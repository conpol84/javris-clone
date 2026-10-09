"""VPS selection and actual ASGI authentication, without device/provider effects."""

import copy
import datetime as dt
import importlib.util
import json
import os
import pathlib
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "firbo_dispatch", ROOT / "src/openjarvis/server/firbo_dispatch.py"
)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
ORG = "45e05812-a860-489e-b758-1f16be8c2db8"
LINUX = "c40d6e28-bc44-44cb-b883-aeb2e3ac4b6f"
MAC = "7d30aab5-3158-4f3f-a4bd-d55f34437159"
NOW = dt.datetime(2026, 10, 9, 11, 30, tzinfo=dt.timezone.utc)


def device(identifier=LINUX, **updates):
    mac = identifier == MAC
    return {
        "id": identifier,
        "name": "Polis1984" if mac else "My shell",
        "platform": "darwin x64" if mac else "linux x64",
        "organization_id": ORG,
        "paired": True,
        "revoked_at": None,
        "last_seen_at": NOW.isoformat(),
        "capabilities": {
            "full_control": not mac,
            "job_kinds": ["list", "read", "browser_open"]
            + ([] if mac else ["desktop_task"]),
        },
        "agent_policy": {"enabled": True, "control": "full", "hours": None},
        "load": 0,
        **updates,
    }


def request(**updates):
    return {
        "contract": m.CONTRACT,
        "request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "organization_id": ORG,
        "kind": "desktop_task",
        "params": {"goal": "Άνοιξε YouTube και παίξε Ώρες Μικρές"},
        "devices": [device(MAC), device()],
        **updates,
    }


