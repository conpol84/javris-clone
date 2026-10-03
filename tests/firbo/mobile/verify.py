"""Real shared-component browser reflow checks; NOT authenticated/full-page QA."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path(os.environ.get('FIRBO_MOBILE_OUTPUT', '/tmp/firbo-mobile-evidence'))
OUT.mkdir(parents=True, exist_ok=True)
CASES = [(w, 800, 'en', 'dark') for w in (320, 360, 390, 412, 768, 1024, 1440)]
CASES += [(w, 800, lang, 'dark') for w in (320, 390) for lang in ('el', 'ar')]
CASES += [(320, 800, 'en', 'light'), (1440, 900, 'en', 'light'), (390, 320, 'el', 'dark'), (320, 256, 'en', 'dark')]
results = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(**({'executable_path': os.environ['FIRBO_CHROMIUM']} if os.environ.get('FIRBO_CHROMIUM') else {}))
    for width, height, lang, theme in CASES:
        name = f'{width}x{height}-{lang}-{theme}'
        ctx = browser.new_context(viewport={'width': width, 'height': height}, reduced_motion='reduce', color_scheme=theme, has_touch=width < 768)
        ctx.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1:5210/') else route.abort())
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            page.goto(f'http://127.0.0.1:5210/?lang={lang}&theme={theme}', wait_until='networkidle')
            expect(page.get_by_test_id('open-dialog')).to_be_visible()
            # Avoid mistaking the app's hidden root overflow for a clean reflow.
            page.add_style_tag(content='html, body, #root {overflow: visible !important; height: auto !important; min-height: 100%;}')
            measure = page.evaluate('''() => {
              const nodes = [...document.querySelectorAll('.fb-pagehead, .fb-pagehead > *, .fb-pagehead h1, .fb-pagehead p, .fb-seg, .fb-seg button, .fb-stat, .fb-stat__value, .fb-kv')];
              return {width:innerWidth, scroll:document.documentElement.scrollWidth, bad:nodes.filter(n => {
                const r=n.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth+1 || n.scrollWidth > n.clientWidth+1;
              }).map(n => ({tag:n.tagName,class:n.className,client:n.clientWidth,scroll:n.scrollWidth}))};
            }''')
            assert measure['scroll'] <= width + 1 and not measure['bad'], measure
            page.get_by_role('tab').nth(2).click()
            expect(page.get_by_test_id('selected-tab')).to_have_text('quota')
            if width < 768:
                assert page.get_by_test_id('long-action').bounding_box()['height'] >= 44
            if name in ('320x800-el-dark','390x800-ar-dark','1440x900-en-light'):
                page.screenshot(path=str(OUT / (name + '-controls.png')), full_page=True)
            page.get_by_test_id('open-dialog').click()
            dialog = page.get_by_test_id('dialog')
            expect(dialog).to_be_visible()
            rect = dialog.bounding_box()
            assert rect and rect['x'] >= -1 and rect['y'] >= -1 and rect['x'] + rect['width'] <= width + 1 and rect['y'] + rect['height'] <= height + 1, rect
            assert dialog.evaluate('(n) => n.scrollHeight > n.clientHeight'), 'long content must be scrollable, not clipped'
            assert dialog.evaluate('(n) => n.scrollWidth <= n.clientWidth + 1'), 'dialog horizontal overflow'
            field = page.get_by_test_id('field-11')
            field.scroll_into_view_if_needed()
            field.fill('synthetic edited value')
            expect(field).to_have_value('synthetic edited value')
            if name in ('320x800-el-dark','390x800-ar-dark','390x320-el-dark'):
                page.screenshot(path=str(OUT / (name + '-dialog.png')))
            page.get_by_test_id('finish-dialog').click()
            expect(dialog).not_to_be_visible()
            expect(page.get_by_test_id('dialog-result')).to_have_text('closed')
            page.get_by_test_id('open-dialog').click()
            page.keyboard.press('Escape')
            expect(dialog).not_to_be_visible()
            assert not errors, errors
            results.append({'case': name, 'status': 'passed'})
            print('FIRBO_MOBILE_CASE', json.dumps(results[-1]), flush=True)
        except Exception as exc:
            page.screenshot(path=str(OUT / (name + '-FAILED.png')), full_page=True)
            results.append({'case': name, 'status': 'failed', 'error': str(exc)[:2000], 'page_errors': errors[:5]})
            (OUT / 'results.json').write_text(json.dumps(results, indent=2))
            raise
        finally:
            ctx.close()
    browser.close()
(OUT / 'results.json').write_text(json.dumps({'scope':'M1 real shared components with synthetic content','cases':results,
 'not_tested':['complete authenticated pages','physical phone keyboard','iOS Safari','desktop agent execution','complete accessibility compliance']}, indent=2))
print('FIRBO_MOBILE_ALL_PASSED', len(results), flush=True)
