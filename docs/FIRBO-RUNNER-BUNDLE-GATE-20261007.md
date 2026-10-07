# FIRBO runner complete-bundle gate — 7 October 2026

## Changed

- Added a deterministic manifest for the complete `agent-runner` import closure:
  one entrypoint plus fifteen shared dependencies. Partial or byte-different
  read-back now fails with the exact missing, extra or changed paths.
- Added an executable release gate. Its source check follows relative imports,
  rejects imports outside the Edge Functions tree and requires exactly 16 files.
- Release mode also requires positive reviewed billed-route input/output prices
  and the output-token cap to match the runtime environment. It does not invent
  zero pricing or make a provider request.
- Added a dedicated exact-head workflow and an actual Node ESM link test. The
  test loads the real entrypoint and dependencies while blocking provider calls.

## Tested

- `node --experimental-strip-types --test tests/firbo/agent-runner-bundle.test.mjs`
- `node tools/firbo-runner-bundle.mjs`
- Synthetic complete and incomplete live-bundle read-backs.
- Synthetic pricing match, missing-config and mismatch cases.

## Passed

- The combined PR67 page-egress source at `9367669b`, with the PR62 gate at
  `b265aa76`, forms one compatible 16-file bundle. The new dependency is
  `_shared/page-egress.ts`; `_shared/free-search.ts` is pinned to the same source.
- Named imports required by the current entrypoint link successfully, including
  server usage, Tavily usage and the image/vision helpers.
- Removing one dependency from a read-back is rejected before release.

## Failed / limitations

- The first exact-head workflow rejected every manifest hash. The authoring
  workspace had appended one extra newline while reconstructing the shared
  source for local testing. Hashes were regenerated from the exact GitHub bytes;
  the gate and all assertions were retained unchanged.
- The Supabase connection available in this run lists PickFantasy and Trade
  Athletes, not the FIRBO project. Therefore current FIRBO secrets, pricing and
  a fresh production bundle could not be read through this connection.
- No Edge Function, secret, provider route, database, VPS, device or frontend
  was changed. This is source and automated evidence, not a live cutover.

## Remains

- Obtain authorized FIRBO project access and export the current `agent-runner`
  read-back. Run the gate with `--live-bundle` against all returned files.
- Verify real provider invoice/contract pricing and current runtime values, then
  run `--release-config` before deploying the complete bundle in one operation.
- After deployment, repeat full read-back, anonymous denial and a harmless
  authorized acceptance. Keep PR60 Take Control and PR61 MCP work independent.
- Preserve FreeLLMAPI, never merge PR13, and keep all Mac, provider, customer,
  OAuth/channel, restore/load and final-production gates open.
