"""M2-B: six actual operational pages and Computer Manager lifecycle.
Mock identity/read responses; deliberately permitted mutations are in-memory only.
No physical PC, remote account, command, file operation or agent is used.
"""

import json
import re
from urllib.parse import urlparse

import verify as v
from playwright.sync_api import expect, sync_playwright

ROOT = v.OUT / "operations"
ROOT.mkdir(parents=True, exist_ok=True)
v.OUT = ROOT / "layouts"
v.OUT.mkdir(exist_ok=True)
v.ROUTES = ["/tasks", "/inbox", "/team", "/people", "/activity", "/computers"]
v.PROFILES = [(w, 800, "en", "dark") for w in (320, 360, 390, 412, 768, 1024)]
v.PROFILES += [(1440, 900, "en", "light")] + [
    (320, 800, lang, "dark")
    for lang in ("el", "ar", "es", "fr", "de", "pt-BR", "zh-CN")
]
v.results = []
layout_failed = False
try:
    v.run()
except SystemExit:
    layout_failed = True
reports = []
CASES = [("computer-actions", w, "loaded", "owner") for w in (320, 390, 768, 1440)]
CASES += [("computer-mac-setup", w, "loaded", "owner") for w in (320, 1440)]
CASES += [("computer-browser-plan", w, "loaded", "owner") for w in (320, 1440)]
CASES += [("computer-mac-update", w, "loaded", "owner") for w in (320, 1440)]
CASES += [
    ("computer-state", 320, state, "owner") for state in ("loading", "empty", "error")
]
CASES += [
    ("computer-member", 320, "loaded", "member"),
    ("computer-race", 390, "loaded", "owner"),
    ("computer-pair-expiry", 390, "loaded", "owner"),
    ("computer-user-switch", 390, "loaded", "owner"),
    ("task-board", 320, "loaded", "owner"),
    ("task-board", 768, "loaded", "owner"),
    ("team-selection", 320, "loaded", "owner"),
    ("team-selection", 1024, "loaded", "owner"),
]
with sync_playwright() as pw:
    browser = pw.chromium.launch(
        **(
            {"executable_path": v.os.environ["FIRBO_CHROMIUM"]}
            if v.os.environ.get("FIRBO_CHROMIUM")
            else {}
        )
    )
    for kind, width, state, role in CASES:
        label = f"{kind}-{width}-{state}-{role}"
        ctx = browser.new_context(
            viewport={"width": width, "height": 800},
            reduced_motion="reduce",
            service_workers="block",
        )
        errors = []
        external = []

        def intercept(r):
            u = urlparse(r.request.url)
            if u.netloc != "127.0.0.1:5211":
                external.append(u.hostname)
                return r.abort()
            if u.path.startswith("/v1/"):
                return r.fulfill(status=404, json={"detail": "no_execution_in_fixture"})
            return r.continue_()

        ctx.route("**/*", intercept)
        page = ctx.new_page()
        page.set_default_timeout(7000)
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            if kind == "computer-pair-expiry":
                page.clock.install()
            path = (
                "/tasks"
                if kind == "task-board"
                else "/team"
                if kind == "team-selection"
                else "/computers"
            )
            page.goto(
                v.BASE
                + path
                + f"?lang=en&state={state}&role={role}&computer_actions=1&device_delay=900&browser_control={1 if kind == 'computer-browser-plan' else 0}&pair_delay="
                + ("900" if kind == "computer-user-switch" else "0")
                + f"&mac_update={1 if kind == 'computer-mac-update' else 0}",
                wait_until="networkidle",
            )
            expect(page.locator("main h1")).to_be_visible()
            if kind == "computer-mac-update":
                page.get_by_test_id("select-device-d1").click()
                notice = page.get_by_test_id("mac-browser-update")
                expect(notice).to_be_visible()
                expect(
                    notice.get_by_role("link", name="Download Mac updater")
                ).to_have_attribute("href", "/FIRBO-Mac-Browser-Update.command")
                expect(notice).to_contain_text("Full Control")
                expect(notice).to_contain_text("firboai.app")
                expect(notice).to_contain_text("javris.firboai.app")
                expect(notice).to_contain_text("destructive commands remain blocked")
                assert not page.evaluate(v.GEOMETRY)["bad"]
                page.get_by_test_id("select-device-d2").click()
                expect(notice).to_have_count(0)
                page.get_by_test_id("select-device-d1").click()
                expect(notice).to_be_visible()
                page.evaluate("window.__firboM2.switchUser()")
                expect(notice).to_have_count(0)
                expect(page.get_by_test_id("select-device-d1")).to_have_count(0)
            elif kind == "computer-browser-plan":
                page.get_by_test_id("select-device-d1").click()
                composer = page.get_by_test_id("browser-task-composer")
                expect(composer).to_be_visible()
                expect(composer.locator("fieldset")).to_have_count(2)
                composer.get_by_role("button", name="Add step", exact=True).click()
                composer.locator("select").nth(2).select_option("fill")
                composer.get_by_label("Element selector", exact=True).fill("#search")
                composer.get_by_label("Text", exact=True).fill("Synthetic search")
                assert not page.evaluate(v.GEOMETRY)["bad"]
                composer.get_by_role(
                    "button", name="Remove step", exact=True
                ).last.click()
                expect(composer.locator("fieldset")).to_have_count(2)
                page.get_by_test_id("select-device-d2").click()
                expect(composer).to_have_count(0)
            elif kind == "computer-state":
                if state == "error":
                    expect(
                        page.get_by_role("alert").filter(
                            has_text="Computer status could not be refreshed"
                        )
                    ).to_be_visible()
                    expect(page.get_by_test_id("select-device-d1")).to_have_count(0)
                elif state == "loading":
                    expect(page.locator('main [role="status"]').first).to_be_visible()
                else:
                    expect(page.get_by_test_id("select-device-d1")).to_have_count(0)
            elif kind == "computer-member":
                expect(page.locator("main form")).to_have_count(0)
                expect(page.get_by_test_id("select-device-d1")).to_have_count(0)
            elif kind == "team-selection":
                page.locator("main .fb-team-layout > ul > li > button").first.click()
                expect(page.locator("main .fb-team-layout > aside")).to_be_visible()
                expect(page.locator("main .fb-team-layout")).not_to_contain_text(
                    "autonomy.ask_first"
                )
                expect(page.locator("main .fb-team-layout > ul")).to_contain_text(
                    "Ask first"
                )
                assert (
                    page.locator("main .fb-team-layout > ul").bounding_box()["width"]
                    >= 200
                ), "team list squeezed beside editor"
            elif kind == "task-board":
                page.get_by_role("tab", name="Board", exact=True).click()
                expect(page.locator(".fb-board")).to_be_visible()
                assert page.locator(".fb-board > *").count() >= 4, (
                    "task columns disappeared"
                )
            elif kind == "computer-mac-setup":
                # Real onboarding DOM; pairing is an in-memory service only.
                enrollment = page.locator("#computer-enrollment")
                expect(
                    page.get_by_test_id("computer-local-setup-note")
                ).to_contain_text("Adding a name here does not connect the computer")
                page.get_by_test_id("computer-platform").select_option("mac")
                expect(enrollment).to_contain_text(
                    "Applications → Utilities → Terminal"
                )
                form = enrollment.locator("form")
                form.locator("input").fill("Synthetic Mac mini")
                form.locator("button").click()
                expect(page.get_by_test_id("pair-code")).to_have_text("DEMO2345")
                access = page.get_by_test_id("computer-access")
                expect(access).to_have_value("browser")
                commands = (
                    page.get_by_test_id("pair-code")
                    .locator("..")
                    .locator(".fb-copyline pre")
                )
                pair_command = commands.filter(
                    has_text=re.compile(r"\bpair\s+DEMO2345\b")
                )
                expect(pair_command).to_have_count(1)
                prefix = 'node "$HOME/Downloads/firbo-connector.mjs"'
                expect(pair_command).to_have_text(
                    prefix + " pair DEMO2345 --allow-browser"
                )
                expect(pair_command).not_to_contain_text("--allow-exec")
                expect(pair_command).not_to_contain_text("--allow-write")
                expect(commands.filter(has_text=re.compile(r"\brun$"))).to_have_text(
                    prefix + " run"
                )
                expect(enrollment).to_contain_text("The code expires and works once")
                expect(enrollment).to_contain_text("keep this Terminal window open")
                access.select_option("files")
                expect(pair_command).to_have_text(
                    prefix + ' pair DEMO2345 --allow "$HOME/Documents" --allow-browser'
                )
                expect(pair_command).not_to_contain_text("--allow-write")
                expect(pair_command).not_to_contain_text("--allow-exec")
                access.select_option("advanced")
                expect(pair_command).to_contain_text("--allow-write --allow-exec")
                expect(enrollment).to_contain_text(
                    "a shell command is NOT confined to the allowed folder"
                )
                access.select_option("browser")
                troubleshooting = page.get_by_test_id("computer-setup-troubleshooting")
                troubleshooting.locator("summary").click()
                expect(troubleshooting).to_contain_text("Cannot find module")
                expect(troubleshooting).to_contain_text("22.13 or newer")
                expect(troubleshooting).to_contain_text("Expired or invalid code")
                expect(troubleshooting).to_contain_text("Do not send")
                expect(
                    troubleshooting.locator("pre").filter(
                        has_text=re.compile(r"\bstatus$")
                    )
                ).to_have_text(prefix + " status")
                # Regeneration must replace the copyable code without granting readiness.
                card = page.get_by_test_id("select-device-created").locator("..")
                card.get_by_role("button", name="New code", exact=True).click()
                expect(page.get_by_test_id("pair-code")).to_have_text("DEMO3456")
                expect(
                    commands.filter(has_text=re.compile(r"\bpair\s+DEMO3456\b"))
                ).to_have_text(prefix + " pair DEMO3456 --allow-browser")
                expect(pair_command).to_have_count(0)
                expect(card).to_contain_text("Waiting for pairing")
                expect(page.get_by_test_id("select-device-created")).to_be_disabled()
            elif kind in ("computer-actions", "computer-race"):
                expect(page.get_by_test_id("select-device-d1")).to_be_visible()
                page.get_by_test_id("select-device-d1").click()
                workspace = page.get_by_test_id("computer-workspace")
                expect(workspace).to_be_visible()
                path_input = workspace.get_by_role(
                    "textbox", name="Path inside an allowed folder", exact=True
                )
                path_input.fill("C:/Demo/draft-not-sent")
                if kind == "computer-race":
                    page.get_by_test_id("select-device-d2").click()
                    expect(path_input).to_have_value("")
                    expect(page.get_by_test_id("computer-jobs")).to_contain_text(
                        "d2-result-"
                    )
                    page.wait_for_timeout(1200)
                    expect(page.get_by_test_id("computer-jobs")).not_to_contain_text(
                        "d1-result-"
                    )
                else:
                    expect(page.get_by_test_id("computer-jobs")).to_contain_text(
                        "d1-result-"
                    )
                    expect(page.get_by_test_id("voice-device-d1")).to_be_enabled()
                    page.get_by_test_id("voice-device-d1").click()
                    expect(
                        page.get_by_test_id("website-laptop-bridge")
                    ).to_contain_text("Voice laptop selected")
                    expect(
                        page.get_by_role("button", name="Cancel queued job", exact=True)
                    ).to_have_count(1)
                    for i in range(5):
                        workspace.get_by_role("tab").nth(i).click()
                        m = page.evaluate(v.GEOMETRY)
                        assert not m["bad"], m
                    workspace.get_by_role("tab").nth(3).click()
                    expect(
                        workspace.get_by_text("Advanced:", exact=False)
                    ).to_be_visible()
                    page.get_by_role(
                        "button", name="Cancel queued job", exact=True
                    ).click()
                    page.get_by_test_id("select-device-offline").click()
                    expect(
                        page.get_by_test_id("computer-workspace").get_by_role(
                            "button", name="Send to computer", exact=True
                        )
                    ).to_be_disabled()
            else:
                # Pairing is a synthetic in-memory service, not a real device registration.
                form = page.locator("main form").first
                form.locator("input").fill("Demo workstation")
                form.locator("button").click()
                if kind == "computer-user-switch":
                    page.evaluate("window.__firboM2.switchUser()")
                    page.wait_for_timeout(1300)
                    expect(page.get_by_test_id("pair-code")).to_have_count(0)
                    expect(page.get_by_test_id("select-device-d1")).to_have_count(0)
                else:
                    expect(page.get_by_test_id("pair-code")).to_have_text("DEMO2345")
                    page.clock.fast_forward(9 * 60 * 1000 + 1001)
                    expect(page.get_by_test_id("pair-code")).to_have_count(0)
            m = page.evaluate(v.GEOMETRY)
            assert m["documentWidth"] <= width + 1 and not m["bad"], m
            assert not errors, errors
            writes = page.evaluate("window.__firboM2.writes")
            assert all(
                x
                in (
                    "profiles.update",
                    "connector:create_device",
                    "connector:new_code",
                    "connector:cancel_job",
                )
                for x in writes
            ), writes
            page.screenshot(path=str(ROOT / (label + ".png")))
            reports.append(
                {
                    "case": label,
                    "status": "passed",
                    "synthetic_writes": writes,
                    "external_requests_blocked": len(external),
                }
            )
        except Exception as e:
            page.screenshot(path=str(ROOT / (label + "-FAILED.png")))
            reports.append(
                {
                    "case": label,
                    "status": "failed",
                    "error": str(e)[:7000],
                    "page_errors": errors,
                }
            )
        finally:
            print("FIRBO_M2B_CASE", json.dumps(reports[-1]), flush=True)
            ctx.close()
            (ROOT / "computer-interactions.json").write_text(
                json.dumps(
                    {
                        "scope": "actual Computer Manager/tasks with synthetic services",
                        "cases": reports,
                    },
                    indent=2,
                )
            )
    browser.close()
failed = sum(r["status"] != "passed" for r in reports)
print("FIRBO_M2B_SUMMARY", len(reports), failed)
if failed or layout_failed:
    raise SystemExit(1)
