# FIRBO runner search accounting — 6 October 2026

## Scope and preserved parents

This source-only candidate continues exact-green draft PR #37
`efa20e4229c52558f00d36a497ae3f550ea284c0` and preserves the newer
exact-green draft PR #30 `44c510363c744e2e358322e2de63fc39892338ee`
as a separate merge parent. Neither active branch was rewritten.

The bounded change in this stage is potentially billed gateway and Tavily
search from `agent-runner`. It does not add or apply a migration, deploy an
Edge Function, change a provider key, call a real provider, or submit a device
job.

## Changed

- Every configured gateway search and direct Tavily search receives its own
  runner reserve, durable dispatch transition and settlement receipt. The
  exact request body is fingerprinted before dispatch and the ledger request
  ID is forwarded as `x-request-id`.
- Gateway auto-search runs only when the platform has configured both its
  expected flat cost and a conservative maximum using
  `FIRBO_GATEWAY_SEARCH_COST_USD` and
  `FIRBO_GATEWAY_SEARCH_MAX_COST_USD`. Without that accounting configuration,
  the runner skips the potentially billed auto route and can use the explicit
  zero-provider-fee gateway route.
- Direct Tavily requests now ask for provider usage. The default reservation is
  two credits at the existing repository rate of USD 0.008 per credit; both are
  operator-configurable through `FIRBO_TAVILY_MAX_CREDITS` and
  `FIRBO_TAVILY_COST_PER_CREDIT_USD`. Settlement uses returned credits rather
  than treating missing usage as zero.
- A settled empty search may continue to the next route. Once a provider
  dispatch has an unknown result, or Tavily omits valid usage, the task becomes
  reconciliation-required and cannot call another provider or publish a result.
- Initial task research and model-requested `web_search` share the same
  accounting path. Search receipts and settled cost are included in the task's
  existing accounting result.
- Public keyless DuckDuckGo/news/Wikipedia fallback remains available only when
  no billed dispatch is unresolved. Those public zero-fee HTTP requests do not
  create billed-attempt rows.

## Tested / passed locally

- 119 focused actual-entrypoint, search-transport and runner-accounting tests.
- 572 non-rendered FIRBO Node tests, excluding only the separately gated
  Playwright rendered-browser test.
- Strict isolated Edge TypeScript using the repository's installed compiler.
- Git whitespace/diff validation.
- Fake transports covered paid gateway payload and request identity, flat-cost
  reserve/settlement, zero-cost gateway search, Tavily credit-based settlement,
  missing usage, ambiguous provider failure, no fallback after ambiguity, and
  receipts for both initial and loop-requested searches.

No test used a real search or model provider.

## Parent CI read-back

- PR #37 exact head: 27 check runs, all completed/success.
- PR #30 exact head: 26 check runs, all completed/success.
- PR #31 final head was re-read: its latest exact-head set completed/success;
  older cancelled checks are superseded duplicate runs, not SQL failures.

## Failed / limitations

- This isolated worktree has no local `frontend/node_modules`; a direct Vitest
  startup could not resolve Vite. No frontend source changed. Exact-head remote
  CI remains mandatory and must rerun frontend, PostgreSQL, Python, security and
  rendered gates for the combined candidate.
- Zero-fee keyless search fans out to public sources and is not represented as
  one billed inference attempt. This stage claims cost coverage for gateway and
  Tavily search, not general network-egress telemetry.
- A provider-returned page URL may still be read later through the existing page
  reader. Network-pinned egress/SSRF closure remains a separate release gate.

## Remains

1. Commit and publish this isolated candidate, then require all exact-head CI.
2. Add server-execution accounting and authorized read-only reconciliation
   monitoring as separate stages.
3. Before any combined release, re-read PR #30, live runner dependencies and the
   production migration ledger. Do not apply or deploy this source-only stage.
4. Preserve every real-account, Mac/device, OAuth/channel, second-customer,
   backup, monitoring/load and final-assessment gate. PR #13 remains CI-only and
   must never be merged.
