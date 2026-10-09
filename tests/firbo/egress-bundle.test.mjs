import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const gate = join(root, 'tools/firbo-egress-bundle.mjs');
const run = (args = [], env = {}) => spawnSync(process.execPath, [gate, ...args], {
  cwd: root, encoding: 'utf8', env: {
    ...process.env,
    FIRBO_MCP_EGRESS_URL: '',
    FIRBO_MCP_EGRESS_TOKEN: '',
    FIRBO_PAGE_EGRESS_URL: '',
    FIRBO_PAGE_EGRESS_TOKEN: '',
    ...env,
  },
});

test('manifest pins the complete two-service and two-adapter bundle', async () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, files: 6, service_files: 4, edge_files: 2 });
  const manifest = JSON.parse(await readFile(join(root, 'deploy/firbo-egress-bundle.json'), 'utf8'));
  assert.deepEqual(new Set(manifest.files.map(item => `${item.kind}:${item.path}`)), new Set([
    'service:src/openjarvis/security/mcp_egress.py',
    'service:src/openjarvis/server/firbo_mcp_egress.py',
    'service:src/openjarvis/security/page_egress.py',
    'service:src/openjarvis/server/firbo_page_egress.py',
    'edge:supabase/functions/_shared/mcp-egress.ts',
    'edge:supabase/functions/_shared/page-egress.ts',
  ]));
});

