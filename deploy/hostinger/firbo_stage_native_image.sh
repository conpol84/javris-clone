#!/usr/bin/env bash
# FIRBO stage-only native image release gate. Never deploy/restart containers.
# bash deploy/hostinger/firbo_stage_native_image.sh preflight|stage SOURCE_SHA EXPECTED_IMAGE_ID
set -euo pipefail
umask 077
die() { printf 'firbo_stage_error=%s\n' "$1" >&2; exit 1; }
[ "$#" -eq 3 ] || die "expected_mode_commit_and_running_image"
mode="$1"; commit="$2"; expected_image="$3"
[[ "$mode" == "preflight" || "$mode" == "stage" ]] || die "unsupported_mode"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || die "commit_must_be_exact_sha"
[[ "$expected_image" =~ ^sha256:[0-9a-f]{64}$ ]] || die "running_image_must_be_sha256"
for tool in docker git tar awk; do command -v "$tool" >/dev/null || die "missing_dependency"; done

root_hint="${FIRBO_SOURCE_REPO:-$(dirname "$0")/../..}"
root="$(git -C "$root_hint" rev-parse --show-toplevel 2>/dev/null)" ||
  die "not_in_git_checkout"
resolved="$(git -C "$root" rev-parse --verify "$commit^{commit}" 2>/dev/null)" ||
  die "commit_not_fetched"
[ "$resolved" = "$commit" ] || die "commit_drift"
reviewed_blob="edf940a67f8881e7bd828ed8a956252f2a8c67de"
blob="$(git -C "$root" rev-parse --verify "$commit:src/openjarvis/server/firbo_free_app.py" 2>/dev/null)" ||
  die "missing_native_module"
[ "$blob" = "$reviewed_blob" ] || die "native_source_not_approved"

image="$(docker inspect --type container firbo-api --format '{{.Image}}' 2>/dev/null)" ||
  die "firbo_api_absent"
[ "$image" = "$expected_image" ] || die "production_image_changed_stop"
running="$(docker inspect --type container firbo-api --format '{{.State.Running}}')" ||
  die "container_status_unavailable"
[ "$running" = true ] || die "firbo_api_not_running"
cmd="$(docker inspect --type container firbo-api --format '{{json .Config.Cmd}}')" ||
  die "command_status_unavailable"
[[ "$cmd" == *'"openjarvis.server.firbo_free_app:app"'* ]] ||
  die "asgi_command_has_changed"
docker image inspect "$image" >/dev/null 2>&1 || die "rollback_image_absent"

docker_root="$(docker info --format '{{.DockerRootDir}}')" || die "docker_root_unknown"
free_disk_kb="$(df -Pk "$docker_root" | awk 'NR==2 {print $4}')" ||
  die "disk_status_unavailable"
free_mem_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)" ||
  die "memory_status_unavailable"
[[ "$free_disk_kb" =~ ^[0-9]+$ && "$free_mem_kb" =~ ^[0-9]+$ ]] ||
  die "invalid_resource_status"
printf 'contract=firbo-native-stage/v1\nmode=%s\nsource_commit=%s\n' "$mode" "$commit"
printf 'reviewed_module_blob=%s\nrunning_image=%s\n' "$blob" "$image"
printf 'docker_free_disk_kb=%s\navailable_memory_kb=%s\n' "$free_disk_kb" "$free_mem_kb"
if [ "$mode" = preflight ]; then
  printf 'stage_performed=false\nproduction_unchanged=true\n'
  exit 0
fi

# Do not contend with production on undersized hosts. Build off-host instead.
(( free_disk_kb >= 12582912 )) || die "insufficient_docker_disk_use_offhost_build"
(( free_mem_kb >= 4194304 )) || die "insufficient_available_memory_use_offhost_build"
image_hex="$(printf '%s' "$image" | cut -d: -f2)"
rollback_tag="firbo-native-rollback:$image_hex"
candidate_tag="firbo-native-candidate:$commit"
if docker image inspect "$candidate_tag" >/dev/null 2>&1; then
  die "candidate_tag_exists_review_before_retry"
fi
if docker image inspect "$rollback_tag" >/dev/null 2>&1; then
  mapped="$(docker image inspect "$rollback_tag" --format '{{.Id}}')"
  [ "$mapped" = "$image" ] || die "rollback_tag_conflict"
else
  docker image tag "$image" "$rollback_tag"
fi
printf 'rollback_tag=%s\n' "$rollback_tag"

tmp="$(mktemp -d /var/tmp/firbo-native-stage.XXXXXXXX)" ||
  die "cannot_stage_source"
trap 'rm -rf -- "$tmp"' EXIT

# git archive contains only committed source at the explicitly reviewed SHA:
# no private .env, old logs, gateway credentials or local checkout changes.
git -C "$root" archive --format=tar "$commit" | tar -xf - -C "$tmp"
[ -f "$tmp/deploy/docker/Dockerfile" ] || die "candidate_dockerfile_missing"
docker build --pull=false --build-arg FIRBO_NATIVE_ROUTE_ATTEST=1 \
  --label "org.firbo.source_commit=$commit" \
  -f "$tmp/deploy/docker/Dockerfile" -t "$candidate_tag" "$tmp"

# The candidate is tested with NO internet, host volumes, secrets or ports.
docker run --rm -i --network none --read-only \
  --security-opt no-new-privileges --cap-drop ALL \
  --pids-limit 128 --memory 768m \
  --entrypoint python "$candidate_tag" -B - <<'PY'
import hashlib, importlib, json
from pathlib import Path
from fastapi.testclient import TestClient

expected = "edf940a67f8881e7bd828ed8a956252f2a8c67de"
route = "/v1/firbo/free/local/chat/completions"
module = importlib.import_module("openjarvis.server.firbo_free_app")
raw = Path(module.__file__).read_bytes()
blob = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
assert blob == expected, "installed_source_differs"
assert any(getattr(r,"path",None)==route and "POST" in
           (getattr(r,"methods",None) or set()) for r in module.app.routes), "route_missing"
with TestClient(module.app) as client:
    assert client.get(route).status_code == 405, "route_get_not_405"
    response = client.post(route, json={
        "organization_id":"00000000-0000-4000-8000-000000000001",
        "request_id":"00000000-0000-4000-8000-000000000002",
        "messages":[{"role":"user","content":"synthetic"}],
    })
    assert response.status_code == 401, "anonymous_post_not_denied"
print(json.dumps({"installed_source_match":True,"local_post_registered":True,
                  "anonymous_post_denied":True,"network":"disabled"}))
PY
candidate_id="$(docker image inspect "$candidate_tag" --format '{{.Id}}')"
still_running="$(docker inspect --type container firbo-api --format '{{.Image}}')"
[ "$still_running" = "$image" ] || die "concurrent_production_change_detected"
printf 'candidate_id=%s\ncandidate_tag=%s\n' "$candidate_id" "$candidate_tag"
printf 'production_changed_by_script=false\nstage_performed=true\n'
