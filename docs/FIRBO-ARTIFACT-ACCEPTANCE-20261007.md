# FIRBO native artifact acceptance — 7 October 2026

## Changed

Continues shared `9016891022f792abc6eeacb7ee2436be8c559ce8`, including the
accepted PR47 ingress deadline, PR45 live Mac updater and both contributors.
Parallel PR46 Billing work is preserved and left to its active continuation.
PR13 remains CI-only. Do not re-install the successful VPS temperature repair.

`deploy/hostinger/verify-openjarvis-artifact.py` runs beside the existing repair
helper on the authorized VPS. It creates one private report directory, submits
one ordinary admin-agent shell request and then one separate file_read request.
It requires complete successful runtime receipts with distinct request IDs,
then independently reads the exact report bytes using non-following directory
and file descriptors. It rejects symlinks, hardlinks, FIFOs, wrong owner/mode,
truncation, prose-only success and replayed response IDs. No installation,
restart, permission bypass, changed model, retries or removal of evidence.

The report contains a unique reference and a bounded non-secret runtime tool
inventory. A timeout or unverified receipt never reports success. The private
directory is printed before dispatch so uncertain effects can be reconciled.
The normal shell confirmation gate stays active: approval-blocked is a real
outcome, not a reason to enable tools automatically.

## Tested / passed

- 16 disposable local tests using actual ShellExecTool, FileReadTool and server
  receipt generation, plus adversarial receipt/filesystem substitutions.
- Ruff formatting/lint and whitespace checks.
- The initial combined read-only review passed 541 frontend tests and build,
  and 80 runtime/MCP tests with 40 subtests. These are supporting checks on the
  reviewed combined source, not live VPS or physical-device evidence.
- Exact published-head CI is recorded in the PR after completion.

## Failed / limits

No direct Hostinger/SSH execution tool exists in this session. This verifier has
not run on the production VPS. Website login previously returned Failed to
fetch; no authenticated website task or physical Mac acceptance is claimed.
The local diagnostic is not website delivery: it explicitly reports
`website_delivery_verified:false` and `full_parity_complete:false`.

The tool may be denied by the existing approval policy or server filesystem
sandbox. It leaves configuration intact and reports non-success. Do not bypass
the gate or repeat a timed-out write blindly.

## Current verified boundaries

Read-only checks in this turn: firboai.app remained production PR45
`4ef4f2766ad10cc25a5f0629bdd5b61e1713f5c4`, deployment
`dpl_4J9dKh45q2cKVcowbuvpFo1uBywR`. Live migrations already contain
`20261006205256` rollover, `20261006205845` runner ledger and
`20261006213545` accounting snapshot. Never replay their source timestamps.
At 21:50 UTC the Mac Polis1984 was paired/online, with list/read/write/exec and
browser_open, but without browser_task. Integrations count remained zero.

## Remains

Run the verifier through authorized VPS access; preserve its receipt, report and
hash. Then verify website -> Jarvis -> delivered artifact and user read-back.
Install the existing Mac updater locally and test consent/Stop/offline and full
browser interaction. Verify server pricing/output limits before runner cutover;
provision pinned MCP HTTPS/credentials/allowlist before MCP cutover. Keep
FreeLLMAPI installed and private until authenticated remote access is deployed.
Provider OAuth/channel consent, second real customer, business workflows,
voice/physical mobile, signed desktop, encrypted off-host restore/monitoring/load
and the final evidence-based assessment remain open. No master-plan completion.

Run from a reviewed checkout (both helpers in their original directory):

```bash
python3 deploy/hostinger/verify-openjarvis-artifact.py
```

Success requires `artifact_verified:true`, separate write/read request IDs and
the independent SHA256. This is a bounded live inference test, not a free or
zero-cost claim. Do not run it repeatedly while awaiting an existing result.
