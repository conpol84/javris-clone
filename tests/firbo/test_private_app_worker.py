"""Real SQLite, HTTP and worker, isolated temporary data only."""

import concurrent.futures
import importlib.util
import json
import socket
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location(
    "firbo_private_worker",
    Path(__file__).resolve().parents[2] / "deploy/worker/firbo_worker.py",
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
WORKER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
WT, AT = "w" * 48, "a" * 48


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.now = time.time()
        self.queue = m.Queue(
            str(Path(self.temp.name) / "queue.sqlite3"),
            WORKER,
            [ORG],
            clock=lambda: self.now,
        )

    def job(self, **changes):
        return {
            "job_id": str(uuid.uuid4()),
            "organization_id": ORG,
            "kind": "text_digest",
            "text": "Γεια σου FIRBO",
            "ttl_seconds": 120,
            **changes,
        }

    def receipt(self, job):
        return {
            key: job[key]
            for key in ("job_id", "organization_id", "worker_id", "lease_id")
        } | {"result": m.digest(job["text"])}

    def server(self):
        server = m.PrivateServer(("127.0.0.1", 0), m.handler_for(self.queue, WT, AT))
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        self.addCleanup(
            lambda: (server.shutdown(), server.server_close(), thread.join())
        )
        return f"http://127.0.0.1:{server.server_port}", server

    def test_durable_replay_conflict(self):
        body = self.job()
        self.assertFalse(self.queue.admit(body)["duplicate"])
        reopened = m.Queue(self.queue.path, WORKER, [ORG])
        self.assertTrue(reopened.admit(body)["duplicate"])
        with self.assertRaises(ValueError):
            reopened.admit({**body, "text": "changed"})

    def test_persisted_queue_scope_is_immutable(self):
        for worker, organizations in (
            (OTHER, [ORG]),
            (WORKER, [OTHER]),
            (WORKER, [ORG, OTHER]),
        ):
            with self.assertRaisesRegex(ValueError, "persisted_queue_scope_changed"):
                m.Queue(self.queue.path, worker, organizations)
        m.Queue(self.queue.path, WORKER, [ORG])

    def test_scope_and_no_shell_provider_or_path(self):
        for delta in (
            {"organization_id": OTHER},
            {"kind": "exec"},
            {"kind": "embedding"},
            {"path": "/etc/passwd"},
            {"url": "http://internal"},
        ):
            with self.subTest(delta=delta), self.assertRaises(ValueError):
                self.queue.admit(self.job(**delta))

    def test_text_and_expiry_bounds(self):
        for delta in (
            {"text": "x" * 65537},
            {"text": None},
            {"ttl_seconds": True},
            {"ttl_seconds": 301},
            {"ttl_seconds": 9},
        ):
            with self.subTest(delta=delta), self.assertRaises(ValueError):
                self.queue.admit(self.job(**delta))
        with self.assertRaises(ValueError):
            self.queue.admit(self.job(text="α" * 30000))

    def test_single_winner_real_sqlite_threads(self):
        self.queue.admit(self.job())
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            jobs = list(pool.map(lambda _: self.queue.claim()["job"], range(16)))
        self.assertEqual(len({j["lease_id"] for j in jobs}), 1)
        self.assertEqual(len({j["job_id"] for j in jobs}), 1)

    def test_dead_worker_not_automatically_requeued(self):
        body = self.job()
        self.queue.admit(body)
        job = self.queue.claim()["job"]
        self.now += 61
        self.assertIsNone(self.queue.claim()["job"])
        self.assertEqual(self.queue.read(body["job_id"])["status"], "review_required")
        with self.assertRaises(ValueError):
            self.queue.receipt(self.receipt(job))

    def test_cancel_blocks_publication(self):
        body = self.job()
        self.queue.admit(body)
        job = self.queue.claim()["job"]
        self.queue.stop(body["job_id"])
        with self.assertRaises(ValueError):
            self.queue.receipt(self.receipt(job))
        self.assertEqual(self.queue.read(body["job_id"])["status"], "cancelled")

    def test_receipt_identity_hash_and_duplicate(self):
        body = self.job()
        self.queue.admit(body)
        receipt = self.receipt(self.queue.claim()["job"])
        for delta in (
            {"organization_id": OTHER},
            {"worker_id": str(uuid.uuid4())},
            {"lease_id": str(uuid.uuid4())},
            {"result": {"sha256": "invented"}},
        ):
            with self.subTest(delta=delta), self.assertRaises(ValueError):
                self.queue.receipt({**receipt, **delta})
        self.assertFalse(self.queue.receipt(receipt)["duplicate"])
        self.assertTrue(self.queue.receipt(receipt)["duplicate"])
        self.assertEqual(self.queue.stop(body["job_id"])["status"], "done")

    def test_cancellation_publication_race_serialized(self):
        for _ in range(10):
            body = self.job()
            self.queue.admit(body)
            receipt = self.receipt(self.queue.claim()["job"])

            def publish(receipt=receipt):
                try:
                    return self.queue.receipt(receipt)
                except ValueError:
                    return "denied"

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                a, b = (
                    pool.submit(publish),
                    pool.submit(self.queue.stop, body["job_id"]),
                )
                result, stopped = a.result(), b.result()
            state = self.queue.read(body["job_id"])
            self.assertIn(state["status"], ["done", "cancelled"])
            self.assertEqual(state["result"] is not None, state["status"] == "done")
            if stopped["status"] == "cancelled":
                self.assertEqual(result, "denied")

    def test_actual_http_worker_and_independent_result(self):
        base, _ = self.server()
        body = self.job()
        m.call(base, AT, "/jobs", body)
        cfg = {
            "worker_id": WORKER,
            "organizations": [ORG],
            "worker_token": WT,
            "server": base,
        }
        cache = str(Path(self.temp.name) / "worker.sqlite3")
        self.assertEqual(m.work_once(cfg, cache), "accepted")
        req = Request(
            base + "/jobs/" + body["job_id"], headers={"Authorization": "Bearer " + AT}
        )
        with urlopen(req) as res:
            observed = json.load(res)
        self.assertEqual(observed["status"], "done")
        import hashlib

        self.assertEqual(
            observed["result"]["sha256"],
            hashlib.sha256(body["text"].encode()).hexdigest(),
        )
        self.assertEqual(m.work_once(cfg, cache), "idle")

    def test_separate_tokens_admin_not_worker(self):
        base, _ = self.server()
        for token, path, body in [
            (WT, "/jobs", self.job()),
            (AT, "/claim", {}),
            ("bad", "/claim", {}),
        ]:
            with (
                self.subTest(path=path, token=token[:1]),
                self.assertRaises(HTTPError) as ctx,
            ):
                m.call(base, token, path, body)
            self.assertEqual(ctx.exception.code, 401)

    def test_lost_ack_reuses_cached_receipt_without_new_claim(self):
        base, _ = self.server()
        body = self.job()
        self.queue.admit(body)
        cfg = {
            "worker_id": WORKER,
            "organizations": [ORG],
            "worker_token": WT,
            "server": base,
        }
        cache = str(Path(self.temp.name) / "worker.sqlite3")
        original = m.call
        paths = []

        def lose_ack(*args):
            paths.append(args[2])
            out = original(*args)
            if args[2] == "/receipt":
                raise OSError("lost response")
            return out

        with patch.object(m, "call", lose_ack), self.assertRaises(OSError):
            m.work_once(cfg, cache)
        self.assertEqual(self.queue.read(body["job_id"])["status"], "done")
        with patch.object(m, "call", lambda *a: (paths.append(a[2]), original(*a))[1]):
            self.assertEqual(m.work_once(cfg, cache), "accepted")
        self.assertEqual(paths.count("/claim"), 1)
        self.assertEqual(paths.count("/receipt"), 2)

    def test_cached_receipt_not_sent_to_changed_server_or_tenant(self):
        base, _ = self.server()
        self.queue.admit(self.job())
        cfg = {
            "worker_id": WORKER,
            "organizations": [ORG],
            "worker_token": WT,
            "server": base,
        }
        cache = str(Path(self.temp.name) / "worker.sqlite3")
        original = m.call

        def disconnected(*args):
            if args[2] == "/receipt":
                raise OSError("offline")
            return original(*args)

        with patch.object(m, "call", disconnected), self.assertRaises(OSError):
            m.work_once(cfg, cache)
        for updated in (
            {**cfg, "server": "https://changed.example.test"},
            {**cfg, "organizations": [OTHER]},
        ):
            with patch.object(m, "call") as transport, self.assertRaises(ValueError):
                m.work_once(updated, cache)
            transport.assert_not_called()

    def test_worker_rejects_malicious_scope_before_computation(self):
        cfg = {
            "worker_id": WORKER,
            "organizations": [ORG],
            "worker_token": WT,
            "server": "https://worker.example.test",
        }
        for delta in (
            {"organization_id": OTHER},
            {"kind": "shell_exec"},
            {"worker_id": str(uuid.uuid4())},
            {"lease_until": 0},
        ):
            job = {
                **self.job(),
                "schema": "firbo-private-worker/v1",
                "worker_id": WORKER,
                "lease_id": str(uuid.uuid4()),
                "lease_until": time.time() + 60,
                **delta,
            }
            with (
                patch.object(m, "call", return_value={"job": job}) as transport,
                patch.object(m, "digest") as compute,
                self.assertRaises(ValueError),
            ):
                m.work_once(cfg, str(Path(self.temp.name) / str(uuid.uuid4())))
            compute.assert_not_called()
            self.assertEqual(transport.call_count, 1)

    def test_endpoint_tls_and_redirect_boundaries(self):
        for url in [
            "http://public.example",
            "https://user:pass@example.test",
            "https://example.test/path",
            "https://example.test/?x=1",
            "file:///tmp/x",
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                m.endpoint(url)
        self.assertEqual(
            m.endpoint("https://worker.example.test/"), "https://worker.example.test"
        )
        with self.assertRaises(ValueError):
            m.NoRedirect().redirect_request(None, None, None, None, None)

    def test_private_config_and_no_symlinks(self):
        path = Path(self.temp.name) / "config.json"
        path.write_text(
            json.dumps(
                {
                    "worker_id": WORKER,
                    "organizations": [ORG],
                    "worker_token": WT,
                    "admin_token": AT,
                }
            )
        )
        path.chmod(0o600)
        self.assertEqual(m.load_config(path)["worker_id"], WORKER)
        path.chmod(0o644)
        with self.assertRaises(ValueError):
            m.load_config(path)
        path.chmod(0o600)
        link = Path(self.temp.name) / "link"
        link.symlink_to(path)
        with self.assertRaises(OSError):
            m.load_config(link)

    def test_duplicate_http_auth_rejected(self):
        _base, server = self.server()
        with socket.create_connection(("127.0.0.1", server.server_port)) as conn:
            conn.sendall(
                (
                    "POST /claim HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer "
                    + WT
                    + "\r\nAuthorization: Bearer "
                    + WT
                    + "\r\nContent-Length: 2\r\n\r\n{}"
                ).encode()
            )
            self.assertIn(b"400", conn.recv(1024))
        self.assertEqual(self.queue.claim(), {"job": None})


if __name__ == "__main__":
    unittest.main()
