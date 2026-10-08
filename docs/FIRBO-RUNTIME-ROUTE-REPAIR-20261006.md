# Active runtime route and tool repair — 6 October 2026

## Native trace follow-up after d9c07eb was run

Observed / failed:
- Both services returned requested native calls from their direct gateway
  probes. The capture-only Orchestrator fixture forwarded the actual schema.
- Both live server direct requests returned zero calls, and normal native
  execution returned zero tools and native_receipt_verified=false. Neither
  code_interpreter nor calculator reported an approval block. This does NOT
  prove a particular parser, wrapper, prompt or cached routing defect.
- The old gateway probe bypassed generate(), response normalization, server
  identity prompts and configured engine wrappers. Its success did not verify
  those stages. No claim that the live tool issue has been repaired.

Changed:
- Added standalone --trace-native to the same pinned diagnostic script.
  It fingerprints eight installed modules and observes actual HTTP payload
  summaries and raw response call counts through the installed adapter,
  server identity path, reconstructed scanner/telemetry wrappers, and captured
  configured Orchestrator first request. Then it repeats live server direct
  and normal native receipt checks. The existing apply path is unchanged.
- Traces expose only counts, booleans, numeric generation options and hashes,
  never headers, arguments, system text, user text or response prose. A worker
  returns model calls without executing them; the configured agent uses a
  capture-only engine before inference replay. No approval bypass or policy,
  provider, config, installed-file, database, frontend or Mac changes.
- Reconstruction is labelled fresh-process evidence, not live-process state;
  it uses one safe native schema, not the entire running agent inventory or
  live memory context. Scanner construction failure is reported and blocks
  configured-agent replay. Never infer live acceptance from a worker fixture.

Tested / passed:
- 58 local runtime/update/receipt tests, including 43 repair/trace cases.
  Real disposable HTTP tests cover vLLM and MultiEngine, current/legacy config,
  both safe schemas, optional auto retry, installed parsing, server identity,
  telemetry and captured agent inference. Scanner native binaries are absent
  in this test environment; HTTP fixtures explicitly disable scanners.
- Fault injection distinguishes outbound schema loss from response parser
  loss. Secret header, upstream error/response prose and system text are
  excluded from output. Ruff check/format and git diff whitespace passed.
- Accepted contributor refs rechecked: Claude f6442b754eb26019c16f4aa40c50a15d6e73c14b,
  parity ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a; PR30 parent d9c07eb unchanged.

Remains:
- Owner runs the checksum-pinned script with --trace-native on srv2027143;
  this session still has no direct VPS execution access. Identify the first
  failed wire/result boundary, then repair only that measured cause. Do not
  repeat --apply, change providers, disable guardrails or force all requests
  to execute tools speculatively. Native live execution remains FAILED.
- Jarvis artifact/approval acceptance, Mac connector/browser acceptance,
  complete animated 3D design and the existing master-plan backlog remain open.

Earlier entries below are historical observations and instructions.

## Native-tool follow-up after b0715ef was run

Changed:
- Owner ran `b0715ef9513401ff756f77992de45101499f21e9`. Both services
  reconstructed the vLLM route to `https://gateway.firboai.app:443`. All six
  direct synthetic probes returned HTTP200 and the requested function call.
  Installed BaseAgent forwarded both tools and tool_choice; no agent edit was
  needed. The normal agent request still returned zero executed tools.
- The old shell smoke test cannot establish general execution readiness:
  shell_exec requires confirmation, and serve does not supply an interactive
  confirmation callback. This explains why shell execution would be refused,
  but does NOT explain zero tool calls. The live cause remains unresolved.
- Added standalone `--diagnose-native`: real installed code_interpreter schema
  on admin and calculator schema on sandbox; capture-only Orchestrator fixture;
  configured gateway requests; server direct calls; then normal agent requests
  for fresh arithmetic. It requires the safe tool in each runtime inventory,
  never falls back to shell and never changes installed files or configuration.
- Receipt verification requires the actual tool name, successful execution and
  exact arithmetic output. Model prose, failed tools and wrong numbers fail.
  Direct model tool calls and a fixture are explicitly not actual execution.

Tested / passed:
- 48 runtime/update/receipt cases, including 33 repair cases and real disposable
  HTTP transports through the configured vLLM/MultiEngine adapters.
- Full Ruff check and formatting gate passed across 1,442 source/test/script
  files. Prior contributors' heads remain unchanged and preserved.

Failed / remains:
- Live native-tool execution, artifact acceptance and approval continuation
  are not yet verified. Run the pinned script with `--diagnose-native` alone;
  do not repeat --apply or treat its diagnostics as a deployment.
- No frontend, Mac, database, provider or permissions release in this update.
  The wider master-plan items below remain open.

Earlier entries below are historical observations and instructions.

## Follow-up after owner ran the repair

Owner output reports `engine: multi` for BOTH services, zero executed tools and
no artifact. The previous script's unsupported_active_engine guard prevented
its direct gateway probes; that was a diagnostic gap. MultiEngine forwards
kwargs unchanged in repository source. Do not call it the proven live cause.

The updated repair supports MultiEngine by using the installed discovery/model
selection code, the service environment and its explicit CLI engine override.
It prints the selected child, its configured endpoint and model advertisers.
This is explicitly labelled reconstruction from the CURRENT configuration and
catalogue, not inspection of the live process's cached private model map.
No router policy or model selection is changed.

Before inference, a local fixture measures the installed BaseAgent._generate
tool/selector forwarding with a capture-only fake engine. It executes no tools
and sends no inference request. If it actually drops tools, --apply adds only
tools/tool_choice forwarding at an AST-validated existing gen_kwargs call site.
It preserves every other source byte and the stored-option allowlist. An unknown
structure is refused. The existing backup/atomic replacement/restart transaction
is reused, with rollback if authenticated service health or forwarding fails.
Already-correct agents are not rewritten. This is a conditional repair of a
known historical behavior, NOT a claim that this VPS has that behavior.

New tests: real MultiEngine plus disposable HTTP transport for nested/legacy
vLLM config; broken installed-agent simulation before/after the bounded patch;
unrelated code and stored-option filtering preservation; unknown-shape refusal;
behavior-probe non-execution. All 18 repair cases passed, and full source/test
Ruff check and format gate passed. Live execution remains unverified.

The pinned source for this follow-up starts at PR30 head
`99178ac94118ed1eaba5f19054f2b7fe635a7d7c`. No frontend, Edge, database, provider,
permission, Mac or design deployment is part of this follow-up. Master-plan
remaining items below still apply. Earlier observations below are historical.

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
  `673f96dd99d9070bba33c0e7d9b0b9511ac902cad94d643448d9519551f38b61`.

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
