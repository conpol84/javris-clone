"""Actual HTTP request construction + real SQLite transactions; providers are fake.
No downloaded model, real GPU/CPU benchmark, user credentials or production writes.
"""

import asyncio
import importlib.util
import json
import sqlite3
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "free_inference", ROOT / "src/openjarvis/server/free_inference.py"
)
f = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = f
spec.loader.exec_module(f)
ORG = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-4222-8222-222222222222"
OTHER = "33333333-3333-4333-8333-333333333333"
NOW = 1791072000
MSG = [{"role": "user", "content": "Synthetic non-confidential example"}]
LOCAL = f.Route("ollama", "qwen3:1.7b")
CLOUD = f.Route("openrouter", "test/model:free", "free-test-key")


def ledger(tmp_path, limits=f.Limits()):
    tmp_path.chmod(0o700)
    return f.Ledger(str(tmp_path / "free.sqlite3"), limits)


def local_result(**extras):
    return {
        "model": "qwen3:1.7b",
        "done": True,
        "message": {"content": "Synthetic answer"},
        "prompt_eval_count": 20,
        "eval_count": 5,
        **extras,
    }


def catalogue(**prices):
    return {
        "data": [
            {
                "id": "test/model:free",
                "pricing": {"prompt": "0", "completion": "0", "request": "0", **prices},
            }
        ]
    }


