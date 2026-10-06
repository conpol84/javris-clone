# FIRBO runner accounting stage 2 — transport adapter candidate

Status: SOURCE CANDIDATE ONLY, 6 October 2026. No migration was applied,
no Edge Function was deployed, and no real provider, device, customer account,
permission, or production state was changed.

Published draft: https://github.com/conpol84/javris-clone/pull/35 on
`codex/firbo-runner-accounting-stage2-20261006`. Initial remote implementation
head `280b53d1df19f6237681af407e6639dc12198a95` has immutable tree
`513f3fe26767ba3464a11e5fce088fd347c27e7c`, byte-identical to local
implementation commit `d6bf5c74f3f5804781d90ac1a16929a2e1671085`.

This stage continues the claim-bound ledger in draft PR #32 at exact head
`fc5ae27f32b2198ac8cb5e782b8c674e2e678cc9`. It first merges the current
OpenJarvis draft PR #30 head
`37768a7a1bd6a333876aae9c014e59a1a39ab672`, including its pinned engine
release evidence. Local merge `55497eb4f3b5df2a57dea3fa10b9d7d16a52b061`
and uploaded equivalent `b6af002f22038f5145e442556672f35e373e0214`
have the identical tree `6553740f99616a485742b9d61bc223d90c247f93`;
neither parent branch was rewritten. PR #31 is already an ancestor through PR #32.

## Changed

- Added a bounded runner attempt executor around the existing stage-1 RPCs.
  It fingerprints the exact payload, reserves against the task claim, obtains
  the single durable dispatch permission, executes one injected transport, and
  settles the same request ID.
- Any error after dispatch is retained as reconciliation-required. The helper
  never releases a dispatched request. Lost settlement results are marked
  ambiguous and automatic retry/escalation stops.
- Adapted every text-model call made through the runner's Free, OmniRoute
  gateway, direct-provider and BYOK paths. Retry, repair, continuation, route-up
  and polish calls pass through the same per-attempt boundary independently.
- The ledger request ID is forwarded as the Free request identity and as
  `x-request-id`/gateway trace identity where the transport supports it.
- Direct calls require bounded integer provider usage. Missing or malformed
  usage is not converted to verified zero. Free/BYOK still reserve zero Firbo
  cost while consuming attempt capacity.
- Removed the runner's legacy aggregate usage insert for adapted text-model
  calls. The task result now carries the list of settled attempt receipts.
- Preserved the legacy usage lane only for the explicitly unadapted vision
  tool, avoiding both duplicate accounting and a false full-coverage claim.
- Removed the runner's non-atomic aggregate budget/rate preflight reads. Daily
  plan lookup remains; the stage-1 reservation RPC atomically applies one
  logical-run daily count, per-attempt hourly capacity, the fixed attempt
  ceiling and the shared company/agent budget locks.
- A reconciliation-required attempt returns HTTP 503 with `retry_safe=false`
  and does not publish task results or approvals. Admission denials dispatch
  no provider request and retain the existing 402/429/503 distinctions.

## Tested / passed locally

- Seven focused ledger/helper tests, including executable fake transports for
  reserve-dispatch-settle, zero-dispatch admission denial, and ambiguous
  post-dispatch failure without settlement or release.
- 157 combined gateway, runner-entrypoint and ledger tests, zero failures.
- 190 combined handler, server-receipt, OpenJarvis runtime and runner tests,
  zero failures.
- 524 frontend tests across 56 files, zero failures.
- Strict isolated Edge TypeScript and the complete frontend TypeScript build
  passed with the repository's pinned npm 11.19.0 toolchain.
- Git whitespace/diff checks passed.

The fake transports prove application ordering and call counts; they are not
real-provider acceptance. PR #32's exact head independently has all ten
workflows completed successfully, including PostgreSQL 17.6 accounting gates
and 18 concurrency checks across READ COMMITTED and SERIALIZABLE. PR #31's
exact head independently has all nine workflows completed successfully.

## Failed / limitations

- This stage has not yet run exact-head remote CI or its combined PostgreSQL
  gate. The local workspace has no PostgreSQL server.
- The stage-1 and rollover migrations remain unapplied in production. The live
  runner therefore cannot safely use this source and was not deployed.
- Vision remains on a named legacy aggregate lane. Image generation, server
  execution and gateway/Tavily search still need their own accounting and
  receipt contracts. An outer OmniRoute request does not prove how many
  internal upstream attempts occurred.
- No authorized read-only reconciliation monitor exists yet. No real provider
  receipt, signed-in user flow, Mac job or second-customer isolation was tested.

## Remains

1. Require all exact-head workflows for PR #35 and inspect the PostgreSQL 17.6
   accounting logs without changing PR #30/#31/#32.
2. Add claim-aware vision and image inference accounting. Define billed search
   (including Tavily) and server-execution receipt contracts before removing
   their named legacy or external lanes.
3. Add authorized, paginated, read-only monitoring for admitted, dispatching
   and reconciliation-required attempts; never let monitoring retry or release.
4. Re-read current live migrations and all runner dependencies before any
   combined migration or deployment. Use executable fake transports first and
   no synthetic real-provider inference.
5. Preserve FreeLLMAPI until a replacement is installed, direct-session work,
   Mac/OAuth/channel/second-customer/backup/monitoring gates, and the prohibition
   on merging CI-only PR #13.
