import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  try {
    await writeFile(path, JSON.stringify(config));
    assert.match(run(['--release-config', path]).stderr, /do not match Edge runtime environment/);
    assert.equal(run(['--release-config', path], env).status, 0);
    assert.match(run(['--release-config', path], { ...env, FIRBO_PAGE_EGRESS_TOKEN: env.FIRBO_MCP_EGRESS_TOKEN }).stderr, /distinct runtime tokens/);

    await writeFile(path, JSON.stringify({ ...config, evidence: { ...config.evidence, tls_ingress: 'pending' } }));
    assert.match(run(['--release-config', path], env).stderr, /tls_ingress evidence is required/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
