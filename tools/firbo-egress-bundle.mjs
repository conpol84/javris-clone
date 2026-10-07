#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'deploy/firbo-egress-bundle.json');
const bundleLayout = new Map([
  ['src/openjarvis/security/mcp_egress.py', 'service'],
  ['src/openjarvis/server/firbo_mcp_egress.py', 'service'],
  ['src/openjarvis/security/page_egress.py', 'service'],
  ['src/openjarvis/server/firbo_page_egress.py', 'service'],
  ['supabase/functions/_shared/mcp-egress.ts', 'edge'],
  ['supabase/functions/_shared/page-egress.ts', 'edge'],
]);
const fail = message => { throw new Error(`egress_bundle_gate: ${message}`); };
const sha256 = value => createHash('sha256').update(value).digest('hex');

async function json(path, label) {
  const text = await readFile(path, 'utf8').catch(() => fail(`${label} is unreadable`));
  try { return JSON.parse(text); } catch { fail(`${label} is not valid JSON`); }
}

function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    fail(`${label} fields are invalid`);
  }
}

function compare(expected, actual, label) {
  const repeated = duplicates(actual.map(item => item.path));
  if (repeated.length) fail(`${label} contains duplicate paths: ${repeated.join(',')}`);
  const exp = new Map(expected.map(item => [item.path, item]));
  const got = new Map(actual.map(item => [item.path, item]));
  const missing = [...exp.keys()].filter(path => !got.has(path));
  const extra = [...got.keys()].filter(path => !exp.has(path));
  const changed = [...exp.keys()].filter(path => got.has(path)
    && (got.get(path).sha256 !== exp.get(path).sha256 || got.get(path).bytes !== exp.get(path).bytes));
  if (missing.length || extra.length || changed.length) {
    fail(`${label} mismatch; missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'} changed=${changed.join(',') || '-'}`);
  }
}

async function sourceFiles(manifest) {
  return Promise.all(manifest.files.map(async item => {
    const content = await readFile(resolve(root, item.path));
    return { ...item, sha256: sha256(content), bytes: content.byteLength };
  }));
}

async function verifyReadback(path, expected, label) {
  const body = await json(path, label);
  if (!Array.isArray(body.files)) fail(`${label} must contain a files array`);
  const actual = body.files.map(item => {
    if (!item || typeof item.name !== 'string' || typeof item.content !== 'string') {
      fail(`${label} contains an invalid file`);
    }
    const content = Buffer.from(item.content);
    return { path: item.name.replaceAll('\\\\', '/'), sha256: sha256(content), bytes: content.byteLength };
  });
  compare(expected, actual, label);
}

function publicUrl(value, path, name) {
  let url;
  try { url = new URL(value); } catch { fail(`${name} must be a public HTTPS URL`); }
  const host = url.hostname.toLowerCase();
  const octets = host.split('.').map(Number);
  const privateIpv4 = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && (octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== path || !host.includes('.') || host.includes(':') || privateIpv4
    || /(^|\.)(?:example|invalid|localhost|local|internal|test)$/.test(host)) {
    fail(`${name} must be the reviewed public HTTPS ${path} route`);
  }
  return url.href;
}

function privateBind(value, name) {
  const parts = String(value).split('.').map(Number);
  const valid = parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && (parts[0] === 127 || parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168));
  if (!valid) fail(`${name} bind must be loopback or RFC1918 IPv4`);
  return parts[0] === 127 ? 'loopback' : 'private';
}

function validToken(value) {
  return typeof value === 'string' && value.length >= 32 && /^[\x21-\x7e]+$/.test(value);
}

function evidence(value, name) {
  if (typeof value !== 'string' || value.trim().length < 8 || /placeholder|todo|unknown|pending/i.test(value)) {
    fail(`${name} evidence is required`);
  }
}

function checkReceipt(value, contract, bind, port, bindScope, originCount) {
  exactKeys(value, originCount === undefined
    ? ['contract', 'configuration_valid', 'bind_scope', 'bind_address', 'port', 'contains_secrets', 'listener_started']
    : ['contract', 'configuration_valid', 'bind_scope', 'bind_address', 'port', 'allowed_origin_count', 'contains_secrets', 'listener_started'], contract);
  if (!value || value.contract !== contract || value.configuration_valid !== true
    || value.bind_scope !== bindScope || value.bind_address !== bind || value.port !== port || value.contains_secrets !== false
    || value.listener_started !== false
    || (originCount !== undefined && value.allowed_origin_count !== originCount)) {
    fail(`${contract} receipt does not match release configuration`);
  }
}

