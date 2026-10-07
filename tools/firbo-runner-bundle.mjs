#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'supabase/functions/agent-runner/index.ts');
const manifestPath = resolve(root, 'deploy/firbo-agent-runner-bundle.json');

const fail = message => {
  throw new Error(`runner_bundle_gate: ${message}`);
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
const posix = value => value.split(sep).join('/');
const sourcePath = file => posix(relative(root, file));
const bundlePath = file => {
  const path = sourcePath(file);
  if (path === 'supabase/functions/agent-runner/index.ts') return 'index.ts';
  const prefix = 'supabase/functions/';
  if (!path.startsWith(prefix)) fail(`dependency outside functions tree: ${path}`);
  return path.slice(prefix.length);
};

function relativeSpecifiers(source) {
  const values = new Set();
  for (const match of source.matchAll(/(?:import|export)\s+(?:type\s+)?[^;]*?\s+from\s*['"]([^'"]+)['"]/g)) {
    if (match[1].startsWith('.')) values.add(match[1]);
  }
  for (const match of source.matchAll(/import\s*['"]([^'"]+)['"]/g)) {
    if (match[1].startsWith('.')) values.add(match[1]);
  }
  return [...values];
}

async function collect(file = entry, seen = new Map()) {
  const exact = resolve(file);
  if (seen.has(exact)) return seen;
  const content = await readFile(exact, 'utf8').catch(() => fail(`missing dependency: ${sourcePath(exact)}`));
  seen.set(exact, content);
  for (const specifier of relativeSpecifiers(content)) {
    const dependency = resolve(dirname(exact), specifier);
    if (!dependency.startsWith(resolve(root, 'supabase/functions') + sep)) {
      fail(`relative import escapes functions tree: ${sourcePath(exact)} -> ${specifier}`);
    }
    await collect(dependency, seen);
  }
  return seen;
}

async function currentFiles() {
  const closure = await collect();
  return [...closure].map(([file, content]) => ({
    path: bundlePath(file),
    source_path: sourcePath(file),
    sha256: sha256(content),
    bytes: Buffer.byteLength(content),
  })).sort((a, b) => a.path.localeCompare(b.path));
}

async function loadJson(path, label) {
  const text = await readFile(path, 'utf8').catch(() => fail(`${label} is unreadable`));
  try { return JSON.parse(text); } catch { fail(`${label} is not valid JSON`); }
}

function compareFiles(expected, actual, label) {
  const repeated = values => values.filter((value, index) => values.indexOf(value) !== index);
  const expectedDuplicates = [...new Set(repeated(expected.map(item => item.path)))];
  const actualDuplicates = [...new Set(repeated(actual.map(item => item.path)))];
  if (expectedDuplicates.length || actualDuplicates.length) {
    fail(`${label} contains duplicate paths; expected=${expectedDuplicates.join(',') || '-'} actual=${actualDuplicates.join(',') || '-'}`);
  }
  const exp = new Map(expected.map(item => [item.path, item]));
  const got = new Map(actual.map(item => [item.path, item]));
  const missing = [...exp.keys()].filter(path => !got.has(path));
  const extra = [...got.keys()].filter(path => !exp.has(path));
  const changed = [...exp.keys()].filter(path => got.has(path) && got.get(path).sha256 !== exp.get(path).sha256);
  if (missing.length || extra.length || changed.length) {
    fail(`${label} mismatch; missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'} changed=${changed.join(',') || '-'}`);
  }
}

function normalizeLiveName(name) {
  const value = String(name ?? '').replaceAll('\\', '/');
  if (value.endsWith('/index.ts') || value === 'index.ts') return 'index.ts';
  const marker = '_shared/';
  const offset = value.lastIndexOf(marker);
  return offset >= 0 ? value.slice(offset) : value.replace(/^source\//, '');
}

async function verifyLive(path, expected) {
  const body = await loadJson(path, 'live bundle');
  const files = Array.isArray(body) ? body : body.files;
  if (!Array.isArray(files)) fail('live bundle must contain a files array');
  const actual = files.filter(item => item && typeof item.content === 'string')
    .map(item => ({ path: normalizeLiveName(item.name), sha256: sha256(item.content) }))
    .filter(item => item.path === 'index.ts' || item.path.startsWith('_shared/'));
  compareFiles(expected, actual, 'live bundle');
}

function finitePositive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1_000_000) fail(`${name} must be a positive billed-route value`);
  return number;
}

async function verifyReleaseConfig(path) {
  const config = await loadJson(path, 'release config');
  let url;
  try { url = new URL(config.route); } catch { fail('release route must be a valid URL'); }
  const host = url.hostname.toLowerCase();
  const octets = host.split('.').map(Number);
  const privateIpv4 = octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255)
    && (octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168));
  if (url.protocol !== 'https:' || !host || /(^|\.)(example|invalid|localhost|local)$/.test(host)
    || privateIpv4 || host.includes(':')) {
    fail('release route must be the reviewed public HTTPS billed route');
  }
  if (typeof config.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_./-]{0,119}$/.test(config.model)) fail('release model is invalid');
  const priceIn = finitePositive(config.price_in_per_m, 'price_in_per_m');
  const priceOut = finitePositive(config.price_out_per_m, 'price_out_per_m');
  const maxOutput = Number(config.max_output_tokens);
  if (!Number.isSafeInteger(maxOutput) || maxOutput < 1 || maxOutput > 100_000) fail('max_output_tokens is invalid');
  if (typeof config.evidence !== 'string' || config.evidence.trim().length < 8 || /placeholder|todo|unknown/i.test(config.evidence)) {
    fail('provider pricing evidence is required');
  }
  const verifiedAt = typeof config.verified_at === 'string' ? Date.parse(config.verified_at) : NaN;
  if (!Number.isFinite(verifiedAt) || verifiedAt > Date.now() + 300_000 || Date.now() - verifiedAt > 31 * 86_400_000) {
    fail('verified_at is invalid or stale');
  }
  const env = {
    priceIn: process.env.FIRBO_SERVER_PRICE_IN_PER_M,
    priceOut: process.env.FIRBO_SERVER_PRICE_OUT_PER_M,
    maxOutput: process.env.FIRBO_SERVER_MAX_OUTPUT_TOKENS,
  };
  if (env.priceIn === undefined || env.priceOut === undefined || env.maxOutput === undefined) fail('runtime pricing environment is incomplete');
  if (Number(env.priceIn) !== priceIn || Number(env.priceOut) !== priceOut || Number(env.maxOutput) !== maxOutput) {
    fail('reviewed pricing does not match the runtime environment');
  }
}

const args = process.argv.slice(2);
const valueAfter = flag => {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  if (!args[index + 1]) fail(`${flag} needs a path`);
  return resolve(process.cwd(), args[index + 1]);
};

const manifest = await loadJson(manifestPath, 'bundle manifest');
if (manifest.schema !== 'firbo-agent-runner-bundle/v1' || !Array.isArray(manifest.files)) fail('bundle manifest schema is invalid');
const current = await currentFiles();
compareFiles(manifest.files, current, 'source bundle');
if (current.length !== 15) fail(`expected 15-file closure, found ${current.length}`);
const livePath = valueAfter('--live-bundle');
if (livePath) await verifyLive(livePath, current);
const configPath = valueAfter('--release-config');
if (configPath) await verifyReleaseConfig(configPath);
process.stdout.write(JSON.stringify({ ok: true, files: current.length, manifest: posix(relative(process.cwd(), manifestPath)) }) + '\n');
