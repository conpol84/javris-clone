# FIRBO tool sampling workaround — 6 October 2026

## Evidence

The owner ran the pinned comparison on srv2027143. With identical native
calculator schema, prompt, model and tool_choice=auto, requests alternated:

| Request | HTTP | Expected calculator call | Tool calls |
| --- | --- | --- | --- |
| temperature omitted, first | 200 | true | 1 |
| temperature 0, first | 200 | false | 0 |
| temperature omitted, repeat | 200 | true | 1 |
| temperature 0, repeat | 200 | false | 0 |

This isolates a reproducible request compatibility problem. It does not identify
the gateway's internal provider/transform bug, prove nonzero sampling fails, or
prove live execution by the ordinary agent.

## Changed

- The HTTPS gateway.firboai.app:443 / firbo-quality tool-bearing route omits
  optional temperature in generate, stream and stream_full. The server otherwise
  injects 0.7 by default. Other hosts, models, text-only requests, tools and
  explicit tool_choice values retain their behavior. No forced tool selection.
- Installer accepts only known source hashes, preserves permissions/ownership,
  saves a backup, restarts the two existing OpenJarvis services and verifies
  ordinary code_interpreter/calculator execution with exact receipts. Failed
  health or failed execution on either service restores the original file.
- --apply-temperature-fix is standalone. Re-running checks execution even if the
  patch is already installed. No config, provider, approval or database changes.
- Corrected the calculator probe expectation: CalculatorTool returns float text
  (for example 42.0), while code_interpreter prints the integer (42). The old
  exact integer expectation would falsely reject real calculator execution.

## Tested / passed

- 32 engine contract tests, including endpoint/model boundaries, explicit tool
  selection, both streaming transports and actual Orchestrator -> Calculator ->
  server receipt with a simulated temperature-sensitive upstream.
- 62 runtime/repair/receipt/update tests, including original baseline upgrades,
  current installed hash, idempotence, permissions, concurrent-change refusal,
  rollback after either service's failed native receipt, and real calculator
  formatting. No live provider/service calls were made from this workspace.
- Ruff check/format and diff whitespace checks.

## Source preservation

Parent PR30 head ad12f1150b3457148719c6b98dd6225f794a5394 already contains Claude
f6442b754eb26019c16f4aa40c50a15d6e73c14b and Codex parity
ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a. Current remote refs were read and those
ancestor relationships checked. No force update, unrelated draft merge or PR13
change. PR39/40/41 remain separate.

## Failed / remains

Live installation and both native execution receipts remain pending the owner's
terminal run. If verification fails the installer rolls back; do not claim the
VPS is fixed from local tests. Real file artifact/read-back, UI/mobile invocation,
private FreeLLMAPI access, Mac browser work and the wider master plan remain open.
