"""Verify the FIRBO candidate-staging guard remains non-deploying."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "deploy/hostinger/firbo_stage_native_image.sh"


def test_stage_script_blocks_automatic_production_promotion():
    script = SCRIPT.read_text()
    assert "mode_must_be" not in script  # avoid the old hidden dispatch path
    assert '[[ "$mode" == "preflight" || "$mode" == "stage" ]]' in script
    assert "running_image_must_be_sha256" in script
    assert "production_image_changed_stop" in script
    assert "asgi_command_has_changed" in script
    assert "native_source_not_approved" in script
    assert "not_in_git_checkout" in script
    assert "FIRBO_SOURCE_REPO" in script
    assert 'git -C "$root" archive --format=tar "$commit"' in script
    assert "--build-arg FIRBO_NATIVE_ROUTE_ATTEST=1" in script
    assert "--network none --read-only" in script
    assert "anonymous_post_not_denied" in script
    assert "insufficient_docker_disk_use_offhost_build" in script
    assert "insufficient_available_memory_use_offhost_build" in script
    assert "candidate_tag_exists_review_before_retry" in script
    assert "docker compose up" not in script
    assert "docker container restart" not in script
    assert "docker exec" not in script
    assert "docker push" not in script
    assert "supabase db" not in script.lower()
    assert "chmod 777" not in script


def test_read_only_preflight_refuses_drift_and_never_mutates_docker(tmp_path):
    import os
    import subprocess

    image = "sha256:" + "a" * 64
    wrong_image = "sha256:" + "b" * 64
    sha = subprocess.check_output(
        ["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True
    ).strip()
    fakebin = tmp_path / "bin"
    fakebin.mkdir()
    calls = tmp_path / "docker-calls"
    fake = fakebin / "docker"
    fake.write_text(
        """#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FIRBO_DOCKER_LOG"
if [[ "$1" == inspect && "$2" == --type ]]; then
  if [[ "$*" == *'.Image'* ]]; then
    echo "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  elif [[ "$*" == *'.State.Running'* ]]; then
    echo true
  elif [[ "$*" == *'.Config.Cmd'* ]]; then
    echo '["openjarvis.server.firbo_free_app:app","--host","0.0.0.0","--port","8000"]'
  else
    exit 30
  fi
elif [[ "$1" == image && "$2" == inspect ]]; then
  exit 0
elif [[ "$1" == info ]]; then
  echo /tmp
else
  echo 'unexpected_docker_operation' >&2
  exit 31
fi
"""
    )
    fake.chmod(0o700)
    env = {
        **os.environ,
        "PATH": str(fakebin) + os.pathsep + os.environ["PATH"],
        "FIRBO_SOURCE_REPO": str(ROOT),
        "FIRBO_DOCKER_LOG": str(calls),
    }
    valid = subprocess.run(
        ["bash", str(SCRIPT), "preflight", sha, image],
        text=True,
        capture_output=True,
        env=env,
        cwd=ROOT,
        check=False,
    )
    assert valid.returncode == 0, valid.stderr
    assert "production_unchanged=true" in valid.stdout
    assert "stage_performed=false" in valid.stdout
    attempted = calls.read_text().splitlines()
    assert attempted
    assert all(" build " not in " " + item + " " for item in attempted)
    assert all(" restart " not in " " + item + " " for item in attempted)
    assert all(" tag " not in " " + item + " " for item in attempted)

    drift = subprocess.run(
        ["bash", str(SCRIPT), "preflight", sha, wrong_image],
        text=True,
        capture_output=True,
        env=env,
        cwd=ROOT,
        check=False,
    )
    assert drift.returncode != 0
    assert "production_image_changed_stop" in drift.stderr
    assert "stage_performed=true" not in drift.stdout
