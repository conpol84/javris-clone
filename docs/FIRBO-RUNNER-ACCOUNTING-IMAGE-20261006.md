# FIRBO runner image-generation accounting — 6 October 2026

## Scope and preserved parents

This source-only candidate continues exact-green draft PR #36
`0d4844aaabdfdcca46799e8b13b4894399f63c95` and preserves the newer exact-green
draft PR #30 `d9c07eb97020ea379c1ce43d200760f46a9b6819` as a separate parent. Neither
active branch was rewritten. The merge retains PR #30's MultiEngine/runtime
repair work and PR #36's text and vision attempt receipts.

The bounded change in this stage is `agent-runner` image generation. It does
not change a database migration, frontend, device connector, deployed function,
provider configuration or production data.

## Changed

- A paid gateway image request now receives one runner admission, one durable
  dispatch transition and one settlement receipt. Its exact OpenAI-compatible
  request body is fingerprinted before dispatch, and the ledger request UUID is
  sent as `x-request-id`.
- The configured flat image cost and conservative maximum reservation are
  separate settings: `FIRBO_IMAGE_COST_USD` and
  `FIRBO_IMAGE_MAX_COST_USD`. A configured paid image model fails locally when
  those values are absent, invalid or non-conservative; it is not called without
  accounting.
- The Pollinations zero-provider-fee path also receives its own attempt receipt.
  Its seed is chosen before reservation and is included in both the fingerprinted
  payload and the actual request URL.
- Once a paid gateway dispatch begins, failure is reconciliation-required and
  cannot silently create a second image through Pollinations. This prevents a
  possible billed duplicate after an ambiguous result.
- Image bytes or a provider URL are stored only after the provider attempt is
  settled. A later download/storage error cannot erase known billed usage.
  Response type and size remain bounded.
- The task's existing receipt list and aggregate displayed cost now include the
  image attempt. No duplicate legacy aggregate usage insert was added.

## Tested / passed locally

- 117 focused agent-tool, runner-accounting and actual Edge-entrypoint tests.
- 567 non-rendered FIRBO Node tests, excluding only the separately gated
  Playwright rendered-browser test.
- Isolated Edge TypeScript using the repository's installed compiler.
- Git whitespace/diff validation.
- Fake transports covered paid payload identity, request ID propagation,
  conservative reserve versus settled flat cost, stored artifact, zero-cost
  Pollinations receipt and ambiguous paid failure with no fallback/publication.

No real provider inference or image generation occurred. Tests used only
in-memory binary responses and synthetic database/transport doubles.

## Failed / limitations

- This separate worktree does not contain its own `frontend/node_modules`.
  Direct Vitest startup therefore could not resolve Vite. No frontend source was
  changed; both exact parent heads have green frontend CI, and the combined
  candidate still requires fresh exact-head CI.
- Python receipt tests could not run locally because this runtime has no pytest.
  The newest PR #30 head passed its independent Python receipt gate; the combined
  candidate must still rerun it remotely.
- A provider-returned HTTPS image URL is still fetched after settlement. The
  broader network-pinned egress/SSRF gate remains open and is not claimed solved.

## Remains

1. Commit and publish this isolated candidate, then require all exact-head CI,
   including PostgreSQL 17.6 accounting races, Python receipts, TypeScript,
   frontend and security checks.
2. Continue with billed gateway/Tavily search, server execution and authorized
   read-only reconciliation monitoring as separate stages.
3. Before any release, re-read current PR #30, live runner dependencies and the
   production migration ledger. Do not apply or deploy this source-only stage.
4. Preserve every existing real-account, Mac/device, OAuth/channel,
   second-customer, backup, monitoring/load and final-assessment gate. PR #13
   remains CI-only and must never be merged.
