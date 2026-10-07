# FIRBO MCP pinned egress — 6 October 2026

## Changed

- Continues exact-green PR41 `0b956a4f8804d35fa7ed6b58d52f6e4337809769`.
  Current contributor heads `f6442b75` (Claude) and `ce421e31` (Codex parity)
  were fetched, independently re-read with `ls-remote` and verified as ancestors.
  The new isolated branch does not rewrite PR30/39/40/41 or either contributor.
- All remote MCP JSON-RPC traffic now uses an operator-configured HTTPS egress
  service. There is no direct target fetch fallback. Missing configuration,
  transport failure or rejection keeps the existing fail-closed receipt flow.
- New standard-library Python transport validates explicit allowed HTTPS
  origins, resolves once, rejects the entire DNS answer set if any address is
  non-public, and connects a socket directly to one validated numeric address.
  TLS SNI and certificate verification retain the original hostname. No proxy
  environment variables, pooling, redirects, alternative-IP retry or fallback.
- The service accepts only bounded MCP POST envelopes and selected headers.
  It requires a dedicated service token, binds to loopback, rejects unsupported
  request framing, limits input/output, and does not log targets, tokens or
  provider content. DNS admission is bounded to two worker slots; timed-out
  workers retain their slot until completion rather than allowing queue growth.
- Existing company role checks, explicit confirmation, same-session tool
  discovery, atomic secret persistence and pre/post receipts remain intact.
  A failure after a requested receipt remains reconciliation-required.
- Added a dedicated CI gate for pinned transport, real synthetic local TLS,
  private service authentication and the actual MCP Edge handler.

## Tested / passed locally

- 15 Python unittest cases, requiring only standard library and OpenSSL.
  Real local TLS sockets prove original Host/SNI, certificate trust and hostname
  validation, redirect refusal, announced and streaming response caps. The
  fixture maps a synthetic public numeric socket to its local TLS server; no
  public provider/account request or actual cloud DNS acceptance is claimed.
- 134 combined MCP/server/runner-accounting Node tests, including service
  credential separation, zero-network missing configuration, no direct retry,
  and durable ambiguity following a requested receipt.
- 633 distinct non-rendered FIRBO Node tests (583 general + 50 dark-voice),
  528 frontend tests, strict isolated Edge TypeScript, Ruff check/format and
  Git diff validation passed. No frontend implementation or package changed.
- Official Python TLS/client documentation and Supabase changelog/environment
  documentation were checked. No new SDK API, migration or database grant.

## Failed / limitations

- This is source-only. No egress service, environment value, Edge dependency,
  migration, device permission or production deployment has been changed.
- Production requires separately reviewed HTTPS ingress with request/header
  limits, a dedicated service account, origin allowlist, secret provisioning,
  process supervision and real deployed transport acceptance. The service is
  intentionally serial for this initial bounded implementation; capacity and
  load testing remain open. Slow DNS workers can exhaust both slots and deny
  further work safely until the resolver returns.
- The Edge-to-proxy endpoint is trusted operator bootstrap configuration. This
  increment does not claim DNS pinning for that configured ingress, provider
  APIs, web_search/read_page, device bridges or OpenJarvis's other HTTP clients.
- Remote exact-head CI, PostgreSQL parent gates and rendered regressions remain
  required for this new combined head. Local TLS is not real MCP consent or a
  production networking acceptance.

## Release sequence / remains

1. Publish an isolated draft; require every exact-head workflow.
2. Read deployed function dependencies and migration ledger; reconcile PR39
   separately before any combined release. Do not replay applied migrations.
3. Provision and independently verify the egress service first. Only then set
   `FIRBO_MCP_EGRESS_URL=https://<operator-ingress>/v1/mcp` and the dedicated
   `FIRBO_MCP_EGRESS_TOKEN` on the Edge side. On the service use the same token,
   `FIRBO_MCP_EGRESS_ALLOWED_ORIGINS` (exact HTTPS origins, port 443 only), and
   optional `FIRBO_MCP_EGRESS_PORT` (default 8093).
4. The reviewed Python source runs with
   `python -m openjarvis.server.firbo_mcp_egress` on loopback. Ingress must expose
   only `/v1/mcp`, terminate verified TLS, bound headers/body/connection time and
   avoid credential/body access logs. Do not expose the raw loopback service.
5. Deploy the exact MCP entrypoint and its new shared dependency together,
   retaining rollback identities; verify anonymous denial and one approved
   harmless MCP call with both receipt hashes and no provider retry.

General egress coverage, provider token lifecycle and invoice verification,
authorized reconciliation UI, real VPS tool execution/useful artifact read-back,
Mac Connector update without re-pairing, Stop/offline behavior, CEO/meeting,
Knowledge/Skills/Workflows/OAuth, second-customer isolation, voice/design/mobile,
backup restore, monitoring and final production assessment remain in the master
plan. FreeLLMAPI stays installed. PR13 remains CI-only and must never be merged.
