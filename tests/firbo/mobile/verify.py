"""Actual shared-component reflow/interactions; synthetic data, no production calls.

Eight sample-language labels are tested, NOT complete application translation.
Narrow/short viewports are not substitutes for physical-device keyboard testing.
"""

import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

OUT = Path(os.environ.get("FIRBO_MOBILE_OUTPUT", "/tmp/firbo-mobile-evidence"))
OUT.mkdir(parents=True, exist_ok=True)
CASES = [(w, 800, "en", "dark") for w in (320, 360, 390, 412, 768, 1024, 1440)]
CASES += [
    (w, 800, lang, "dark")
    for w in (320, 390)
    for lang in ("el", "ar", "es", "fr", "de", "pt-BR", "zh-CN")
]
CASES += [
    (320, 800, "en", "light"),
    (1440, 900, "en", "light"),
    (390, 320, "el", "dark"),
    (320, 256, "en", "dark"),
]
results = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(
        **(
            {"executable_path": os.environ["FIRBO_CHROMIUM"]}
            if os.environ.get("FIRBO_CHROMIUM")
            else {}
        )
    )
    for width, height, lang, theme in CASES:
        name = f"{width}x{height}-{lang}-{theme}"
        ctx = browser.new_context(
            viewport={"width": width, "height": height},
            reduced_motion="reduce",
            color_scheme=theme,
            has_touch=width < 768,
        )
        ctx.route(
            "**/*",
            lambda route: (
                route.continue_()
                if route.request.url.startswith("http://127.0.0.1:5210/")
                else route.abort()
            ),
        )
        page = ctx.new_page()
        page.set_default_timeout(8000)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            page.goto(
                f"http://127.0.0.1:5210/?lang={lang}&theme={theme}",
                wait_until="networkidle",
            )
            trigger = page.get_by_test_id("open-dialog")
            expect(trigger).to_be_visible()
            assert page.locator("html").get_attribute("lang") == lang, (
                "fixture language mismatch"
            )
            # Do not mistake hidden root overflow for reflow. Remove only root clipping.
            page.add_style_tag(
                content="html, body, #root {overflow: visible !important; height: auto !important; min-height: 100%;}"
            )
            measure = page.evaluate("""() => {
              const nodes = [...document.querySelectorAll('.fb-pagehead, .fb-pagehead > *, .fb-pagehead h1, .fb-pagehead p, .fb-seg, .fb-seg button, .fb-stat, .fb-stat__value, .fb-kv')];
              return {width:innerWidth, scroll:document.documentElement.scrollWidth, bad:nodes.filter(n => {
                const r=n.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth+1 || n.scrollWidth > n.clientWidth+1;
              }).map(n => ({tag:n.tagName,class:n.className,client:n.clientWidth,scroll:n.scrollWidth}))};
            }""")
            assert measure["scroll"] <= width + 1 and not measure["bad"], measure
            page.get_by_role("tab").nth(2).click()
            expect(page.get_by_test_id("selected-tab")).to_have_text("quota")
            if width < 768:
                action = page.get_by_test_id("long-action")
                touch = action.bounding_box()
                assert touch and touch["height"] >= 44, {
                    "reason": "undersized_action",
                    "rect": touch,
                    "computed": action.evaluate(
                        "(n) => ({minHeight:getComputedStyle(n).minHeight,height:getComputedStyle(n).height})"
                    ),
                }
            if name in ("320x800-el-dark", "390x800-ar-dark", "1440x900-en-light"):
                page.screenshot(
                    path=str(OUT / (name + "-controls.png")), full_page=True
                )
            trigger.click()
            dialog = page.get_by_test_id("dialog")
            expect(dialog).to_be_visible()
            # Fail explicitly when the isolated build does not include real utility CSS.
            expect(dialog).to_have_css("position", "fixed")
            rect = dialog.bounding_box()
            assert (
                rect
                and rect["x"] >= -1
                and rect["y"] >= -1
                and rect["x"] + rect["width"] <= width + 1
                and rect["y"] + rect["height"] <= height + 1
            ), rect
            close_control = dialog.locator(':scope > [data-slot="dialog-close"]')
            close_rect = close_control.bounding_box()
            assert close_rect, "missing close control"
            if width < 768:
                assert close_rect["width"] >= 44 and close_rect["height"] >= 44, {
                    "reason": "undersized_close",
                    "rect": close_rect,
                }
            close_center = close_rect["x"] + close_rect["width"] / 2
            dialog_center = rect["x"] + rect["width"] / 2
            assert (
                (close_center < dialog_center)
                if lang == "ar"
                else (close_center > dialog_center)
            ), "close control must use logical end"
            assert dialog.evaluate("(n) => n.scrollHeight > n.clientHeight"), (
                "long content must remain scrollable"
            )
            assert dialog.evaluate("(n) => n.scrollWidth <= n.clientWidth + 1"), (
                "dialog horizontal overflow"
            )
            field = page.get_by_test_id("field-11")
            field.scroll_into_view_if_needed()
            field.fill("synthetic edited value")
            expect(field).to_have_value("synthetic edited value")
            field_rect = field.bounding_box()
            assert (
                field_rect
                and 0 <= field_rect["y"]
                and field_rect["y"] + field_rect["height"] <= height + 1
            ), field_rect
            if name in ("320x800-el-dark", "390x800-ar-dark", "390x320-el-dark"):
                page.screenshot(path=str(OUT / (name + "-dialog.png")))
            page.get_by_test_id("finish-dialog").click()
            expect(dialog).not_to_be_visible()
            expect(page.get_by_test_id("dialog-result")).to_have_text("closed")
            expect(trigger).to_be_focused()
            trigger.click()
            expect(dialog).to_be_visible()
            # The visible close button works, independently of footer and Escape.
            dialog.locator(':scope > [data-slot="dialog-close"]').click()
            expect(dialog).not_to_be_visible()
            expect(trigger).to_be_focused()
            trigger.click()
            expect(dialog).to_be_visible()
            page.keyboard.press("Escape")
            expect(dialog).not_to_be_visible()
            expect(trigger).to_be_focused()
            assert not errors, errors
            results.append({"case": name, "status": "passed"})
        except Exception as exc:
            page.screenshot(path=str(OUT / (name + "-FAILED.png")), full_page=True)
            results.append(
                {
                    "case": name,
                    "status": "failed",
                    "error": str(exc)[:2000],
                    "page_errors": errors[:5],
                }
            )
        finally:
            print(
                "FIRBO_MOBILE_CASE",
                json.dumps(results[-1], ensure_ascii=False),
                flush=True,
            )
            (OUT / "results.json").write_text(
                json.dumps(
                    {
                        "scope": "M1 real shared components with synthetic content",
                        "cases": results,
                        "not_tested": [
                            "complete authenticated pages",
                            "physical phone keyboard",
                            "iOS Safari",
                            "desktop agent execution",
                            "complete accessibility compliance",
                        ],
                    },
                    indent=2,
                )
            )
            ctx.close()
    browser.close()
failed = [case for case in results if case["status"] != "passed"]
if failed:
    raise SystemExit(
        f"FIRBO_MOBILE_FAILED {len(failed)}/{len(results)}; see results.json"
    )
print("FIRBO_MOBILE_ALL_PASSED", len(results), flush=True)
