# U3 continuation: OCI artifact compatibility, not a production rollout

Date: 2026-10-03. Continues draft PR #9, branch codex/firbo-unified-gateway.
Base: d58aa54b195340c4bc4f03c77031d2785650f4df. Do not restart prior audits.

## Owner evidence received

The checksum-pinned prior continuation returned `status: blocked`, `error: invalid_oci_config` at 2026-10-03T03:51:19.704367+00:00. It also reported configuration_matches_live=true and true checks for the Firbo origin, Supabase project, public key presence and both gateway keys. keys_distinct=false means the two API-container environment variables have the SAME value. This is not a live key-scope verification and is not the cause of the local archive format error.

These are owner-supplied results, not an assistant terminal session. No successful real image verification or recovery pass is claimed. The backup archives remain on the owner's server; no private archives, raw configuration, keys or model data were requested.

## Root cause established in code; actual archive subtype still unconfirmed

The previous verifier applied an image-only config-media-type check to every manifest in an OCI index. Docker's current attestation format can have a separate artifact manifest with `application/vnd.oci.empty.v1+json` as config, an artifactType, a subject reference, and in-toto payload layers. The OCI specification also supports opaque non-image configs. These are not runnable container configs and should not be misclassified as malformed image configs.

A synthetic archive following Docker's documented empty-config attestation structure reproduces EXACTLY `invalid_oci_config` in the previous script. The updated verifier passes that case while separately counting one runnable image and one artifact. This is a reproduced implementation defect, NOT proof that this specific format is in the owner's unread archive. The new diagnostics will identify the safe category/stage if another case is encountered.

## Changed

- Update the EXISTING standalone recovery_continue.py; no additional runtime package or helper download is required.
- Separate runnable image manifests/configs from OCI artifacts and legacy BuildKit attestation manifests.
- Verify artifact blob sizes/hashes without accepting artifact or attestation-config digests as the requested API image identity. An artifact-only subindex cannot borrow a sibling image to pass the identity check.
- Support the canonical empty JSON descriptor, including its exact embedded two-byte representation. Embedded content never masks a present corrupt blob. Non-empty/incorrect empty descriptors still fail.
- Preserve unknown non-image config payloads as opaque bytes for hash verification; do not parse them as image JSON.
- Retain full referenced payload hash checks, path/symlink/duplicate-member rejection and bounded metadata reads. Validate repeated descriptors rather than allowing a malformed cached alias.
- Validate runnable config platform/rootfs shape and keep artifacts out of the runnable count. Uncompressed layer diff-ID checking and application boot testing are explicitly NOT claimed.
- Add image_diagnostics to verifier failures: fixed stage/category labels, counts and booleans ONLY. No Docker environment, config values, artifact annotations, attestation payloads or raw exception messages are emitted.
- Add 22 artifact/diagnostic/continuation tests and a corresponding step in the existing read-only diagnostic workflow.

## Tested / passed locally

67 recovery-related tests: 26 original checkpoint tests + 19 previous continuation tests + 22 new artifact tests. Python byte compilation passed. The prior verifier produced invalid_oci_config on the same synthetic empty-attestation archive that the new verifier accepts.

Tests cover canonical/inline empty configs, legacy dummy configs, binary opaque configs, corrupted/missing attestation blobs, artifact-only identity rejection, wrong repeated descriptor sizes, invalid runnable configs, preservation of existing archives and secret-free diagnostics through the complete continuation handler.

Script Git blob: bc9acacf2703c53653bbcbdaa2f2b9eb5289f521.
Script SHA-256: 7380cbf1b66c90c2a42fdfe1b339d6a733eb45814d6aecf80990b62b723ab950.
The uploaded script blob was checked against the locally tested file. CI is a separate verification after this commit; record its actual result in the PR conversation.

No real Docker archive/runtime is available in the assistant execution environment. A supplemental anonymous registry connectivity check could not resolve DNS; no downloaded registry fixture or remote-image test is claimed. All archive tests above use synthetic data derived from the primary format specifications.

## Next owner action

Run this version against the SAME existing private checkpoint directory using the pinned download/checksum command in the delivery message. Do not re-export, rerun the old --capture, delete archives, change keys/permissions, run git pull or restart containers.

Expected success remains contract=firbo-recovery-resume/v1 and status=verified_existing_checkpoint. On success, image_verification.verifier_version is oci-artifacts-v2. On a verifier failure, image_diagnostics includes the fixed stage/config category and counters so the next diagnosis does not rely solely on a generic error string.

Send ONLY the safe JSON report, including image_diagnostics if present. Never send .private.tar, .env, raw Docker inspect, OAuth tokens or API keys. This does not ask for the prior browser Gateway symptom again; that separate investigation and all earlier feature requests remain recorded in the incident checkpoint.

## Side effects / exact limits

The script reads private configuration LOCALLY and compares it with the existing checkpoint. It reads/hashes the existing image archive. If all checks succeed, it adds root-only report/checksum files in the existing protected directory. It never replaces the original archives.

No docker save/export/load/run/exec/build/pull/restart/stop, external network call, database access, remote upload, provider request, credential change or production deployment is performed by the script. Reading/hash verification uses disk I/O. The temporary downloaded script is an additional local file.

This remains a LOCAL CONFIGURATION + API-IMAGE check only. No database/volume backup, encrypted off-host copy, restoration of app state or application boot test has been completed. Artifact content authenticity/semantics and signatures are not checked merely by verifying stored bytes.

## Remains

- Apply the new verifier to the owner's real archive and inspect the result; no assumption of success.
- Keep equal gateway keys as an OPEN security item. Before the gateway routing cutover, replace the shared credential arrangement with verified separate least-privilege inference/management credentials and coordinate updates. Do not rotate a key opportunistically during archive diagnosis.
- Complete consistent data backups, encrypted off-host recovery, isolated restore/boot, matching backend/frontend installation and real account/gateway tests before production promotion.
- Retain mission/audio consolidation, durable request accounting/atomic budgets, native provider lifecycle, migrations, MCP/shift hardening, monitoring, mobile/microphone QA and the requested TikTok/YouTube/Salesforce/QuickBooks adapters from the existing plan. None is silently marked completed here.

## Primary references consulted

- https://docs.docker.com/build/metadata/attestations/attestation-storage/
- https://docs.docker.com/build/metadata/attestations/
- https://specs.opencontainers.org/image-spec/manifest/
- https://github.com/opencontainers/image-spec/blob/main/manifest.md

No frontend, deployed Supabase function/schema, real agent routing, gateway configuration, domain or unrelated sports-product change is part of this commit.
