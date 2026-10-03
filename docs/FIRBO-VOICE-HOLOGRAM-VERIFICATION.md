# Firbo VOICE-1 — voice/hologram lifecycle checkpoint

Verified 2026-10-03. Continue MASTER-PLAN-V2, PR #9 and the existing route/requirement inventory. This is an implemented and tested candidate slice, NOT a new product, full voice release or completed agent-work milestone.

## Exact source and production boundary

- Starting head: `08baeb10f3a1d6edc36fdfe73c48f1432df0179d`, retaining E1 durable local results/receipt verification and the earlier mobile/Computer Manager work.
- Final tested implementation: **`38f4e5fbc081c8191976318494989cde42acfa81`**, branch `codex/firbo-unified-gateway`.
- This later documentation commit does not change the tested implementation.
- Full PR #9 remains draft; no merge/promotion occurred.
- Fresh connected Vercel read: `firboai.app` remains production READY **`ae82ca939f1a19130871c6ad7661f22be200d3c0`**, deployment **`dpl_FFpzRVXxp8UWpSfiZ2RpDZuefBSM`**.
- Real production-domain `/firbo-backend-health` at **20:12:32 UTC** returned HTTP 200 JSON `{"status":"ok"}`, Via Caddy, no-store/CDN no-store, cache MISS. This is health reachability, not real-account voice or tool execution.
- No Supabase function/schema/data, Hostinger service/configuration, provider credential, model selection, device pairing, external action or actual inference was changed/called in this slice.

## Changed — actual implementation, not only a test harness

1. **Owned voice lifecycle:** one in-memory active turn with AbortSignal, identity/organization/language/role fencing, generation checks and bounded waits. A cancelled or replaced turn cannot start late audio, return a late transcript, or reset the current hologram state.
2. **Truthful playback outcomes:** speech returns completed/cancelled/failed. Media enters speaking on actual playback start, not on click or request dispatch. Playback rejection/error/timeout is not reported as completion. Object URLs, media handlers and metering nodes are cleaned up.
3. **Stop/mute:** CEO and Talk controls remain available while waiting for a text answer or TTS. Stop cancels the locally owned turn; mute during a pending text answer preserves text but prevents speech. Closing Talk or changing identity cancels owned media. Already-started server inference or a task is NOT certified cancelled by this frontend signal.
4. **Microphone lifecycle:** permission, recording, explicit Send, transcription and cancellation have separate states. Late microphone grants are released after cancellation/timeout. Recorder construction/errors, byte limits, stream ending and upload failures clean up tracks/resources. Callbacks are installed before recording starts/stops.
5. **Fallback policy:** browser recognition is explicit opt-in rather than a silent service change. Browser synthesis remains a possible output fallback, labelled as browser speech with unavailable amplitude. Auth/budget/rate-limit responses 401/402/403/429 are not bypassed; a partly spoken answer is not replayed wholesale through another voice.
6. **Real meter, not random numbers:** amplitude is derived from Web Audio when available. Browser synthesis does not expose a waveform here and is shown unmetered; there is no Math.random substitute. A measured level is not phoneme-accurate lip sync.
7. **Holographic identity retained:** CoreOrb now consumes actual voice phase instead of always passing idle. Existing HoloHead/CeoStage remain, with reduced decorative motion when requested and a graphics fallback boundary. No static-dashboard replacement, navigation deletion or new avatar artwork.
8. **Existing UI integration:** CeoPage, TalkConsole and AgentChatPage use the revised lifecycle. Mobile voice controls/transcript wrapping retain text input and status diagnostics. New actionable diagnostics are present in all eight current languages.
9. **Durable regression harness:** add a read-only voice workflow and isolated build of real App/Layout/pages with only synthetic services. Temporary snapshot/hash-patch preparation workflows were removed after use; their history is not an ongoing deployment mechanism.

The comparison from the starting head contains 20 implementation/test/config files. The final checkpoint adds documentation only. No package versions or lockfile changed.

## Unit/type/build verification

- **37 new voice tests passed**, covering stale-turn fencing, cancellation, bounded deadlines, phase mapping, language parity, playback start/error/cancel, late TTS, no forbidden fallback, truncation metadata, microphone cleanup, permission denial/late grant, recorder failure, cancelled transcription and quiet-capture limits.
- **260 total frontend Vitest tests passed across 32 files** locally and in the exact six-UI-file candidate verification (223 existing + 37 new).
- Full frontend TypeScript and production Vite/PWA build passed locally and in CI. The normal final frontend workflow also completed successfully.
- Preparation run `37150150642`, job `111282138616`, applies only six locally reviewed UI diffs after validating original/resulting Git blob hashes. The resulting tree `abdfd1876acd7681c97de92f6b915d0cdcb18087` was explicitly committed with the browser harness; the workflow itself never updated a branch or deployment.
- Existing large-chunk, ineffective-dynamic-import and dependency/action deprecation warnings remain; no warning-free build or universal security certification is claimed.

Unit tests simulate SDK, media and device objects. They are not physical hardware or real-provider acceptance.

## Actual-browser result — 18 passed, 0 failed

Final voice workflow **37150477447**, job **111283171153**, on tested head **38f4e5f**.
Downloaded artifact **11283782397**, `firbo-voice-lifecycle-evidence`.
ZIP SHA-256: **`9e7238086095445dab93e6fcd46ad9060a9ced9f393b488f4068962a40862b45`**.

