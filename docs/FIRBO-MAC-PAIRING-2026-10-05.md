# FIRBO Mac mini pairing checkpoint — 5 October 2026

Continue the existing master plan and `FIRBO-HANDOFF-2026-10-04.md`. This is a focused continuation, not a replacement audit. The exact source SHA and final CI results belong in the current continuation checkpoint; results below are local evidence for this change.

## Changed

- Computers explains that creating a website entry does not install or start anything on the computer. The owner confirmed they had only used the website, with no local Connector execution.
- Explicit target OS selection, quoted Downloads paths, one pairing command for the selected permissions, browser-only default, keep-Terminal-running and expired-code/path/offline recovery guidance. All eight existing languages have setup labels.
- The CLI checks writable private settings before consuming the one-use code, saves via private temporary file and rename, preserves old settings on API failure, gives safe recovery guidance, and retries transient startup network failures. Authentication and protocol rejection still fail closed.
- Local-operation CI includes macOS. Canonical Claude-line PRs now receive the frontend, local-operation and Computer Manager gates. New setup checks are included without removing previous checks.
- A Granola router test lost its validator mock when the router reloaded the unregistered connector. Explicit synthetic registration plus a fail-before-transport guard fixes the reproduced problem. RSS setup uses synthetic DNS while keeping the actual SSRF validation.

## Tested / Passed

- Connector execution, durable journal and receipts: 100 passed. Mac system-launch success/failure uses a mocked launcher; local filesystem/process/SQLite tests use real isolated effects and synthetic service identity.
- Computer Manager workflow's exact state/setup/cancellation/delivery list: 33 passed. Mac commands exercised from an unrelated directory with spaces in the synthetic home path. Permission boundaries and pairing-code injection are checked.
- Router plus Granola modules: 37 passed with external GET blocked before transport. The original invalid-key test was first reproduced failing under that same guard.
- TypeScript and production Vite build passed. Ruff check and format passed (1,429 files). Workflow YAML/security/matrix assertions and diff checks passed.
- Agent-runner reconciliation preparation: 113 existing synthetic tests and 3 focused probes passed. No function was deployed.

## Failed / Unverified

- Local rendered verification could not run: agent-browser Chrome installation failed certificate validation; the alternative trusted-CA Node/Playwright installer received invalid/truncated Chromium ZIPs. No rendered pass is claimed. Actual-page Mac onboarding regressions remain CI acceptance checks.
- No owner Mac is paired, online or browser-ready in the last read. A macOS CI runner or mocked `/usr/bin/open` is not owner-device acceptance.
- Exact new-head CI remains required. Previous old-head red jobs were cancelled before reaching a runner; that is not a demonstrated assertion failure. The old source also retains the now-reproduced Granola test egress defect, so do not repeat its broad test run.

## Production/source evidence

- `firboai.app`: READY production `dpl_6cwk52JS3rP8xnwajnACZDoEe4hw`, source `be8669538eb559661dede8ad18d1661e7b260894` in the last read.
- Vercel audit records show explicit promotion/redeploy from preview `dpl_2vHkxp3Vng28uuyExqRFEPbyqAx1` at 20:06 UTC, followed by alias assignment. The account attribution cannot distinguish a human from an agent token. No automatic production-branch release was demonstrated.
- Connector v17 matches source; agent-chat v26 differs only in equivalent Unicode regex spelling. Agent-runner v65 still lacks bounded successful output previews in two files. Candidate dependency closure and exact rollback were prepared privately; deploy only after the CI gate and read back the result. No repeated migrations.

## Remains / next gate

1. Exact committed-source CI, including Mac local execution and actual-page onboarding.
2. Agent-runner reconciliation, read-back and rollback evidence.
3. On the owner's Mac mini: current Connector download, Node 22.13+, fresh browser-only code, `pair`, then a running `run` process. Verify fresh heartbeat/capabilities, actual browser launch, durable receipt, restart/offline and revoke.
4. Then continue the unchanged sequence: visible scoped browser executor; useful-work artifact/read-back/receipt; Knowledge/Skills/Workflows/OAuth; Free hardening; voice/Desktop/security/backup/monitoring/mobile/languages; final production assessment.

Do not equate SOURCE, local automated, rendered, real-device or LIVE evidence. Do not merge the CI-only PR, silently promote production, or grant file/shell permissions merely to open a browser. Physical installation/login/OS permissions remain owner-only when no authorized local tool exists.
