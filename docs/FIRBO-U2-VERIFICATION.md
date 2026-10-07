# Firbo unification U2 — verification and handoff

Checked: 2026-10-03. Continue the existing PR #9; do not restart the audit.

## Changes saved

- Repository: `conpol84/javris-clone`.
- Branch: `codex/firbo-unified-gateway`; draft PR #9 targets `claude/omniroute-engine`.
- U2 implementation: `21389de0f4f257bf2be566d43555c8a2dad184d4`.
- Final tested code/configuration: `0b146ed870d84a76a514948beb097959452d5713`.
- Base before U2: `8c10f3a8b672bfceaa0c478fb4192ac9ff5badd2` (U1 retained).
- Full plan: `docs/FIRBO-PRODUCTION-PLAN.md`.
- Compared base to tested head: 11 changed files, no frontend screen/navigation changes, no package manifest/lockfile changes and no database migrations.

U2 adds the common gateway selector/client used by chat and task execution, selected-agent canary configuration, bounded/cancellable requests, sanitized routing traces, fail-closed budget-query handling and explicit persistence failures. It retains legacy routing by default and preserves the existing authentication, organization checks, cron authentication and approval behavior.

The shared route makes one application-level request to OmniRoute. It does not silently retry directly against another AI provider. Internal combo fallback is explicitly marked unverified until the actual gateway logs can be correlated.

## Passed

| Check | Result | Evidence |
|---|---|---|
| Existing frontend suite | 196 tests pass | Initial U2 job 111104896565 output; repeated npm test step succeeds in final job 111105522188 |
| U1 native control contract/input/languages | 11 tests pass | Initial U2 CI output; final CI step succeeds; local repeat also 11/11 |
| New routing policy/transport tests | 43 pass | Local run and the combined CI output |
| New actual chat/task handler tests with mocked services | 40 pass | Local run and the combined CI output: 83/83 new tests |
| U1 Python/ASGI security regressions | 26 pass locally; final security workflow succeeds | Local repeat 26/26; workflow 37089136235 |
| Isolated strict Edge TypeScript check | Pass | Final Frontend CI job 111105522188, explicit project configuration |
| Full frontend TypeScript project check | Pass | Final job step `npx tsc -b` |
| Full frontend production build | Pass | Final job step `npm run build:tauri` |
| Existing static-security jobs | All returned jobs succeed | Run 37089136245: Bandit, Semgrep and six pip-audit variants |
| Production identity check | Still READY on original production SHA 50bea79 | Vercel get_deployment for firboai.app returned dpl_8MfPgVXcD8oPWSp4JsU9JJd2Vdxd |

Final Frontend CI: https://github.com/conpol84/javris-clone/actions/runs/37089136252
Final control-plane security: https://github.com/conpol84/javris-clone/actions/runs/37089136235
Static-security jobs: https://github.com/conpol84/javris-clone/actions/runs/37089136245

The isolated Edge type check uses a clearly identified Supabase SDK stub. It is not verification against the real SDK/Deno deployment runtime. Handler tests mock authentication, database responses and network calls; they do not prove live RLS or account integration. Tests made no AI-provider calls and used no real account credentials.

## Failed, diagnosed and fixed

The first U2 frontend run passed 196 existing tests, 11 native tests and all 83 new tests, then stopped at TypeScript TS5112. The command specified source files from a working directory that already contained a tsconfig.

Configuration fix `0b146ed` adds `tests/firbo/tsconfig.edge.json` and invokes the compiler with `--project`. The strict checks remain enabled; no test is skipped to make the build green. The final frontend run passes the isolated check, full project check and production build.

Initial run: https://github.com/conpol84/javris-clone/actions/runs/37088929619

## Failed and STILL OPEN: dependency release gate

The new dependency job is intentionally nonzero when npm reports high or critical vulnerabilities. The advisory request itself succeeded; this is not a connectivity or parser failure.

Detailed report retrieved at 2026-10-03 02:11:52 UTC:

| Scope | Low | Moderate | High | Critical | Total |
|---|---:|---:|---:|---:|---:|
| All dependencies | 1 | 3 | 9 | 0 | 13 |
| npm production dependency graph (`--omit=dev`) | 1 | 3 | 9 | 0 | 13 |

Source: run 37088929588, job 111104896457.
https://github.com/conpol84/javris-clone/actions/runs/37088929588
The subsequent gate at tested head also fails: run 37089136243.
https://github.com/conpol84/javris-clone/actions/runs/37089136243

Reported high-severity package entries: `@ts-morph/common`, `brace-expansion`, `braces`, `fast-glob`, `js-yaml`, `micromatch`, `shadcn`, `ts-morph`, `undici`.
Moderate entries: `fast-uri`, `hono`, `ip-address`. Low entry: `dompurify`.

These are npm dependency-graph findings, not a claim that all are reachable in the browser bundle or that an exploit occurred. Several high entries are propagated through the same shadcn/tooling dependency chain. Some npm remediation suggestions propose changing shadcn to 1.0.0; no such unreviewed downgrade was applied.

Next dependency work: determine actual runtime/tooling usage and dependency parents, check maintainer advisories and compatible fixes, regenerate the lockfile through npm, and repeat all tests plus both audit scopes. Removing an unused tooling dependency is preferable to shipping it unnecessarily, but its usage must first be checked. Moving a package to devDependencies alone does not resolve its vulnerability in the build environment. Do not run `npm audit fix --force` blindly.

No package versions were changed by U2. The release gate remains red; existing branch protection was not changed, so this is a failing CI check and a release-policy block, not a claim that every external deployment path is technically disabled.

## Not changed in production

Production remains `50bea79134fb28aacc9d5d3fcd949ba8d8239d78`. No production frontend promotion, Supabase function deployment, SQL mutation, provider key/secret setting, agent model selection, domain change or Hostinger container restart was performed. No unrelated sports-product infrastructure was touched.

The only live Supabase query in this stage read table-column metadata to avoid inventing fields. The existing usage table has no durable per-request trace/idempotency ledger; U2 did not add one.

## Remaining before production

- Review and fix the dependency findings; keep the red check visible.
- Obtain authorized terminal access to the actual Firbo Hostinger VPS, identify running versions, prepare an isolated matching backend, and verify backup restore/rollback before cutover. Do not paste passwords or API keys into chat.
- Test one bounded, selected-agent request with a real Firbo account and correlate it with gateway records; verify actual key scopes, request-ID retention, model compatibility and fallback behavior.
- Consolidate mission planning/synthesis, STT/TTS and any remaining legacy inference paths. The new mode currently applies only to chat and task handlers.
- Add a server-owned durable request ledger and atomic budget reservations. Current task markers and logs are interim safeguards, not exactly-once accounting; failed gateway requests may still incur cost.
- Complete native provider/OAuth/key lifecycle, scoped company cost/quotas, migration reconciliation, MCP and shift hardening, monitoring, real tenant/mobile/microphone tests and the remaining page-by-page matrix.

## Decision / next checkpoint

**U2 shared-routing candidate is implemented and build-tested. Production release is blocked.**

Start the next work unit with dependency triage and the actual Hostinger deployment prerequisite. Preserve U1/U2 and continue with the staged plan. Do not replace firboai.app with a frontend whose matching backend and real-account behavior remain unverified.
