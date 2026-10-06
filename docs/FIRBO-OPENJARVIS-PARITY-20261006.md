# FIRBO / OpenJarvis — actual source, connected functions and remaining work

Reviewed 6 October 2026. Continue MASTER-PLAN-V2 and the collaboration rules.
This inventory supplements the existing delivery matrix; it does not restart it.

## Finding

The OpenJarvis implementation is already cloned. Against upstream
`3eb2077c64d1e8f5e53be3cf3e2d78e85b781d77` (5 October), **zero upstream files
are missing** from `src/openjarvis` (950), `frontend/src` (95), `rust` (146)
or `tests` (721). These are file-presence counts, not acceptance scores.
The common ancestor is `f0ecea0dc4c3144e91352449aae0dd3ef88d0280`.
Later upstream commits affecting these code scopes only update two Rust
dependencies; they are not missing product functionality and were not blindly
merged over Firbo's dependency fixes.

AST inspection finds 64 static ToolRegistry registrations, 30 channels,
27 data connectors, 23 agent implementations and 6 engine registrations.
Dynamic registry entries and dependency availability can change the runtime
set. `FIRBO-OPENJARVIS-INVENTORY.json` lists each registration and its source.
Every entry is SOURCE, with runtime verification explicitly false.

The actual remaining work is **exposing appropriate existing functions through
Firbo's identity, company, permission, consent and receipt contracts**, followed
by real execution tests. Copying the same engine again will not do that.

## Current architecture and server evidence

- `firbo-api` supplies the native gateway/control API, not the whole engine.
- Separate Caddy routes `/jarvis/*` and `/jarvis-box/*` target the full admin
  OpenJarvis instance and the customer sandbox. `agent-runner` already bridges
  selected employee powers through its `server_task` tool. The older 3 October
  conclusion that there was no engine bridge is superseded.
- Public checks this session: `/health` returned HTTP 200 with
  `firbo-control/v1`; both `/jarvis/health` and `/jarvis-box/health` returned 200;
  both `/v1/info` paths returned 401 without credentials. This establishes
  reachable services and the anonymous boundary, not their installed commit,
  enabled tool lists, tenant isolation or successful work.
- No Hostinger/SSH execution capability is exposed in this session. Therefore
  systemd configuration, installed hashes, sandbox Docker state and off-host
  restoration remain unverified. Do not manufacture access via SQL or expose
  a new privileged endpoint just to close this evidence gap.
- Firbo Supabase project: `bfeinnsorgjycivozcau`. Latest observed Mac inventory:
  one paired, one online, zero devices advertising `browser_task`.
- Latest observed production frontend at the start of this review:
  `8aed938`, deployment `dpl_HwR3pfREEFg8Xzp9DXQueeJFEGUA`.
  Backend reads: `agent-runner` v79, `connector` v26. Agent-runner already
  included Claude's deliverable work, which was then merged into our candidate.
  These are timestamped observations, not a claim they cannot change later.

## Function-family parity

