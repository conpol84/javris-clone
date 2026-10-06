# FIRBO design continuation — 6 October 2026

## Changed

- Isolated candidate from current PR30 `ad12f1150b3457148719c6b98dd6225f794a5394`.
  Claude `f6442b75` and parity `ce421e31` histories are retained. No active
  contributor branch is rewritten. PR38 accounting is still a separate draft;
  this UI candidate does not deploy or supersede its ledger work.
- Retains the existing head asset, cyan instrument rings, agent satellites and
  real voice subscription. Adds accessible native buttons for graphics-only
  pause/resume and lightweight graphics, with scope text in all eight languages.
- Pause and OS reduced motion unmount the Canvas and freeze fallback rings.
  Microphone, task execution, permissions and backend cancellation are unchanged.
  The phase label still updates while graphics are paused, including voice error.
- Lightweight mode uses 4,000 rather than 16,000 head points, maximum DPR 1,
  no bloom and a low-power context. Mobile initially selects it; the user may
  change quality. No measured performance/latency improvement is claimed yet.
- Disposes sampled geometry and corrects reversed-edge GLSL smoothstep calls
  (undefined GLSL behavior). This remains amplitude-based jaw motion, NOT
  phoneme/viseme lip-sync or a complete reference-design acceptance.

## Tested / passed

- 9 new unit/server-rendered controls cases; full 537 frontend tests passed.
- Production TypeScript/Vite build passed; existing chunk-size warnings remain.
- Rendered Chromium acceptance script and exact-head CI job added: real controls,
  desktop/mobile bounds, pause/resume, quality, voice independence, reduced motion.
  All network requests are restricted to localhost assets; voice is synthetic.

## Failed / limits

- Local Chromium installation failed because the download was an invalid/truncated
  ZIP. Local real-rendered and screenshot acceptance is NOT claimed. Require the
  new exact-head CI rendered gate before any release.
- No provider call, third-party library installation in production, VPS/Mac job,
  database migration, deployment, credential or permissions change.
- Earlier publication was blocked by source-egress review. The owner explicitly
  approved upload and continuation; PR39 was then created through the connected
  API (CLI lacked credentials), with exact local/remote tree equality.
- First actual rendered job 112452798907 exposed that the scene harness omitted
  the application's index.css/Tailwind layers: Canvas intercepted clicks because
  z-index utilities were absent. Added the real application stylesheet, retained
  normal Playwright clicks and every assertion, and added screenshot artifacts.
  Require the follow-up exact-head rendered result before claiming acceptance.

## Reusable components decision

Sources inspected 6 October 2026; these are candidates, not integrations:

| Component | Decision / boundary |
| --- | --- |
| Mark-LV | Reference for visual/interaction requirements only; CC BY-NC 4.0 prohibits commercial code reuse without separate permission. Do not copy its code/assets. |
| TalkingHead | MIT library candidate for viseme-based 3D speech; demo assets are separately licensed. Own compatible mesh or individually verified CC0 asset required. |
| Pipecat | BSD-2-Clause voice pipeline candidate; evaluate against existing voice routes, cancellation, accounting and per-company authorization before adoption. Provider charges remain separate. |
| Playwright | Already in FIRBO browser runtime. Extend the existing approved protocol; do not install a second autonomous executor. MCP is not itself a security boundary. |
| whisper.cpp | MIT local transcription candidate, particularly Mac; benchmark Greek/noise/latency on the actual device before choosing. Not TTS or reasoning. |
| openWakeWord | Apache code does not make bundled NC-SA wake-word models commercially usable. No automatic bundled Hey Jarvis model adoption. |

References:
- https://github.com/FatihMakes/Mark-LV/blob/main/LICENSE
- https://github.com/met4citizen/TalkingHead/blob/main/LICENSE
- https://github.com/met4citizen/TalkingHead#readme
- https://github.com/pipecat-ai/pipecat
- https://github.com/microsoft/playwright-mcp#security
- https://github.com/ggml-org/whisper.cpp
- https://github.com/dscripka/openWakeWord#license

## Remains — previous plan is not replaced

1. Exact-head frontend and new rendered CI, then visual review against all seven
   references, actual Command Center/mobile integration, accessibility/performance.
2. Prove the VPS tool boundary and useful artifact. Latest PR30 evidence reports
   zero raw upstream calls before parsing; do not claim a parser cause or bypass
   protections. No direct VPS executor is available here.
3. Update the paired Mac without re-pairing; actual browser heartbeat, local
   approval, screenshot/snapshot, Stop/offline and saved-artifact hash acceptance.
4. Server accounting, authorized reconciliation monitor and network-pinned
   egress/SSRF; combine newer PR30 with PR38 and reread live dependencies/applied
   migration identities before any backend/schema/frontend release.
5. Signed-in CEO/meeting/delegation; company Knowledge/Skills/Workflows; provider
   OAuth consent/refresh/revoke; approved channel destination/content tests;
   second-customer isolation; U1/U2/U3 keys/routing; signed OS input; natural
   voice/mobile/eight languages; encrypted offhost bootable restore; monitoring,
   load and final assessment.

FreeLLMAPI stays installed until an accepted replacement exists. Never merge
CI-only PR13. Source/automated/rendered/device/provider/live evidence stay separate.
