"""Real existing App/screens; invented account/device/provider data only.
No authorization, customer token, physical device or external service is used.
"""

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pages"))
from verify import GEOMETRY, NAME, PAYLOADS

BASE = "http://127.0.0.1:5213"
OUT = Path("/tmp/firbo-world-evidence")
OUT.mkdir(exist_ok=True)
CASES = [
    (route, width, lang, "layout")
    for route in ["/computers", "/integrations"]
    for width in [320, 390, 768, 1440]
    for lang in ["en", "el", "ar"]
]
CASES += [
    ("/computers", 390, "en", x)
    for x in [
        "home-read",
        "switch-while-reading",
        "mobile-permission",
        "no-source",
        "read-failure",
        "identity-change",
        "member",
    ]
]
CASES += [
    ("/integrations", 320, "en", x)
    for x in [
        "four-setup-dialogs",
        "server-not-installed",
        "viewer",
        "no-fake-callback",
        "legacy-setup-dialogs",
        "legacy-ready",
        "legacy-deep-link",
        "connection-save-failure",
        "connection-credentials-failure",
        "readiness-error",
    ]
]
results = []
with sync_playwright() as pw:
    b = pw.chromium.launch(
        **(
            {"executable_path": os.environ["FIRBO_CHROMIUM"]}
            if os.environ.get("FIRBO_CHROMIUM")
            else {}
        ),
        args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    )
    for route, width, lang, kind in CASES:
        label = f"{route[1:]}-{width}-{lang}-{kind}"
        ctx = b.new_context(
            viewport={"width": width, "height": 1000},
            color_scheme="dark",
            reduced_motion="reduce",
            service_workers="block",
        )
        bad_requests = []
        external = []
        errors = []

        def intercept(r):
            u = urlparse(r.request.url)
            if u.netloc != "127.0.0.1:5213":
                external.append(u.hostname)
                return r.abort()
            if u.path.startswith("/v1/"):
                if r.request.method != "GET":
                    bad_requests.append(u.path)
                    return r.abort()
                if u.path == "/v1/firbo/session":
                    return r.fulfill(
                        json={
                            "contract": "firbo-control/v1",
                            "platform_admin": True,
                            "companies": [
                                {"id": "org-1", "name": NAME, "role": "owner"}
                            ],
                            "has_more": False,
                        }
                    )
                return r.fulfill(
                    json={"available": True, "error": None, **PAYLOADS.get(u.path, {})}
                )
            return r.continue_()

        ctx.route("**/*", intercept)
        page = ctx.new_page()
        page.set_default_timeout(10000)
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            query = f"?lang={lang}"
            if kind == "no-source":
                query += "&world=empty"
            if kind == "read-failure":
                query += "&world=failure"
            if kind in ["switch-while-reading", "identity-change"]:
                query += "&read_delay=1200"
            if kind in ["viewer", "member"]:
                query += "&role=member"
            if kind in ["server-not-installed", "legacy-setup-dialogs"]:
                query += "&world=setup"
            if kind == "legacy-deep-link":
                query += "&connect=gmail"
            if kind == "connection-save-failure":
                query += "&world=save-failure"
            if kind == "connection-credentials-failure":
                query += "&world=credentials-failure"
            if kind == "readiness-error":
                query += "&world=readiness-error"
            if kind == "no-fake-callback":
                query += "&connected=youtube"
            page.goto(BASE + route + query, wait_until="networkidle")
            page.wait_for_function("window.__firboWorld?.synthetic===true")
            if route == "/computers":
                expect(page.get_by_test_id("device-fabric")).to_be_visible()
            elif kind != "viewer":
                expect(page.locator('[data-connection-kind="tiktok"]')).to_be_visible()
            page.wait_for_timeout(250)
            measure = page.evaluate(GEOMETRY)
            assert measure["documentWidth"] <= width + 1 and not measure["bad"], measure
            if kind == "layout":
                if width in [390, 1440] and lang in ["en", "el"]:
                    page.locator("main").evaluate("(e)=>e.scrollTo(0,0)")
                    page.screenshot(path=str(OUT / (label + ".png")))
            elif kind in [
                "home-read",
                "switch-while-reading",
                "identity-change",
                "read-failure",
            ]:
                page.locator('[data-device-kind="home"]').click()
                page.get_by_role(
                    "button", name="Read selected devices", exact=True
                ).click()
                if kind == "switch-while-reading":
                    page.locator('[data-device-kind="car"]').click()
                    page.wait_for_timeout(1400)
                    assert (
                        page.get_by_text("Office temperature", exact=True).count() == 0
                    )
                elif kind == "identity-change":
                    page.evaluate("window.__firboM2.switchUser()")
                    page.wait_for_timeout(1400)
                    assert (
                        page.get_by_text("Office temperature", exact=True).count() == 0
                    )
                    assert page.locator(".cw-source").count() == 0
                elif kind == "read-failure":
                    expect(
                        page.get_by_role("alert").filter(has_text="Could not verify")
                    ).to_be_visible()
                    assert (
                        page.get_by_text("Office temperature", exact=True).count() == 0
                    )
                else:
                    expect(
                        page.get_by_text("Office temperature", exact=True)
                    ).to_be_visible()
                    page.get_by_test_id("device-detail").screenshot(
                        path=str(OUT / (label + ".png"))
                    )
            elif kind == "no-source":
                page.locator('[data-device-kind="home"]').click()
                expect(
                    page.get_by_text("No source connected yet", exact=True)
                ).to_be_visible()
                assert (
                    page.get_by_role(
                        "button", name="Read selected devices", exact=True
                    ).count()
                    == 0
                )
            elif kind == "mobile-permission":
                page.locator('[data-device-kind="phone"]').click()
                page.get_by_role("button", name="Check microphone permission").click()
                expect(
                    page.get_by_text(
                        "This check does not start recording or request permission.",
                        exact=True,
                    )
                ).to_be_visible()
                assert all(
                    x["action"] == "connection_manifest"
                    for x in page.evaluate("window.__firboWorld.calls")
                )
            elif kind == "four-setup-dialogs":
                for service in ["youtube", "tiktok", "salesforce", "quickbooks"]:
                    page.locator(f'[data-connection-kind="{service}"]').click()
                    dialog = page.get_by_role("dialog")
                    expect(dialog).to_be_visible()
                    rect = dialog.bounding_box()
                    assert (
                        rect
                        and rect["x"] >= -1
                        and rect["x"] + rect["width"] <= width + 1
                        and rect["y"] >= -1
                        and rect["y"] + rect["height"] <= 1001
                    ), rect
                    assert dialog.evaluate("(e)=>e.scrollWidth<=e.clientWidth+1")
                    if service == "quickbooks":
                        expect(
                            dialog.get_by_text(
                                "The provider permission is broader", exact=False
                            )
                        ).to_be_visible()
                        dialog.screenshot(path=str(OUT / (label + ".png")))
                    page.keyboard.press("Escape")
                    expect(dialog).not_to_be_visible()
                assert "Coming soon" not in page.locator("body").inner_text()
            elif kind == "server-not-installed":
                page.locator('[data-connection-kind="youtube"]').click()
                dialog = page.get_by_role("dialog")
                expect(dialog.locator("form .fb-btn--primary")).to_be_disabled()
                expect(
                    dialog.get_by_text("Server setup required", exact=True)
                ).to_be_visible()
            elif kind == "legacy-setup-dialogs":
                for service in [
                    "gmail",
                    "gcal",
                    "gdrive",
                    "sheets",
                    "gmail_read",
                    "gcal_read",
                    "gdrive_read",
                    "outlook",
                    "outlook_read",
                    "linkedin",
                    "dropbox",
                ]:
                    page.locator(f'[data-connection-kind="{service}"]').click()
                    dialog = page.get_by_role("dialog")
                    expect(dialog.locator("form .fb-btn--primary")).to_be_disabled()
                    expect(
                        dialog.get_by_text("Server setup required", exact=True)
                    ).to_be_visible()
                    expect(
                        dialog.get_by_text(
                            "The platform must configure this provider", exact=False
                        )
                    ).to_be_visible()
                    dialog.get_by_text("Server setup details", exact=True).click()
                    expect(
                        dialog.get_by_text(
                            "https://database.invalid/functions/v1/integrations",
                            exact=True,
                        )
                    ).to_be_visible()
                    assert dialog.evaluate("(e)=>e.scrollWidth<=e.clientWidth+1")
                    page.keyboard.press("Escape")
                assert all(
                    x["action"] in ["connection_manifest", "integration_manifest"]
                    for x in page.evaluate("window.__firboWorld.calls")
                )
            elif kind in ["legacy-ready", "legacy-deep-link"]:
                if kind == "legacy-ready":
                    page.locator('[data-connection-kind="gmail"]').click()
                dialog = page.get_by_role("dialog")
                expect(
                    dialog.get_by_text("Ready for authorization", exact=True)
                ).to_be_visible()
                expect(dialog.locator("form .fb-btn--primary")).to_be_enabled()
                assert all(
                    x["action"] in ["connection_manifest", "integration_manifest"]
                    for x in page.evaluate("window.__firboWorld.calls")
                )
            elif kind in ["connection-save-failure", "connection-credentials-failure"]:
                page.locator('[data-connection-kind="github"]').click()
                dialog = page.get_by_role("dialog")
                dialog.get_by_label("Repository (owner/name)", exact=True).fill(
                    "synthetic-org/synthetic-repo"
                )
                dialog.get_by_label("Access token", exact=True).fill(
                    "ghp_" + "synthetic" * 5
                )
                dialog.locator("form .fb-btn--primary").click()
                expected = (
                    "The connection could not be saved"
                    if kind == "connection-save-failure"
                    else "The provider rejected access"
                )
                expect(dialog.get_by_role("alert")).to_contain_text(expected)
                expect(dialog).to_be_visible()
                assert "GitHub connected" not in page.locator("body").inner_text()
            elif kind == "readiness-error":
                page.locator('[data-connection-kind="gmail"]').click()
                dialog = page.get_by_role("dialog")
                expect(
                    dialog.get_by_text("Could not check server readiness", exact=False)
                ).to_be_visible()
                expect(dialog.locator("form .fb-btn--primary")).to_be_enabled()
                before = len(page.evaluate("window.__firboWorld.calls"))
                dialog.get_by_role("button", name="Try again", exact=True).click()
                page.wait_for_timeout(200)
                assert len(page.evaluate("window.__firboWorld.calls")) > before
            elif kind in ["viewer", "member"]:
                assert page.locator("[data-connection-kind]").count() == 0
                assert page.evaluate("window.__firboWorld.calls") == []
            elif kind == "no-fake-callback":
                assert "YouTube connected" not in page.locator("body").inner_text()
            assert not bad_requests, bad_requests
            assert not errors, errors
            results.append(
                {
                    "case": label,
                    "status": "passed",
                    "external_blocked": len(external),
                    "fixture_calls": page.evaluate("window.__firboWorld.calls"),
                }
            )
        except Exception as e:
            page.screenshot(path=str(OUT / (label + "-FAILED.png")), full_page=True)
            results.append(
                {
                    "case": label,
                    "status": "failed",
                    "error": str(e)[:4000],
                    "page_errors": errors[:3],
                }
            )
        finally:
            print(
                "FIRBO_WORLD_CASE",
                json.dumps(results[-1], ensure_ascii=False),
                flush=True,
            )
            (OUT / "results.json").write_text(
                json.dumps(
                    {
                        "scope": "Real App pages; synthetic accounts/providers/devices; external network blocked",
                        "cases": results,
                        "not_tested": [
                            "physical devices",
                            "real provider consent/token exchange",
                            "real home/car access",
                            "production database",
                            "all mobile routes",
                            "browser autoplay and audio quality",
                        ],
                    },
                    indent=2,
                )
            )
            ctx.close()
    b.close()
failed = [r for r in results if r["status"] != "passed"]
print("FIRBO_WORLD_SUMMARY", len(results), len(failed))
if failed:
    raise SystemExit(1)
