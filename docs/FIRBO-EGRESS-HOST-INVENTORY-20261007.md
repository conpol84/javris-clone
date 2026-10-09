# FIRBO egress host inventory — source checkpoint

Date: 2026-10-07. This stage follows the accepted source-only egress bundle and no-upstream-dispatch acceptance probe. It does not install, expose, start, stop, reload or deploy either service.

## Changed

- Added `deploy/hostinger/egress_inventory.py`, a standalone standard-library collector with contract `firbo-egress-host-inventory/v1`.
- It accepts two explicit loopback/RFC1918 IPv4 binds and distinct unprivileged ports. Public, wildcard, IPv6, privileged and colliding listener requests fail before host inspection.
- It issues only bounded read queries:
  - Docker server availability and `docker container inspect` for the four fixed existing FIRBO container names plus the two fixed candidate egress container names;
  - `systemctl is-active --quiet` for the two fixed proposed egress unit names;
  - `ss -H -lnt` filtered to each explicitly requested port.
- Docker output is reduced to fixed booleans/counts. Host mount sources, network names/addresses, environment, image command, labels and arbitrary command output are never returned.
- Optional service read-back hashes exactly the four service files in the accepted egress manifest. It rejects symlinked roots/files, traversal, duplicate JSON keys, oversize input and incomplete read-back arguments. Edge files are not read from a VPS service directory.
- Optional file output uses exclusive creation with mode `0600`; an existing path is never overwritten.
- Added offline tests and included them in the existing read-only VPS diagnostics workflow.

## Safety contract

The collector never reads `.env`, process/container environment values, Caddy contents, credentials, logs, databases, provider configuration or user data. It does not call a public route or provider, use `docker exec`, use `sudo`, install packages, change permissions, or mutate a service. Raw subprocess stderr is suppressed and raw stdout is never copied to the report.

The inventory intentionally does not select a topology. It reports whether the currently reviewed Docker/Caddy shape exists, whether either candidate egress container shares Caddy's network, the fixed candidate systemd unit state, whether the requested private ports appear occupied, and—when explicitly requested—whether installed service bytes equal an accepted manifest.

Example syntax after an operator has selected the reviewed private addresses and ports:

```bash
python3 deploy/hostinger/egress_inventory.py \
  --mcp-bind "$REVIEWED_MCP_PRIVATE_BIND" --mcp-port "$REVIEWED_MCP_PORT" \
  --page-bind "$REVIEWED_PAGE_PRIVATE_BIND" --page-port "$REVIEWED_PAGE_PORT" \
  --output firbo-egress-host-inventory.json
```

Optional exact service-byte read-back adds both arguments atomically:

```bash
  --service-root "$REVIEWED_SERVICE_ROOT" \
  --bundle-manifest deploy/firbo-egress-bundle.json
```

Do not paste environment files, proxy configuration, unfiltered Docker output or service logs into the report. A missing command or permission is evidence to stop and review, not authorization to install software or grant Docker access.

## Tested

- Eleven isolated Python tests with fake Docker/systemd/socket-listener output.
- Python bytecode compilation and repository diff checks.
- The collector's read-back path matched all four current service files to the exact six-file manifest (`8ee8bb0bfa6deb96d5fec4421ddfda3d64b1fd34c4bc822f0b2727cbb3b31d63`) locally.
- The test fixtures include secret-looking environment, mount-source, Docker-network and command-output values and assert none reach the report.
- Tests cover exact command allowlisting, missing tools without escalation, public/privileged/colliding bind denial, exact and changed service bytes, symlink denial, duplicate manifest keys, closed manifest layout, paired read-back arguments, output exclusivity/permissions and oversized command output.

## Passed

- Source-only collection and all eleven offline regressions passed locally.
- No provider, public page, database, VPS, device or real-user action was performed.

## Failed

- No final exact-head remote CI has been claimed at this authoring checkpoint.
- No actual VPS inventory report exists yet, so no listener, supervision, Caddy-network or installed-byte fact is claimed for production.

## Remains

- Re-read concurrent direct/shared work before publication or combination.
- Obtain an authorized report from the actual VPS using operator-selected private binds/ports; review it without changing the host.
- Choose and review one real supervision and public HTTPS ingress topology, including exact-origin authorization, limits and log suppression.
- Install a complete matching service bundle only after the existing recovery/rollback guards and current-head checks pass; then obtain exact service read-back and a harmless deployed acceptance receipt.
- Verify actual billed provider prices and maximum output-token configuration before any accounting-schema-compatible runner release.
- General egress and MCP remain source-tested only. No real-provider, real-page, deployment, migration, secret, permission or device acceptance is asserted here.
