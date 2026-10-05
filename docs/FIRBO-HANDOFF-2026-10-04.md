# FIRBO AI — Full Engineering Handoff
## 4 October 2026 · source of truth after WEBSITE↔LAPTOP-1

This document is for the next ChatGPT conversation or developer. Read it before changing Firbo. Do **not** restart completed audits, local-model installation, native API installation, execution-receipt work, or this Website↔Laptop browser-open slice from zero.

The owner means **the Firbo website opened in the mobile browser**, not a native mobile application. Desired behavior: speak/type on the Firbo website on the phone -> Firbo selects the owner's paired laptop -> the laptop actually opens/works in a browser -> the website reports the real result. Full browser click/type/screen control is still a later Desktop executor gate; this handoff implements the first real cross-device browser action: **open a public HTTPS page on the paired laptop without granting a shell**.

---

## 1. Repository / PR / deployment identity

Repository: `conpol84/javris-clone` — currently PUBLIC. Do not commit tokens, .env files, connector journals or private rollback files.

Work branch: `codex/firbo-unified-gateway`  
Current branch head at final audit: **66fe7d850b02166214f1aed2fd4b082a4b9586d4** (documentation-only follow-ups after the tested Website↔Laptop implementation). Last explicitly tested Website↔Laptop code source: **9aca210dbb5219ccb8bb85c017e151f87adf4da9**.  
Base branch: `claude/omniroute-engine`, base SHA **50bea79134fb28aacc9d5d3fcd949ba8d8239d78**  
PR: **#9**, open, mergeable, DRAFT. Do not merge merely because this slice is green.

### Production frontend
Fresh Vercel read after this work:
- domain: `firboai.app`
- deployment: **dpl_AXUPy9TUxZxrEsSZaWs4fFtDPHN6**
- source: **184c7acb43d49031e440e5a309719eec7379a5cf**
- state: READY

The PR body still contained an older production SHA before this handoff. Use the value above.

### Latest tested preview
- source: **9aca210dbb5219ccb8bb85c017e151f87adf4da9**
- deployment: **dpl_HgjvYvdAWyAo4WmNjFJKqq7UF5GG**
- URL: **https://jarvis-command-center-o7ozq1cpc-conpol84s-projects.vercel.app**
- `/computers`: HTTP 200 verified.
- previous source bundle inspection confirmed `Website ↔ Laptop`, `Voice laptop`, and `browser_open` are present.

Attempting Vercel `request_promote` for the exact READY deployment returned:
`422 unprocessable_entity: Resource cannot be processed.`

Do not keep retrying or reassign production aliases blindly. Either diagnose Vercel's promotion restriction or use the Vercel dashboard/approved production-deploy path for the exact reviewed SHA. Production has **not** been updated by this slice.

---

## 2. Current server / AI runtime already completed before this slice

Hostinger current machine is `srv2027143`.

Owner-supplied capacity snapshot:
- 2 logical CPUs
- 7.75 GiB RAM
- ~5.83 GiB available at snapshot
- ~65.59 GiB free disk
- no GPU detected
- no swap

Prior completed/live work that must be preserved:
- native Firbo API installed on Hostinger
- OmniRoute live
- local Ollama / Qwen3 1.7B live
- local model rollout had 3/3 real smoke samples and no paid fallback on that local lane
- durable connector execution receipts implemented
- connector jobs carry `task_id`, `approval_id`, `report_sha256`, `receipt`
- `connector_decide_execution` and `connector_finish_execution` are service-role-only RPCs
- approval -> exactly one connector job -> device result -> canonical SHA-256 receipt -> task result/status -> audit lifecycle exists
- five stale Running tasks were recovered to Blocked with audit instead of being silently completed/deleted

Local multilingual Piper voice is a separate candidate:
- proof workflow generated real mono WAV for EN/EL/ES/PT-BR/FR/DE/ZH-CN
- Arabic is deliberately device fallback until an acceptable licensed server voice exists
- rollout/rollback package exists
- **Piper local voice is NOT yet installed on the owner's VPS**
- do not confuse this with the already-deployed agent-speak/Dark voice work