| OpenJarvis function family | FIRBO path available in source | Still needed for complete acceptance |
|---|---|---|
| Chat / agent reasoning / tool loop | Supabase agent-chat and iterative agent-runner, gateway/BYOK/Free routes | Confirm each chosen route with real task, verified result and accounting |
| Search, calculator, weather, images | 13 named loop actions; source mapping in agent-loop and agent-tools | Credentials/model support and real receipts; preserve per-agent permission checks |
| Browser navigate/click/type/extract | Scoped local browser open/read/click/fill/scroll/upload/download | Update existing Mac Connector/runtime; real local consent/Stop/offline test |
| Browser accessibility tree / screenshot | Original Python tools retained | No equivalent local Connector action yet; explicit capture/retention controls and bounded adapter required |
| File read/write, shell, app/Shortcut | Scoped Connector with durable receipts; separate admin server bridge | Signed distribution, OS-level interruption acceptance, exact file artifact read-back |
| Python / Docker code interpreter | server_task routes customers to separate sandbox; original tools retained | Second real customer account; verify no host/network/shared-memory access and resource limits |
| PDF, git, patches, database, HTTP, REPL | Tools retained in engine; selected capabilities reachable indirectly by admin server_task | Typed per-operation permissions/receipts, bounded inputs/outputs; do not grant whole admin engine to customers |
| Memory / document ingestion / retrieval | Company memory, knowledge ingestion/retrieval, installed skills | Full real ingestion-to-answer acceptance; original knowledge graph/SQL/index tooling is not fully mapped to company APIs |
| Agent spawn/send/list/kill | Firbo employees and missions provide a distinct company workflow | Original engine agent lifecycle is not a drop-in tenant-safe replacement; explicit adapter required |
| Schedule/pause/resume/cancel | Firbo shifts/workflows and engine scheduler both exist | Reconcile ownership and scheduling so one task is not run by both; real recovery evidence |
| Approval queue / decisions | Inbox, exact computer plan parser, connector receipts | Final PostgreSQL concurrency gate, actual browser approval on Mac, denied/cancelled outcomes |
| 30 messaging channels | Original channel implementations; Firbo integration adapters and callbacks | Account linking, token refresh/revoke and approved real destination/content tests; no blanket Live claim |
| 27 data connectors | Original connectors; Firbo selected knowledge/integration adapters | Per-company consent, sync cursors, dedup and disconnect lifecycle for each supported connector |
| Google / Microsoft OAuth | Provider definitions, scopes and OAuth lifecycle exist in integrations | Provider application setup, real consent, refresh and revoke; no connection can be fabricated |
| Speech / local engines | Voice functions, local Piper/Whisper paths and engine choices retained | Real microphone, languages, cancellation and signed desktop acceptance |
| MCP / A2A | Original packages and Firbo MCP source retained | Authenticated per-company tool discovery/dispatch and scope verification |
| Telemetry, budget, traces, evaluation, learning | Original engine modules retained; gateway/company analytics exist | Durable atomic cross-route budgets, reconciliation and tenant trace ownership; engine research APIs are not automatically company APIs |
| Desktop / OS input | Tauri source, pairing and Connector retained | Firbo-signed installer/updater; real mouse/keyboard and screen capture grants; Windows/Mac acceptance separately |
| Backup / monitoring / operations | Recovery scripts, guards and prior checks retained | Encrypted off-host data/volume restore that boots; alerts/load and coordinated rollback |

The static catalog still contains historical `live`, `engine` and `planned`
labels; it is not an installed-runtime capability registry. In particular,
`engine` on Web search/Calculator does not mean their Firbo adapters are absent,
and `live` on a channel does not mean a user's account is connected. The live
`integrations` table returned zero rows in this review. No account or permission
was enabled to make a test appear complete.

## Reconciled changes

- Preserved Claude `ca8bdf9`, `63a9279`, `c88df12` and `c3912f9`, including
  fresh computer policy, Inbox browser execution, Studio computer power,
  report/presentation/message standards, PowerPoint export and repair prompts.
- Preserved Codex PR #16 (`525bb38`) task-run binding, atomic claim boundary,
  current employee/tool/task checks and parent lifecycle guards.
- Confirmed Shortcut termination rather than treating SIGTERM as completion;
  bounded SIGKILL escalation and `stop_unconfirmed_needs_review` preserve the
  uncertainty if no close event arrives. A late zero exit cannot turn Stop into
  success. This tests the CLI lifecycle, not a rollback of delegated OS effects.
- Preserved Claude's intended suggest-only list/read permission in the SQL
  guard; mutation remains blocked. Locked fresh agent/tool rows and reject
  malformed working-hour values. Claims take parent before device locks.
- Isolated SQL and concurrency test devices, retaining all assertions. FIFO
  correctly returns earlier work; sharing one synthetic queue across unrelated
  cases was an invalid test assumption, not a reason to weaken FIFO ordering.

## Release and completion rules

PR #17 is the combined candidate; PR #16 alone lacks the newer deliverable work.
PR #13 remains CI-only and excluded. Before release, fetch Claude again, compare
all live function dependencies, and run the combined tree's PostgreSQL and
Chromium gates. Do not replay the three already-applied 20261006 migrations.
The new agent run protocol migration requires no running legacy agent jobs;
deploy its dependent connector/runner only after database acceptance.

Next completion sequence: finish the tested hardening release; real Mac browser
and useful artifact; real sandbox account; provider OAuth and authorized channel
tests; map remaining engine families through company-specific adapters;
signed desktop/OS acceptance, accounting, restore and final assessment.
The master plan is not complete merely because the upstream source is present.

## Reproduction

```bash
git fetch --no-tags https://github.com/open-jarvis/OpenJarvis.git HEAD:refs/remotes/upstream-review/main
python scripts/firbo_parity_inventory.py --upstream 3eb2077c64d1e8f5e53be3cf3e2d78e85b781d77 --output docs/FIRBO-OPENJARVIS-INVENTORY.json
```

Source references: https://github.com/open-jarvis/OpenJarvis/tree/3eb2077c64d1e8f5e53be3cf3e2d78e85b781d77
and https://github.com/conpol84/javris-clone/pull/17 .
