# Company accounting snapshot — 6 October 2026

Changed:
- Continues shared checkpoint 7e7555d5 and preserves Codex parity ce421e31.
  Billing now includes a bounded current-company owner/admin accounting panel.
- Public security-invoker RPC calls a private stable security-definer routine.
  The privileged routine validates auth.uid() against current membership. No
  caller-supplied user, editable JWT role, private-table grants or mutations.
- Cross-month unresolved liability, UTC-month recorded platform spend, unknown
  costs/overruns, own-key and recorded-zero counts. Age never expires liability.
  Twenty oldest safe request details; sums/counts cover the full scoped ledger.
- Aborted/unmounted requests cannot show another company's receipt. Permission
  changes remount the panel; refresh/error removes stale totals. Eight languages,
  RTL, wrapping IDs and six-decimal currency precision retained.

Tested / passed locally:
- 541 frontend tests, production build, strict type checking and diff checks.
- Client boundary tests cover denial, malformed/cross-company receipts, unknown
  costs, cap-independent totals and stripping unexpected secret-bearing fields.
- React quality review: bounded DOM/list, direct imports, parallel independent
  Billing and accounting fetches, stable primitive dependencies, effect cleanup,
  accessible status/alerts and explicit company/permission component ownership.

Failed / limitations:
- Local Chromium download yielded invalid/truncated archives; stopped download.
  Exact-head real CI Chromium and PostgreSQL remain acceptance gates.
- No provider invoice verification and no complete global accounting claim.
  Existing agent-runner/MCP cutover config/ingress gates remain unchanged.
- No live migration or deployment at this authoring checkpoint.

Remains:
- Require exact-head CI, live migration absent/prerequisite checks, atomic apply,
  read-back, actual owner/admin and denial probes, ledger digest equality, then
  exact accepted preview/production frontend release.
- Preserve all VPS useful artifact/read-back, Mac, integrations, second customer,
  business workflow, design/voice/mobile, off-host recovery and operations gates.
  This closes only the UI/API accounting snapshot, never automatic reconciliation.

Source migration: 20261006212341_inference_accounting_snapshot.sql. Record the
actual live migration identity after deployment; never replay a semantic duplicate.