---

## 3. WEBSITE↔LAPTOP-1 — what was actually implemented

### A. Dedicated laptop job: `browser_open`

Files:
- `frontend/public/firbo-connector.mjs`
- `supabase/functions/connector/index.ts`
- `frontend/src/lib/company/computers.ts`
- `frontend/src/lib/company/laptop-bridge.ts`
- `frontend/src/lib/company/useCeoSession.ts`
- `frontend/src/pages/ComputersPage.tsx`
- `frontend/src/pages/CeoPage.tsx`
- `frontend/src/components/command/TalkConsole.tsx`

`browser_open` is **not** implemented as a generic shell command.

Local Connector rules:
- new pairing flag: `--allow-browser`
- existing paired connector upgrade command: `node firbo-connector.mjs allow-browser`
- browser-only pairing may have no allowed filesystem folder
- file read/write/exec permissions remain independent
- remote job cannot turn browser permission on
- Connector reports actual `job_kinds` capabilities to the server during the capability handshake
- an old Connector that does not report `browser_open` is not presented as browser-ready
- Windows launcher: `explorer.exe <URL>`
- macOS launcher: `/usr/bin/open <URL>`
- Linux launcher: `xdg-open <URL>`
- launch uses `shell:false`
- only HTTPS targets are accepted
- URL credentials, localhost and IP literals are rejected
- no general `--allow-exec` is required merely to open a browser page

This is intentionally **open-page only**. It does not yet click, type, scroll, upload, download or inspect a live browser DOM. Those remain the dedicated visible-browser/Desktop milestone.

### B. Real capability storage

Live migration applied successfully:
- migration: **20261004114507 connector_browser_open**
- Git migration file: `supabase/migrations/20261004114000_connector_browser_open.sql`

Live schema now has:
- `connector_devices.capabilities jsonb NOT NULL DEFAULT '{}'`
- bounded JSON object check
- `connector_jobs_kind_check` now allows:
  `list, read, write, exec, browser_open`

Migration was applied while live `connector_jobs` had:
- total jobs: 0
- active queued/running: 0

### C. Live Connector backend v7

Supabase project: `bfeinnsorgjycivozcau`

`connector` Edge Function:
- ACTIVE
- **version 7**
- same function ID: `4099d34d-d118-42d2-bfe8-a8f84bff58d5`
- deployed artifact SHA: **523976edf5e85533452dc4cd981f3e71f6fda7385adb577c34244b4b87628d41**
- Git source blob SHA: **15d5b3c558d065d73658e2c2c47b5d059e120c73**
- `verify_jwt=false` is intentionally preserved because the same function handles device-token calls; people-side requests still call Supabase Auth and enforce owner/admin organization membership internally.

v7:
- sanitizes and stores client-reported capabilities
- returns accepted job kinds
- validates `browser_open`
- queues `browser_open` only for an existing paired device in the correct organization
- keeps existing durable execution receipt/RPC lifecycle
- audit metadata stores browser host instead of pretending a generic command was run

### D. Website Voice-laptop selection

Computer Manager now includes a separate **Website ↔ Laptop** section.

Behavior:
- each actual paired/online browser-capable laptop can be selected as **Voice laptop**
- selection is stored per organization in browser localStorage
- if exactly one browser-ready laptop is online, voice dispatch may auto-select it
- if several are online and none is selected, the website asks the owner to choose rather than guessing
- removing a selected computer clears that website selection
- current bridge UI/voice messages are explicitly complete for EN/EL; other languages still need the final localization pass

New-pair onboarding now shows a browser-only path:
`node firbo-connector.mjs pair <CODE> --allow-browser`

For an existing local Connector configuration:
1. download/use the current `firbo-connector.mjs`
2. stop the old running Connector
3. run `node firbo-connector.mjs allow-browser`
4. restart with `node firbo-connector.mjs run`

The CLI candidate still requires Node 22.13+ and is **not** a signed Firbo Desktop installer.

### E. Mobile website voice -> laptop flow

`useCeoSession` now intercepts explicit browser commands for owner/admin **before sending them to the LLM**.

