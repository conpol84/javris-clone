"""Private bounded text-digest worker bootstrap; no shell or model execution."""

import argparse
import hashlib
import hmac
import json
import os
import socket
import sqlite3
import stat
import threading
import time
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_BODY = 100_000


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def identity(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError("invalid_identity")
    return value


def digest(text):
    if not isinstance(text, str) or len(text.encode("utf-8")) > 65_536:
        raise ValueError("invalid_text")
    raw = text.encode("utf-8")
    return {
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
        "characters": len(text),
    }


def load_config(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_nlink != 1
            or info.st_mode & 0o077
        ):
            raise ValueError("private_config_required")
        cfg = json.load(stream)
    identity(cfg["worker_id"])
    orgs = cfg["organizations"]
    if not isinstance(orgs, list) or not 1 <= len(orgs) <= 8:
        raise ValueError("invalid_organizations")
    for org in orgs:
        identity(org)
    for key in ["worker_token"] + (["admin_token"] if "admin_token" in cfg else []):
        if not isinstance(cfg[key], str) or len(cfg[key]) < 43 or len(cfg[key]) > 128:
            raise ValueError("invalid_token")
    if cfg.get("admin_token") == cfg["worker_token"]:
        raise ValueError("separate_credentials_required")
    return cfg


class Queue:
    def __init__(self, path, worker_id, organizations, clock=time.time):
        self.path = path
        self.worker = identity(worker_id)
        self.orgs = set(map(identity, organizations))
        self.clock = clock
        with self.transaction() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS binding (singleton INTEGER PRIMARY KEY CHECK(singleton=1), scope TEXT NOT NULL)"
            )
            scope = canonical(
                {"worker": self.worker, "organizations": sorted(self.orgs)}
            )
            old_scope = db.execute(
                "SELECT scope FROM binding WHERE singleton=1"
            ).fetchone()
            if old_scope and old_scope[0] != scope:
                raise ValueError("persisted_queue_scope_changed")
            db.execute("INSERT OR IGNORE INTO binding VALUES (1, ?)", (scope,))
            db.execute(
                "CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, org TEXT NOT NULL, payload TEXT NOT NULL, expires REAL NOT NULL, state TEXT NOT NULL, lease TEXT, lease_until REAL, result TEXT)"
            )

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=5)
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def admit(self, body):
        if set(body) != {"job_id", "organization_id", "kind", "text", "ttl_seconds"}:
            raise ValueError("invalid_job")
        job = identity(body["job_id"])
        org = identity(body["organization_id"])
        if org not in self.orgs or body["kind"] != "text_digest":
            raise ValueError("unsupported_scope_or_kind")
        digest(body["text"])
        ttl = body["ttl_seconds"]
        if type(ttl) is not int or not 10 <= ttl <= 300:
            raise ValueError("invalid_expiry")
        payload = canonical(body)
        if len(payload.encode()) > MAX_BODY - 1024:
            raise ValueError("transport_payload_bound")
        with self.transaction() as db:
            old = db.execute(
                "SELECT payload,state FROM jobs WHERE id=?", (job,)
            ).fetchone()
            if old:
                if old[0] != payload:
                    raise ValueError("identity_conflict")
                return {"job_id": job, "status": old[1], "duplicate": True}
            if db.execute("SELECT count(*) FROM jobs").fetchone()[0] >= 100:
                raise ValueError("queue_capacity")
            db.execute(
                "INSERT INTO jobs VALUES (?,?,?,?,?,NULL,NULL,NULL)",
                (job, org, payload, self.clock() + ttl, "queued"),
            )
        return {"job_id": job, "status": "queued", "duplicate": False}

    def claim(self):
        with self.transaction() as db:
            now = self.clock()
            db.execute(
                "UPDATE jobs SET state='review_required' WHERE (state='running' AND lease_until<=?) OR (state='queued' AND expires<=?)",
                (now, now),
            )
            row = db.execute(
                "SELECT id,payload,lease,lease_until FROM jobs WHERE state='running'"
            ).fetchone()
            if not row:
                row = db.execute(
                    "SELECT id,payload FROM jobs WHERE state='queued' ORDER BY rowid LIMIT 1"
                ).fetchone()
                if not row:
                    return {"job": None}
                lease = str(uuid.uuid4())
                until = min(
                    now + 60,
                    db.execute(
                        "SELECT expires FROM jobs WHERE id=?", (row[0],)
                    ).fetchone()[0],
                )
                db.execute(
                    "UPDATE jobs SET state='running',lease=?,lease_until=? WHERE id=?",
                    (lease, until, row[0]),
                )
                row = (*row, lease, until)
            return {
                "job": {
                    "schema": "firbo-private-worker/v1",
                    "worker_id": self.worker,
                    **json.loads(row[1]),
                    "lease_id": row[2],
                    "lease_until": row[3],
                }
            }

    def receipt(self, body):
        if set(body) != {
            "job_id",
            "organization_id",
            "worker_id",
            "lease_id",
            "result",
        }:
            raise ValueError("invalid_receipt")
        with self.transaction() as db:
            row = db.execute(
                "SELECT org,payload,state,lease,lease_until,result FROM jobs WHERE id=?",
                (identity(body["job_id"]),),
            ).fetchone()
            if (
                not row
                or body["worker_id"] != self.worker
                or body["organization_id"] != row[0]
                or body["lease_id"] != row[3]
            ):
                raise ValueError("receipt_identity_conflict")
            if row[2] == "done":
                if canonical(body["result"]) != row[5]:
                    raise ValueError("receipt_conflict")
                return {"accepted": True, "duplicate": True}
            if row[2] != "running" or self.clock() >= row[4]:
                raise ValueError("not_publishable")
            expected = digest(json.loads(row[1])["text"])
            if canonical(body["result"]) != canonical(expected):
                raise ValueError("incorrect_result")
            db.execute(
                "UPDATE jobs SET state='done',result=? WHERE id=?",
                (canonical(expected), body["job_id"]),
            )
            return {"accepted": True, "duplicate": False}

    def stop(self, job):
        with self.transaction() as db:
            db.execute(
                "UPDATE jobs SET state='cancelled' WHERE id=? AND state IN ('queued','running')",
                (identity(job),),
            )
            return self._read(db, job)

    def read(self, job):
        with self.transaction() as db:
            return self._read(db, identity(job))

    @staticmethod
    def _read(db, job):
        row = db.execute(
            "SELECT org,state,result FROM jobs WHERE id=?", (job,)
        ).fetchone()
        if not row:
            raise ValueError("not_found")
        return {
            "job_id": job,
            "organization_id": row[0],
            "status": row[1],
            "result": json.loads(row[2]) if row[2] else None,
        }


