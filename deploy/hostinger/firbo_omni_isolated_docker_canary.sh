#!/usr/bin/env bash
# OFF-HOST, source-pinned, disposable OmniRoute image canary. Never target
# Hostinger production or the existing FIRBO/OmniRoute Docker services.
# Requires an owner-approved isolated, EMPTY Docker builder >=30 GiB RAM.
set -euo pipefail

fail() { printf 'FIRBO_OMNI_CANARY_STOP=%s\n' "$1" >&2; exit 2; }

[ "$#" -eq 2 ] || fail "exactly_source_dir_and_commit_required"
SOURCE_DIR="$1"
EXPECTED_SHA="$2"
PINNED_SHA="26e14038151e8e74c825334a33b77702286892ab"

[ "$EXPECTED_SHA" = "$PINNED_SHA" ] || fail "unreviewed_source_sha"
[ -d "$SOURCE_DIR/.git" ] || fail "source_git_missing"
[ "$(git -C "$SOURCE_DIR" rev-parse HEAD)" = "$PINNED_SHA" ] || fail "git_head_not_pinned"
[ "$(git -C "$SOURCE_DIR" remote get-url origin)" = "https://github.com/conpol84/OmniRoute" ] ||
  fail "unexpected_source_origin"
[ -z "$(git -C "$SOURCE_DIR" status --porcelain)" ] || fail "source_worktree_dirty"
[ -f "$SOURCE_DIR/Dockerfile" ] || fail "pinned_dockerfile_missing"

# No unreviewed Docker daemon or live containers. A label alone cannot prove
# physical isolation: owner must verify a disposable machine BEFORE enabling CI.
[ -z "$(printenv DOCKER_HOST || true)" ] || fail "remote_docker_host_forbidden"
[ "$(docker context show)" = "default" ] || fail "nondefault_docker_context"
docker info >/dev/null || fail "docker_unavailable"
[ -z "$(docker ps -q)" ] || fail "builder_has_running_containers"

ram_kib="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
[[ "$ram_kib" =~ ^[0-9]+$ ]] || fail "ram_unreadable"
[ "$ram_kib" -ge $((30 * 1024 * 1024)) ] || fail "builder_under_30GiB_ram"

docker_root="$(docker info --format '{{.DockerRootDir}}')"
[ -n "$docker_root" ] || fail "docker_storage_unknown"
disk_kib="$(df -Pk "$docker_root" | awk 'NR == 2 {print $4}')"
[[ "$disk_kib" =~ ^[0-9]+$ ]] || fail "docker_free_disk_unreadable"
[ "$disk_kib" -ge $((35 * 1024 * 1024)) ] || fail "docker_free_disk_under_35GiB"

IMAGE_TAG="firbo-omni-test:source-26e1403815"
CANARY_NAME="firbo-omni-disposable-canary-$$"
created_image=0
cleanup() {
  docker rm -f "$CANARY_NAME" >/dev/null 2>&1 || true
  if [ "$created_image" = "1" ]; then
    docker image rm "$IMAGE_TAG" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

# Full production standalone and real native SQLite assets. Do NOT use the
# source-only Next compile stubs (OMNIROUTE_SKIP_STANDALONE is intentionally
# absent). Never push the image, use registry credentials or upload artifacts.
DOCKER_BUILDKIT=1 docker build \
  --pull \
  --target runner-base \
  --build-arg OMNIROUTE_USE_TURBOPACK=1 \
  --build-arg OMNIROUTE_BUILD_MEMORY_MB=12288 \
  --build-arg OMNIROUTE_BUILD_WORKERS=2 \
  --tag "$IMAGE_TAG" \
  "$SOURCE_DIR"
created_image=1

IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE_TAG")"
[[ "$IMAGE_ID" == sha256:* ]] || fail "image_digest_unavailable"

# The canary gets ZERO host ports, network or persistent volumes. The tmpfs is
# destroyed when the container is removed. No production keys or provider
# credentials ever enter the image/run. Nobody may attach Docker socket.
docker run --detach --name "$CANARY_NAME" \
  --network none \
  --memory 4g --cpus 2 --pids-limit 256 \
  --tmpfs /app/data:rw,nosuid,nodev,size=256m,uid=1000,gid=1000 \
  --env NODE_ENV=production \
  --env REQUIRE_API_KEY=true \
  --env DATA_DIR=/app/data \
  --env OMNIROUTE_DISABLE_CLOUD_SYNC=true \
  --env OMNIROUTE_MCP_ENFORCE_SCOPES=true \
  --env API_KEY_SECRET="firbo-disposable-test-api-key-20261010" \
  --env JWT_SECRET="firbo-disposable-test-jwt-20261010" \
  "$IMAGE_TAG" >/dev/null

healthy=0
for _ in $(seq 1 90); do
  state="$(docker inspect --format '{{.State.Status}}' "$CANARY_NAME")"
  [ "$state" = "running" ] || fail "canary_exited_before_health"
  health="$(docker inspect --format '{{.State.Health.Status}}' "$CANARY_NAME")"
  if [ "$health" = "healthy" ]; then
    healthy=1
    break
  fi
  [ "$health" != "unhealthy" ] || fail "canary_healthcheck_failed"
  sleep 2
done
[ "$healthy" -eq 1 ] || fail "canary_healthcheck_timeout"

# Probe inside the network-isolated container only. Never ask for real tokens,
# never print response bodies/provider catalogs or send any MCP tools/call.
docker exec "$CANARY_NAME" node --input-type=module -e '
  const base = "http://127.0.0.1:20128";
  const path = ["/healthz", "/api/mcp/status", "/v1/models"];
  const status = [];
  for (const p of path) {
    const r = await fetch(base + p, { signal: AbortSignal.timeout(4500) });
    status.push(r.status);
    await r.body?.cancel();
  }
  if (status[0] !== 200 ||
      ![401,403].includes(status[1]) ||
      ![401,403].includes(status[2])) {
    process.stderr.write("FIRBO_OMNI_CANARY_STOP=auth_or_health_contract_failed\n");
    process.exit(3);
  }
  process.stdout.write(JSON.stringify({
    canary: "passed",
    healthz_http: status[0],
    anonymous_mcp_http: status[1],
    anonymous_models_http: status[2],
    external_network: false,
    host_ports: 0,
    live_volumes: 0,
    credentials: "synthetic_only",
    mcp_tools_executed: 0,
    production_changed: false
  }) + "\n");
'
printf 'FIRBO_OMNI_CANARY_IMAGE=%s\n' "$IMAGE_ID"
printf 'FIRBO_OMNI_CANARY_SOURCE=%s\n' "$PINNED_SHA"
printf '%s\n' 'FIRBO_OMNI_IMAGE_DISPOSABLE_NOT_PUBLISHED=true'