Example:
`Άνοιξε το browser στο example.com`

Flow:
1. mobile website microphone/STT creates the text turn
2. `useCeoSession.ask()`
3. deterministic `parseLaptopBrowserCommand()`
4. list browser-ready devices for the organization
5. resolve stored Voice laptop / single-device automatic choice
6. server queues `browser_open`
7. local Connector polls and claims the job
8. local Connector calls the platform browser launcher
9. result is written to local durable journal and reported using the existing receipt protocol
10. website polls job history
11. website says “opened” **only** if `status=done` and `result.launched=true`
12. timeout/unconfirmed/error is never presented as successful

Current deterministic command parsing is deliberately narrow. EN/EL browser-open phrases and direct domains are supported. Expand the parser or move to a safely structured tool-intent layer before claiming all eight languages.

Voice Stop can cancel the website's waiting/late UI result. It is **not** a guarantee that a browser already launched on the laptop can be closed remotely.

---

## 4. Why the user's laptop still does not connect right now

Live database check after backend deployment:
- connector device records: **1**
- paired: **0**
- online: **0**

Therefore there is currently **no physical laptop executor connected to Firbo**.

No software change on the server can truthfully make a remote laptop execute work until something runs on that laptop and completes pairing. This is the hard physical boundary.

The next real acceptance test must happen on the owner's personal/test laptop, not only in CI.

Minimum physical acceptance:
1. open the latest preview `/computers` on the website
2. use/create the unpaired computer entry and obtain a fresh pairing code
3. on the laptop, download the current `firbo-connector.mjs`
4. run:
   `node firbo-connector.mjs pair <CODE> --allow-browser`
5. run:
   `node firbo-connector.mjs run`
6. website must show that laptop as paired, online and browser-ready
7. select it as Voice laptop
8. from the website on the phone say:
   `Άνοιξε το browser στο example.com`
9. verify the laptop's default browser actually opens that site
10. verify the website receives the completed receipt and only then reports success
11. stop/restart Connector and verify offline/online state truthfully changes
12. revoke the device in Firbo and verify the old token cannot poll or execute again

Do not bypass owner/admin checks if a real account gets 403. Diagnose membership/role.

---

## 5. Verification evidence for this slice

### Durable/local executor
Workflow **Firbo real local-operation checks**:
- run **37199414364**
- source **20d6b5b15e51bf9dad4f5b911d61d3fa1eef6998**
- Windows: PASS
- Ubuntu: PASS

This run includes the new dedicated browser permission/launch tests plus existing files/processes/SQLite/receipt behavior. The test Edge identity/database is synthetic; local filesystem/process/SQLite work is real.

### Frontend
Final relevant source was unchanged after the deterministic test-only fix.
Current-head Frontend CI:
- run **37199855286**
- source **9aca210dbb5219ccb8bb85c017e151f87adf4da9**
- SUCCESS

Earlier failing bridge test was fixed: it originally waited the real 16-second confirmation deadline and hit Vitest's 5-second test timeout. The production deadline remained 16 seconds; the test now advances its injected clock deterministically.

### Mobile
M2 actual-page mobile:
- run **37199855272**
- source **9aca210...**
- SUCCESS

### Computer Manager / Website↔Laptop UI
Computer Manager:
- run **37199855238**
- source **9aca210...**
- SUCCESS

The prior run failed only because the test loop ended on the fifth “Open browser” tab and then searched for the `Advanced:` warning that exists on the exec tab. The test was corrected to return to exec before checking that warning. Final page reflow/lifecycle step passed.

### Other current-head gates
- control-plane security: run **37199855308**, SUCCESS
- no-paid text inference pilot: run **37199855280**, SUCCESS
- voice/hologram lifecycle at source containing the bridge: SUCCESS
- connectivity and M1 shared reflow at source containing the bridge: SUCCESS

### Vercel preview
Latest exact preview is READY:
- deployment **dpl_HgjvYvdAWyAo4WmNjFJKqq7UF5GG**
- source **9aca210...**
- `/computers`: HTTP 200

