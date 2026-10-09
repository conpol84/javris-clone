# FIRBO egress deployed-acceptance gate — 7 October 2026

## Changed

- Continued exact draft PR70 without modifying PR60, PR70 or PR13.
- Added a standard-library HTTPS acceptance probe for the configured public
  `/v1/mcp` and `/v1/page` routes. It makes one anonymous request and one
  authenticated malformed-envelope request to each route.
- The fixed `{}` payload is rejected before any upstream MCP, provider, DNS or
  page transport: MCP returns the bundle's deterministic `egress_denied`
  response and `read_page` returns `bad_request`.
- The probe keeps normal certificate and hostname validation, rejects redirects
  and ambiguous response framing, enforces per-request and overall deadlines,
  and emits only hashes and bounded result metadata. Tokens are environment-only
  and are never written to the receipt or error output.
- Extended the deployment-bundle verifier to require an exact, at-most-15-minute
  acceptance receipt tied to the exact manifest and release URLs. Unknown fields
  are rejected so a receipt cannot silently carry credentials.
- Tightened release-configuration freshness from 31 days to 24 hours and now
  checks exact schema closure plus agreement between listener address and the
  reported loopback/private bind scope.

## Tested / passed

- New offline acceptance suite: 4/4 Python tests passed, including four exact
  probes, pre-network route/token denial, unexpected success, duplicate response
  framing and a real watchdog close of a stalled fake transport.
- Manifest/read-back/release-config/receipt gate: 3/3 Node tests passed, including
  stale config/receipt, mismatched response and hidden-field rejection.
- Existing MCP synthetic TLS and loopback suite: 35/35 Python tests passed.
- Existing `read_page` synthetic TLS and loopback suite: 13/13 Python tests
  passed.
- Focused MCP/page/runner Node selection: 32/32 tests passed.
- Broader Edge/runtime/accounting Node selections: 324/324 tests passed.
- Ruff 0.16.7, `node --check` and `git diff --check` passed.

## Failed / limitations

- The local strict Edge TypeScript command was unavailable because this isolated
  worktree has no `frontend/node_modules/.bin/tsc`. Exact-head CI must install the
  reviewed dependency set and run TypeScript, build and rendered-browser gates.
- No actual public HTTPS request was made here: no deployed service token or
  authorized VPS/FIRBO Supabase connection is available in this environment.
- No provider/page request, service installation, ingress or supervisor change,
  secret read/write, Edge deployment, migration, device job or frontend
  deployment was performed.

## Remains

- Require exact-head CI for this isolated source candidate, including the new
  receipt workflow, PostgreSQL lifecycle/accounting races, TypeScript/frontend
  and real Chromium gates.
- On the authorized host, inspect the current topology, install only the exact
  reviewed bundle, capture full byte read-back and release configuration, then
  run this harmless acceptance probe. Preserve its secret-free receipt and pass
  it back through the exact-manifest verifier before any Edge cutover.
- Verify the complete runner bundle and the actual billed-route pricing/output
  token settings before release. Real provider invoice, Mac/local approval and
  useful artifact, OAuth/channels, second customer, business workflows,
  restore/load/monitoring and final assessment remain open.

FreeLLMAPI remains installed. Never merge PR13.