`results.json` was read directly: **18 PASS, 0 FAIL**. Four resulting screenshots (English/Greek phone and Arabic desktop, including recorded-turn output) were visually inspected. The screenshots are of real UI with invented test messages, not a live customer session. A viewport screenshot may be scrolled after interacting with an input; it is not a full-page screenshot.

Cases:
- Typed answer/playback and hologram state at 320px English, 390px Greek and 1440px Arabic.
- Stop while chat is pending, TTS is pending, and media is playing.
- Mute before a text answer arrives and during playback.
- Chromium synthetic microphone -> real MediaRecorder/FormData -> fake transcript -> fake reply -> native media playback.
- Stop during pending transcription; no subsequent chat/TTS request.
- Permission denial; late permission after Stop with track cleanup.
- TTS 403 without browser-speech bypass; answer retained as text.
- Identity change while answer waits; late answer not shown.
- Actual Talk overlay Stop and Close during pending reply.
- Text/speech Stop remains usable without MediaRecorder support.
- Existing Chat screen mute while its answer waits; no late speech request.

### What the browser test actually uses

It renders the real App, Layout, CEO, Talk and Chat components. It uses a generated four-second WAV tone, NOT a natural model voice, and Chromium's synthetic microphone. The real browser handles recording and media playback. Speech/LLM/auth/database data are fake and same-origin test routes; all other hosts and service workers are blocked. No agent-runner or external action is invoked. Autoplay is relaxed by a Chromium test flag, so this does not validate iOS/Safari or normal device autoplay permission behavior.

The checks observe state, visible controls/hologram state attributes, bounded layout, retained transcript, zero live microphone tracks after cancellation and no prohibited late fixture calls. Physical audibility, naturalness, acoustic echo, real transcription accuracy, sustained hands-free dialogue, detailed audio/animation synchronization and real microphone/device driver behavior remain unverified.

Local browser navigation was blocked by the execution environment. `agent-browser` was unavailable, and a direct Playwright navigation was also blocked. Therefore the actual-screen evidence above is from GitHub Actions, not a claimed local browser pass. No browser failure was hidden or relabelled as a local success.

## All twelve final PR workflows completed successfully

| Workflow | Run ID |
|---|---:|
| Voice/hologram lifecycle | 37150477447 |
| Frontend CI | 37150477517 |
| Computer Manager/operational pages | 37150477516 |
| M2 actual-page mobile regression | 37150477489 |
| M1 shared-component reflow | 37150477585 |
| Real local-operation checks | 37150477488 |
| Connectivity candidate | 37150477534 |
| Dependency release gate | 37150477629 |
| Control-plane security | 37150477513 |
| Free model catalogue | 37150477631 |
| VPS/recovery diagnostics | 37150477531 |
| Existing static security | 37150477495 |

These are the returned PR workflows associated with the exact implementation head. Registry results and mocked backend tests have their prior documented limitations. Success is not a claim that the whole product is production-ready.

## Limits and remaining obligations

- The 700-character speech limit is retained and returned as `truncated`; the complete answer remains text. Long-form streaming narration, per-agent voice selection/personas and phoneme/viseme lip sync are not implemented by this slice.
- The lifecycle covers conversation/audio, not a verified task-execution state machine. Do not claim that the hologram's thinking state proves a job is executing or that Stop kills a server/desktop process.
- Existing state labels can be refined visually: repeated status text and phone placement still need product review. All-page mobile/physical-device acceptance remains open.
- Graphics fallback/reduced-motion code is improved, but this is not certification of every driver/context-loss case or every visual animation.
- Speech Blob validation is after the current SDK returns it; it is not a streaming network-body cap on server audio. Recording and request deadlines have explicit bounds; broader backend transport/quotas remain their own gates.
- The current microphone path has silence/max-duration heuristics; real noise environments, manual-send usability and microphone toggling during rapid user activity need human acceptance.
- Real supplied speech and recognized text must pass existing server-side auth, company and budget checks. No keys were exposed to the client or inserted into test data.
- Full job orchestration, safe local pairing, durable server-side ledger/atomic budgets, matched native backend, real approved integration receipts, signed Firbo Desktop/browser/OS input/Stop and actual two-company/device verification remain.
- Existing seven-model registration and local configuration/API-image validation stay completed in their original scope. Full data/volume backups, encrypted off-host copies and real restore/boot are still open. Do not repeat completed Hostinger commands or connectivity promotion.

## Next acceptance and owner handoff

Prepare a specifically identified, backend-compatible visual/voice preview for real device testing; a preview hostname alone does not prove data isolation. Verify its actual environment bindings and provide an exact URL/commit and a small test list. Do NOT promote all of PR #9 solely because these tests passed. No owner Hostinger command or Promote action is required for this candidate checkpoint.

Real-device acceptance should verify: explicit Talk/permission; actual transcript; understandable audible reply; state/motion matching playback; Stop/mute and released microphone; denied permission/network failure; no late answer in another account/company. Then connect voice to the existing execution-first milestone: permitted synthetic documents -> report artifact -> read-back/receipt -> result in Tasks/Computers/Activity, with honest failure and cancellation.

Do not discard the holographic requirement, prior E1 work, remaining route inventory, real integrations or final evidence-based product assessment. This delivers the voice lifecycle foundation; it does not close the full voice-and-useful-work milestone.

## Primary references

- https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play
- https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/stop_event
- https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop
- https://github.com/conpol84/javris-clone/actions/runs/37150477447
- https://github.com/conpol84/javris-clone/actions/runs/37150150642
