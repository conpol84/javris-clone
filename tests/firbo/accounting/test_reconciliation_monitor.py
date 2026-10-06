"""Offline process-boundary tests; no connection to production/provider."""

import importlib.util
import json
import unittest
from pathlib import Path
from subprocess import CompletedProcess

SPEC = importlib.util.spec_from_file_location(
    "monitor", Path(__file__).parents[3] / "tools/firbo-accounting-monitor.py"
)
monitor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(monitor)
ORG = "11111111-0815-4815-8815-111111111111"


class MonitorTests(unittest.TestCase):
    def test_injection_and_unbounded_reads_are_rejected(self):
        for org, limit, stale in [
            ("';DELETE FROM tasks;--", 1, 1),
            (ORG, 0, 1),
            (ORG, 201, 1),
            (ORG, 1, 0),
            (ORG, 1, 10081),
        ]:
            with self.assertRaises(ValueError):
                monitor.query(org, limit, stale)

    def test_operator_process_has_no_credentials_or_shell_in_argv(self):
        def run(argv, **kwargs):
            self.assertEqual(
                argv,
                [
                    "psql",
                    "-X",
                    "--no-password",
                    "-qAt",
                    "-v",
                    "ON_ERROR_STOP=1",
                    "-f",
                    "-",
                ],
            )
            self.assertNotIn("shell", kwargs)
            self.assertEqual(kwargs["timeout"], 10)
            self.assertIn("REPEATABLE READ READ ONLY", kwargs["input"])
            self.assertTrue(kwargs["input"].endswith("ROLLBACK;\n"))
            return CompletedProcess(
                argv,
                0,
                json.dumps(
                    {"contract": "firbo-accounting-monitor/v1", "read_only": True}
                ),
                "",
            )

        self.assertTrue(monitor.snapshot(monitor.query(ORG), run)["read_only"])

    def test_query_is_scoped_and_contains_no_customer_content(self):
        sql = monitor.query(ORG)
        self.assertIn(f"organization_id = '{ORG}'::uuid", sql)
        self.assertIn("LIMIT 100", sql)
        self.assertNotIn("reconcile_reason", sql)
        self.assertNotIn("request_key", sql)
        self.assertNotIn("payload_sha256", sql)
        self.assertNotIn("model", sql)

    def test_database_error_text_never_leaves_process_boundary(self):
        def run(argv, **kwargs):
            return CompletedProcess(argv, 1, "", "secret-password and private endpoint")

        with self.assertRaisesRegex(RuntimeError, "^monitor_query_failed$"):
            monitor.snapshot(monitor.query(ORG), run)

    def test_fail_closed_on_write_capable_or_invalid_receipt(self):
        for receipt in [
            {"contract": "firbo-accounting-monitor/v1", "read_only": False},
            {"read_only": True},
            [],
        ]:

            def run(argv, **kwargs):
                return CompletedProcess(argv, 0, json.dumps(receipt), "")

            with self.assertRaises(RuntimeError):
                monitor.snapshot(monitor.query(ORG), run)


if __name__ == "__main__":
    unittest.main()
