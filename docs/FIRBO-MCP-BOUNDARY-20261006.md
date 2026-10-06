# FIRBO MCP company boundary — 6 October 2026

## Scope

This increment hardens the existing remote MCP adapter. It does not connect a
provider, create an integration, recover a credential, call a real MCP tool or
claim general OpenJarvis runtime parity.

## Changed

- Only an authenticated company owner/admin/manager may connect, discover or
  call. The role is checked again after remote discovery and immediately before
  a tool action.
- A call needs a separate visible browser confirmation. The Edge Function also
  requires `confirm: true` and does not establish the remote session when that
  confirmation is absent.
- A call may use only an exact, syntactically safe tool name advertised by the
  same authenticated MCP session. Tool lists, schemas, descriptions, cursors,
  session IDs, request bodies and response streams are bounded before use.
- A durable `mcp.tool_requested` receipt containing the company, actor, tool,
  host and SHA-256 of the arguments must be committed before the remote action.
  A second receipt records the bounded result hash and outcome. An interrupted
  or unrecorded result is reconciliation-required, never reported as success or
  automatically retried.
- New MCP connection persistence now uses the existing atomic
  `firbo_save_legacy_integration` RPC, so an integration row and its encrypted
  secret cannot be exposed as a partial save. No migration or SQL replay is
  needed.
- Integration, credential, quota and audit reads fail closed. Stored remote
  errors are generic and bounded; provider content or secrets are not retained.
- Confirmation copy is present in all eight existing app languages. The client
  keeps the request/result receipt identifiers and hashes returned by the Edge
  Function.

## Tested

- Actual MCP Edge entrypoint exercised with synthetic database and remote MCP
  doubles: authentication/role scope; database and secret failures; explicit
  confirmation; exact discovered tool; role revocation; audit failure;
  successful receipts; ambiguous result; completion-audit failure; bounded
  response; bad session ID; atomic persistence.
- Edge TypeScript includes `supabase/functions/mcp/index.ts`.
- Frontend unit coverage verifies that the client sends explicit confirmation
  and preserves durable receipt fields.
- All 555 non-rendered FIRBO Node tests and all 489 frontend tests pass. Edge
  TypeScript, frontend production build, clean npm 11.19 install, diff check and
  `npm audit --omit=dev` (zero vulnerabilities) pass. Rendered Chromium evidence
  is a separate CI gate and is not replaced by static/source checks.

## Evidence classification

- **Source:** company authorization, bounds, confirmation, receipts and atomic
  save are implemented in the repository.
- **Automated:** 555 non-rendered Node and 489 frontend tests exercise these and
  the retained contracts without external side effects.
- **Rendered/live:** not established by this document. A release requires an
  exact-head rendered workflow and immutable deployment verification.
- **Real provider/account:** not attempted. There is no consent, credential,
  integration row or real MCP tool execution in this work.

## Failed / limitations

- The local wildcard FIRBO run attempts the rendered browser fixture, but this
  workspace still lacks that fixture's pinned Playwright runtime. It is excluded
  from the local non-rendered count and must pass independently in exact-head CI.
- The Edge runtime fetch API does not expose the socket-level DNS pinning used by
  the local Connector browser transport. The adapter rejects literal, local and
  internal host forms and never follows redirects, but a production-grade
  egress proxy/pinned transport remains required before treating arbitrary
  tenant-supplied MCP hosts as a complete SSRF boundary.

## Remains

- Exact-head CI, merge preserving both histories, MCP function deployment and
  frontend publication from the accepted immutable source.
- A legitimate company owner must then connect an approved public MCP server,
  review discovery, approve a harmless tool call, and reconcile the two receipt
  hashes. This is real-provider acceptance and cannot be inferred from CI.
- Network-level egress/DNS pinning, provider token refresh/revoke where
  applicable, per-tool risk/permission policy and cross-customer live isolation
  remain open master-plan gates.