class SelectorTests(unittest.TestCase):
    def select(self, body):
        return m.select_worker(body, now=NOW)

    def test_native_work_selects_actual_debian_capability_despite_legacy_mac(self):
        body = request()
        before = copy.deepcopy(body)
        chosen = self.select(body)
        self.assertEqual(chosen["worker"]["id"], LINUX)
        self.assertEqual(
            chosen["job"], {"kind": body["kind"], "params": body["params"]}
        )
        self.assertEqual(body, before)

    def test_goal_search_mentions_are_data_not_routing(self):
        out = self.select(
            request(params={"goal": "Search YouTube for Mac OS developer music"})
        )
        self.assertEqual(out["worker"]["id"], LINUX)

    def test_explicit_unsupported_mac_never_falls_to_debian(self):
        for target in ({"target": "mac"}, {"device_id": MAC}, {"target": "Polis1984"}):
            with (
                self.subTest(target=target),
                self.assertRaisesRegex(m.DispatchError, "target_unavailable"),
            ):
                self.select(request(**target))

    def test_missing_explicit_worker_and_conflicting_targets_are_denied(self):
        for target in (
            {"device_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
            {"device_id": LINUX, "target": "mac"},
        ):
            with self.subTest(target=target), self.assertRaises(m.DispatchError):
                self.select(request(**target))

    def test_lowest_load_then_stable_identity_regardless_of_inventory_order(self):
        for devices in ([device(), device(MAC)], [device(MAC), device()]):
            out = self.select(
                request(kind="read", params={"path": "notes.txt"}, devices=devices)
            )
            self.assertEqual(out["worker"]["id"], MAC)
        out = self.select(
            request(
                kind="read",
                params={"path": "notes.txt"},
                devices=[device(MAC, load=2), device(load=1)],
            )
        )
        self.assertEqual(out["worker"]["id"], LINUX)

    def test_availability_and_full_control_are_required(self):
        variants = [
            {"paired": False},
            {"revoked_at": NOW.isoformat()},
            {"last_seen_at": (NOW - dt.timedelta(seconds=61)).isoformat()},
            {"last_seen_at": (NOW + dt.timedelta(minutes=10)).isoformat()},
            {"last_seen_at": None},
            {"agent_policy": {"enabled": False}},
            {"agent_policy": {"enabled": True, "control": "guarded"}},
            {"capabilities": {"job_kinds": ["desktop_task"], "full_control": False}},
        ]
        for update in variants:
            with (
                self.subTest(update=update),
                self.assertRaisesRegex(m.DispatchError, "no_eligible_worker"),
            ):
                self.select(request(devices=[device(**update)]))

    def test_working_hours_timezone_and_overnight_window(self):
        policy = {
            "enabled": True,
            "control": "full",
            "hours": {"from": 13, "to": 14, "tz": "Europe/Paris"},
        }
        self.assertEqual(
            self.select(request(devices=[device(agent_policy=policy)]))["worker"]["id"],
            LINUX,
        )
        policy["hours"]["from"], policy["hours"]["to"] = 14, 15
        with self.assertRaisesRegex(m.DispatchError, "no_eligible_worker"):
            self.select(request(devices=[device(agent_policy=policy)]))
        policy["hours"]["from"], policy["hours"]["to"] = 23, 14
        self.assertEqual(
            self.select(request(devices=[device(agent_policy=policy)]))["worker"]["id"],
            LINUX,
        )
        policy["hours"]["tz"] = "invalid/timezone"
        with self.assertRaisesRegex(m.DispatchError, "invalid_working_hours"):
            self.select(request(devices=[device(agent_policy=policy)]))

    def test_open_app_uses_native_desktop_when_no_legacy_launcher_exists(self):
        out = self.select(
            request(
                kind="open_app", params={"app": "Google Chrome"}, goal="Άνοιξε Chrome"
            )
        )
        self.assertEqual(
            out["job"], {"kind": "desktop_task", "params": {"goal": "Άνοιξε Chrome"}}
        )
        out = self.select(request(kind="open_app", params={"app": "Google Chrome"}))
        self.assertEqual(out["job"]["params"], {"goal": "Open Google Chrome"})

    def test_safari_requires_capable_mac_and_preserves_legacy_launch(self):
        with self.assertRaisesRegex(m.DispatchError, "no_eligible_worker"):
            self.select(request(kind="open_app", params={"app": "Safari"}))
        d = device(MAC, capabilities={"job_kinds": ["open_app"]})
        out = self.select(
            request(kind="open_app", params={"app": "Safari"}, devices=[device(), d])
        )
        self.assertEqual(out["worker"]["id"], MAC)
        self.assertEqual(out["job"], {"kind": "open_app", "params": {"app": "Safari"}})

    def test_server_work_is_vps_local_and_cannot_take_device_target(self):
        body = request(
            kind="server_task", params={"input": "calculate 2+2"}, devices=[]
        )
        out = self.select(body)
        self.assertEqual(out["worker"]["kind"], "vps")
        self.assertEqual(out["job"]["params"], body["params"])
        with self.assertRaisesRegex(m.DispatchError, "server_task_has_device_target"):
            self.select({**body, "target": "mac"})

    def test_foreign_company_inventory_rejected_even_for_vps_work(self):
        for kind in ("desktop_task", "server_task"):
            with (
                self.subTest(kind=kind),
                self.assertRaisesRegex(m.DispatchError, "foreign_company_inventory"),
            ):
                self.select(
                    request(
                        kind=kind,
                        devices=[
                            device(
                                organization_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
                            )
                        ],
                    )
                )

    def test_duplicate_workers_and_malformed_input_rejected(self):
        cases = [
            request(devices=[device(), device()]),
            request(extra="secret"),
            request(kind="arbitrary_code"),
            request(params=[]),
            request(devices=[device(load=True)]),
            request(devices=[device(last_seen_at="2026-10-09")]),
            request(
                devices=[
                    device(capabilities={"job_kinds": ["desktop_task", "desktop_task"]})
                ]
            ),
            request(params={"big": "x" * m.MAX_BODY}),
            request(params={"number": float("nan")}),
        ]
        for body in cases:
            with (
                self.subTest(kind=body.get("kind")),
                self.assertRaises(m.DispatchError),
            ):
                self.select(body)

    def test_explicit_ambiguous_platform_target_requires_unique_worker(self):
        other = device("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        with self.assertRaisesRegex(m.DispatchError, "target_ambiguous"):
            self.select(request(target="linux", devices=[device(), other]))


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.state.api_key = "fixture-only-key"
        with patch.dict(os.environ, {"FIRBO_WORKER_DISPATCH_ENABLED": "1"}):
            self.assertTrue(m.install_worker_dispatch(self.app))
            self.assertTrue(m.install_worker_dispatch(self.app))
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.headers = {"Authorization": "Bearer fixture-only-key"}

    def test_config_opt_in_and_configured_key_required(self):
        app = FastAPI()
        with patch.dict(os.environ, {"FIRBO_WORKER_DISPATCH_ENABLED": "0"}):
            self.assertFalse(m.install_worker_dispatch(app))
        with (
            patch.dict(os.environ, {"FIRBO_WORKER_DISPATCH_ENABLED": "1"}),
            self.assertRaisesRegex(m.DispatchError, "dispatch_requires_api_key"),
        ):
            m.install_worker_dispatch(app)

    def test_anonymous_bad_and_duplicate_auth_never_select(self):
        for headers in (
            {},
            {"Authorization": "Bearer wrong"},
            [
                ("Authorization", "Bearer fixture-only-key"),
                ("Authorization", "Bearer fixture-only-key"),
            ],
        ):
            response = self.client.post(
                "/v1/firbo/dispatch", json=request(), headers=headers
            )
            self.assertEqual(response.status_code, 401)

    def test_real_endpoint_selects_without_executing_and_preserves_contract(self):
        body = request(
            kind="server_task", params={"input": "Do not execute this"}, devices=[]
        )
        response = self.client.post(
            "/v1/firbo/dispatch", json=body, headers=self.headers
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["request_id"], body["request_id"])
        self.assertEqual(response.json()["job"]["params"], body["params"])
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(
            len([r for r in self.app.routes if r.path == "/v1/firbo/dispatch"]), 1
        )

    def test_real_endpoint_input_auth_and_unavailable_codes(self):
        self.assertEqual(
            self.client.post(
                "/v1/firbo/dispatch", json=request(devices=[]), headers=self.headers
            ).status_code,
            409,
        )
        self.assertEqual(
            self.client.post(
                "/v1/firbo/dispatch", content=b"{}", headers=self.headers
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                "/v1/firbo/dispatch",
                content=b"not JSON",
                headers={**self.headers, "Content-Type": "application/json"},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                "/v1/firbo/dispatch",
                content=json.dumps(request(params={"large": "x" * m.MAX_BODY})),
                headers={**self.headers, "Content-Type": "application/json"},
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.get("/v1/firbo/dispatch", headers=self.headers).status_code, 405
        )


if __name__ == "__main__":
    unittest.main()
