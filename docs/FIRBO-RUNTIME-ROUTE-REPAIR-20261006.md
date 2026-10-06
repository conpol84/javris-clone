# Active runtime route and tool repair — 6 October 2026

Continues PR30 at `9021ae53404148ec8920cd5f7492698bdd2f5d12`.
Verified remote heads: Claude `f6442b754eb26019c16f4aa40c50a15d6e73c14b`,
Codex parity `ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a`; both are ancestors.
No merge from PR13. Existing CoreOrb and Claude/Tavily changes are retained.

## Observed / failed

The owner ran the previous diagnostic: both requests to localhost:20128 failed
with ECONNREFUSED (111). That script assumed OmniRoute on host loopback. Compose
publishes only Caddy; its gateway is on the private Docker network. The sandbox
installer explicitly copies VLLM_API_KEY, so vLLM compatibility is a supported
host-service setup. Neither observation proves the actual live engine or the
upstream cause. Previous agent responses still show zero tools and no artifact.

## Changed

- FIRBO aliases now preserve tools through both OmniRoute and vLLM adapters.
  On HTTP400 with optional tool_choice=auto, retry once omitting only that
  selector. Keep tools/messages/model; never relax required or named selection.
  A further 400 raises an explicit error. Existing non-FIRBO vLLM compatibility
  is unchanged.
- `deploy/hostinger/repair-openjarvis-tools.py` replaces the old assumed-route
  diagnostic operationally. Read actual service MainPID environment and live
  /v1/info engine/model, then instantiate the installed engine/config under the
  jarvis user. This reuses config migration, host precedence and credential
  loading. No invented localhost endpoint or forced configuration change.
- The same script's --apply installs the exact tested one-file engine change
  only from two known hashes. Private backup, atomic replacement, two-service
  restart and authenticated health checks; restore on failed health. Preserve
  unknown/concurrent local edits. Incomplete rollback explicitly reports backup.
- Direct probes compare auto/required/omitted selectors, with bounded HTTP
  timeouts and sanitized status/call summaries. Returned functions are not run.
  --verify-execution additionally requests one admin printf of a fresh marker;
  only a successful matching shell_exec receipt verifies that stage. It never
  calls a prose answer an execution or a receipt an independently verified file.
- CI includes the new regression/transaction/HTTP integration tests.

## Tested / passed

- Broad engine/probe pass: 83 cases before the final additional rollback case.
- Final CI-shaped isolated lanes: 28 runtime/transaction/receipt cases and
  10 engine tool-contract cases, all passed.
- Real disposable HTTP server tests verify nested and legacy vllm_host config,
  correct bearer key, exact /v1 path, all three requests retaining tools, no
  credentials or upstream error prose in output.
- Ruff and whitespace checks passed. Candidate engine SHA256:
  `52ac25dd6e2c361f70cc9f08d04ef5f83227f8f8f753646e323b494c72c47f17`.

## Remains

The VPS has not received this candidate. Run the pinned repair script with
`--apply --verify-execution` there, then evaluate both the direct tool contract
and shell receipt. Unsupported upstream models may still require a separate
route correction based on those results. Do not claim live execution is fixed.
No provider/model, key, config, port, UI, permission or tenant policy changed.

Continue the existing master plan: real artifact acceptance; company-scoped
memory/knowledge, skills, workflows, approval continuation and accounting;
physical Mac connector/browser acceptance; full reference-based animated 3D
design; remaining operational and second-company acceptance. The initial 3D
core is retained, not described as a completed redesign.
