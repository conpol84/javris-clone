# Native exact-action approval repair

## Observed failure

Owner-run acceptance on srv2027143 returned request chatcmpl-5d38b34853f2,
approval_blocked=true, write_receipt_verified=false. The private report did not
exist on subsequent read-only inspection. All five inspected installed module
hashes matched shared c64bba2a64d3fa5fd2af765d9abf6343e9841c74. The shell tool
requires confirmation but the native completion API did not supply a callback.
The separate proactive approval queue does not represent this denied call.

## Change

An optional `firbo_native_approval` field selects a root-issued, 256-bit random
grant in `/run/firbo-native-approval/grants`. The grant binds the complete model
and message list, service UID, exact shell tool arguments and a maximum five
minute lifetime. No credential or approval is inferred from model prose or a
boolean supplied by an API caller. Existing API authentication is unchanged.

Root-owned directories/files, permissions, bounded regular files, non-following
opens and hardlink rejection protect issuance. Grant files use the existing
sensitive `.key` suffix; native file tools reject reads/writes and symlink
aliases. A separate service-owned directory uses O_EXCL markers to reserve each
grant once across processes before inference. Markers persist for the boot;
restarting the service cannot replay a used grant. After reboot `/run` grants
disappear, and normal requests retain their original deny behavior.

The callback accepts only the exact shell_exec argument map. Any mismatched
confirmation consumes the opportunity; expiry is checked again at execution.
Callback state is scoped to the existing full-run agent lock and restored on
success or exception. Concurrent requests cannot borrow another request's grant.
Existing interactive callbacks are never replaced. Tool capability, rate-limit,
taint and boundary checks remain before confirmation. Streaming and raw-tools
approval requests are rejected; memory enrichment is skipped only for approved
requests so their operator-reviewed messages remain exact. All ordinary requests
keep existing behavior. The grant does not limit already-permitted unconfirmed
tools, change the model, or certify a provider bill.

The existing artifact verifier remains denial-preserving by default. Its new
`--approve-exact-shell` mode displays the exact command/arguments and model and
requires the operator to type `APPROVE <action hash prefix>` in the actual local
terminal. Only then is the root grant issued and the request dispatched. There
is no automatic approval or retry. Its second file_read request carries no grant.
Artifact success still requires both real receipts and independent bytes/hash.

## Manual rollout

`native-approval-control.py --install` installs only the exact three runtime
files listed in its embedded BUNDLE. It rejects unknown installed source against
the five owner-observed hashes, compiles staged bytes, saves private original
files/ownership/modes, creates the constrained approval directories and replaces
the three files atomically. It restarts only openjarvis.service and verifies
authenticated local info/tool readiness plus installed-byte read-back. The
previous engine temperature repair is untouched. Already matching installations
are not restarted. A failed rollout restores originals and restarts the service;
rollback refuses to overwrite later unknown code. The printed backup is retained.

Run only the checksum-pinned delivery command after review. No direct VPS access
exists for this session; source/CI evidence is not an installed runtime claim.
Keep helpers alongside the installer/verifier and retain the delivery directory
until rollout and acceptance have been checked. Manual rollback is:

```bash
python3 -B native-approval-control.py --rollback /var/backups/firbo-native-approval-OBSERVED
```

The rollback path must be the actual printed backup. No guessed path, reboot,
global allow flag, direct root artifact write, proactive queue approval, shell
policy relaxation or rerun of an ambiguous provider request is part of this fix.

## Validation and remaining work

Owner rollout follow-up: the first installation stopped before replacement at
`unexpected_file`. Read-only metadata showed two hard links on the three untouched
baseline modules (`tools/_stubs.py`, `tools/shell_exec.py`, `cli/serve.py`); all
replacement targets and staged files had one link. The installer now permits
multiple links only when reading these three exact paths for the unchanged
SHA-256 baseline check. It never writes to or breaks their links. Staging,
replacement targets, backups and approval grants retain single-link checks.
Regression tests use actual hard links and verify unchanged aliases/inodes/bytes
after install/rollback, plus rejection of altered baselines, symlinks and
hardlinked replacement/staged files. This source fix is not live acceptance.

Focused tests exercise real executor/handler behavior, actual disposable shell
work, malformed/expired/wrong-owner grants, alternate arguments, replay and
concurrency, normal-request denial, restoration after errors, existing policy,
no-follow filesystem checks, installation read-back, idempotence, rollback and
preservation of newer installed changes. Existing artifact/receipt tests remain
required. Dedicated CI covers Python 3.12 and 3.13.

No live install/approval/artifact success is claimed by this source checkpoint.
After manual rollout, perform one explicitly approved verifier run and retain
its actual result. Website delivery is separate and remains false in the
verifier. MCP/page ingress, server pricing, the unrelated timed-out runner
request, physical Mac, provider connections and encrypted off-host restore
remain open. Preserve both contributors, current shared work and CI-only PR13.
