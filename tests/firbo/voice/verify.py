"""Real App/CEO/Talk screens and browser audio/recording, isolated services.

Audio is a generated tone, NOT a model voice. Microphone is Chromium's synthetic
input. No real account, speech provider, company record or agent work is called.
"""

import io
import json
import math
import os
import struct
import sys
import wave
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pages"))
from verify import GEOMETRY, NAME, PAYLOADS

BASE = "http://127.0.0.1:5212"
OUT = Path(os.environ.get("FIRBO_VOICE_OUTPUT", "/tmp/firbo-voice-evidence"))
OUT.mkdir(parents=True, exist_ok=True)
TONE = io.BytesIO()
with wave.open(TONE, "wb") as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(24000)
    wav.writeframes(
        b"".join(
            struct.pack("<h", int(2300 * math.sin(i * math.pi * 2 * 440 / 24000)))
            for i in range(24000 * 4)
        )
    )
AUDIO = (
    Path(os.environ["FIRBO_VOICE_WAV"]).read_bytes()
    if os.environ.get("FIRBO_VOICE_WAV")
    else TONE.getvalue()
)
ANSWER = "Synthetic response for the isolated voice lifecycle check."
INIT = """(() => {
 window.__voiceTest={plays:0,streams:[],permissionCalls:0};
 const original=HTMLMediaElement.prototype.play;
 HTMLMediaElement.prototype.play=function(){window.__voiceTest.plays++;return original.call(this);};
 const real=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
 navigator.mediaDevices.getUserMedia=function(options){
   window.__voiceTest.permissionCalls++;
   return real(options).then(stream=>{window.__voiceTest.streams.push(stream);return stream;});
 };
})();"""
CASES = [
    ("typed-reply", 320, "en"),
    ("typed-reply", 390, "el"),
    ("typed-reply", 1440, "ar"),
    ("stop-chat", 390, "en"),
    ("stop-tts", 390, "en"),
    ("stop-playback", 320, "en"),
    ("mute-chat", 390, "en"),
    ("mute-playback", 390, "en"),
    ("record-send", 390, "en"),
    ("stop-transcript", 390, "en"),
    ("permission-denied", 320, "en"),
    ("late-permission", 390, "en"),
    ("tts-auth-failure", 390, "en"),
    ("change-user", 390, "en"),
    ("talk-stop", 320, "en"),
    ("talk-close", 390, "en"),
    ("no-recorder-stop", 390, "en"),
    ("chat-mute", 390, "en"),
]
results = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(
        **(
            {"executable_path": os.environ["FIRBO_CHROMIUM"]}
            if os.environ.get("FIRBO_CHROMIUM")
            else {}
        ),
        args=[
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
        ],
    )
    for kind, width, lang in CASES:
        label = f"{kind}-{width}-{lang}"
        context = browser.new_context(
            viewport={"width": width, "height": 900},
            permissions=["microphone"],
            reduced_motion="reduce",
            color_scheme="dark",
            has_touch=width < 768,
            service_workers="block",
        )
        context.add_init_script(INIT)
        if kind == "permission-denied":
            context.add_init_script(
                "navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Synthetic refusal','NotAllowedError'));"
            )
        if kind == "late-permission":
            context.add_init_script(
                "const realLate=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=o=>realLate(o).then(s=>new Promise(r=>window.__deliverGrant=()=>r(s)));"
            )
        if kind == "no-recorder-stop":
            context.add_init_script("window.MediaRecorder=undefined;")
        calls = []
        external = []
        held = []
        unexpected = []
        errors = []
        hold_name = (
            "agent-chat"
            if kind
            in (
                "stop-chat",
                "mute-chat",
                "change-user",
                "talk-stop",
                "talk-close",
                "chat-mute",
            )
            else "agent-speak"
            if kind == "stop-tts"
            else "agent-listen"
            if kind == "stop-transcript"
            else None
        )

        def reply(route, name):
            if name == "agent-speak":
                if kind == "tts-auth-failure":
                    return route.fulfill(status=403, json={"error": "forbidden"})
                return route.fulfill(status=200, body=AUDIO, content_type="audio/wav")
            if name == "agent-listen":
                return route.fulfill(json={"text": "Synthetic microphone transcript."})
            return route.fulfill(
                json={
                    "user_message": {
                        "id": "vm1",
                        "role": "user",
                        "content": "Synthetic request",
                        "created_at": "2026-10-03T12:00:00Z",
                    },
                    "message": {
                        "id": "vm2",
                        "role": "assistant",
                        "content": ANSWER,
                        "created_at": "2026-10-03T12:00:00Z",
                    },
                }
            )

        def route_request(route):
            u = urlparse(route.request.url)
            if u.netloc != "127.0.0.1:5212":
                external.append(u.hostname)
                return route.abort()
            if u.path.startswith("/__firbo_voice_fixture/"):
                name = u.path.rsplit("/", 1)[-1]
                calls.append(name)
                if name == "agent-speak":
                    payload = route.request.post_data_json
                    assert (
                        payload.get("voice_profile") == "firbo-dark-v1"
                        and payload.get("audio_format") == "wav"
                    ), payload
                if name not in ("agent-chat", "agent-speak", "agent-listen"):
                    unexpected.append(u.path)
                    return route.abort()
                if name == hold_name:
                    held.append((route, name))
                    return
                return reply(route, name)
            if u.path.startswith("/v1/"):
                if route.request.method != "GET":
                    unexpected.append(u.path)
                    return route.fulfill(status=403, json={})
                if u.path == "/v1/firbo/session":
                    return route.fulfill(
                        json={
                            "contract": "firbo-control/v1",
                            "platform_admin": True,
                            "companies": [
                                {"id": "org-1", "name": NAME, "role": "owner"}
                            ],
                            "has_more": False,
                        }
                    )
                return route.fulfill(
                    json={"available": True, "error": None, **PAYLOADS.get(u.path, {})}
                )
            route.continue_()

        context.route("**/*", route_request)
        page = context.new_page()
        page.set_default_timeout(12_000)
        page.on("pageerror", lambda error: errors.append(str(error)))

        def wait_phase(value):
            page.wait_for_function(
                "(s)=>window.__firboVoice?.snapshot().phase===s", arg=value
            )

        def phase():
            return page.evaluate("window.__firboVoice.snapshot().phase")

        def wait_calls(name):
            for _ in range(120):
                if name in calls:
                    return
                page.wait_for_timeout(100)
            raise AssertionError(f"missing {name}: {calls}")

        def flush():
            for route, name in held:
                try:
                    reply(route, name)
                except Exception:
                    pass  # An aborted fetch may already have discarded the request.
            held.clear()
            page.wait_for_timeout(400)

        def live_tracks():
            return page.evaluate(
                'window.__voiceTest.streams.flatMap(s=>s.getTracks()).filter(t=>t.readyState==="live").length'
            )

        def assert_quiet():
            wait_phase("idle")
            assert live_tracks() == 0, "microphone tracks remain active"
            assert page.evaluate("window.__firboVoice.level()") == 0

        def typed(root):
            field = root.locator("form input").last
            expect(field).to_be_enabled()
            field.fill("Synthetic question; no real action.")
            field.press("Enter")

        try:
            url = (
                "/?lang=" + lang
                if kind.startswith("talk-")
                else "/chat?c=c0&lang=en"
                if kind == "chat-mute"
                else "/ceo?lang=" + lang
            )
            page.goto(BASE + url, wait_until="networkidle")
            assert page.evaluate("window.__firboM2.synthetic") is True
            if kind.startswith("talk-"):
                # Use the actual Command Center action; the title is not a mock.
                page.locator("button.fb-talk").first.click()
                root = page.locator('[data-firbo-voice="talk"]')
            elif kind == "chat-mute":
                root = page.locator("main")
            else:
                root = page.locator('[data-firbo-voice="ceo"]')
            expect(root).to_be_visible()
            if kind not in ("chat-mute",):
                expect(root.locator("form input").last).to_be_enabled()
                measure = page.evaluate(GEOMETRY)
                assert measure["documentWidth"] <= width + 1 and not measure["bad"], (
                    measure
                )
            if kind in (
                "record-send",
                "stop-transcript",
                "permission-denied",
                "late-permission",
            ):
                root.get_by_role("button", name="Talk", exact=True).click()
                if kind == "permission-denied":
                    page.get_by_text(
                        "Microphone permission was not granted.", exact=False
                    ).first.wait_for()
                    assert phase() == "error" and not calls, calls
                    assert live_tracks() == 0
                elif kind == "late-permission":
                    wait_phase("opening")
                    page.wait_for_function('typeof window.__deliverGrant==="function"')
                    root.get_by_role("button", name="Stop", exact=True).click()
                    page.evaluate("window.__deliverGrant()")
                    page.wait_for_timeout(300)
                    assert_quiet()
                    assert not calls
                else:
                    wait_phase("listening")
                    page.wait_for_timeout(450)
                    root.get_by_role("button", name="Send", exact=True).first.click()
                    if kind == "stop-transcript":
                        wait_calls("agent-listen")
                        wait_phase("transcribing")
                        root.get_by_role("button", name="Stop", exact=True).click()
                        flush()
                        assert_quiet()
                        assert (
                            "agent-chat" not in calls and "agent-speak" not in calls
                        ), calls
                    else:
                        wait_phase("speaking")
                        assert calls == ["agent-listen", "agent-chat", "agent-speak"], (
                            calls
                        )
                        expect(
                            root.locator("li").filter(has_text=ANSWER).last
                        ).to_be_visible()
                        assert live_tracks() == 0
                        page.screenshot(path=str(OUT / (label + ".png")))
                        wait_phase("idle")
            elif kind == "chat-mute":
                # Enable speech on the actual chat screen, then mute while reply waits.
                root.get_by_role(
                    "button", name="Read answers aloud", exact=True
                ).click()
                field = root.locator("form textarea")
                field.fill("Synthetic chat request.")
                field.press("Enter")
                wait_calls("agent-chat")
                root.get_by_role(
                    "button", name="Stop reading answers aloud", exact=True
                ).click()
                flush()
                expect(root.get_by_text(ANSWER, exact=True).last).to_be_visible()
                assert "agent-speak" not in calls, calls
            else:
                typed(root)
                wait_calls("agent-chat")
                if kind in ("stop-chat", "talk-stop", "talk-close", "change-user"):
                    wait_phase("thinking")
                    if kind == "change-user":
                        page.evaluate("window.__firboM2.switchUser()")
                    elif kind == "talk-close":
                        root.get_by_role("button", name="Close", exact=True).click()
                    else:
                        root.get_by_role(
                            "button", name="Stop", exact=True
                        ).first.click()
                    flush()
                    assert_quiet()
                    assert "agent-speak" not in calls, calls
                    assert page.get_by_text(ANSWER, exact=True).count() == 0, (
                        "late answer leaked into UI"
                    )
                elif kind == "mute-chat":
                    root.get_by_role("button", name="Mute voice", exact=True).click()
                    flush()
                    expect(
                        root.locator("li").filter(has_text=ANSWER).last
                    ).to_be_visible()
                    assert_quiet()
                    assert "agent-speak" not in calls, calls
                elif kind == "stop-tts":
                    wait_calls("agent-speak")
                    wait_phase("preparing")
                    root.get_by_role("button", name="Stop", exact=True).click()
                    flush()
                    assert_quiet()
                    assert page.evaluate("window.__voiceTest.plays") == 0, (
                        "late audio started"
                    )
                elif kind == "tts-auth-failure":
                    wait_calls("agent-speak")
                    page.wait_for_function(
                        'window.__firboVoice.snapshot().phase==="error"'
                    )
                    expect(
                        root.locator("li").filter(has_text=ANSWER).last
                    ).to_be_visible()
                    assert page.evaluate("window.__voiceTest.plays") == 0
                    assert not page.evaluate("window.speechSynthesis.speaking")
                else:
                    wait_phase("speaking")
                    expect(
                        root.locator('[data-holo-state="speaking"]').first
                    ).to_be_visible()
                    if kind in ("stop-playback", "no-recorder-stop"):
                        root.get_by_role("button", name="Stop", exact=True).click()
                        assert_quiet()
                    elif kind == "mute-playback":
                        root.get_by_role(
                            "button", name="Mute voice", exact=True
                        ).click()
                        assert_quiet()
                    else:
                        page.screenshot(path=str(OUT / (label + ".png")))
                        wait_phase("idle")
                        expect(
                            root.locator("li").filter(has_text=ANSWER).last
                        ).to_be_visible()
                        assert calls == ["agent-chat", "agent-speak"], calls
            assert not unexpected, unexpected
            assert not errors, errors
            if kind not in ("tts-auth-failure", "permission-denied"):
                assert_quiet()
            assert page.evaluate("window.__voiceTest.permissionCalls") <= 1, (
                "unexpected microphone restart"
            )
            results.append(
                {
                    "case": label,
                    "status": "passed",
                    "fixture_calls": calls,
                    "external_blocked": len(external),
                    "plays": page.evaluate("window.__voiceTest.plays"),
                }
            )
        except Exception as error:
            page.screenshot(path=str(OUT / (label + "-FAILED.png")), full_page=True)
            results.append(
                {
                    "case": label,
                    "status": "failed",
                    "error": str(error)[:5000],
                    "page_errors": errors[:4],
                    "fixture_calls": calls,
                    "body": page.locator("body").inner_text()[-4500:],
                }
            )
        finally:
            # Evidence contains synthetic text only. Close releases any still-held routes.
            context.close()
            print(
                "FIRBO_VOICE_CASE",
                json.dumps(results[-1], ensure_ascii=False),
                flush=True,
            )
            (OUT / "results.json").write_text(
                json.dumps(
                    {
                        "scope": "Real App voice lifecycle; generated tone, Chromium fake microphone and mocked speech/LLM/auth services",
                        "cases": results,
                        "not_verified": [
                            "actual speech recognition quality",
                            "audible natural voice quality",
                            "real microphone/permissions on a physical phone",
                            "real provider and live Supabase authentication",
                            "agent or external work execution",
                            "phoneme lip sync",
                            "Safari/iOS",
                            "production deployment",
                        ],
                    },
                    indent=2,
                )
            )
    browser.close()
failed = sum(r["status"] != "passed" for r in results)
print("FIRBO_VOICE_SUMMARY", len(results), failed)
if failed:
    raise SystemExit(1)
