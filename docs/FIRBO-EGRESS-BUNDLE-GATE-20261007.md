# FIRBO egress deployment-bundle gate — 7 October 2026

## Changed

- Continued exact-green draft PR69 without modifying PR60, PR69 or PR13.
- Added one deterministic manifest for the four private Python service files
  and the two matching Supabase Edge adapters used by MCP and `read_page`.
- The verifier hard-codes that six-path closure, so changing the manifest
  cannot silently substitute a different file set.
- Added byte-exact source, private-service read-back and Edge read-back gates.
- Added a release-configuration gate requiring reviewed public HTTPS routes,
  private listener receipts, explicit MCP origins, non-colliding listeners,
  fresh supervision/TLS/limit/log evidence and distinct runtime credentials.
- The release file never contains service tokens. Runtime values are compared
  in memory and are not printed.

## Tested / passed

- New manifest/read-back/release-config gate: 3/3 Node tests passed.
- MCP service synthetic TLS and loopback suite: 35/35 Python tests passed.
- `read_page` service synthetic TLS and loopback suite: 13/13 Python tests
  passed.
- Focused MCP/page/runner Node selection: 32/32 tests passed.
- Broader Edge/runtime/accounting Node selection: 178/178 tests passed.
- Ruff 0.16.7, `node --check` and `git diff --check` passed.
- Parent PR69 is independently green; that evidence is not substituted for
  exact CI on this new head.

## Failed / limitations

- The local strict Edge TypeScript command could not start because this
  isolated worktree has no `frontend/node_modules/.bin/tsc` (exit 127).
  Exact-head CI must supply the dependency and run the TypeScript/rendered
  gates; this is not recorded as a product test failure.
- This does not install either service, change Caddy/systemd/Docker, provision
  credentials, call an external page/provider or claim public HTTPS acceptance.
- The available Supabase connection still exposes only PickFantasy and Trade
  Athletes, not FIRBO. No live Edge secret or function byte was read.

## Remains

- Run the new manifest/read-back/config tests plus both existing synthetic-TLS
  suites and Edge adapters on this exact tree, then require exact-head CI.
- On an authorized VPS, inspect the real topology before choosing supervision
  or ingress configuration. Install only the reviewed exact files, run both
  `--check-config` commands, capture byte-exact read-back, and verify one
  harmless deployed receipt for each route.
- Only after that, verify FIRBO Edge environment and deploy the matching Edge
  and complete runner bundles. Pricing/output-token and every real Mac,
  provider, customer, OAuth, restore/load and final-assessment gate remain.

FreeLLMAPI remains installed. Never merge PR13.
