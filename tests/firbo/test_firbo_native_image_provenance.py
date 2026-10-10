"""Synthetic, no-network unit tests for the FIRBO image provenance readback."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "firbo_native_image_provenance",
    ROOT / "deploy" / "hostinger" / "firbo_native_image_provenance.py",
)
assert SPEC is not None and SPEC.loader is not None
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


def test_empty_git_blob_is_exact_git_hash_object():
    assert probe.git_blob_sha1(b"") == "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"


def test_reviewed_native_module_file_has_pinned_git_blob_hash():
    content = (ROOT / "src/openjarvis/server/firbo_free_app.py").read_bytes()
    assert probe.git_blob_sha1(content) == probe.REVIEWED_GIT_BLOB_SHA1


@pytest.mark.parametrize(
    "methods,expected",
    [
        ({"POST"}, True),
        ({"GET"}, False),
        (set(), False),
        (None, False),
    ],
)
def test_route_present_rejects_missing_method(methods, expected):
    app = SimpleNamespace(
        routes=[SimpleNamespace(path=probe.ROUTE, methods=methods)]
    )
    assert probe.route_present(app) is expected


def test_route_present_rejects_wrong_path():
    app = SimpleNamespace(
        routes=[SimpleNamespace(path=probe.ROUTE + "/extra", methods={"POST"})]
    )
    assert probe.route_present(app) is False


def test_loopback_http_404_and_405_are_reported_without_retry(monkeypatch):
    attempts = []

    def fake(url, timeout):
        attempts.append((url.method, url.full_url, timeout))
        raise HTTPError(url.full_url, 405, "Method Not Allowed", None, None)

    monkeypatch.setattr(probe.request, "urlopen", fake)
    assert probe.check_loopback_get() == 405
    assert attempts == [
        ("GET", "http://127.0.0.1:8000" + probe.ROUTE, 5)
    ]


def test_inspect_reports_different_installed_source_not_repaired(monkeypatch, tmp_path):
    old = tmp_path / "firbo_free_app.py"
    old.write_text("app = 'legacy module'\n")
    fake_app = SimpleNamespace(
        routes=[SimpleNamespace(path="/health", methods={"GET"})]
    )
    monkeypatch.setattr(
        probe.importlib, "import_module",
        lambda _name: SimpleNamespace(__file__=str(old), app=fake_app),
    )
    monkeypatch.setattr(probe, "check_loopback_get", lambda: 404)
    report = probe.inspect()
    assert report["exact_source_match"] is False
    assert report["local_post_registered"] is False
    assert report["loopback_get_http"] == 404
    assert report["module_source"] == "read"
    assert report["read_only"] is True
    assert "secrets" not in str(report).lower()
