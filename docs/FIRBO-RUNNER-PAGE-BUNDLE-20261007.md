# FIRBO runner + page-egress bundle checkpoint — 7 October 2026

## Changed

- Combined the independently accepted PR62 runner release gate and PR67 pinned
  `read_page` egress source without changing PR60 Take Control or PR61 MCP.
- Regenerated the deterministic `agent-runner` manifest for the combined import
  closure: `index.ts` plus fifteen shared dependencies. The new sixteenth file
  is `_shared/page-egress.ts`; `_shared/free-search.ts` is pinned to the exact
  PR67 bytes.
- Updated the gate and tests to require all sixteen files. Synthetic live
  read-back now proves that omission of either `free-search.ts` or its
  `page-egress.ts` dependency fails closed.
- Retained the release-config gate: reviewed positive billed-route input/output
  prices and output-token cap must exactly match the runtime environment.

## Tested / passed

- Exact manifest generation and four bundle/link/pricing tests pass. The actual
  runner entrypoint links every named import with provider transport disabled.
- Thirteen Edge/page tests and thirteen Python policy/synthetic-TLS tests pass.
- The isolated Edge TypeScript configuration passes.
- The focused combined Edge suite passes 127/127 tests.
- Frontend passes 552/552 tests and the production Tauri build completes.
- Ruff 0.16.7 lint and formatting checks pass for the page-egress Python source.
- The broad local Node run passed 649/650 tests. Its only failure was the
  rendered browser harness because this isolated worktree has no local
  Playwright package/browser; no product assertion failed. Exact-head CI must
  supply the rendered evidence.

## Failed / limitations

- Fresh Supabase project discovery exposes only PickFantasy and Trade Athletes,
  not the FIRBO project. Current FIRBO function bytes and the three runtime
  pricing/output-token values therefore cannot be independently read here.
- No provider call was made. Positive synthetic pricing proves gate behavior,
  not the real contract or invoice rate.

## Remains

- Publish this as a new isolated draft and require exact-head CI, including the
  real Chromium workflows.
- With authorized FIRBO project access, export all current runner files and run
  `--live-bundle`; verify billed-route evidence and the exact three runtime
  values with `--release-config` before any one-operation runner deployment.
- Provision and review the page-egress service, HTTPS ingress, dedicated
  credential, exact Edge origin, supervision, limits and log suppression; then
  obtain a harmless deployed receipt before cutting over `read_page`.
- Do not merge or deploy this source by itself. Keep PR60, PR61 and PR13
  untouched; keep provider, Mac, OAuth/channel, second-customer, restore/load,
  useful-artifact and final-production acceptance gates open.
