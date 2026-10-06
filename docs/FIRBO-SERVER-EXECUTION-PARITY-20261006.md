# FIRBO / OpenJarvis — runtime execution evidence, stage 1

Owner direction: leave FreeLLMAPI installed for now; remove it only when a replacement is installed. Stop pursuing its activation as a prerequisite. Continue the missing FIRBO/OpenJarvis functionality, preserving Claude and Codex. No FreeLLMAPI resource changed.

## Reconciled source

Candidate branches from `68fe576b6cc4860af274b7bfd52b41a21a6b22f5` (PR29), preserving the exact live Claude runner v89 including Tavily. Verified shared branch `f6442b754eb26019c16f4aa40c50a15d6e73c14b`; parity `ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a` remains an ancestor. PR28 accounting design is retained; this does not implement that ledger. PR13 remains CI-only and must not be merged.

## Concrete gap fixed in this candidate

OpenJarvis `_handle_agent` had real `AgentResult.tool_results`, but its non-streaming response discarded them. The FIRBO `server-jarvis` bridge and employee `server_task` then returned only model prose. The admin panel could not distinguish a failed file or code operation from a model claiming success.

- Opt-in `firbo_include_execution` adds a versioned runtime envelope to agent responses. It includes total and failed tool counts, up to 24 tool results, bounded output (2,000 characters each, 24,000 total), and truncation markers. Failures beyond displayed entries remain counted. Arguments and internal metadata are not exported; tool output is authorized result data, not a credential-sanitization guarantee.
- Existing callers do not request receipts. Plain engine responses and older servers cannot acquire execution evidence from model-authored text.
- The admin bridge requests and validates the envelope after its existing user/platform-admin checks. Nothing grants customer access to the admin engine.
- Employee server tasks request the same envelope on their existing selected server. Failed tool results are included in the next model context, prioritized within its bounded result. The existing fresh task/employee permission guards and customer sandbox selection are retained.
- The existing server panel displays the returned tool results separately from prose in expandable text-only entries, with explicit unknown/empty/truncated evidence. A returned tool result does not independently verify a saved file or external action.
- Empty final text no longer discards valid tool results. A transport rejection releases the panel's busy state. Labels cover all eight existing locales.

## Tested / passed

- 103 Node tests: actual agent/chat entrypoints plus parser and admin bridge, with fake SDK/database/provider transport. Covers admin denial, missing/malformed/legacy receipts, bounded output, real error propagation to the employee, and preserved task authorization. No real provider calls.
- 16 Python tests: receipt contract, existing response models, and concurrent request-model override behavior. The handler runs a fake agent with actual AgentResult/ToolResult objects.
- 5 React tests: escaped output and failure presentation, unknown/empty/truncated cases, empty final answer with receipts, and rejection/busy cleanup. Static render and handler probes, not browser/real-account acceptance.
- Strict frontend and Edge TypeScript; production Vite/PWA build; focused Ruff checks and formatting; diff check.
- Added exact-source PR workflow for receipt/bridge/panel gates. Remote CI must be checked independently.

## Remaining parity, in delivery order

| Family | Evidence now | Required next |
|---|---|---|
| Server work and visible results | This candidate closes discarded runtime reports | Matching VPS engine + Edge bundles + reviewed frontend; real allowed code/file task and artifact read-back |
| Local computer work | Paired Mac exists; last read was offline, no browser_task; one exec queued | Inspect pending work, update existing Connector without pairing again; local consent, browser, Excel, Stop/offline |
| Resume after approval | Computer jobs can finish separately | Feed approved job receipts into the same employee task through a durable claim-aware continuation; avoid duplicate execution on retry |
| OpenJarvis memory/knowledge | Source modules plus company knowledge adapters | Full ingestion/retrieval acceptance and tenant mapping for original graph/index/query features |
| Skills, agent lifecycle, workflows | Existing source and separate FIRBO workflows | Map supported engine operations through scoped company APIs; one scheduling owner; usable controls and recovery tests |
| Integrations/channels | Adapters exist; last read showed zero connected integrations | Actual provider consent, refresh/revoke, approved destination/content and useful returned result |
| Accounting and traces | Chat/mission ledger delivered in earlier releases | PR28 runner per-attempt design, speech/search/tool accounting, reconciliation UI; this candidate is not a durable ledger |
| Customer sandbox | Existing admin/customer routing retained | Second real customer, files/network/resource boundaries and adversarial isolation |
| Voice, desktop and operations | Existing implementation remains | Real multilingual mic/Stop, signed desktop, OS input, encrypted off-host restore, load/monitoring |

## Failed / limits / release gate

No VPS/SSH execution connector is available in this session. The user's Mac SSH tunnel is not assistant access. This candidate has not changed production, credentials, device permissions, queued jobs, provider accounts, or databases. No tool result proves a useful artifact has been saved until read back.

This stage covers non-streaming calls used by the two FIRBO bridges. SSE receipts, incremental progress, cancellation of a remote running tool, durable job/result storage, and full OpenJarvis parity remain open. The earlier static source inventory must not be described as functional completion.

Before release, re-read both shared heads and live Edge bundles, retain new Claude work, run exact-head CI and preview, and capture current VPS files/images/rollback before applying engine changes. Do not promote production without the owner's required preview/testing gate. Deploy only changed matching bundles and do not replay migrations (none are added here). Old servers remain usable with explicit unverified execution.

## Owner clarification: visible work on the computer

The owner explicitly requires seeing the agent's work in local application/browser windows. Server receipts alone do not satisfy this. Existing `firbo-browser.mjs` already launches Chromium with `headless:false`; it must run on the paired Mac with the reviewed local origin and consent. Its browser actions are not physical OS mouse-pointer automation. Excel/Numbers work must activate the local application, show the changes and leave the useful artifact available for read-back. Shell/file API work must not be described as visible desktop work.

The employee loop now explicitly distinguishes remote server work from visible local computer work and requires reporting missing/offline/approval blockers rather than claiming remote work happened locally. This prompt guidance is not a new execution permission or an end-to-end visible-work guarantee.

Read-only device check at 2026-10-06 14:47:51 UTC: Polis1984 remains paired but offline (last heartbeat 13:27:02 UTC), with list/read/write/exec/browser_open and no browser_task. One queued exec remains, 8c8c1bef-adf4-4e8b-8ce3-153b45e22a2e. The queued AppleScript requests Microsoft Excel activation and saving Weekly-plan.xlsx. A database character check confirms 45 actual newlines and no literal escaped newline or quote sequences; the escaped-looking tool display is JSON encoding, not a confirmed script defect. Real Excel syntax/application/file acceptance remains pending; do not silently alter approved script bytes. No queued job or local setting changed here.

Remote upload of this stage uses PR29 parent fd9ebd4c542ba945c8ff4237ac847ea5bea46b30 (identical tree to local 68fe576b). Initial remote commit ee2c80447c2d9382f5aea2a5a2b5603d9f4c5c9b, draft PR30. Its dedicated Python/bridge/panel CI passed; other workflows were still running when checked. Initial uploaded tree equals local tested tree a67e037d411a5aea721aa9fd88bab36d6840d153. Later source changes require their own exact-head results.
