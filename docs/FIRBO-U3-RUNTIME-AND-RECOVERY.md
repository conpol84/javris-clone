# U3: real runtime identified; next step is a private local configuration/API-image checkpoint

Date: 2026-10-03. Continues the existing production plan and draft PR #9.
Prior head: `6bc25aac77b47c657e2fbac1503bf418164f8813`.
This document supersedes the prior 'run preflight' next-owner-action. The owner has now done it.

## Evidence received from the owner

The owner pasted the JSON from the pinned preflight, with checksum OK and timestamp `2026-10-03T02:56:53.834227+00:00`. This is owner-supplied execution evidence, not an assistant SSH session.

- Four exact containers found: firbo-api, firbo-omniroute, firbo-caddy, firbo-redis, all running.
- OmniRoute and Redis report healthy. API and Caddy have no configured Docker healthcheck; that is not an unhealthy result.
- RestartCount is zero for the current four containers; this does not establish their lifetime uptime or rule out previous container replacements.
- API and gateway public health endpoints return HTTP 200 JSON with status_ok true.
- The Firbo API does not advertise firbo-control/v1. This is consistent with the native backend candidate not yet being installed; health alone does not identify every deployed code file.
- The same false flag on OmniRoute's own health endpoint is not a failure: the Firbo-specific contract need not be advertised by OmniRoute.
- Writable persistent mounts are present for API home and OmniRoute data, plus named volumes for Redis/Caddy. Persistence after restart, data correctness and restore have NOT been tested.
- Docker reports 29.8.2 and Compose 5.5.1 in this execution.

The new capture script pins these exact image IDs and refuses to continue if they changed:

| Container | Image ID |
|---|---|
| firbo-api | sha256:4de8002d27da8b29ddde0d1f0009de623d2530895e36d1e774c01a3baf754574 |
| firbo-omniroute | sha256:a2b9e9405ae4dd4cbbce83468623b98376e7c6d14aa7a04a51afc20c25684da9 |
| firbo-caddy | sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52 |
| firbo-redis | sha256:cd218f4b106a332c5c992e38a9480bfb9d7e9f8f7b0ec9a0023bfa36d9a408f9 |

## Changed in this code-only slice

- Added standalone `deploy/hostinger/recovery_checkpoint.py`, requiring explicit `--capture`.
- Added 26 isolated tests and expanded the existing diagnostic CI workflow. It executes only tests with mocked Docker and synthetic files, never a real VPS capture.
- No frontend, Edge Function, database, routing, credentials, provider, domain or production runtime change.
- U1/U2 and the dependency remediation are retained. No new audit from zero.

## Exact scope and side effects of the next owner command

This is NOT another read-only preflight: it creates PRIVATE LOCAL BACKUP FILES. It does not change the running services.

The script connects only to the local Docker socket and checks the four exact names/images. It discovers the real Compose working directory and files from the running containers' labels, instead of assuming where the Git checkout lives. It refuses missing/mixed projects, unexpected paths/symlinks, non-root-owned configuration or inadequate disk space. It will not chmod the original files or repair a blocked installation.

It reads the existing Compose files, .env, mounted Caddyfile and selected Docker configuration INCLUDING ENVIRONMENT SECRETS. Those values are written only under a fresh `/root/firbo-recovery/<timestamp-random>/` directory (0700); files are 0600. It then saves ONLY the existing firbo-api image using `docker image save`, with no network pull or new tag.

It rehydrates the configuration archive into a new temporary private directory and verifies identical bytes. It checks that the saved image archive references the expected image configuration digest and includes its layers, then records archive checksums. This image validation is structural, not a `docker load` or boot test. The script verifies that captured runtime metadata and source configuration did not change during capture.

The JSON sent to the terminal has only safe status fields, checksums, the new backup location and boolean presence/matching checks for a fixed list of API settings. It does NOT print environment values or original host paths. Raw exceptions and Docker stderr are suppressed; errors use fixed codes. The private archives must never be pasted into chat, committed to Git or exposed under a web root.

No container exec/run/build/pull/restart/stop/load/remove, provider call, upload, database access, package installation or live configuration update is performed. Image export consumes local disk and I/O; the tool checks a conservative free-space reserve and does not claim zero resource impact.

## Important limits — never describe this as a full recovery pass

- Scope is CONFIGURATION + FIRBO API IMAGE ONLY.
- The backup is root-only but NOT encrypted; other root-level processes can access it. No off-host copy has been made. Host failure would still lose a local-only backup.
- No Supabase database, OmniRoute database, Redis state, Caddy certificate volume or API writable data is backed up by this script.
- A Docker image export does not contain the live data in mounted volumes or the container writable layer.
- No application restore/boot rehearsal has been performed. The safe report deliberately marks database_backup_performed, off_host_copy_verified, application_restore_test_passed and deployment_performed false.
- Do not resume a partly failed capture by manually applying files to production. Keep partial private files and send only its safe error report for review.
- Distinct inference/management values do not prove key scope; equal values are flagged without automatically rotating anything.

## Tested locally

26/26 unittest tests passed against the exact script blob `63b890a2174db2e92d444da3ab65cc92efab725f`. Python compilation passed. Tests cover private file permissions, symlink/path rejection, bounded config reads, synthetic image identity/layers, config round-trip, missing files, mixed projects, image drift, sanitized reporting/errors, no remote Docker context, insufficient space and an end-to-end synthetic capture. They do not establish real VPS compatibility. Final CI is a separate check and should be recorded in the PR after completion.

Script SHA-256: `24bbbf4d9592bbc93d3a7e8bd5a4d9c45352b0001f244d8eed6c8898dbc04c3f`.

## Owner steps

1. Stay in the SAME root Hostinger Web Console used for the successful preflight. No git pull, branch switch, update, reboot or repair script.
2. Run the checksum-pinned download/execution block in the current delivery message. Its final command is `python3 "$FILE" --capture`.
3. Send ONLY the resulting JSON starting with `contract: firbo-recovery-checkpoint/v1`. A successful capture reports `status: captured`; any failure reports `status: blocked` and a safe error code. Do not send either `.private.tar` archive, .env or a raw Docker inspect.

## Remaining / next gate

A successful report establishes only the local configuration/API-image checkpoint. Next: explicit consistent database/volume backup and encrypted off-host storage, an isolated restore/boot rehearsal and matching candidate API installation. Do not copy live database files blindly and claim a consistent backup. Keep production unchanged until recovery and real account/gateway tests pass. The later mission/audio consolidation, durable usage ledger, budget reservations, provider lifecycle, migrations, MCP/shifts, monitoring and mobile/microphone QA remain in FIRBO-PRODUCTION-PLAN.md.

## Primary references consulted

- Docker image save: https://docs.docker.com/reference/cli/docker/image/save/
- Docker storage: https://docs.docker.com/engine/storage/
- Docker volumes/restore: https://docs.docker.com/engine/storage/volumes/
- SQLite live backup requirements (for the later data-backup step, not implemented here): https://sqlite.org/backup.html
