# FIRBO MCP response integrity — 7 October 2026

## Changed

- Independent continuation starts from freshly read shared
  `572412e6d5bc0f8c586364de7399539c08bd3d42` (through merged PR59).
  Parity `ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a` is preserved in ancestry.
  Concurrent draft PR60 owns Take Control; its worktree and branch are untouched.
- Reproduced a new transport defect with real synthetic TLS: a valid JSON body
  followed by EOF before the declared Content-Length was returned as HTTP200.
  `HTTPResponse.read1()` does not itself raise for this premature EOF.
- Pinned MCP transport now checks the complete declared byte count, rejects
  conflicting/duplicate framing and unsupported transfer encodings, bounds
  Content-Length parsing before integer conversion, and reports incomplete
  chunked responses as generic transport denial. No partial success is returned.
- Valid chunked replies, length-delimited replies, empty 202 notification replies
  and bounded close-delimited replies remain supported. The existing DNS pin,
  TLS hostname verification, deadlines, size cap, cleanup and no-retry behavior
  remain. No new route, credential, provider connection or permission.

## Tested / passed

- Before the patch, real synthetic TLS reproduced premature-length success and
  acceptance of four ambiguous/unsupported transfer-encoding cases. Duplicate
  Content-Length already denied, but with an incorrect size-error classification.
- After the patch: all 35 Python cases passed, including real synthetic TLS,
  truncation of length/chunked bodies, duplicate/conflicting headers, unsupported
  encodings, malformed/5000-digit lengths, valid framing, existing slow ingress /
  outbound deadlines, private startup configuration and service recovery.
- 36 focused Node cases passed across the actual MCP handler, proxy adapter,
  runner ledger and server receipts. Existing denial/ambiguous receipt tests
  confirm no direct retry or falsely successful receipt publication.
- Ruff check/format and `git diff --check` passed. Exact remote CI remains a
  separate gate; local results are not real provider/VPS/device acceptance.

## Failed / limits

- There is still no callable VPS terminal/SSH capability here. No service install,
  public HTTPS ingress certification, firewall/supervision change, provider call,
  Edge deployment, migration, secret change or computer job was performed.
- This is MCP response integrity only. General read_page/search/provider egress
  has not been certified or changed by this patch. A close-delimited response has
  no declared length to compare; this patch does not invent that evidence.
- Public ingress and actual approved provider acceptance remain prerequisites
  for deploying the fail-closed MCP Edge candidate.

## Fresh read-only reconciliation

- PR46 Billing, PR47 ingress, PR48 artifacts and PR49 private bind are merged.
  Do not repeat their implementation or replay any applied source migration.
- firboai.app independently resolved to READY production
  `dpl_5qYzCxyXoHK4AyNNAej1djzWxT9G`, pinned source
  `0809fc800c91dd2511f3fa2d1cfbd7a764fa764b` from the direct Mac-control release.
  Shared source has advanced since that runtime. This patch must not redeploy
  an older frontend, replace the active direct release or assert newer UI is live.
- Live migration list includes actual identities `20261006205256` rollover,
  `20261006205845` runner attempts, `20261006213545` snapshot, and newer
  `20261007010757` running Stop, `20261007010759` owner instructions,
  `20261007015134` performance hardening. The month rollover bug IS fixed live.
- Fresh Edge metadata: runner91, chat41, mission30, integrations31, connector30,
  MCP19, server15. These are metadata reads; full dependency bytes were not read
  in this run. A newer runner version does not prove billed-route accounting or
  prices are verified. Preserve the direct session's newer bundles.

## Remains

1. Exact-head CI and shared-head reconciliation before source integration.
2. Authorized VPS topology, reviewed private supervised service, exact public
   HTTPS route/limits/log suppression, dedicated credential, explicit origins
   and harmless deployed request/receipt acceptance before MCP Edge cutover.
3. Actual billed server input/output pricing and output-token limit verification,
   accounting dependency read-back and provider invoice reconciliation.
4. Useful VPS artifact/delivery/read-back, existing Mac updater/local consent /
   browser/Stop/offline, real OAuth/channel consent and second-customer isolation.
5. Business workflows/Knowledge/Skills, voice/mobile/languages/signed desktop,
   encrypted offhost booting restore, monitoring/load and final assessment.

Keep FreeLLMAPI installed. Never merge PR13. No master-plan completion claim.