async function verifyReleaseConfig(path) {
  const config = await json(path, 'release config');
  if (config.schema !== 'firbo-egress-release/v1') fail('release config schema is invalid');
  exactKeys(config, ['schema', 'verified_at', 'mcp', 'page', 'evidence'], 'release config');
  exactKeys(config.mcp, ['public_url', 'bind', 'port', 'allowed_origins', 'check'], 'MCP release config');
  exactKeys(config.page, ['public_url', 'bind', 'port', 'check'], 'page release config');
  exactKeys(config.evidence, ['supervision', 'tls_ingress', 'rate_and_concurrency_limits', 'log_suppression'], 'release evidence');
  const mcpUrl = publicUrl(config.mcp?.public_url, '/v1/mcp', 'MCP');
  const pageUrl = publicUrl(config.page?.public_url, '/v1/page', 'page');
  const mcpScope = privateBind(config.mcp?.bind, 'MCP');
  const pageScope = privateBind(config.page?.bind, 'page');
  for (const [name, port] of [['MCP', config.mcp?.port], ['page', config.page?.port]]) {
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) fail(`${name} port is invalid`);
  }
  if (config.mcp.port === config.page.port && config.mcp.bind === config.page.bind) {
    fail('MCP and page listeners collide');
  }
  if (!Array.isArray(config.mcp.allowed_origins) || config.mcp.allowed_origins.length === 0) {
    fail('MCP allowed origins are required');
  }
  for (const origin of config.mcp.allowed_origins) {
    let url;
    try { url = new URL(origin); } catch { fail('MCP allowed origin is invalid'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.pathname !== '/' || !url.hostname.includes('.')) fail('MCP allowed origin is invalid');
  }
  checkReceipt(config.mcp.check, 'firbo-mcp-egress-config/v1', config.mcp.bind, config.mcp.port, mcpScope, config.mcp.allowed_origins.length);
  checkReceipt(config.page.check, 'firbo-page-egress-config/v1', config.page.bind, config.page.port, pageScope);
  for (const name of ['supervision', 'tls_ingress', 'rate_and_concurrency_limits', 'log_suppression']) {
    evidence(config.evidence?.[name], name);
  }
  const verified = Date.parse(config.verified_at);
  if (!Number.isFinite(verified) || verified > Date.now() + 300_000 || Date.now() - verified > 86_400_000) {
    fail('verified_at is invalid or stale');
  }
  const env = process.env;
  if (env.FIRBO_MCP_EGRESS_URL !== mcpUrl || env.FIRBO_PAGE_EGRESS_URL !== pageUrl) {
    fail('reviewed public routes do not match Edge runtime environment');
  }
  const mcpToken = env.FIRBO_MCP_EGRESS_TOKEN;
  const pageToken = env.FIRBO_PAGE_EGRESS_TOKEN;
  if (!validToken(mcpToken) || !validToken(pageToken) || mcpToken === pageToken) {
    fail('dedicated distinct runtime tokens are required');
  }
  return { config, mcpUrl, pageUrl };
}

function acceptedProbe(value, status, body, label) {
  exactKeys(value, ['status', 'body_sha256', 'tls_peer_sha256', 'attempts'], label);
  if (!value || value.status !== status || value.attempts !== 1
    || value.body_sha256 !== sha256(Buffer.from(body))
    || !/^[a-f0-9]{64}$/.test(value.tls_peer_sha256)) {
    fail(`${label} acceptance probe is invalid`);
  }
}

async function verifyAcceptanceReceipt(path, release, manifestSha) {
  const receipt = await json(path, 'acceptance receipt');
  exactKeys(receipt, ['schema', 'checked_at', 'bundle_manifest_sha256', 'probe_payload_sha256', 'contains_secrets', 'upstream_dispatch_expected', 'services'], 'acceptance receipt');
  const checked = Date.parse(receipt.checked_at);
  if (receipt.schema !== 'firbo-egress-acceptance/v1'
    || receipt.bundle_manifest_sha256 !== manifestSha
    || receipt.probe_payload_sha256 !== sha256(Buffer.from('{}'))
    || receipt.contains_secrets !== false || receipt.upstream_dispatch_expected !== false
    || !Number.isFinite(checked) || checked > Date.now() + 300_000 || Date.now() - checked > 900_000
    || !receipt.services || Object.keys(receipt.services).sort().join(',') !== 'mcp,page') {
    fail('acceptance receipt is invalid or stale');
  }
  const mcp = receipt.services.mcp;
  const page = receipt.services.page;
  exactKeys(mcp, ['url', 'anonymous', 'authenticated_malformed'], 'MCP acceptance receipt');
  exactKeys(page, ['url', 'anonymous', 'authenticated_malformed'], 'page acceptance receipt');
  if (!mcp || mcp.url !== release.mcpUrl || !page || page.url !== release.pageUrl) {
    fail('acceptance receipt routes do not match release configuration');
  }
  acceptedProbe(mcp.anonymous, 401, '{"error":"unauthorized"}', 'MCP anonymous');
  acceptedProbe(mcp.authenticated_malformed, 502, '{"error":"egress_denied"}', 'MCP authenticated');
  acceptedProbe(page.anonymous, 401, '{"error":"unauthorized"}', 'page anonymous');
  acceptedProbe(page.authenticated_malformed, 400, '{"error":"bad_request"}', 'page authenticated');
}

const args = process.argv.slice(2);
const after = flag => {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  if (!args[index + 1]) fail(`${flag} needs a path`);
  return resolve(process.cwd(), args[index + 1]);
};

const manifest = await json(manifestPath, 'bundle manifest');
if (manifest.schema !== 'firbo-egress-bundle/v1' || !Array.isArray(manifest.files)) fail('bundle manifest schema is invalid');
if (manifest.files.length !== bundleLayout.size || duplicates(manifest.files.map(item => item.path)).length
  || manifest.files.some(item => bundleLayout.get(item.path) !== item.kind
    || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 1)) {
  fail('bundle manifest content is invalid');
}
const current = await sourceFiles(manifest);
compare(manifest.files, current, 'source bundle');
const services = current.filter(item => item.kind === 'service');
const edge = current.filter(item => item.kind === 'edge');
const servicePath = after('--service-readback');
const edgePath = after('--edge-readback');
const configPath = after('--release-config');
const acceptancePath = after('--acceptance-receipt');
if (servicePath) await verifyReadback(servicePath, services, 'service read-back');
if (edgePath) await verifyReadback(edgePath, edge, 'Edge read-back');
const release = configPath ? await verifyReleaseConfig(configPath) : null;
if (acceptancePath && !release) fail('--acceptance-receipt requires --release-config');
if (acceptancePath) {
  await verifyAcceptanceReceipt(acceptancePath, release, sha256(await readFile(manifestPath)));
}
process.stdout.write(JSON.stringify({ ok: true, files: current.length, service_files: services.length, edge_files: edge.length }) + '\n');