Production promotion remains blocked by Vercel API 422.

---

## 6. Important security / truthfulness boundaries

Do not weaken these to make demos look green:
- only owner/admin may create/revoke/give computer jobs
- device authentication uses random device token stored server-side only as a hash
- browser-open permission is local and independent
- capability is reported by the actual running Connector; server does not invent it
- no public laptop listener is opened; Connector polls outbound to Firbo
- `browser_open` does not grant shell/file rights
- localhost/IP/credential URLs are refused in this browser-open path
- durable results remain receipt-hashed; failed delivery must not re-execute work blindly
- queued cancellation does not prove running process cancellation
- Website Stop does not prove laptop/browser process Stop
- no claim of full sandbox: generic `--allow-exec` is still a shell as the local user and remains a separate advanced/test permission
- no claim of full browser automation: click/type/scroll/screen/download/upload are still open
- no claim that a PWA on the phone controls other phone apps
- do not call a device Online based only on a stored row

Latest Supabase security advisor still reports:
- leaked-password protection disabled
- several authenticated-callable SECURITY DEFINER functions requiring review
- secret tables with RLS but intentionally no client policies

Do not “fix” secret-table no-policy warnings by exposing policies. They are service-only tables. Review each SECURITY DEFINER function separately.

---

## 7. Whole FIRBO plan — what is done vs what is NOT done

### DONE / live in its stated scope
- Hostinger native Firbo API
- OmniRoute runtime
- Ollama Qwen3 1.7B local text lane
- no-paid-fallback local text pilot mechanics
- connector device pairing backend
- durable connector result journal/receipts
- approval -> connector execution receipt lifecycle
- Supabase connector execution RPCs
- Website↔Laptop `browser_open` schema/backend v7
- browser capability reporting
- Website Voice-laptop selection source/UI
- deterministic mobile website voice -> browser-open dispatch source
- tested cross-platform local browser launcher
- latest preview containing all of the above

### SOURCE/TESTED but not fully live/accepted
- latest Website↔Laptop frontend is preview only because production Promote returned 422
- physical website->personal laptop acceptance
- multilingual local Piper voice rollout package
- connected-provider OAuth/read candidates
- Home Assistant/Traccar read candidates
- broader connected-world device UI

### OPEN / must not be called complete
1. **Actual personal/test laptop acceptance** — currently 0 paired, 0 online.
2. **Signed Firbo Desktop installer/updater** — current connector is CLI candidate.
3. **Dedicated visible browser executor** — open page exists; click/type/scroll/upload/download/DOM verification does not.
4. **Opt-in OS mouse/keyboard** with local takeover/Stop, sleep/lock reconciliation.
5. **True local Stop** for already-running desktop/browser work.
6. **Useful-work product acceptance**: one instruction -> scoped task -> permitted tools -> persisted artifact -> readback verification -> receipt -> Tasks/Computers/Activity/hologram all representing the same task.
7. **Local multilingual voice installed on real VPS** and real human quality/Greek pronunciation/mic/phone/Safari acceptance.
8. **Full eight-language pass** for Website↔Laptop copy/intent parser and remaining application routes/popups.
9. **Real integration consent/action acceptance** for YouTube, TikTok, Salesforce, QuickBooks; posting/writes/financial actions need approval/idempotency semantics.
10. **Home/car activation** with hostile-network/DNS-rebinding/load hardening.
11. **Free subscription product gate**: entitlement/abuse/rate limits/monitoring for every potentially paid feature, not just local text.
12. **Global durable request/budget ledger**, atomic cost reservations, real Free-only policy across all feature paths.
13. **Distinct scoped/rotated gateway inference vs management keys** and guarded write audit.
14. **Reproducible complete migration baseline**.
15. **MCP / Shifts** finalization.
16. **Two-real-company adversarial isolation tests** including device jobs.
17. **Encrypted off-host data + volume backups and isolated restore test**; local config/image rollback is not disaster recovery.
18. **Monitoring/performance/capacity** under sustained inference and real users.
19. **Supabase leaked-password protection and SECURITY DEFINER review**.
20. **Coordinated production release / rollback / real-account smoke**.
21. **Final evidence-based product assessment**. Do not call Firbo number-one/world-best before these gates are real.