def cloud_result(**extras):
    return {
        "choices": [{"message": {"content": "Cloud answer"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 3},
        **extras,
    }


def call(engine, **kwargs):
    return asyncio.run(engine.infer(ORG, USER, str(uuid4()), MSG, **kwargs))


@pytest.mark.parametrize(
    "kind,model,key",
    [
        ("openai", "gpt-4o", "secret"),
        ("ollama", "qwen3:4b-cloud", ""),
        ("ollama", "auto", ""),
        ("ollama", "qwen3:4b", "secret"),
        ("openrouter", "test/model", "key"),
        ("openrouter", "openrouter/free", "key"),
        ("openrouter", "test/model:free", ""),
    ],
)
def test_paid_unknown_cloud_model_rejected(kind, model, key):
    with pytest.raises(f.FreeError):
        f.Route(kind, model, key)


def test_key_not_in_repr():
    assert "free-test-key" not in repr(CLOUD)


@pytest.mark.parametrize(
    "p",
    [
        {},
        None,
        {"prompt": "0"},
        {"prompt": 0, "completion": 1},
        {"prompt": "NaN", "completion": 0},
        {"prompt": "0", "completion": 0, "image": "0.01"},
        {"prompt": False, "completion": 0},
        {"prompt": None, "completion": 0},
    ],
)
def test_zero_price_requires_all_dimensions(p):
    assert not f.all_prices_zero(p)


def test_zero_accepts_numeric_strings():
    assert f.all_prices_zero({"prompt": "0.000", "completion": 0, "request": "0"})


def test_private_ledger_file(tmp_path):
    assert Path(ledger(tmp_path).path).stat().st_mode & 0o777 == 0o600


def test_atomic_daily_admission_across_connections(tmp_path):
    p = ledger(tmp_path, f.Limits(user_daily=3)).path

    def reserve(_):
        db = f.Ledger(p, f.Limits(user_daily=3, global_parallel=8))
        try:
            db.admit(ORG, USER, str(uuid4()), NOW)
            return True
        except f.FreeError:
            return False

    with ThreadPoolExecutor(8) as pool:
        assert sum(pool.map(reserve, range(20))) == 3


def test_idempotency_does_not_repeat_inference(tmp_path):
    db = ledger(tmp_path)
    rid = str(uuid4())
    db.admit(ORG, USER, rid, NOW)
    db.finish(ORG, rid, "completed")
    with pytest.raises(f.FreeError, match="request_already_admitted"):
        db.admit(ORG, USER, rid, NOW)


def test_user_allowance_shared_across_companies(tmp_path):
    db = ledger(tmp_path, f.Limits(user_daily=1))
    db.admit(ORG, USER, str(uuid4()), NOW)
    with pytest.raises(f.FreeError, match="free_daily_limit"):
        db.admit(OTHER, USER, str(uuid4()), NOW)


def test_daily_reset_does_not_replay_old_id(tmp_path):
    db = ledger(tmp_path, f.Limits(user_daily=1))
    rid = str(uuid4())
    db.admit(ORG, USER, rid, NOW)
    db.finish(ORG, rid, "completed")
    db.admit(ORG, USER, str(uuid4()), NOW + 86400)
    with pytest.raises(f.FreeError, match="request_already_admitted"):
        db.admit(ORG, USER, rid, NOW + 86400)


def test_model_pool_lease_and_cooldown_persist(tmp_path):
    db = ledger(tmp_path)
    token = db.acquire("openrouter", NOW)
    assert token
    again = f.Ledger(db.path)
    assert again.acquire("openrouter", NOW) is None
    again.release("openrouter", "wrong")
    assert db.acquire("openrouter", NOW) is None
    db.release("openrouter", token)
    db.cool("openrouter", NOW + 90)
    assert again.acquire("openrouter", NOW + 89) is None
    assert again.acquire("openrouter", NOW + 91)


def test_native_local_has_no_api_key_or_cloud_call(tmp_path):
    requests = []

    def handle(req):
        requests.append(req)
        assert req.url.host == "firbo-ollama"
        body = json.loads(req.content)
        assert body["stream"] is False and body["think"] is False
        assert (
            body["options"]["num_predict"] == 512 and body["options"]["num_ctx"] == 4096
        )
        assert "authorization" not in req.headers
        return httpx.Response(200, json=local_result())

    r = call(
        f.FreeEngine([LOCAL], ledger(tmp_path), transport=httpx.MockTransport(handle))
    )
    assert (
        len(requests) == 1
        and r["firbo"]["provider_fee_usd"] == 0
        and r["firbo"]["infrastructure_cost_excluded"]
    )


def test_cloud_429_falls_back_to_local_and_skips_shared_pool(tmp_path):
    requests = []

    def handle(req):
        requests.append(req)
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json=catalogue())
        if req.url.host == "openrouter.ai":
            return httpx.Response(429, headers={"Retry-After": "300"})
        return httpx.Response(200, json=local_result())

    second = f.Route("openrouter", "test/other:free", "free-test-key")
    engine = f.FreeEngine(
        [CLOUD, second, LOCAL],
        ledger(tmp_path),
        clock=lambda: NOW,
        transport=httpx.MockTransport(handle),
    )
    r = call(engine, cloud_allowed=True)
    assert (
        r["firbo"]["attempts"] == 2
        and sum(q.url.host == "openrouter.ai" for q in requests) == 2
    )
    requests.clear()
    call(engine, cloud_allowed=True)
    assert len(requests) == 1 and requests[0].url.host == "firbo-ollama"


def test_local_overload_does_not_start_second_same_server_model(tmp_path):
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(503)

    e = f.FreeEngine(
        [LOCAL, f.Route("ollama", "qwen3:4b")],
        ledger(tmp_path),
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(f.FreeError, match="free_capacity_unavailable"):
        call(e)
    assert len(calls) == 1


def test_confidential_default_never_contacts_remote(tmp_path):
    calls = []

    def handle(req):
        calls.append(req)
        return httpx.Response(200, json=local_result())

    call(
        f.FreeEngine(
            [CLOUD, LOCAL], ledger(tmp_path), transport=httpx.MockTransport(handle)
        )
    )
    assert all(q.url.host == "firbo-ollama" for q in calls)


def test_cloud_options_do_not_include_tools_plugins_or_paid_fallback(tmp_path):
    def handle(req):
        if req.method == "GET":
            return httpx.Response(200, json=catalogue())
        b = json.loads(req.content)
        assert b["model"].endswith(":free")
        assert (
            b["provider"]["allow_fallbacks"] is False
            and b["provider"]["data_collection"] == "deny"
        )
        assert not {"tools", "plugins", "models", "route"} & b.keys()
        return httpx.Response(200, json=cloud_result())

    r = call(
        f.FreeEngine([CLOUD], ledger(tmp_path), transport=httpx.MockTransport(handle)),
        cloud_allowed=True,
    )
    assert r["firbo"]["cost_basis"] == "verified_free_api"


@pytest.mark.parametrize("status", [400, 401, 402, 403, 404, 500, 302])
def test_other_errors_never_loop_or_switch(status, tmp_path):
    calls = []

    def handle(req):
        if req.method == "GET":
            return httpx.Response(200, json=catalogue())
        calls.append(req)
        return httpx.Response(status, text="PRIVATE_UPSTREAM_SECRET")

    e = f.FreeEngine(
        [CLOUD, LOCAL], ledger(tmp_path), transport=httpx.MockTransport(handle)
    )
    with pytest.raises(f.FreeError) as err:
        call(e, cloud_allowed=True)
    assert len(calls) == 1 and "SECRET" not in str(err.value)


def test_network_uncertainty_never_replays(tmp_path):
    calls = []

    def handle(req):
        if req.method == "GET":
            return httpx.Response(200, json=catalogue())
        calls.append(req)
        raise httpx.ReadTimeout("SECRET")

    db = ledger(tmp_path)
    with pytest.raises(f.FreeError, match="free_transport_uncertain"):
        call(
            f.FreeEngine([CLOUD, LOCAL], db, transport=httpx.MockTransport(handle)),
            cloud_allowed=True,
        )
    assert len(calls) == 1
    with sqlite3.connect(db.path) as conn:
        assert conn.execute("select state from requests").fetchone()[0] == "unknown"


@pytest.mark.parametrize(
    "data",
    [
        local_result(done=False),
        local_result(prompt_eval_count=None),
        local_result(model="wrong"),
        local_result(message={"content": "", "tool_calls": [{}]}),
        local_result(done_reason="content_filter"),
    ],
)
def test_missing_usage_partial_tools_and_refusal_rejected(data, tmp_path):
    e = f.FreeEngine(
        [LOCAL],
        ledger(tmp_path),
        transport=httpx.MockTransport(lambda req: httpx.Response(200, json=data)),
    )
    with pytest.raises(f.FreeError):
        call(e)


def test_length_is_explicit_not_silent_fallback(tmp_path):
    r = call(
        f.FreeEngine(
            [LOCAL],
            ledger(tmp_path),
            transport=httpx.MockTransport(
                lambda req: httpx.Response(200, json=local_result(done_reason="length"))
            ),
        )
    )
    assert r["choices"][0]["finish_reason"] == "length"


@pytest.mark.parametrize(
    "messages",
    [
        [{"role": "tool", "content": "x"}],
        [{"role": "user", "content": "x", "model": "paid"}],
        [{"role": "user", "content": "x" * 3000}],
        [],
    ],
)
def test_invalid_input_never_reaches_network(messages, tmp_path):
    calls = []
    e = f.FreeEngine(
        [LOCAL],
        ledger(tmp_path),
        transport=httpx.MockTransport(lambda req: calls.append(req)),
    )
    with pytest.raises(f.FreeError):
        asyncio.run(e.infer(ORG, USER, str(uuid4()), messages))
    assert calls == []


def test_retry_after():
    assert f.retry_seconds("300", NOW) == 300
    assert f.retry_seconds("bad", NOW) == 60
    assert f.retry_seconds("9999999999999999999999", NOW) == 86400


def test_cancel_releases_route_and_records_state(tmp_path):
    db = ledger(tmp_path)

    async def handler(req):
        await asyncio.sleep(10)

    async def exercise():
        engine = f.FreeEngine([LOCAL], db, transport=httpx.MockTransport(handler))
        task = asyncio.create_task(engine.infer(ORG, USER, str(uuid4()), MSG))
        await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(exercise())
    with sqlite3.connect(db.path) as c:
        assert c.execute("select count(*) from leases").fetchone()[0] == 0
        assert c.execute("select state from requests").fetchone()[0] == "cancelled"


@pytest.mark.parametrize(
    "prices", [{"prompt": "1"}, {"completion": None}, {"image": "0.1"}]
)
def test_changed_cloud_price_skips_generation_and_uses_local(tmp_path, prices):
    seen = []

    def handler(req):
        seen.append(req)
        if req.method == "GET":
            return httpx.Response(200, json=catalogue(**prices))
        assert req.url.host == "firbo-ollama"
        return httpx.Response(200, json=local_result())

    result = call(
        f.FreeEngine(
            [CLOUD, LOCAL], ledger(tmp_path), transport=httpx.MockTransport(handler)
        ),
        cloud_allowed=True,
    )
    assert result["model"].startswith("ollama:")
    assert len([r for r in seen if r.method == "POST"]) == 1


def test_cloud_price_ceiling_is_zero_for_every_supported_dimension(tmp_path):
    def handler(req):
        if req.method == "GET":
            return httpx.Response(200, json=catalogue())
        provider = json.loads(req.content)["provider"]
        assert provider["max_price"] == {
            "prompt": 0,
            "completion": 0,
            "request": 0,
            "image": 0,
        }
        assert (
            provider["allow_fallbacks"] is False
            and provider["data_collection"] == "deny"
        )
        return httpx.Response(200, json=cloud_result())

    call(
        f.FreeEngine([CLOUD], ledger(tmp_path), transport=httpx.MockTransport(handler)),
        cloud_allowed=True,
    )


@pytest.mark.parametrize("cost", [1, None, "NaN", True])
def test_positive_or_unknown_reported_cloud_charge_is_never_reported_zero(
    tmp_path, cost
):
    def handler(req):
        return httpx.Response(
            200,
            json=catalogue()
            if req.method == "GET"
            else cloud_result(
                usage={"prompt_tokens": 5, "completion_tokens": 3, "cost": cost}
            ),
        )

    with pytest.raises(f.FreeError, match="free_charge_discrepancy"):
        call(
            f.FreeEngine(
                [CLOUD, LOCAL], ledger(tmp_path), transport=httpx.MockTransport(handler)
            ),
            cloud_allowed=True,
        )


def test_expired_lease_cannot_release_new_owner(tmp_path):
    db = ledger(tmp_path)
    old = db.acquire("ollama", NOW)
    new = db.acquire("ollama", NOW + 181)
    assert new and old != new
    db.release("ollama", old)
    assert db.acquire("ollama", NOW + 182) is None


def test_ledger_rejects_symlink_file(tmp_path):
    tmp_path.chmod(0o700)
    target = tmp_path / "target"
    target.write_text("private")
    (tmp_path / "free.sqlite3").symlink_to(target)
    with pytest.raises(OSError):
        f.Ledger(str(tmp_path / "free.sqlite3"))
