# Preserve live runner v89 before ledger adaptation

## Changed

- Candidate branches from PR28 head `c728d0c61720855c66e50fb6c99145a1d49d7a9d`;
  its accounting design remains unchanged. Shared Claude head independently
  verified as `f6442b754eb26019c16f4aa40c50a15d6e73c14b`; parity head remains
  `ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a`.
- Read back live agent-runner v89, ACTIVE, verify_jwt=false, bundle digest
  `e3ed8ea6f4b0b4c822ac6301a4ea575ed25246a44db5cba305f712b54ce7c03c`.
  Ten of twelve files already matched shared source. Preserved the two newer
  files verbatim: runner index and shared free-search (optional Tavily key).
- No changes to the runtime behavior already deployed by the direct session.
  Added five transport tests and an executable handler test for task research
  and explicit loop searches. All transports are fake; no real search or model.

## Tested / passed

- All twelve deployed files equal candidate contents exactly, including shared
  computer policy, agent loop, gateway and BYOK routing.
- 200 tests passed, zero failed/skipped: search/Tavily, executable edge handlers,
  agent loop, computer policy and gateway routing. Strict Edge TypeScript and
  `git diff --check` passed.
- New tests cover configured requests, invalid-key no-dispatch, response limits,
  empty/malformed/error fallback, abort propagation, both runner search paths,
  evidence fed back to the model, and synthetic key exclusion from writes.
- Source SHA256: runner index
  `76364b2f7ad493c7b2b47be069d3a8e6f59d0ea122e70b7a88b67f450835be01`;
  free-search `b4627b6e15ba91941ef66c38140a0efb856c766d3dafe8ba84767518708ec61a`.
- Independently listed live mission-runner v28, connector v29, agent-chat v38,
  integrations v30. This listing alone does not validate their complete bundles.

## Failed / corrected / limits

- First new handler fixture expected one search, but existing behavior performs
  initial task research and then the model-requested search. Corrected the test
  to assert exactly both calls and their distinct queries; runtime unchanged.
- No new PostgreSQL, rendered UI, real-provider or real-device acceptance.
  No migrations, deployment, credential changes, device jobs or external messages.
- The live source readback does not prove that a Tavily key is configured or that
  real provider search succeeds. Direct VPS/FreeLLMAPI/Mac work remains separate.

## Remains

- Continue PR28's claim-aware attempt ledger from this reconciled source, after
  rechecking branch and live drift. Tavily is another potentially billed tool
  route outside callModel: preserve the design's separate search/tool coverage gate.
- Implement logical-run versus attempt quotas, durable admission/dispatch,
  cancellation/claim locks, all retry/repair/polish paths, separate tool accounting,
  legacy duplicate removal and unresolved reservations across month boundaries.
- Require real PostgreSQL and fake-transport handler gates before release.
  This reconciliation does not implement the ledger and needs no backend redeploy.
- Direct user sessions take priority. Keep PR28 as design; never merge CI-only PR13.
  All real-provider/device/customer isolation and remaining master-plan gates stay open.