---

## 8. Next developer sequence — do this in order

### STEP 1 — do not rewrite Website↔Laptop
Use current head **9aca210...**. Inspect existing implementation first. Do not replace it with shell commands or a second device system.

### STEP 2 — finish production publication
Diagnose why Vercel Promote rejects READY deployment **dpl_HgjvYvdAWyAo4WmNjFJKqq7UF5GG** with 422.
Target must remain the exact reviewed source **9aca210...** or a new production build from that exact source/config.
After release, re-read `firboai.app` deployment SHA. Do not claim production changed until it does.

### STEP 3 — pair a real laptop
Use the owner's personal/test laptop.
Prefer browser-only permission first:
`node firbo-connector.mjs pair <CODE> --allow-browser`
then:
`node firbo-connector.mjs run`

If Node/CLI onboarding is unacceptable, build the signed Desktop installer around the same protocol instead of inventing a new pairing backend.

### STEP 4 — execute the physical mobile-web acceptance
Run the 12-step physical checklist in section 4.
Record exact job ID, device ID (internally only), status sequence and receipt — do not publish tokens.

### STEP 5 — evolve open-page into dedicated browser work
Build a Firbo Desktop controlled browser profile using the existing device/job/receipt model:
- navigate
- click
- type
- scroll
- upload/download under explicit task scope
- DOM/accessibility-tree readback
- screenshot only when needed
- local visible Stop/takeover
- per-task browser permission, not global shell
- bounded timeouts/redirect/domain policy
- durable result receipt and reconciliation

Do not use `exec` as the final browser automation layer.

### STEP 6 — useful-work E2E
Acceptance example:
“Firbo, read the test files in the folder I allowed and prepare a report.”
Same task must appear consistently in voice/hologram/Tasks/Computers/Activity and end with a saved/read-back artifact.

### STEP 7 onward
Continue Desktop -> integrations -> physical devices -> all languages/mobile -> Free entitlement/budgets -> recovery/monitoring -> release/final assessment. Keep MASTER-PLAN-V2 and delivery matrix as backlog; append checkpoints rather than restarting.

---

## 9. What NOT to repeat

Do not ask the owner to repeat:
- native Hostinger API rollout
- VPS capacity snapshot
- Ollama/Qwen local model installation already recorded live
- seven OpenCode catalogue registration
- execution receipt migration/RPC work
- stale task recovery
- connector browser schema migration `20261004114507`

Do not regenerate device tokens, prune rollback images/configs, or rerun old recovery scripts without a concrete reason.

---

## 10. Immediate owner-facing truth

The Website↔Laptop software path now exists in source and live backend, and its CI gates are green.

It cannot physically open the owner's laptop browser **yet** because the live database currently has **0 paired and 0 online laptops**. The owner/dev must complete one local pairing/run on the laptop. That is not a server bug and cannot be truthfully bypassed from a phone browser.

The newest frontend with the pairing/browser UI is currently a READY preview, not production, because the Vercel promotion API is rejecting it with 422.

Those two items — **production frontend publication** and **real laptop pairing/acceptance** — are the immediate blockers before claiming “mobile website voice opens my laptop browser” is complete in the real world.

## FINAL AUDIT ADDENDUM — 4 October 2026 12:00 UTC

A final live re-check after the handoff confirmed:
- Supabase connector Edge Function is ACTIVE **v7**, artifact SHA **523976edf5e85533452dc4cd981f3e71f6fda7385adb577c34244b4b87628d41**, contains both `browser_open` and durable `connector_finish_execution` handling.
- Live database constraint accepts exactly `list/read/write/exec/browser_open`; `connector_devices.capabilities` migration is live.
- Live device inventory is still **1 total / 0 paired / 0 online**. Physical Website→Laptop acceptance therefore remains impossible until the owner/dev runs the Connector on a real laptop.
- `firboai.app` still resolves to deployment **dpl_AXUPy9TUxZxrEsSZaWs4fFtDPHN6**, source **184c7acb43d49031e440e5a309719eec7379a5cf**. The Website↔Laptop frontend is still newer preview source **9aca210dbb5219ccb8bb85c017e151f87adf4da9**; no production publication was confirmed.

