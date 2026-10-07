# FIRBO deployed acceptance probe — connected TLS deadline repair

Source authoring checkpoint: 7 October 2026, 14:09 UTC. Source-only preparation
of the existing egress acceptance gate; no new master-plan stage is completed.

## Changed

- Continued shared `0e1c5d85f2e4d9d286192a42a54f66f6237461d8` with Codex
  parity `ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a` preserved as ancestry.
  Issue52 body/comments and current open PRs were read first; the PR79
  release-control claim is completed. A narrow source-only claim was recorded
  on Issue52, with no acknowledgement or release ownership inferred.
- Independently reproduced two deadline bypasses in
  `tools/firbo_egress_acceptance.py` using actual loopback TLS sockets and a
  synthetic certificate with verified hostname. Both requests carried only
  the fixed malformed `{}` envelope, with no public/provider/page dispatch.
- Old probe accepted HTTP401 after **0.5861s body drip** and **0.3841s header
  drip**, despite a **0.15s** deadline. Existing fake-transport watchdog tests
  did not exercise buffered socket reads or `http.client` response handoff.
- The probe now retains the connected socket and performs `shutdown(SHUT_RDWR)`
  on deadline. `HTTPConnection.close()` alone could not interrupt the buffered
  header read and did nothing after the connection handed its socket to a
  `Connection: close` response.
- Added monotonic admission checks before/after transport phases and after
  timer cleanup. A late scheduler callback cannot authorize a late receipt.
- Added a final total-duration check after all four probes and receipt
  construction. A separate fake-clock regression reproduced the missing
  overall final check before this repair.
- Existing exact status/body/certificate-hash receipt fields, ordinary verified
  TLS, malformed payload, token handling, redirect/framing denial and one-attempt
  behavior remain. No retry, direct target fallback or service enablement.
- The six-file service/Edge manifest is unchanged: this repair changes only the
  acceptance probe, its tests and this checkpoint.

## Tested

- Existing four probe/route/token/framing/watchdog tests plus five new tests:
  real TLS header drip, real TLS body drip after detached response handoff,
  real valid TLS response, delayed watchdog rejection and final total deadline.
- **9 Python tests passed**, including three actual loopback TLS cases.
- After repair, the same independent reproductions fail closed at **0.1511s**
  (body) and **0.1506s** (headers), with `acceptance_deadline_exceeded`.
- **11 Node tests passed** for the exact egress manifest/read-back/release gate
  and both MCP/page Edge adapters. No service manifest regeneration was needed.
- Ruff 0.16.7 check/format and diff checks passed after correcting import order.
  Exact-head remote CI must still run before acceptance of the draft.
- Fresh full deployed runner read-back remains **v92, 16/16 files identical**
  to shared `0e1c5d85...`. The historical runner91 dependency mismatch is no
  longer current and was not reimplemented or redeployed.

## Passed

- Both real connected TLS bypasses reproduced against old source and are denied
  by the repaired probe. Valid TLS denial responses still produce exact receipt
  metadata, with `attempts:1`.
- No provider inference, actual page, public acceptance request, database write,
  migration, device action, service installation, credentials, configuration,
  permissions, backend/frontend deployment or production release occurred.
- FreeLLMAPI, PR78/79 and Claude/Codex history remain preserved. PR13 untouched.

## Failed / limits

- The original real TLS tests failed 2/3 before repair; the final total-duration
  test separately failed before the final admission check. These are reproduced
  source defects, not observed deployed customer failures.
- This is an acceptance-tool repair, not a change to either egress service and
  not certification that the services are installed or publicly supervised.
- Shutdown interrupts already-connected TLS reads. The platform's blocking DNS
  resolver and pre-socket connection setup are not made cancellable by this
  patch. Late completion is rejected; no universal DNS wall-clock guarantee
  is claimed. Actual ingress/DNS/supervision remain deployment prerequisites.
- Remote exact-head CI and read-back are not claimed at authoring; subsequent
  results belong in the draft PR/Issue52 handoff.

## Remains

- Keep this change draft/source-only pending exact-head CI and current direct
  session reconciliation; no merge or deployment is owned by this claim.
- On an authorized VPS, inspect actual topology and install only the reviewed
  complete matching bundle, with private binds, exact origins, HTTPS ingress,
  distinct tokens, supervision, limits and log suppression. Obtain full service
  byte read-back and harmless deployed acceptance receipts before Edge cutover.
- Verify billed-route input/output prices and output-token bound before enabling
  server execution. Do not invent a free price or make a provider call for a test.
- Physical Mac/local consent, useful artifacts, authenticated business flow,
  OAuth/channels, second customer, voice, encrypted offhost restore, load and
  final production assessment remain separate real gates.
- No callable VPS/SSH channel is available here. Mac Catalina capability limits
  are not bypassed through generic exec. This source work does not resolve them.
