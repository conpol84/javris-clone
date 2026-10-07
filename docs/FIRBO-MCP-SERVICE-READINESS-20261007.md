# FIRBO MCP service readiness — 7 October 2026

## Changed

- This isolated source candidate starts from shared `11e7b311`, which includes
  merged PR46 Billing, PR47 MCP ingress deadlines and PR48 native artifact
  acceptance. Codex parity remains in the shared ancestry. PR13 stays CI-only.
- The private MCP service keeps `127.0.0.1` as its default listener, but can now
  use an explicitly configured `FIRBO_MCP_EGRESS_BIND` on an RFC1918 address.
  This supports a reviewed Docker-Caddy-to-host route without permitting a
  wildcard, public, link-local or IPv6 listener. Ports below 1024 are rejected.
- `python -m openjarvis.server.firbo_mcp_egress --check-config` validates the
  token, exact HTTPS origin allowlist, bind and port without starting a listener.
  Its bounded JSON output includes no token or target origin.
- The existing absolute ingress deadline, pinned DNS/TLS egress, serial request
  handling, body/header caps, no retry and no direct fallback are unchanged.

## Tested / passed

- 28 focused Python cases pass, covering the loopback default, RFC1918 bridge binds,
  public/wildcard/link-local/IPv6 rejection, unprivileged port bounds and safe
  no-listener configuration output in addition to the existing synthetic TLS,
  SSRF and request-deadline cases.
- 36 actual Node cases pass across the Edge MCP handler, pinned transport,
  durable accounting, server receipts and runtime contracts. Ruff format/lint
  and repository diff checks pass. Exact-head remote CI remains a separate gate.

## Failed / limits

- No callable VPS terminal or SSH capability is available here. This candidate
  does not inspect the actual bridge address, install a unit, edit Caddy, create
  a credential, open a firewall port, start a process or deploy the Edge MCP
  function. A private bind is not by itself authenticated public HTTPS ingress.
- The exact read-only topology output requested in `FIRBO-LIVE-FINISH-20261007.md`
  is still required before a topology-specific installer or Caddy route can be
  reviewed. No real MCP provider, customer consent or invoice evidence exists.

## Remains

1. Obtain the bounded Docker/systemd/Caddy/listener topology output from the
   authorized VPS. Select the exact private host address only from that evidence.
2. Review and install dedicated supervision, a root-private environment file,
   a fresh service token, explicit approved provider origins, an exact `/v1/mcp`
   TLS route, request limits, access-log suppression and firewall containment.
3. Run `--check-config`, verify the listener is private, then perform one harmless
   authenticated deployed MCP request with durable request/result receipts.
4. Only after that acceptance, configure the Edge URL/token and deploy the exact
   MCP entrypoint plus shared dependency. Preserve the current live rollback.
5. Server pricing/output-token verification, Mac local approval/browser/Stop,
   useful artifact delivery, OAuth/channels, second-customer isolation, business
   workflows, restore/load/monitoring and final assessment remain open.

FreeLLMAPI remains installed and private. No migration, production deployment,
provider request, VPS mutation, device job, secret or permission changed here.
