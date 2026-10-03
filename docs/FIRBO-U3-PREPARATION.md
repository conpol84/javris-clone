# U3 preparation: dependency remediation and safe Hostinger discovery

Date: 2026-10-03. Continues U1/U2 in draft PR #9, branch `codex/firbo-unified-gateway`, targeting `claude/omniroute-engine`.

**This completes the dependency-remediation slice and prepares VPS discovery. It does NOT complete U3 hosting/recovery or authorize a production cutover.**

## Changed

1. Removed the installed `shadcn` CLI dependency after scanning frontend source/config references. The actual application only imported its Tailwind CSS. Local UI components, routes and screens remain untouched.
2. Copied the EXACT `shadcn@4.21.0` CSS export into `frontend/src/styles/vendor/shadcn-tailwind.css`; kept its MIT license and attribution. Updated only its import in `src/index.css`. This preserves the utilities rather than dropping the stylesheet or downgrading the CLI.
3. Regenerated the lockfile through npm 11.19.0. Exactly four retained version entries changed, all patch-level: brace-expansion 5.0.9 -> 5.0.12 and nested 2.1.4 -> 2.1.7; dompurify 3.4.13 -> 3.4.16; fast-uri 3.1.7 -> 3.1.8. No other retained package version changed. 195 installed-package entries were removed with the CLI tree; no new package paths were added. Existing direct dependency declarations other than shadcn are unchanged.
4. Added standalone `deploy/hostinger/preflight.py` and nine diagnostic regression tests. The script reads only selected metadata for the four exact Firbo containers and two fixed public health URLs. It never reads .env, credentials, prompts, application logs or database rows; never executes commands inside a container; never installs, restarts or changes a service.
5. Added a read-only GitHub workflow for the diagnostics tests. Removed the temporary one-shot candidate workflow/script after they produced the tested files. Their implementation remains in Git history; no ongoing write-enabled repair workflow is retained.

## Candidate verification obtained

Evidence: GitHub Actions run 37090708937, job 111110254821. Candidate source parent `9fecf6d5dd8642979b97f6af4f9d0067a2dedbbd`; produced tree `da3adf0faf07591489cf9621253fe4d8d42a5962`.

- Before: npm audit reported 13 package entries (9 high, 3 moderate, 1 low), both full and production-only dependency graphs.
- After: npm audit reported ZERO findings in both graphs, at 2026-10-03 02:42 UTC. This is a point-in-time registry result, not proof of absence of all vulnerabilities.
- A fresh dependency installation passed all 196 existing frontend tests plus 94 native/routing/handler tests (11 + 43 + 40).
- Isolated Edge SDK-stub typecheck, full frontend TypeScript project check and production Vite/PWA build passed.
- Compiled application CSS before/after was BYTE-IDENTICAL: SHA-256 `2d08619059340e9d351415f2972eb57eabd44546dd1e6b9fd491003b9b4d0b74`.
- The nine preflight tests passed locally with mocked processes/network. The script Git blob is `5e90ea36ad638b1a35e4c8522bb7e94c0cff7eaa`, and its SHA-256 is `5991711ca8bd53e834a10531b3148861abc4682bb6c7a51d46878930a9e794a4`.
- Final normal branch CI is a SEPARATE check, recorded after this commit. A passing one-shot candidate is not a claim that every final workflow has passed.

Machine-readable change/audit/CSS evidence: `docs/FIRBO-DEPENDENCY-REMEDIATION.json`.

The first candidate attempt stopped at an overly strict source scan that treated a CSS comment as a package import. The check was corrected to ignore block comments; the code-use, exact-CSS, version-scope and zero-advisory requirements were not weakened. No failed candidate changed dependencies on the working branch or in production.

## Owner action: safe VPS discovery

1. In the Hostinger account, open VPS -> Manage for the ACTUAL Firbo server -> Overview -> Web Console. Do not choose a different project's VPS. Do not reboot or run an existing repair/setup script.
2. Download `deploy/hostinger/preflight.py` from the exact reviewed commit, verify SHA-256 above, and run it with python3. Use the pinned command in the current delivery message, or inspect and upload the script manually. This requires no third-party Python packages.
3. Send only the resulting JSON report. If Python/curl/Docker is unavailable or permissions fail, send that error and stop; do not install software or change Docker permissions yet.

The downloader creates a temporary diagnostic script; the script does not modify production configuration or data. It does not prove backup/restore, authentication, inference, provider key permissions or persistence after restart. Missing containers may mean a different deployment layout, not necessarily a failed service. A successful public health response is not a successful agent request.

Never paste .env, tokens, passwords, provider keys or a full unfiltered docker inspect into chat.

## Not changed

No production frontend promotion, Supabase function/schema/data change, provider/agent setting, credential, DNS or Hostinger container change. No real AI inference request or paid service was created. No TradeAthletes, PlayersFX or PickFantasy infrastructure was touched. The active production version must be checked again before any later rollout; the preserved baseline is `50bea79`.

## Remaining gates

- Authorized discovery of the actual VPS, running image/version verification, isolated matching API deployment, exact preview-origin authorization, backup restore and rollback rehearsal.
- Real-account end-to-end verification of native controls and one budget-limited gateway request, including request-ID and fallback evidence.
- Mission/audio/legacy-path consolidation, durable server-owned request accounting and atomic budget reservation, provider/OAuth/key lifecycle, tenant cost isolation.
- Migration reconciliation, prior MCP/scheduler hardening, monitoring, real company/role isolation tests, mobile and physical microphone QA, outstanding page/feature matrix.
- Existing oversized bundles, ineffective dynamic imports and deprecation warnings remain. No performance baseline improvement or warning-free build is claimed by this change.

No promotion until these gates are met. Continue with the production plan, not a fresh audit.

## References

- Candidate CI: https://github.com/conpol84/javris-clone/actions/runs/37090708937
- shadcn eject pattern: https://ui.shadcn.com/docs/cli#eject
- Hostinger Web Console: https://www.hostinger.com/support/how-to-use-the-web-console-in-hostinger/
- npm audit: https://docs.npmjs.com/cli/audit.html/
