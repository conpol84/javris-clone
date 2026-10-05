# Firbo shared-branch preservation

Owner directive, 6 October 2026: always retain both Claude's and Codex's work.

- Before editing or releasing, read the latest continuation and inspect the current
  heads of `claude/gifted-dijkstra-rph5j8` and `codex/firbo-reconcile-20261005`.
- Fetch and merge new work. Preserve both parents and review overlapping files;
  never replace a file with an older branch's copy simply to resolve a conflict.
- Do not force-push, reset away another session's work, or discard uncommitted
  changes. Use expected-head, non-force updates. Re-read after a rejected update.
- Check relevant tests on the combined tree. Changes to page controls require
  checking accessible selectors and device/company-switch behavior in the page
  tests; do not weaken assertions or remove either feature to make tests pass.
- Before a backend deployment, compare all deployed dependency files with the
  candidate. Preserve the agent-chat task/result/work-log fix from `e9fb240`.
  Do not redeploy a function already matching the accepted source.
- Inspect applied migrations before database changes. Do not replay migrations
  another session has already applied.
- Release the exact accepted source with the production environment, then verify
  the domain, source identity and served Connector assets. Preserve rollback IDs.
- PR #12 was merged by the other session into Claude's line at `6f5aa78`.
  PR #15 is its successor. PR #13 is CI-only towards main: never merge it.
- After each major stage, record Changed / Tested / Passed / Failed / Remains,
  exact code and deployment identities, and the next action. Automated, rendered,
  real-device and live evidence are different; do not claim one from another.
- Read current state again if another session is active. These rules supplement
  the master plan and do not grant additional device, credential or provider access.

Reconciled release candidate: `7f915df6edf2fbce66b5e09b004e1b25ce6375be`.
It contains both `44ecae2` and Claude `6f5aa78`, including `e9fb240`.
The only changes beyond their combined implementation are two precise browser
test selectors: the path textbox and the offline job-submission button.
