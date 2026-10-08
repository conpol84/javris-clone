# Runner reconciliation visibility — 7 October 2026

## Changed

A real production runner92 request returned HTTP503 after `model_timeout` but left
its claimed task with a null result. One attempt settled; the second remained
`reconcile_required`. The accounting guard correctly retained the claim, but the
Tasks page could not show its existing reconciliation warning without a result flag.

Both search and model reconciliation exits now persist a bounded review marker
on the same task/org/running claim. The update compares the prior JSON result as
well as the claim, preserving concurrent receipts and earlier report/accounting
fields. Response `reconciliation_saved` reports storage success honestly. Failed
or conflicting writes do not cause a second inference, release funds, publish
approvals, clear claims, or report successful work.

Database status remains running intentionally until provider accounting is
reconciled; this is not a completed report or a timeout fix in the provider.
The current Tasks UI already displays its reconciliation warning and denies rerun.
No migration, runtime gate, provider route, permissions, frontend, or device changes.

## Tested

Four new actual-handler regression cases failed against the old source, then
passed with the fix. Model/search ambiguity, prior/null results, claim changes,
write conflicts/errors and thrown transports are covered. Existing server ambiguity
assertion permits only the review-marker write, still forbidding publication.
123 combined handler/accounting tests pass. Strict Edge TypeScript passes.

A rollback-only probe against the affected live task verified that a marker write
retains the same claim and byte-equivalent attempt rows. Trying to publish a
completed status still fails with `task_active_inference`; the probe rolled back.
The bundle gate caught the outdated index.ts fingerprint; the complete 16-file
manifest now pins the reviewed source. No dependencies or pricing gates changed.
Exact-head CI and deployed full-bundle read-back belong in PR/Issue52 final evidence.

## Remains

One provider request requires real usage/outcome reconciliation; do not release it
or repeat the task without evidence. Physical Catalina Mac browser control,
authenticated UI acceptance, actual integration connections, VPS execution,
encrypted off-host backup/restore, and the other Issue52 gates remain open.
Preserve the other chat's selected-skills scope and source-only PR80.
