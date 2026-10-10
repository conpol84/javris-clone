# FIRBO — one-system OmniRoute isolated production-image canary

Date: 2026-10-10. This is a source-only Draft descendant of FIRBO PR146 and does NOT mutate production.

## Ground truth inherited, not re-audited

OmniRoute public fork Draft PR1 exact source head 26e14038151e8e74c825334a33b77702286892ab already passed 28/28 actual API-key creation/scopes and CLIENT_API restriction tests, targeted TypeScript, modified-source lint via FIRBO PR145. FIRBO PR144 already fixed the independent 100-tool discovery truncation, returning only the five reviewed read-only tools.

Owner's live OmniRoute MCP status authenticated HTTP200 with streamable-http and enforced scopes, tools/list 110/110 and five allowlisted names present; first `omniroute_get_health` produced correctly audited `scope_denied:missing_scopes` because the old key lacked `read:health`. No successful tool execution yet. The production gateway has NOT received OmniRoute PR1's new in-app key-preset code. FIRBO MCP pilot remains OFF and FIRBO production Supabase mcp v25.

Full source Next.js compilation once **SUCCEEDED**, produced 618/618 prerendered pages and compiled the API Manager UI, but that GH run went red because its hand-written find|grep -q verifier caused SIGPIPE; subsequent hosted attempts failed V8 OOM or received runner shutdown. Upstream OmniRoute's own .github/workflows/build.yml says ordinary hosted runners cannot reliably compile the monorepo (19/30 shutdowns), and uses a roughly 31GB self-hosted builder. PR146 now passes source/provenance/SAST/backend gates but intentionally SKIPS the full UI job absent a dedicated high-RAM builder. A skipped full build is NOT a pass.

## Changed in this Draft: real runnable Docker candidate and private smoke

The existing Dockerfile creates the full `runner-base` Node26 image with real native SQLite binding, complete Next.js UI/API route graph and standalone assets. The reviewed canary script is deploy/hostinger/firbo_omni_isolated_docker_canary.sh. It only executes on an explicitly authorized isolated self-hosted GitHub runner labeled `firbo-omni-build`, with at least 30GiB physical RAM, 35GiB Docker free disk and EMPTY local Docker daemon. A remotely pointed Docker context, any live/running container, an unexpected Git origin, SHA drift, or dirty source results in an immediate stop.

The candidate never uses Hostinger production. It builds the fixed exact reviewed SHA with Docker BuildKit, 12GiB V8 heap and one worker, no image push or login. It starts the image under `--network none` with no published ports, no host volume mounts or secrets; only a disposable 256MiB /app/data tmpfs and synthetic API key/JWT material, nonroot user, capped 4GB runtime memory and 2 CPUs. It checks Docker HEALTHCHECK and performs bounded localhost-only GET /healthz (expect 200), /api/mcp/status (anonymous must reject), /v1/models (anonymous must reject). It prints only status codes, image ID and fixed commit, never response bodies or credentials. It removes the temporary container/image at end, never prunes other images or volumes.

## Verified vs blocked

The hosted CI job validates Bash syntax and a static restriction contract and must go GREEN before anyone provisions a builder. The true image build + canary job is present but gated behind (a) a push from the exact reviewed FIRBO branch and (b) a deliberately set repository variable `FIRBO_OMNI_HIGH_RAM_BUILDER_APPROVED=true`; it requires a dedicated `self-hosted, firbo-omni-build` label. This variable MUST NOT be enabled before owner authorization, cost approval and verification the runner is an ephemeral isolated builder with no corporate/provider credentials, production Docker socket/mount, live tenant data or private network. Mere GitHub source-test success does not mean an image exists.

If Docker candidate passes, next steps remain: provenance of the immutable candidate, live VPS/OmniRoute read-only image/ports/Compose/volume snapshot, encrypted off-host backup and restore rehearsal, agreed downtime and rollback, owner-authorized same-service rollout, six-scope dedicated MCP key readback and one live health/audit success, followed by the existing FIRBO Supabase mcp Edge permission/tenant audit and owner flag approval. An unverified or failed smoke MUST stop the release.

Separately: the old native Hostinger FIRBO API local Qwen HTTP404 candidate and physical website→CEO→Linux computer/voice/readback remain on Master Issue #52; the recently live Linux connector is paired and advertises full_control and browser_task/desktop_task, but no new physical job was dispatched by this work. No unrelated projects affected.