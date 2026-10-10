"""Verify the FIRBO candidate-staging guard remains non-deploying."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "deploy/hostinger/firbo_stage_native_image.sh"


def test_stage_script_blocks_automatic_production_promotion():
    script = SCRIPT.read_text()
    assert "mode_must_be" not in script  # avoid the old hidden dispatch path
    assert '[[ "$mode" == "preflight" || "$mode" == "stage" ]]' in script
    assert 'running_image_must_be_sha256' in script
    assert 'production_image_changed_stop' in script
    assert 'asgi_command_has_changed' in script
    assert 'native_source_not_approved' in script
    assert 'not_in_git_checkout' in script
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
