# FIRBO ownership recovery and source reconciliation — 5 October 2026

Continue the existing master plan and Mac pairing checkpoint. This checkpoint
records completed work; no reset, CI-only PR merge or production frontend
promotion occurred.

## Changed and read back live

- The `Trade Athletes` company had one member, role `manager`, and zero owners.
  Its immutable audit history attributed company creation and the original
  `owner → admin` change to the same user; the later `admin → manager` event
  explains the current People and Computers lockout. The recovery updated only
  that verified original member, only if still sole member/manager with no owner,
  and required both creation and original-ownership audit evidence.
- Restored that member to `owner`. The audit trigger recorded
  `manager → owner`; an authenticated-role read verified management access.
  Roles are company-scoped: the same account was already owner of `FREE` and `4a`.
- Applied migration `20261005213618_firbo_preserve_last_owner`. Private trigger
  blocks the final owner's demotion/removal and identity reassignment, serializes
  competing removals through a real parent row UPDATE, and preserves complete
  organization deletion cascades. Existing RLS and connector owner/admin gates
  are unchanged. The function is not executable by anonymous/signed-in clients.
- An authenticated rollback probe on the actual affected member verified that
  another self-demotion raises `last_owner` and leaves owner access intact.
- Agent-runner reconciliation completed after the exact `83b2087` CI gate passed.
  The fresh pre-deploy version was **67**, with the same artifact bytes as the
  previously saved v65 rollback (`cd05ed858dbcc005ba4bddfee82d5a34e12c3da8bf87e9c28ea3ad375b3490b8`).
  Deployed only the prepared runner: **ACTIVE v68**, artifact
  `467937e52b830807b807d8c5ef5232f939a5648e8ff56043fcd11cf0af0096c4`.
  All nine read-back file contents match the tested immutable `83b2087` source.
  Anonymous POST returns 401. Existing custom authentication/verify_jwt=false
  is preserved. Saved rollback payload is unchanged. No agent-chat/connector
  redeploy, provider call or repeated parity migration.

## Changed in the candidate frontend

- People locks the sole owner, explains role restrictions and ownership handoff
  in all eight languages, and refreshes company authorization after self changes.
- Role/deletion mutations check that a matching membership row was returned;
  RLS-filtered zero-row updates are failures rather than false successes.
- No manager self-promotion, generic account whitelist or wider device permission
  was added. The frontend changes need their own committed-source CI and release;
  the live owner recovery and DB invariant already work with the old frontend.

## Tested and passed

- Exact `83b2087`: all 19 returned PR workflows completed successfully, including
  full CI `37373985625`, Frontend, Computer Manager, native/model/voice,
  dependency gate, Desktop, SAST and real local-operation checks.
- Live synthetic rollback checks: 14 passed before applying the guard, and the
  same 14 passed against the installed guard. Covers manager/admin authorization,
  sole/bulk owner demotion and removal, valid handoff, auth-user deletion, immutable
  membership identity, function ACL and organization cascade. No synthetic records
  remain. These are database tests, not owner-device acceptance.
- Focused People/data/i18n tests: 63 passed; TypeScript compilation passed.
- Runner candidate: 3 focused synthetic output-preview/persistence probes passed;
  all nine live file bytes match; anonymous 401 passed.
- Security Advisor after migration has the same findings as before: four intended
  secret-table RLS/no-policy INFO findings, seven existing authenticated definer
  RPC WARN findings and existing leaked-password-protection WARN. No new finding
  was introduced by this guard. Broader hardening remains in its planned stage.

## Remains and exact next gate

- New ownership CI exercises real PostgreSQL RLS and concurrent owner removals
  under READ COMMITTED, REPEATABLE READ and SERIALIZABLE. Record the result for
  the new committed source; do not substitute the parent commit's passes.
- Frontend release identity and new full CI need fresh verification before release.
- Owner must refresh the Firbo page with the intended company selected. Computers
  allows owners **or admins**; Manager is intentionally insufficient.
- Physical Mac mini still needs current Connector, a fresh browser-only code,
  local `pair` then a running `run` process. Only a real fresh heartbeat, local
  browser launch and durable receipt closes stage 3. No laptop pairing is claimed.
- Continue existing sequence: scoped click/type/scroll/DOM/upload/download browser
  executor; useful work artifact/read-back/receipt; Knowledge/Skills/Workflows/OAuth;
  Free hardening; voice/Desktop/security/backup/monitoring/mobile/languages; final
  production assessment. Previous open safeguards and rollback rules still apply.