def handler_for(queue, worker_token, admin_token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log credentials or job text.

        def handle(self):
            self.connection.settimeout(5)

            def close():
                try:
                    self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

            timer = threading.Timer(5, close)
            timer.start()
            try:
                super().handle()
            finally:
                timer.cancel()
                timer.join()

        def do_GET(self):
            self.route()

        def do_POST(self):
            self.route()

        def do_DELETE(self):
            self.route()

        def route(self):
            status, out = 400, {"error": "invalid_request"}
            try:
                auth = self.headers.get_all("Authorization") or []
                if len(auth) != 1:
                    raise ValueError("authorization_required")
                worker_route = self.path in ("/claim", "/receipt")
                token = worker_token if worker_route else admin_token
                if not hmac.compare_digest(auth[0], "Bearer " + token):
                    status = 401
                    raise ValueError("unauthorized")
                body = {}
                if self.command == "POST":
                    lengths = self.headers.get_all("Content-Length") or []
                    if (
                        self.headers.get_all("Transfer-Encoding")
                        or len(lengths) != 1
                        or not lengths[0].isdigit()
                        or len(lengths[0]) > 6
                    ):
                        raise ValueError("invalid_framing")
                    size = int(lengths[0])
                    if not 2 <= size <= MAX_BODY:
                        raise ValueError("invalid_size")
                    raw = self.rfile.read(size)
                    if len(raw) != size:
                        raise ValueError("incomplete_body")
                    body = json.loads(raw)
                    if not isinstance(body, dict):
                        raise ValueError("invalid_body")
                if self.command == "POST" and self.path == "/jobs":
                    out = queue.admit(body)
                elif self.command == "POST" and self.path == "/claim" and body == {}:
                    out = queue.claim()
                elif self.command == "POST" and self.path == "/receipt":
                    out = queue.receipt(body)
                elif self.command == "GET" and self.path.startswith("/jobs/"):
                    out = queue.read(self.path[6:])
                elif self.command == "DELETE" and self.path.startswith("/jobs/"):
                    out = queue.stop(self.path[6:])
                else:
                    raise ValueError("unsupported_request")
                status = 200
            except (ValueError, KeyError, TypeError, sqlite3.Error, OSError):
                pass
            raw = canonical(out).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(raw)

    return Handler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise ValueError("redirect_denied")


class PrivateServer(ThreadingHTTPServer):
    def __init__(self, *args, **kwargs):
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def endpoint(base):
    url = urlsplit(base)
    if (
        url.username
        or url.password
        or url.path not in ("", "/")
        or url.query
        or url.fragment
    ):
        raise ValueError("invalid_endpoint")
    if url.scheme != "https" and not (
        url.scheme == "http" and url.hostname in ("127.0.0.1", "::1")
    ):
        raise ValueError("https_required")
    if not url.hostname:
        raise ValueError("invalid_endpoint")
    return base.rstrip("/")


def call(base, token, path, body):
    req = Request(
        endpoint(base) + path,
        data=canonical(body).encode(),
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with build_opener(NoRedirect()).open(req, timeout=10) as response:
        raw = response.read(MAX_BODY + 1)
    if len(raw) > MAX_BODY:
        raise ValueError("response_size")
    return json.loads(raw)


def work_once(cfg, cache):
    """One pure operation; receipt cache survives restart/lost ACK, no new job until ACK."""
    with sqlite3.connect(cache) as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS pending (singleton INTEGER PRIMARY KEY CHECK(singleton=1), receipt TEXT NOT NULL)"
        )
        row = db.execute("SELECT receipt FROM pending WHERE singleton=1").fetchone()
        if row:
            cached = json.loads(row[0])
            if cached["server"] != endpoint(cfg["server"]):
                raise ValueError("cached_endpoint_conflict")
            receipt = cached["receipt"]
            if (
                receipt["worker_id"] != cfg["worker_id"]
                or receipt["organization_id"] not in cfg["organizations"]
            ):
                raise ValueError("cached_scope_conflict")
        else:
            job = call(cfg["server"], cfg["worker_token"], "/claim", {}).get("job")
            if job is None:
                return "idle"
            if (
                job.get("schema") != "firbo-private-worker/v1"
                or job.get("worker_id") != cfg["worker_id"]
                or job.get("organization_id") not in cfg["organizations"]
                or job.get("kind") != "text_digest"
                or time.time() >= job.get("lease_until", 0)
            ):
                raise ValueError("invalid_job_scope")
            receipt = {
                "job_id": identity(job["job_id"]),
                "organization_id": identity(job["organization_id"]),
                "worker_id": identity(job["worker_id"]),
                "lease_id": identity(job["lease_id"]),
                "result": digest(job["text"]),
            }
            db.execute(
                "INSERT INTO pending VALUES (1,?)",
                (canonical({"server": endpoint(cfg["server"]), "receipt": receipt}),),
            )
            db.commit()
        ack = call(cfg["server"], cfg["worker_token"], "/receipt", receipt)
        if ack.get("accepted") is not True:
            raise ValueError("receipt_not_accepted")
        db.execute("DELETE FROM pending WHERE singleton=1")
        return "accepted"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("server", "worker"))
    parser.add_argument("--config", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--port", type=int, default=8095)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if os.getuid() == 0:
        raise ValueError("unprivileged_service_user_required")
    cfg = load_config(args.config)
    info = os.lstat(args.state_dir)
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o077
    ):
        raise ValueError("private_state_directory_required")
    os.umask(0o077)
    dbpath = os.path.join(args.state_dir, args.mode + ".sqlite3")
    if os.path.lexists(dbpath):
        st = os.lstat(dbpath)
        if (
            not stat.S_ISREG(st.st_mode)
            or st.st_nlink != 1
            or st.st_uid != os.getuid()
            or st.st_mode & 0o077
        ):
            raise ValueError("private_database_required")
    if args.mode == "server":
        queue = Queue(dbpath, cfg["worker_id"], cfg["organizations"])
        server = PrivateServer(
            ("127.0.0.1", args.port),
            handler_for(queue, cfg["worker_token"], cfg["admin_token"]),
        )
        server.serve_forever()
    else:
        while True:
            outcome = work_once(cfg, dbpath)
            print(outcome, flush=True)
            if args.once:
                break
            time.sleep(5)


if __name__ == "__main__":
    main()
