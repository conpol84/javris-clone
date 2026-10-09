# FIRBO runtime network bundle checkpoint — 7 October 2026

## Changed

- Combined the exact draft PR68 head
  `99fccd4c0eae86f6319f3881523b335a03db2d10` with the exact draft PR61 head
  `92d36611bdb3e1448deed34b64c277f686a1fe85` in a new isolated candidate.
- Preserved PR68's deterministic sixteen-file `agent-runner` closure, pinned
  `read_page` transport and pricing/output-token release gate.
- Preserved PR61's complete-response MCP framing checks for declared length,
  chunked bodies, duplicate/conflicting framing and unsupported encodings.
- PR60 Take Control and PR13 are not parents and were not modified. Shared
  `572412e6d5bc0f8c586364de7399539c08bd3d42` and parity
  `ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a` remain in ancestry.

## Tested / passed

- All 35 MCP Python cases passed, including actual synthetic TLS response
  truncation, framing ambiguity, total deadlines and private-service admission.
- All 13 page-egress Python cases passed, including synthetic TLS pinning,
  redirect revalidation, response framing and absolute ingress deadlines.
- The combined focused Node selection passed 32/32: the exact sixteen-file
  runner manifest/link/pricing gate, MCP entrypoint/service routing and page
  search/read routing. Provider transport remained disabled.
- The broader Edge/runtime/accounting selection passed 178/178. Strict Edge
  TypeScript compilation passed.
- Ruff 0.16.7 lint/format checks passed for both egress implementations and
  their tests. `git diff --check` passed.
- These are local automated checks. The two parents were independently green,
  but exact combined-head CI and rendered evidence remain separate gates.

## Failed / limitations

- No FIRBO Supabase project connection is available in this environment. Live
  runner bytes and the three pricing/output-token variables were not re-read.
- No VPS terminal, provider request, external page request, device job, secret,
  permission, migration, Edge deployment or frontend deployment was performed.

## Remains

- Run the MCP and page synthetic-TLS suites, runner bundle/link/pricing tests,
  focused Edge tests, TypeScript and Ruff checks on this exact combined tree.
- Publish only as a draft and require exact-head CI, including PostgreSQL and
  real Chromium workflows, before considering any release.
- With authorized FIRBO access, perform the complete live bundle read-back and
  verify billed-route evidence plus `FIRBO_SERVER_PRICE_IN_PER_M`,
  `FIRBO_SERVER_PRICE_OUT_PER_M` and `FIRBO_SERVER_MAX_OUTPUT_TOKENS`.
- Provision and accept the reviewed HTTPS egress services, credentials, exact
  origins, supervision, limits and log suppression before Edge cutover.
- Keep Mac/local approval, useful artifact, OAuth/channels, second customer,
  business workflows, restore/load/monitoring and final assessment open.

FreeLLMAPI remains installed. Never merge PR13.
