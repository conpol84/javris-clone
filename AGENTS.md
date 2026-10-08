# Firbo collaboration

The owner requires that both Claude's and Codex's work be preserved.
Before changing or deploying Firbo, read `docs/FIRBO-COLLABORATION-RULES.md`
and the latest `docs/FIRBO-CONTINUATION-*.md` checkpoint when present.
Continue the existing master plan; do not restart completed stages without a
concrete reason. Verify the current branch and live state before release.

Never force-push or discard another session's changes. Merge newer work from
both active branches, inspect overlapping changes, and test the combined tree.
Keep PR #13 CI-only; never merge it into main.

When more than one chat is active, read the latest coordination comments on
GitHub Issue #52 before editing or releasing. Follow
`docs/FIRBO-RELEASE-COORDINATION.md`: declare a narrow file scope, use a separate
worktree, and reconcile new heads before a single designated release owner acts.
Do not infer agreement merely from posting a claim or seeing another worktree.
