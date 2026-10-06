# FIRBO combined acceptance candidate — 6 October 2026

## Changed

- Combined the current PR30 runtime repair `39645cec5bf5b7954c212e3e8bf49ef2a55c3454`,
  PR39 design `9167cf4b26a99450f74fab72e6c6b570b142cbd5`, PR41 accounting
  `0b956a4f8804d35fa7ed6b58d52f6e4337809769`, and PR43 MCP deadline/egress
  `05e890422aa0ae2e3542c964b8e5fa9487301de5` through history-preserving merges.
  PR40/38/42 are included through those parents. No conflicts or source replacement.
- Independently re-read Claude `f6442b754eb26019c16f4aa40c50a15d6e73c14b`
  and parity `ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a`; both remain ancestors.
- This is an isolated combined draft for review/CI. Existing contributor branches,
  PR13, production functions, migrations, provider accounts and device permissions
  are unchanged by this continuation. FreeLLMAPI remains installed.

## Newly accepted VPS evidence

The owner supplied the output of the checksum-pinned PR30 installer in this
conversation. Both services returned a successful native receipt:

| Service | Tool | Count | Failed | Native receipt |
| --- | --- | --- | --- | --- |
| openjarvis.service | code_interpreter | 1 | 0 | true |
| openjarvis-box.service | calculator | 1 | 0 | true |

Installer result: installed=true, native_execution_verified=true,
configuration_changed=false. Installed SHA256:
`d833c6cd073ee235ac1f47f74f668317397524ee31c37889b87e2e0393b8b395`.
Backup: `/var/backups/firbo-tools-9wapfud6`.
This is owner-provided live VPS evidence, not a fresh assistant-executed test.
It closes the measured native tool-execution blocker. Both artifact_verified
values and full_parity_complete remain false. The original gateway-internal
cause is not proved; the measured request compatibility workaround is verified.

## Tested / passed on the combined tree

- 537 frontend tests in 58 files, strict Edge TypeScript and production TS/Vite/PWA build.
- 129 server/runtime/admin bridge/actual runner entrypoint/accounting Node tests.
- 15 additional MCP transport/entrypoint Node tests.
- 67 runtime receipt/inventory/installer/rollback/reconciliation Python tests.
- 32 tool-route engine tests and 17 MCP egress Python tests (34 subtests),
  including real local synthetic TLS deadline tests.
- Git diff whitespace validation. No assertion weakened. Remote exact-head CI,
  PostgreSQL and rendered checks remain required for this combined candidate.

## Fresh read-only production checkpoint

At 20:58 UTC, the existing Mac Polis1984 was paired, non-revoked and online
(last_seen_at 20:58:17 UTC). Capabilities remain list/read/write/exec/browser_open;
browser_task is absent. Do not re-pair or manufacture capability/consent flags.

The live migration ledger now includes `inference_reservation_rollover` under
version **20261006205256**, applied by a different continuation. Do not replay
candidate file `20261006144554_inference_reservation_rollover.sql`. Earlier mission
accounting remains applied as 20261006111315. At this read, private.inference_runner_runs
and private.inference_runner_attempts were both absent. Do not deploy the candidate
runner before its reviewed attempt-ledger migration and explicit pricing bounds.

| Live bundle | Version | Files equal to combined source | Different files |
| --- | --- | --- | --- |
| server-jarvis | 14 | 2/3 | shared/server-execution.ts |
| agent-runner | 90 | 8/13 | index.ts, server-execution.ts, gateway-routing.ts, free-search.ts, agent-tools.ts |
| mcp | 19 | 0/1 | index.ts; candidate additionally needs mcp-egress.ts |

The candidate runner also adds inference-accounting.ts and
runner-inference-accounting.ts dependencies. Existing policy/loop/deliverables
files match; preserve them. Live entrypoint identity alone is not full bundle
identity. Production may change concurrently: re-read immediately before release.

## Failed / limitations

- Initial npm setup correctly refused npm 11.9; used required npm 11.19.0 and
  completed installation/build without weakening engine requirements.
- The cloud browser reaches firboai.app/gateway but is signed out. No website
  tool task was submitted, and no authenticated UI acceptance is claimed.
- No direct VPS/SSH execution capability exists here. No server file, ingress,
  secret, service or installed egress change was attempted.
- Existing generated frontend/tsconfig.tsbuildinfo is left uncommitted.

## Remains / next delivery sequence

1. Obtain exact-head combined CI/preview acceptance; keep this draft until reviewed
   production dependencies and operational prerequisites are satisfied.
2. Website Jarvis tool check through the owner's authenticated session, then a
   useful artifact with independent read-back. code_interpreter intentionally
   forbids file IO; use the appropriate authorized file tool and approval path,
   never weaken the interpreter or shell confirmation to manufacture success.
3. Update the existing Mac Connector using the already prepared updater, retaining
   pairing/journal; actual browser_task heartbeat, local consent, visible browser/
   application work, Stop/offline and saved/read-back artifact acceptance.
4. Reconcile accounting release with the current migration ledger, explicit
   route rates/output limits, current full bundled dependencies and receipts.
5. Provision/verify MCP egress with HTTPS ingress, dedicated secret and reviewed
   origin allowlist before deploying its fail-closed adapter. General egress and
   real provider/customer isolation acceptance remain separate.
6. FreeLLMAPI authenticated remote access/provider inference, CEO meetings and
   delegation, Knowledge/Skills/Workflows, OAuth refresh/revoke, voice/mobile/
   eight languages and full reference design, backup restore and load/monitoring.

Do not send external messages without the owner's specific authorization.
Do not call any source/CI/rendered evidence real-device or full-plan completion.
