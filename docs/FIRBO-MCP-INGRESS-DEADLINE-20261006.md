# FIRBO private MCP request deadline — 6 October 2026

## Changed

- Isolated continuation of the freshly confirmed shared Claude head
  `8a59bc666a559e2dfc09ea76fd9230f2348f5373`. Codex parity `ce421e31` remains
  an ancestor. PR44 and PR45 are already released; their migrations must not
  be replayed. The direct session owns Billing PR46; this work changes none
  of its paths or active worktrees. PR13 remains CI-only.
- Independently reproduced another inactivity-only timeout: a real loopback
  client sent headers every 0.55 seconds and kept the serial private service
  occupied for **5.5031 seconds**, exceeding its configured 5-second timeout.
  This is distinct from PR43's already-fixed outbound TLS response deadline.
- One socket watchdog now spans incoming request line, headers and body,
  starting before HTTP parsing. Timeout shuts down the connection; cleanup
  cancels and joins the timer on every handled request. A monotonic admission
  check also refuses dispatch if the timer callback itself is delayed.
- Fully admitted requests cancel the incoming timer before the existing
  independently bounded DNS/TLS/provider phase. Valid upstream work is not
  cut off by the 5-second incoming budget. No retry or direct fallback added.
- Reject duplicate Authorization, duplicate/unsupported framing, excessive
  Content-Length digits and accepted headers above 16,000 bytes before
  provider dispatch. The standard-library parser's own line/count caps still
  apply before the aggregate accepted-header check. Disconnected-client socket
  errors close quietly without dumping a request traceback.

## Tested / passed

- **24 Python unittest cases** passed locally, including the existing actual
  synthetic TLS suite and seven new ingress regression cases. Actual loopback
  slow request-line/header/body senders are closed within a 0.2-second fixture
  deadline (0.4-second test tolerance), then a valid request succeeds on the
  same serial server. No provider/DNS call is made for rejected requests.
- A combined header/body test proves the timer is not restarted after headers.
  A delayed-watchdog fixture proves monotonic denial; admitted synthetic
  upstream work lasts beyond the ingress deadline and still completes. Timer
  cleanup is asserted after every server request and server thread shutdown.
- **36 focused Node tests** passed: actual MCP Edge entrypoint, fail-closed
  routing/receipts, runner attempt adapter and server receipts/runtime contracts.
- Ruff check/format and Git diff checks passed. Python 3.12 socket/threading
  official documentation was checked for timeout and cancel/join behavior:
  https://docs.python.org/3.12/library/socket.html and
  https://docs.python.org/3.12/library/threading.html .
- Existing pinned-egress CI discovers the expanded Python file automatically;
  no assertions or release gates were weakened.

## Failed / limits

- This is source-only. No VPS installation, ingress, secret, migration, Edge
  deployment, device job, provider request or customer permission changed.
- Public HTTPS ingress still needs independently reviewed TLS, header/body
  limits and connection/concurrency policy. A buffering reverse proxy has its
  own client reception lifecycle; a loopback watchdog does not certify it.
- The service is intentionally serial and still requires supervision and load
  acceptance. DNS workers retain bounded slots until blocked resolvers finish.
  General web/provider egress is not certified by this MCP-only change.
- Exact-head remote CI is required before merging; parent success is not
  acceptance of this candidate. Authoring evidence is recorded here; later CI
  status and exact remote source identity belong in the draft PR body.

## Remains

1. Publish isolated draft and pass exact-head pinned TLS/Node/Ruff and shared
   lifecycle/accounting/rendered workflows; compare full remote source tree.
2. Preserve the active Billing PR46, re-read newer shared/live state before any
   combined release, and never replace live dependencies with older files.
3. Provision authorized dedicated HTTPS MCP ingress, allowlist, credential and
   supervision; obtain harmless real deployed acceptance before MCP cutover.
   No callable VPS terminal/SSH capability has been supplied to this run.
4. Verify real server-route input/output prices and output token bound before
   runner accounting cutover; obtain genuine provider usage/invoice evidence.
5. Existing paired Mac updater/local consent/Stop/offline and useful browser
   artifact acceptance, useful VPS artifact/read-back, OAuth/channel consent,
   second-customer isolation, Knowledge/Skills/Workflows/CEO meeting, final
   design/voice/mobile, encrypted off-host booting restore and monitoring/load
   remain. FreeLLMAPI stays installed; no full-plan completion claim.
