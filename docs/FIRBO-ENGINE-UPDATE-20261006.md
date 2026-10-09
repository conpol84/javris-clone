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

## Installed and released — owner continuation, 6 October 2026

Owner ran the pinned updater on srv2027143 and returned installed:true,
services_active:true, backup /var/backups/firbo-engine-70a1iohu. This proves the
helper completed imports/hash/start checks, not an inference or artifact.

All nine workflows passed for source 161802b049bd746150699cae5e2f0e2e08e938c6.
Fresh Claude head f6442b75 and parity ce421e31 were unchanged. Live runner v89
matched all 12 baseline files. Released server-jarvis v14 (three exact matching
files, verify_jwt:true) and agent-runner v90 (13 matching files, verify_jwt:false
retained with existing user/cron guards). Claude v89/Tavily is preserved.
Live agent-chat v38 entrypoint is unchanged; it was not redeployed. Its separate
accounting dependency differs from this candidate and was also left untouched.
No migration, credentials, device jobs or provider permission changes occurred.

Frontend production dpl_Ee5eRBnzphaJqJKfr3iPi7Y1ng54 is READY at firboai.app,
independently resolved to exact source 161802b0. Rollback frontend remains
dpl_B9gmDQxDew7FTMNNdoTC7bhMpVaR (fd9ebd4). Both updated functions reject
anonymous POST with 401. Public landing page rendered in the cloud browser;
authenticated admin execution was blocked by absence of a signed-in session,
not by a known runtime defect. No login, permission expansion or synthetic
customer account was created to manufacture acceptance.

Next: safe authenticated local /v1/info for both services on VPS, then actual
allowed tool call and independently read saved artifact. Remaining full parity
families above are still open. Do not present this deployment as the whole clone.
