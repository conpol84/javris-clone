"""Actual Gateway/Free tab UI; ONLY synthetic identity and inference responses.
Real model inference is verified separately in the Docker lifecycle test.
"""

import json
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).parent / "pages"))
from verify import GEOMETRY, NAME, PAYLOADS

OUT = Path("/tmp/firbo-local-evidence/browser")
OUT.mkdir(parents=True, exist_ok=True)
CASES = [
    ("layout", width, lang)
    for width, lang in [
        (320, "en"),
        (320, "el"),
        (390, "el"),
        (390, "ar"),
        (768, "en"),
        (1440, "en"),
    ]
] + [
    (kind, 390, "en")
    for kind in ["missing", "denied", "stop", "identity", "paid-response", "download"]
]
words = {
    "en": ["Check connection", "Generate locally", "Local result"],
    "el": ["Έλεγχος σύνδεσης", "Τοπική παραγωγή", "Τοπικό αποτέλεσμα"],
    "ar": ["فحص الاتصال", "إنشاء محلي", "نتيجة محلية"],
}
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(
        args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    )
    for kind, width, lang in CASES:
        calls = []
        errors = []
        external = []
        held = []
        context = browser.new_context(
            viewport={"width": width, "height": 950},
            reduced_motion="reduce",
            service_workers="block",
            accept_downloads=True,
        )

        def route(r):
            u = urlparse(r.request.url)
            if u.netloc != "127.0.0.1:5211":
                external.append(u.hostname)
                return r.abort()
            if not u.path.startswith("/v1/"):
                return r.continue_()
            calls.append((r.request.method, u.path))
            if u.path == "/v1/firbo/session":
                return r.fulfill(
                    json={
                        "contract": "firbo-control/v1",
                        "platform_admin": True,
                        "companies": [{"id": "org-1", "name": NAME, "role": "owner"}],
                        "has_more": False,
                    }
                )
            if u.path == "/v1/firbo/free/status":
                if kind == "denied":
                    return r.fulfill(
                        status=403, json={"detail": "platform_admin_required"}
                    )
                return r.fulfill(
                    json={
                        "contract": "firbo-local-status/v1",
                        "ready": kind != "missing",
                        "enabled": True,
                        "policy": "no-paid-fallback",
                    }
                )
            if u.path == "/v1/firbo/free/chat/completions":
                body = r.request.post_data_json
                assert body["organization_id"] == "org-1" and len(body["messages"]) == 1
                response = {
                    "model": "ollama:qwen3:1.7b",
                    "choices": [{"message": {"content": words[lang][2]}}],
                    "firbo": {
                        "contract": "firbo-free-text/v1",
                        "request_id": body["request_id"],
                        "policy": "no-paid-fallback",
                        "provider_fee_usd": 1 if kind == "paid-response" else 0,
                    },
                }
                if kind in ["stop", "identity"]:
                    held.append((r, response))
                    return
                return r.fulfill(json=response)
            if r.request.method != "GET":
                raise AssertionError("Unexpected network write")
            return r.fulfill(
                json={"available": True, "error": None, **PAYLOADS.get(u.path, {})}
            )

        context.route("**/*", route)
        page = context.new_page()
        page.set_default_timeout(10000)
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            page.goto(
                "http://127.0.0.1:5211/gateway?lang=" + lang, wait_until="networkidle"
            )
            assert page.evaluate("window.__firboM2.synthetic") is True
            page.get_by_role("tab").nth(8).click()
            box = page.get_by_test_id("local-compute-panel")
            expect(box).to_be_visible()
            assert not any(m == "POST" for m, _ in calls)
            box.get_by_role("button", name=words[lang][0], exact=True).click()
            if kind in ["missing", "denied"]:
                expect(box.get_by_role("status")).to_be_visible()
                assert box.locator("textarea").count() == 0
            else:
                field = box.locator("textarea")
                expect(field).to_be_visible()
                field.fill("Create a brief synthetic draft.")
                box.get_by_role("button", name=words[lang][1], exact=True).click()
                if kind in ["stop", "identity"]:
                    page.wait_for_timeout(200)
                    if kind == "stop":
                        box.get_by_role(
                            "button", name="Stop waiting", exact=True
                        ).click()
                    else:
                        page.evaluate("window.__firboM2.switchUser()")
                    for r, j in held:
                        try:
                            r.fulfill(json=j)
                        except Exception:
                            pass
                    page.wait_for_timeout(350)
                    assert page.get_by_text(words[lang][2], exact=True).count() == 0
                elif kind == "paid-response":
                    expect(box.get_by_role("alert")).to_be_visible()
                    assert page.get_by_text(words[lang][2], exact=True).count() == 0
                else:
                    expect(box.get_by_text(words[lang][2], exact=True)).to_be_visible()
                    if kind == "download":
                        with page.expect_download() as download:
                            box.get_by_role(
                                "button", name="Download draft", exact=True
                            ).click()
                        saved = download.value.path()
                        raw = Path(saved).read_text()
                        assert "Local result" in raw and "Human review required" in raw
                    geometry = page.evaluate(GEOMETRY)
                    assert (
                        geometry["documentWidth"] <= width + 1 and not geometry["bad"]
                    ), geometry
                    if width in [320, 1440] and lang in ["en", "el"]:
                        box.screenshot(path=str(OUT / f"{kind}-{width}-{lang}.png"))
            assert not errors, errors
            assert all(
                path == "/v1/firbo/free/chat/completions"
                for method, path in calls
                if method == "POST"
            )
            results.append(
                {
                    "case": f"{kind}-{width}-{lang}",
                    "status": "passed",
                    "local_requests": sum(m == "POST" for m, _ in calls),
                    "external_blocked": len(external),
                }
            )
        except Exception as e:
            page.screenshot(
                path=str(OUT / f"FAILED-{kind}-{width}-{lang}.png"), full_page=True
            )
            results.append(
                {
                    "case": f"{kind}-{width}-{lang}",
                    "status": "failed",
                    "error": str(e)[:3000],
                    "page_errors": errors,
                }
            )
        finally:
            context.close()
            print(json.dumps(results[-1], ensure_ascii=False), flush=True)
            (OUT / "results.json").write_text(
                json.dumps(
                    {
                        "scope": "Actual App/Gateway UI, synthetic model and identity only; real model test separate",
                        "cases": results,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
    browser.close()
if any(r["status"] != "passed" for r in results):
    raise SystemExit(1)
