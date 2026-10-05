"""Offline regression tests; all upstreams and Docker are mocked."""

import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "free_models", ROOT / "deploy/hostinger/free_models.py"
)
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
HTML = """<table><tr><th>Model</th><th>Model ID</th><th>Endpoint</th><th>AI SDK Package</th></tr>
<tr><td>Example Free</td><td><code>example-free</code></td><td>https://opencode.ai/zen/v1/chat/completions</td><td>sdk</td></tr>
<tr><td>Retired Free</td><td>retired-free</td><td>https://opencode.ai/zen/v1/chat/completions</td><td>sdk</td></tr>
<tr><td>Paid Free Name</td><td>not-actually-free</td><td>https://opencode.ai/zen/v1/chat/completions</td><td>sdk</td></tr>
<tr><td>Other Free</td><td>other-free</td><td>https://opencode.ai/zen/v1/responses</td><td>sdk</td></tr></table>
<table><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th></tr>
<tr><td>Example Free</td><td>Free</td><td>Free</td><td>Free</td><td>-</td></tr>
<tr><td>Retired Free</td><td>Free</td><td>Free</td><td>Free</td><td>-</td></tr>
<tr><td>Paid Free Name</td><td>$0.01</td><td>Free</td><td>Free</td><td>-</td></tr>
<tr><td>Other Free</td><td>Free</td><td>Free</td><td>Free</td><td>-</td></tr></table>"""
OC = {"data": [{"id": x} for x in ("example-free", "not-actually-free", "other-free")]}


def or_model(ident="vendor/example:free", **kw):
    return {
        "id": ident,
        "name": "Example",
        "pricing": {"prompt": "0", "completion": "0", "request": "0"},
        "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
        **kw,
    }