test('service and Edge read-backs must match every byte without extras or duplicates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'firbo-egress-readback-'));
  try {
    const manifest = JSON.parse(await readFile(join(root, 'deploy/firbo-egress-bundle.json'), 'utf8'));
    const make = async kind => Promise.all(manifest.files.filter(item => item.kind === kind).map(async item => ({
      name: item.path, content: await readFile(join(root, item.path), 'utf8'),
    })));
    const services = await make('service');
    const edge = await make('edge');
    const servicePath = join(dir, 'services.json');
    const edgePath = join(dir, 'edge.json');
    await writeFile(servicePath, JSON.stringify({ files: services }));
    await writeFile(edgePath, JSON.stringify({ files: edge }));
    assert.equal(run(['--service-readback', servicePath, '--edge-readback', edgePath]).status, 0);

    const missing = join(dir, 'missing.json');
    await writeFile(missing, JSON.stringify({ files: services.slice(1) }));
    assert.match(run(['--service-readback', missing]).stderr, /missing=src\/openjarvis\/security\/mcp_egress\.py/);

    const changed = join(dir, 'changed.json');
    await writeFile(changed, JSON.stringify({ files: edge.map((item, index) => index ? item : { ...item, content: item.content + '\n' }) }));
    assert.match(run(['--edge-readback', changed]).stderr, /changed=supabase\/functions\/_shared\/mcp-egress\.ts/);

    const duplicate = join(dir, 'duplicate.json');
    await writeFile(duplicate, JSON.stringify({ files: [...services, services[0]] }));
    assert.match(run(['--service-readback', duplicate]).stderr, /duplicate paths/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release mode requires matching routes, private checks, fresh evidence and distinct tokens', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'firbo-egress-config-'));
  const path = join(dir, 'release.json');
  const config = {
    schema: 'firbo-egress-release/v1',
    verified_at: new Date().toISOString(),
    mcp: {
      public_url: 'https://egress.firboai.app/v1/mcp',
      bind: '127.0.0.1',
      port: 8093,
      allowed_origins: ['https://api.github.com'],
      check: {
        contract: 'firbo-mcp-egress-config/v1', configuration_valid: true,
        bind_scope: 'loopback', bind_address: '127.0.0.1', port: 8093,
        allowed_origin_count: 1, contains_secrets: false, listener_started: false,
      },
    },
    page: {
      public_url: 'https://egress.firboai.app/v1/page',
      bind: '127.0.0.1',
      port: 8094,
      check: {
        contract: 'firbo-page-egress-config/v1', configuration_valid: true,
        bind_scope: 'loopback', bind_address: '127.0.0.1', port: 8094,
        contains_secrets: false, listener_started: false,
      },
    },
    evidence: {
      supervision: 'synthetic CI supervisor receipt',
      tls_ingress: 'synthetic CI TLS route receipt',
      rate_and_concurrency_limits: 'synthetic CI bounded admission receipt',
      log_suppression: 'synthetic CI redaction receipt',
    },
  };
  const env = {
    FIRBO_MCP_EGRESS_URL: config.mcp.public_url,
    FIRBO_MCP_EGRESS_TOKEN: 'm'.repeat(40),
    FIRBO_PAGE_EGRESS_URL: config.page.public_url,
    FIRBO_PAGE_EGRESS_TOKEN: 'p'.repeat(40),
  };
  const hash = value => createHash('sha256').update(value).digest('hex');
  const probe = (status, body, certificate = 'c'.repeat(64)) => ({
    status, body_sha256: hash(body), tls_peer_sha256: certificate, attempts: 1,
  });
  const acceptance = {
    schema: 'firbo-egress-acceptance/v1',
    checked_at: new Date().toISOString(),
    bundle_manifest_sha256: hash(await readFile(join(root, 'deploy/firbo-egress-bundle.json'))),
    probe_payload_sha256: hash('{}'),
    contains_secrets: false,
    upstream_dispatch_expected: false,
    services: {
      mcp: {
        url: config.mcp.public_url,
        anonymous: probe(401, '{"error":"unauthorized"}'),
        authenticated_malformed: probe(502, '{"error":"egress_denied"}'),
      },
      page: {
        url: config.page.public_url,
        anonymous: probe(401, '{"error":"unauthorized"}'),
        authenticated_malformed: probe(400, '{"error":"bad_request"}'),
      },
    },
  };
  const acceptancePath = join(dir, 'acceptance.json');
  try {
    await writeFile(path, JSON.stringify(config));
    await writeFile(acceptancePath, JSON.stringify(acceptance));
    assert.match(run(['--release-config', path]).stderr, /do not match Edge runtime environment/);
    assert.equal(run(['--release-config', path], env).status, 0);
    assert.equal(run(['--release-config', path, '--acceptance-receipt', acceptancePath], env).status, 0);
    assert.match(run(['--release-config', path], { ...env, FIRBO_PAGE_EGRESS_TOKEN: env.FIRBO_MCP_EGRESS_TOKEN }).stderr, /distinct runtime tokens/);

    await writeFile(path, JSON.stringify({ ...config, verified_at: new Date(Date.now() - 86_400_001).toISOString() }));
    assert.match(run(['--release-config', path], env).stderr, /verified_at is invalid or stale/);
    await writeFile(path, JSON.stringify(config));

    await writeFile(acceptancePath, JSON.stringify({ ...acceptance, checked_at: new Date(Date.now() - 901_000).toISOString() }));
    assert.match(run(['--release-config', path, '--acceptance-receipt', acceptancePath], env).stderr, /invalid or stale/);
    await writeFile(acceptancePath, JSON.stringify({ ...acceptance, services: { ...acceptance.services, page: { ...acceptance.services.page, authenticated_malformed: probe(200, '{}') } } }));
    assert.match(run(['--release-config', path, '--acceptance-receipt', acceptancePath], env).stderr, /page authenticated acceptance probe is invalid/);
    await writeFile(acceptancePath, JSON.stringify({ ...acceptance, runtime_token: 'must-not-be-accepted' }));
    assert.match(run(['--release-config', path, '--acceptance-receipt', acceptancePath], env).stderr, /acceptance receipt fields are invalid/);

    await writeFile(path, JSON.stringify({ ...config, evidence: { ...config.evidence, tls_ingress: 'pending' } }));
    assert.match(run(['--release-config', path], env).stderr, /tls_ingress evidence is required/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
