# FIRBO pinned page egress — source checkpoint

## Changed

- `read_page` no longer performs a direct fetch after a lexical hostname check.
  It fails closed unless the operator configures an authenticated HTTPS
  `/v1/page` service; there is no direct-target retry or fallback.
- The private service accepts exactly one URL, resolves every redirect host once,
  rejects mixed/non-public DNS, connects to the approved numeric address and
  verifies TLS for the original hostname. Only public HTTPS on port 443 is read.
- Request ingress, DNS, the whole redirect chain, response bytes and response
  framing are bounded. Compression, non-text content, ambiguous framing,
  incomplete bodies and redirects to private/local targets are rejected.
- Service logs suppress request details. Startup requires a dedicated token and
  a loopback/private bind. Errors do not echo the target or upstream body.

## Tested / passed

- Offline policy tests cover private/metadata/transition addresses, alternate
  numeric hosts, mixed DNS, malformed targets and private service settings.
- Actual local TLS tests connect through a synthetic public IP to a loopback TLS
  server, verify SNI/hostname preservation, re-resolve redirects, refuse metadata
  redirects, and exercise strict length/transfer/content-type handling.
- Edge tests prove that only the configured service receives the envelope/token,
  unsafe targets cause zero dispatch, service denial has no fallback, responses
  stay bounded, and page text cleanup/deep-research behavior is preserved.
- Local acceptance passed 13 Python page-egress cases, 13 focused Edge/page
  cases, 645 non-rendered FIRBO Node cases, strict Edge TypeScript, 552 frontend
  tests, Ruff 0.16.7 and the production frontend build. Counts are separate and
  may overlap; no real external page or provider was contacted.

## Failed / corrected

- The first TLS run exposed `http.client` clearing the connection's socket after
  a `Connection: close` response handed it to the response reader. The transport
  now retains the already pinned TLS socket before that handoff; the tests pass.
- The local rendered browser test could not run because Chromium 1243 is absent;
  the Playwright download endpoint returned an empty/truncated archive. This is
  an environment failure, not a passing rendered check. Exact-head CI must run it.

## Remains

- Source-only candidate. Before an Edge cutover, provision and review private
  supervision plus public HTTPS ingress, a dedicated token, exact Edge origin,
  rate/concurrency limits and log suppression, then obtain a harmless deployed
  page receipt. Until that exists, `read_page` must remain on the current live
  version rather than deploying this fail-closed source alone.
- Combining this candidate with PR62 adds `page-egress.ts` to the runner import
  closure. PR62's dynamic manifest gate must be regenerated from the combined
  exact bytes (16 files instead of 15); neither PR62 nor its branch is modified here.
- This does not certify MCP, provider billing, VPS artifacts, Mac/browser control,
  OAuth/channels, a second real customer, restore/load or final production status.
  PR60 Take Control, PR61 MCP response integrity and PR62 runner bundle remain
  independent. FreeLLMAPI remains installed; PR13 must never be merged.
