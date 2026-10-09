# Private worker deployment preflight — 8 October 2026

## Changed

The PR104 private coordinator/client is preserved byte for byte. A separate
standard-library Linux preflight observes local prerequisites before a future
coordinated deployment. It never installs, starts, pairs, dispatches work, contacts
an origin or changes an account, credential, configuration, service or firewall.

The accepted PR104 worker SHA256 is pinned:
`a60e7ab0f98d2c919496b0c59368f114728dfd71dcc8dfb3e9a4bb4775aa50c4`.
The supplied worker file is read as bytes and never imported/executed. Modified,
symlinked, hardlinked, oversized or non-regular source cannot pass the hash gate.

The report checks Linux/Python3.11+, a non-root service identity, owner-private
regular configuration with exact role-specific fields, canonical unique company
UUIDs, distinct sufficiently long URL-safe bearer tokens, private existing state
directory and safe database path. A worker configuration containing an admin
credential is rejected. HTTPS origins and literal loopback tunnel origins are
allowed; URL credentials, paths, queries, invalid ports and public HTTP fail.
Server mode observes TCP/IPv6 port8095 (or the explicit port) through `/proc/net`;
missing/unreadable socket metadata fails closed. It does not bind/reserve the port.

Only booleans and the public source SHA are printed. Configuration values,
credentials, company IDs, origin, file contents and exception details are omitted.
Exit0 means observed local prerequisites passed; exit1 means at least one failed.
The output always states `deployed:false`, network/supervision/receipt acceptance
`not_tested`. It never labels a machine or the application production-ready.

## Tested / passed

Six actual temporary-filesystem/CLI tests cover pinned and modified source,
private/public permissions, symlinks/FIFO/missing config, admin-secret separation,
malformed/duplicate scope and origins, private directory/database path checks,
unchanged existing database bytes, IPv4/IPv6 occupied ports, unavailable socket
metadata, sanitized JSON, deterministic exit status and zero state-file creation.
Combined with unchanged PR104 tests, local23/23 pass. Ruff0.16.7 and syntax/diff
checks pass. Exact-head CI separately runs both suites on Python3.11/3.12/3.13.
No physical Debian/VPS, remote topology, TLS or actual worker service was tested.

## Failed / corrected

Local Ruff required explicit `check=False` for subprocess tests that assert
expected failure exit codes; corrected before publication without weakened checks.
No deployment or remote operation occurred.

## Remains

This is local prerequisite analysis, not a deployment script or installer. It does
not check configuration against current FIRBO membership, existing SQLite binding
or pending receipts, service definitions, TLS ingress, SSH tunnel authorization,
supervision, OS resource limits, encryption, backup or actual network/job behavior.
The operator must reconcile existing state separately; never delete a cache to
make preflight pass. Files/ports may change immediately after the observation.

Private users/config/state must already be prepared by an authorized operator
before these checks can pass. Hostinger has all nine local MCP registrations but
exposes no callable VPS tools in this session. The hPanel browser advertises a
cloud sign-in restriction; no retry, workaround, login, secret request or remote
installation was attempted. Working supported VPS access remains required.

PR105 was freshly observed targeting `main` from the original PR104 branch,
head03894ced8222f7a5fbf9ea92beddffc0156bb1d1: 642commits/736files at observation.
It is not a new four-file worker patch. Do not merge it as worker deployment or
alter its branch; preserve the existing shared integration and coordinate any
default-branch change separately. This preflight uses a new isolated branch.

Debian tenant Connector online/pwd acceptance is separate from private application
worker enrollment. No actual pwd receipt was supplied here. No personal macOS or
Debian commands, re-pairing or permissions were performed. PR104 still executes
only bounded text_digest; CEO/API/general tasks are not implemented by preflight.

Preserve PR100–103 backend config/pricing/live-byte release gates, Memory review
and semantic quality, all Mem0 service/DB/accounting/atomic-publication gates,
desktop/media, website-native delivery, egress, provider/OAuth/customer/business/
voice/signed OS/offhost restore/load requirements. Production unchanged; no full
plan completion. Exact source/CI identities and claim release belong in Issue52.
