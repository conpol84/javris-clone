# FIRBO MCP total transport deadline — 6 October 2026

## Changed

- Independent follow-up to draft PR42, exact parent
  `c63ba31e100a557d59d54af06a1411feca3999d0`, tree
  `94a9dd3a0e8f0cb974a46937fc2e310935788999`. Neither PR42 nor the active
  PR30/Claude/Codex branches is rewritten. PR30 was observed at `39645cec`;
  its newer runtime diagnosis remains separate and requires reconciliation.
- A bounded socket watchdog now enforces the original total egress deadline
  while HTTP headers and chunk metadata are read. Per-operation inactivity
  timeouts alone allowed a peer to extend these buffered reads indefinitely.
- The watchdog remains active when `http.client` transfers a close-delimited
  socket to its response reader. Final cleanup cancels/joins the watchdog,
  closes the response and closes the connection on success or failure.
- Deadline errors remain generic and fail closed. Numeric-IP pinning, original
  TLS hostname validation, receipt ambiguity, no redirect/retry policy and
  service/provider credential separation are preserved.

## Tested / passed

- Before the fix, actual local TLS slow-header acceptance failed: a configured
  0.2-second deadline returned only after 0.6076 seconds. A second slow-chunk
  test exposed the premature-watchdog-cancellation variant (0.6117 seconds).
  Both fixtures drip bytes more often than the socket inactivity timeout.
- After the fix: all 17 Python unittest cases pass, including both actual TLS
  total-deadline regressions, success/failure watchdog and connection cleanup,
  certificate/hostname validation, DNS restrictions, size bounds and service
  authentication. Synthetic socket remapping remains explicit; no real MCP
  account, external provider or production-network acceptance is claimed.
- All 134 combined MCP, server bridge, actual Edge entrypoint and runner
  accounting Node tests pass. Ruff 0.16.7 lint/format and diff checks pass.
- Independently refreshed PR31's exact-head Actions: its latest eight workflow
  families are completed/success, including the two formerly pending workflows.
  Earlier cancelled duplicates remain superseded CI, not SQL failures.

## Failed / limitations

- The initial slow-header test failed against the parent; the first watchdog
  implementation also failed the close-delimited chunk regression. Both are
  corrected. No assertions were weakened.
- New-head remote CI remains required. The parent PR42 currently has nine
  successful workflow families and two in progress at this authoring checkpoint.
- This is source-only: no live migration, merge, egress installation, function
  deployment, secret, permission, provider call or device job has occurred.
- Incoming request absolute deadlines still require the reviewed HTTPS ingress
  described in PR42. This change covers the outgoing MCP response transport;
  it does not certify every other HTTP client, real service capacity or load.

## Remains

- Publish this independent draft and require exact-head CI; reconcile current
  PR30, PR39 and production dependency/migration identities before release.
- Provision/verify the private egress service before changing the MCP function.
  Preserve PR42's origin allowlist, dedicated credential and HTTPS ingress gates.
- Continue general egress, real VPS/provider receipts and invoice verification,
  Mac update without re-pairing, local approval/Stop/offline artifact acceptance,
  OAuth, second-customer isolation, restore and the remaining master plan.
- FreeLLMAPI remains installed. PR13 remains CI-only and must never be merged.

Reference semantics checked against the official Python socket, SSL and
http.client documentation:
https://docs.python.org/3/library/socket.html
https://docs.python.org/3/library/ssl.html
https://docs.python.org/3/library/http.client.html
