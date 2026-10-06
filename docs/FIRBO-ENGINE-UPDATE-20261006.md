# Guided VPS engine update — 6 October 2026

Continues PR30; preserves Claude f6442b75 and live runner v89/Tavily. Mac stays
deferred. This is an engine deployment helper, not completed OpenJarvis parity.

## Changed

Owner identified srv2027143, two active systemd services running as jarvis, shared
Python 3.13 environment and installed OpenJarvis 1.0.5.dev70+ga0df94c. Added a
default read-only inspector and explicit --apply transaction for the three PR30
server files. Known old/new SHA256 values only; unknown local modifications abort
before mutation. Candidate downloads are pinned to accepted PR30 1cfc4e3a and
validated by SHA256 and Python syntax. Private backups retain old bytes and
ownership/mode metadata. Services are stopped before replacing files and checked
after imports/startup; verification failure restores original files. A concurrent
file edit is retained and the stopped services restarted. No Compose checkout,
Caddy, environment, credentials, providers, permissions or FreeLLMAPI edits.

## Tested / passed

Six disposable-directory tests passed: baseline rejection, accepted mixed states,
metadata/backups, failed verification rollback, concurrent drift and symlink
rejection. Ruff and diff checks passed. Existing engine implementation retains
its prior exact-head nine-workflow CI evidence; new helper CI is separate.

## Failed / limitations

Local full receipt suite rerun lacked cached FastAPI dependency; no tests were
removed or weakened. Only new pure-Python updater tests ran locally. VPS is not
directly accessible from the session. Service-active/import/hash checks do not
certify HTTP health, authentication, an inference, a loaded agent, tenant isolation
or a saved artifact. Script explicitly returns execution_verified:false.

## Remains

Owner executes guided --apply on VPS and returns its safe JSON. Unknown baseline
must be compared before any override; never bypass the hash check. Then release
matching Edge/frontend bundles after drift verification and perform actual file
task/readback. Original company memory/knowledge, skill/lifecycle/workflow adapters,
durable approval continuation, per-attempt runner accounting, provider linking,
second-customer isolation and off-host restore remain open; use PR30 matrices.
Mac physical browser/Excel/Stop acceptance follows the server stages.