class Tests(unittest.TestCase):
    def test_zero_is_explicit_finite_number(self):
        for v in ["0", "0.000", "0e5", 0, 0.0]:
            self.assertTrue(f.zero(v))
        for v in [
            None,
            False,
            True,
            "",
            "Free",
            "NaN",
            "Infinity",
            float("nan"),
            -1,
            "0.01",
            {},
            [],
        ]:
            self.assertFalse(f.zero(v))

    def test_model_identifier_not_path_or_header(self):
        for v in ["vendor/model:free", "a_b-2.5", "org/model/name"]:
            self.assertTrue(f.model_id(v))
        for v in [
            "../evil",
            "x\nAuthorization:y",
            "https://host",
            "/absolute",
            "a b",
            "",
            None,
            "x" * 251,
        ]:
            self.assertFalse(f.model_id(v))

    def test_opencode_live_intersection_and_protocol(self):
        data = f.opencode_offers(OC, HTML)
        self.assertEqual([r["model_id"] for r in data], ["example-free"])
        self.assertFalse(data[0]["inference_tested"])
        self.assertTrue(data[0]["public_data_only"])

    def test_opencode_paid_cached_write_not_free(self):
        self.assertEqual(
            f.opencode_offers(OC, HTML.replace("<td>-</td>", "<td>$0.01</td>")), []
        )

    def test_opencode_price_source_missing_blocks(self):
        with self.assertRaises(f.Blocked):
            f.opencode_offers(OC, "<html>No pricing</html>")

    def test_opencode_ambiguous_price_source_blocks(self):
        with self.assertRaises(f.Blocked):
            f.opencode_offers(OC, HTML + HTML)

    def test_opencode_new_table_shape_blocks(self):
        with self.assertRaises(f.Blocked):
            f.opencode_offers(OC, HTML.replace("<td>sdk</td>", ""))

    def test_opencode_empty_live_source_blocks(self):
        with self.assertRaises(f.Blocked):
            f.opencode_offers({"data": []}, HTML)

    def test_duplicate_ids_block(self):
        with self.assertRaises(f.Blocked):
            f.opencode_offers(
                {"data": [{"id": "example-free"}, {"id": "example-free"}]}, HTML
            )

    def test_openrouter_explicit_zero_free_variants(self):
        out = f.openrouter_offers(
            {"data": [or_model(), or_model("openrouter/free"), or_model("vendor/paid")]}
        )
        self.assertEqual(len(out), 2)

    def test_openrouter_auto_free_is_not_free_router(self):
        self.assertEqual(
            f.openrouter_offers({"data": [or_model("openrouter/auto:free")]}), []
        )

    def test_openrouter_unknown_price_blocks(self):
        for pricing in [
            None,
            {},
            {"prompt": "0"},
            {"prompt": "0", "completion": "0", "new_fee": None},
            {"prompt": "0", "completion": "0", "new_fee": "1"},
        ]:
            self.assertEqual(
                f.openrouter_offers({"data": [or_model(pricing=pricing)]}), []
            )

    def test_openrouter_nontext_blocked(self):
        for architecture in [
            None,
            {},
            {"input_modalities": ["text"], "output_modalities": ["image"]},
            {"input_modalities": ["image"], "output_modalities": ["text"]},
        ]:
            self.assertEqual(
                f.openrouter_offers({"data": [or_model(architecture=architecture)]}), []
            )

    def test_openrouter_nonzero_and_boolean_price_blocked(self):
        for price in [False, -1, "NaN", "0.0001"]:
            self.assertEqual(
                f.openrouter_offers(
                    {"data": [or_model(pricing={"prompt": price, "completion": "0"})]}
                ),
                [],
            )

    def test_source_failure_is_explicit_not_empty_success(self):
        def fetch(url):
            if url == f.SOURCES["openrouter_models"]:
                return {"data": [or_model()]}
            raise f.Blocked("http_503")

        result = f.discover(fetch)
        self.assertEqual(result["source_errors"], {"opencode": "http_503"})
        self.assertEqual(len(result["offers"]), 1)

    def test_request_forbids_credential_exfiltration(self):
        with patch.object(f.urllib.request, "build_opener") as network:
            with self.assertRaises(f.Blocked):
                f.request("https://other.test", key="secret")
            with self.assertRaises(f.Blocked):
                f.request(f.SOURCES["openrouter_models"], key="secret")
            network.assert_not_called()

    def test_request_forbids_arbitrary_mutation(self):
        with patch.object(f.urllib.request, "build_opener") as network:
            with self.assertRaises(f.Blocked):
                f.request(f.GATEWAY + "/api/combos", key="secret", body={})
            network.assert_not_called()

    def test_http_error_body_never_displayed(self):
        error = f.urllib.error.HTTPError(
            f.GATEWAY, 401, "secret-token", {}, io.BytesIO(b"secret-body")
        )
        with patch.object(f.urllib.request, "build_opener") as build:
            build.return_value.open.side_effect = error
            with self.assertRaisesRegex(f.Blocked, "^http_401$"):
                f.request(f.SOURCES["openrouter_models"])

    def test_redirect_refused(self):
        self.assertIsNone(
            f.NoRedirect().redirect_request(
                None, None, 302, "", {}, "https://other.test"
            )
        )

    def test_active_connection_must_be_explicit(self):
        payload = {
            "connections": [
                {"provider": "opencode", "isActive": True},
                {"provider": "openrouter", "isActive": False},
                {"provider": "openrouter"},
            ]
        }
        self.assertEqual(f.active_providers(payload), {"opencode"})

    def test_truncated_providers_blocks(self):
        with self.assertRaises(f.Blocked):
            f.active_providers({"connections": [], "total": 2})

    def plan(self, custom=None, registered=None, active=None):
        return f.registration_plan(
            [f.offer("opencode", "example-free", "Example", "source")],
            {"opencode"} if active is None else active,
            {"opencode": {"models": []} if custom is None else custom},
            {"data": [] if registered is None else registered},
        )

    def test_new_model_can_be_registered(self):
        self.assertEqual(len(self.plan()), 1)

    def test_disconnected_provider_not_connected_automatically(self):
        self.assertEqual(self.plan(active=set()), [])

    def test_existing_operator_model_preserved(self):
        self.assertEqual(
            self.plan(custom={"models": [{"id": "example-free", "isFree": False}]}), []
        )

    def test_hidden_model_not_unhidden(self):
        self.assertEqual(
            self.plan(
                custom={
                    "models": [],
                    "hiddenModelsByProvider": {"opencode": ["example-free"]},
                }
            ),
            [],
        )

    def test_gateway_alias_catalogue_deduplication(self):
        for ident in ["oc/example-free", "opencode/example-free"]:
            self.assertEqual(self.plan(registered=[{"id": ident}]), [])

    def test_same_name_other_provider_not_deduplicated(self):
        self.assertEqual(
            len(
                self.plan(
                    registered=[{"id": "other/example-free", "owned_by": "other"}]
                )
            ),
            1,
        )

    def test_journal_is_private_and_exclusive(self):
        with tempfile.TemporaryDirectory() as tmp:
            j = f.Journal(Path(tmp) / "audit")
            j.write({"phase": "test"})
            j.close()
            self.assertEqual(Path(j.path).stat().st_mode & 0o777, 0o600)
            self.assertEqual(Path(j.path).parent.stat().st_mode & 0o777, 0o700)

    def test_journal_rejects_broad_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "audit"
            root.mkdir(mode=0o755)
            with self.assertRaises(f.Blocked):
                f.Journal(root)

    def test_journal_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "link"
            root.symlink_to(Path(tmp))
            with self.assertRaises(f.Blocked):
                f.Journal(root)

    def test_registration_readback_and_no_other_writes(self):
        stored = []
        writes = []
        journal = []

        class J:
            def write(self, v):
                journal.append(v)

        def call(path, body=None):
            if body is not None:
                self.assertEqual(path, "/api/provider-models")
                writes.append(body)
                stored.append(
                    {
                        "id": body["modelId"],
                        "isFree": True,
                        "apiFormat": "chat-completions",
                    }
                )
                return {"model": stored[-1]}
            return {"models": stored}

        out = f.register(self.plan(), call, J())
        self.assertEqual(len(out), 1)
        self.assertEqual(len(writes), 1)
        self.assertEqual([r["phase"] for r in journal], ["requested", "verified"])

    def test_failed_registration_never_retried(self):
        calls = []
        journal = []

        class J:
            def write(self, v):
                journal.append(v)

        def call(path, body=None):
            if body is not None:
                calls.append(path)
                raise f.Blocked("http_502")
            return {"models": []}

        with self.assertRaises(f.Blocked):
            f.register(self.plan(), call, J())
        self.assertEqual(len(calls), 1)
        self.assertEqual(journal[-1]["phase"], "reconcile_required")

    def test_http_success_without_readback_is_not_success(self):
        class J:
            def write(self, v):
                pass

        with self.assertRaises(f.Blocked):
            f.register(self.plan(), lambda p, b=None: {"models": []}, J())

    def test_failed_audit_stops_before_mutation(self):
        writes = []

        class J:
            def write(self, v):
                raise OSError("audit unavailable")

        def call(p, b=None):
            if b is not None:
                writes.append(b)
            return {"models": []}

        with self.assertRaises(OSError):
            f.register(self.plan(), call, J())
        self.assertEqual(writes, [])

    def test_apply_has_no_inference_or_restart_commands(self):
        source = (ROOT / "deploy/hostinger/free_models.py").read_text()
        self.assertNotIn("'exec'", source)
        self.assertNotIn("'restart'", source)
        self.assertNotIn("'stop'", source)
        # A completion URL appears only in public documentation matching, never as a request target.
        with patch.object(f.urllib.request, "build_opener") as net:
            with self.assertRaises(f.Blocked):
                f.request(
                    f.GATEWAY + "/v1/chat/completions",
                    key="x",
                    body={"provider": "opencode", "modelId": "x"},
                )
            net.assert_not_called()

    def test_public_mode_does_not_read_runtime(self):
        with (
            patch.object(
                f, "discover", return_value={"offers": [{}], "source_errors": {}}
            ),
            patch.object(f, "runtime") as runtime,
        ):
            report, code = f.run(public_only=True)
            self.assertEqual(code, 0)
            self.assertEqual(report["inference_requests"], 0)
            runtime.assert_not_called()


if __name__ == "__main__":
    unittest.main()