CI truth at source `9aca210...`:
- Frontend CI, Computer Manager, M2 mobile, control-plane, no-paid text, real local-operation checks, connectivity, M1, voice/hologram, native rollout, connected devices and SAST were successful.
- **Two separate workflows are red and must not be hidden:**
  1. `Firbo local voice and model compatibility` failed before its application tests because `npm install --global npm@11.19.0` hit runner filesystem **EACCES** at `/usr/local/share/man/man5`. This is a CI setup failure, not evidence that voice/model runtime failed.
  2. `Firbo actual local-model install and useful draft` passed its isolated Python contracts and actual Qwen smoke (FIRBO_OK / έτοιμο / 50) but its disposable Docker API canary ended `local_api_boot_or_auth_check_failed`. The production VPS local model was already installed earlier and is not rolled back by this CI failure. The disposable canary regression still needs diagnosis before calling the entire PR green.

Current Supabase Security Advisor still reports leaked-password protection disabled and six authenticated-callable SECURITY DEFINER functions requiring review. RLS-with-no-policy findings on secret/service-only tables must **not** be “fixed” by exposing client policies.

The branch contains later documentation-only commits after the tested implementation. Treat **9aca210...** as the last explicitly cited tested Website↔Laptop implementation source until a newer code SHA is fully re-run. Read branch history before editing; never reset to the old source snapshots referenced earlier in the conversation.


## FINAL LIVE AUDIT — 4 October 2026, before handoff

This final audit re-read the live services rather than relying only on prior notes:

- Supabase connector Edge Function: ACTIVE **v7**, artifact SHA **523976edf5e85533452dc4cd981f3e71f6fda7385adb577c34244b4b87628d41**, with both `browser_open` and `connector_finish_execution` present.
- Live `connector_devices.capabilities` column exists as JSONB with default `{}`.
- Live device inventory remains **1 total / 0 paired / 0 online**. Therefore physical phone-website -> laptop execution has NOT been accepted on the owner's hardware.
- Vercel production `firboai.app`: deployment **dpl_AXUPy9TUxZxrEsSZaWs4fFtDPHN6**, source **184c7acb43d49031e440e5a309719eec7379a5cf**, READY.
- Exact Website↔Laptop preview: deployment **dpl_HgjvYvdAWyAo4WmNjFJKqq7UF5GG**, source **9aca210dbb5219ccb8bb85c017e151f87adf4da9**, READY. Production publication remains unconfirmed.
- At source `9aca210...`, the current regression set is mostly green, including Frontend CI, Computer Manager, M2 mobile, real local-operation checks, control-plane, no-paid text, connectivity, M1, voice/hologram, native rollout, connected devices and SAST.
- Two workflows remain red and must not be hidden: **Firbo local voice and model compatibility** (runner npm global-install EACCES setup failure) and **Firbo actual local-model install and useful draft** (disposable Docker API canary `local_api_boot_or_auth_check_failed` after actual Qwen smoke passed). These do not roll back already-live VPS Ollama, but they must be diagnosed before calling the PR fully green.
- Security Advisor still reports leaked-password protection disabled and six authenticated-callable SECURITY DEFINER functions requiring review. Secret/service-only RLS tables with no client policies must not be exposed merely to silence the linter.

### Exact immediate blockers
1. **Publish the reviewed Website↔Laptop frontend to production** or use the exact READY preview for acceptance; do not claim `firboai.app` contains it yet.
2. **Run/pair the current Connector on a real personal/test laptop with `--allow-browser`**, then complete the physical voice/browser receipt checklist.
3. After that, evolve `browser_open` into the dedicated visible-browser executor (click/type/scroll/upload/download/readback) without using generic shell as the final architecture.

Everything else in this handoff remains part of the same MASTER-PLAN-V2 backlog and must not be silently dropped.
