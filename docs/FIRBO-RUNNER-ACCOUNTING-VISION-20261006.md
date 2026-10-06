# FIRBO runner vision accounting — source candidate

Status: SOURCE ONLY, 6 October 2026. No migration was applied, no Edge
Function or frontend was deployed, and no provider, device, permission, account,
or production state was changed.

This stage continues draft PR #35 at exact green head
`e451458074309b033d334704e72f25888b7e39d1` and preserves the newer active
PR #30 head `9021ae53404148ec8920cd5f7492698bdd2f5d12` as a separate merge parent.
Local merge `23baf272fb937fc4345dfcea6c28d04a7fe20153` retains both histories.
Implementation commit: `841dee4ce4c3b15287533276b32797e405edbe22`, tree
`1943f82900a8ff1679183b44c6bf72f356ad0023`.

## Changed

- Runner `analyze_image` requests now use the same claim-bound
  reserve → durable dispatch → transport → settle contract as adapted text
  attempts. Vision receives its own attempt ordinal and receipt.
- The exact bounded vision payload is built once for fingerprinting and provider
  dispatch. The ledger request ID is forwarded as `x-request-id`.
- Admission reserves a conservative 100,000-token non-text input ceiling plus
  the 700-token output ceiling at configured OmniRoute rates. The actual
  provider-reported tokens and calculated cost settle the reservation.
- Missing or malformed vision usage after dispatch is never converted to zero.
  It becomes `reconciliation_required`, stops the run, and prevents task result
  or approval publication.
- Removed the vision-only legacy aggregate `usage_events` insert. Text and vision
  receipts are now individually settled; result totals remain informational.
- Image generation, gateway/Tavily search and server execution remain explicitly
  unadapted. No complete runner-spend claim is made.

## Tested / passed

- 113 focused Edge, helper and executable fake-transport tests.
- 563 non-rendered FIRBO Node tests, all passing.
- 524 frontend tests across 56 files, production frontend build and full
  frontend TypeScript.
- Strict Edge TypeScript and Git whitespace/diff checks.
- Two OpenJarvis OmniRoute tool-contract tests from the newer PR #30 parent,
  with proxy variables removed from the isolated test process; focused Ruff
  check and format passed.
- New executable acceptance proves one main text attempt, one vision attempt and
  one final text attempt produce three distinct RPC-settled usage receipts. A
  vision response without usage produces one ambiguity marker, no vision
  settlement, no continuation and no publication.

No test used a real provider. The complete Node glob has one environment-only
failure: the rendered browser suite cannot import the absent isolated
`tools/firbo-browser-runtime/node_modules/playwright` package. The other 563
tests pass when that rendered suite is excluded. PR #35's independently read
exact-head CI already passed its Chromium gates; this new source still needs its
own remote CI before release.

## Failed / limits

- There is no local PostgreSQL server. This stage reuses the already green PR
  #35 schema/RPC contract and adds no migration, but its combined exact-head
  PostgreSQL and workflow gates have not run remotely.
- Image-generation gateway attempts currently have no reliable token/image-cost
  receipt and can fall back to a free transport. Search/Tavily and server
  execution have different billing and artifact contracts. They were not
  forced through the text/vision adapter.
- Authorized read-only reconciliation monitoring remains unimplemented.

## Remains

1. Publish this isolated branch as a draft only after re-reading PR #30 and the
   target branch, then require exact-head CI and real PostgreSQL gates.
2. Define image generation admission, per-image cost and gateway-fallback
   ambiguity before adapting it.
3. Define billed gateway/Tavily search receipts and server execution receipts;
   do not count keyless public fetches as provider inference.
4. Add company-authorized, paginated, read-only reconciliation monitoring that
   cannot retry, settle or release requests.
5. Re-read live migrations and all Edge dependencies before any combined
   release. Keep PR #13 CI-only and preserve every Mac, OAuth/channel,
   second-customer, backup, monitoring and final-assessment gate.
