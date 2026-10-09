#!/usr/bin/env node
// Read-only comparison of committed FIRBO source with fresh provider snapshots.
// This never deploys, executes a task, reads credentials or changes permissions.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROJECT = 'bfeinnsorgjycivozcau';
export const REPOSITORY = 'conpol84/javris-clone';
export const SHARED_BRANCH = 'claude/gifted-dijkstra-rph5j8';
export const PARITY_BRANCH = 'codex/firbo-parity-20261006';
export const FUNCTIONS = ['agent-chat','agent-runner','connector','computer-dispatch','integrations','mission-runner'];
export const JWT = Object.freeze({'agent-chat':false,'agent-runner':false,connector:false,'computer-dispatch':true,integrations:false,'mission-runner':true});
export const ASSETS = ['FIRBO-Mac-Browser-Update.command','firbo-connector.mjs','firbo-browser.mjs'];
const MAX_AGE_MS = 15 * 60_000;
const fail = message => { throw new Error('firbo_release_gate: ' + message); };
const sha = value => createHash('sha256').update(value).digest('hex');
const exactSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

export function relativeImports(source) {
  const found = new Set();
  // The accepted Edge tree uses static literal imports. Include re-exports,
  // side effects and literal dynamic imports; unknown dynamic imports fail closed.
  for (const expression of [
    /(?:import|export)\s+(?:type\s+)?[^;]*?\s+from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) for (const match of source.matchAll(expression)) if (match[1].startsWith('.')) found.add(match[1]);
  if (/\bimport\s*\(\s*[^'"\s]/.test(source)) fail('non-literal dynamic import needs explicit bundle support');
  return [...found];
}

export function collectBundle(name, readSource) {
  if (!FUNCTIONS.includes(name)) fail('unknown function');
  const files = new Map();
  function visit(file) {
    if (file.startsWith('../') || path.posix.isAbsolute(file) || file.includes('\\')) fail('dependency escapes function tree');
    if (files.has(file)) return;
    let content;
    try { content = readSource('supabase/functions/' + file); } catch { fail('missing source dependency: ' + file); }
    if (typeof content !== 'string') fail('non-text source: ' + file);
    files.set(file, content);
    for (const specifier of relativeImports(content)) visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
  }
  visit(name + '/index.ts');
  for (const config of [name + '/deno.json', name + '/deno.jsonc', name + '/import_map.json']) {
    try { files.set(config, readSource('supabase/functions/' + config)); } catch { /* absent configuration is normal */ }
  }
  return files;
}

function livePath(name, fn) {
  if (typeof name !== 'string' || name.includes('\\') || name.split('/').includes('..')) fail('unsafe live file name');
  if (name === 'index.ts') return fn + '/index.ts';
  if (name.startsWith('source/')) name = name.slice(7);
  if (!name.startsWith(fn + '/') && !name.startsWith('_shared/')) fail('unexpected live file path: ' + name);
  return name;
}

export function verifyBundle(fn, live, expected) {
  if (live?.name !== fn || live?.slug !== fn || live?.status !== 'ACTIVE' || !Number.isSafeInteger(live.version) || live.version < 1) fail(fn + ': inactive or invalid metadata');
  // Preserve each reviewed live setting, including mission-runner's additional
  // platform JWT check. A change needs explicit review, never a shared default.
  if (live.verify_jwt !== JWT[fn]) fail(fn + ': unexpected JWT configuration');
  if (!Array.isArray(live.files)) fail(fn + ': missing files');
  const actual = new Map();
  for (const item of live.files) {
    const name = livePath(item?.name, fn);
    if (actual.has(name)) fail(fn + ': duplicate file ' + name);
    if (typeof item.content !== 'string') fail(fn + ': missing content ' + name);
    actual.set(name, item.content);
  }
  const missing = [...expected.keys()].filter(n => !actual.has(n));
  const extra = [...actual.keys()].filter(n => !expected.has(n));
  const changed = [...expected.keys()].filter(n => actual.has(n) && sha(expected.get(n)) !== sha(actual.get(n)));
  if (missing.length || extra.length || changed.length) fail(fn + ': missing=' + missing.join(',') + ' extra=' + extra.join(',') + ' changed=' + changed.join(','));
  return {name:fn, version:live.version, files:expected.size};
}

export function deploymentBundle(name, readSource) {
  const files = [...collectBundle(name, readSource)]
    .sort(([a], [b]) => a.localeCompare(b)).map(([name, content]) => ({name, content}));
  const result = {project_id:PROJECT, name, entrypoint_path:name + '/index.ts', verify_jwt:JWT[name], files};
  if (files.some(f => f.name === name + '/import_map.json')) result.import_map_path = name + '/import_map.json';
  return result;
}

export function verifyRelease(evidence, {source, observedShared, observedParity, readSource, isAncestor, frontendTree, now = Date.now()}) {
  if (evidence?.schema !== 'firbo-release-evidence/v1' || evidence.project_id !== PROJECT || evidence.repository !== REPOSITORY) fail('wrong evidence schema, repository or FIRBO project');
  if (![source, observedShared, observedParity, evidence.source_commit, evidence.shared_head, evidence.parity_head].every(exactSha)) fail('exact commit identities required');
  if (evidence.source_commit !== source || evidence.shared_head !== observedShared || evidence.parity_head !== observedParity) fail('source or live branch heads moved; capture fresh evidence');
  const captured = Date.parse(evidence.captured_at);
  if (!Number.isFinite(captured) || captured > now + 60_000 || now - captured > MAX_AGE_MS) fail('stale or invalid capture timestamp');
  if (!isAncestor(observedShared, source) || !isAncestor(observedParity, source)) fail('candidate omits current shared or parity work');
  if (!Array.isArray(evidence.functions) || evidence.functions.length !== FUNCTIONS.length) fail('all six live function snapshots are required');
  if (new Set(evidence.functions.map(f => f.name)).size !== FUNCTIONS.length) fail('duplicate function snapshots');
  const functions = FUNCTIONS.map(fn => verifyBundle(fn, evidence.functions.find(f => f.name === fn), collectBundle(fn, readSource)));
  const web = evidence.frontend;
  if (!web || web.state !== 'READY' || web.target !== 'production' || !/^dpl_[A-Za-z0-9]+$/.test(web.deployment_id) || !exactSha(web.source_commit)) fail('frontend is not an identified READY production deployment');
  if (!Array.isArray(web.aliases) || !['firboai.app','javris.firboai.app'].every(a => web.aliases.includes(a))) fail('production FIRBO aliases are incomplete');
  // Tooling/docs-only commits do not justify an unnecessary production rebuild.
  if (!isAncestor(web.source_commit, source) || frontendTree(web.source_commit) !== frontendTree(source)) fail('production frontend differs from accepted source');
  if (!Array.isArray(web.assets) || web.assets.length !== ASSETS.length || new Set(web.assets.map(a => a.name)).size !== ASSETS.length) fail('all served Connector asset hashes are required');
  for (const asset of ASSETS) {
    const live = web.assets.find(a => a.name === asset);
    if (live?.status !== 200 || live.sha256 !== sha(readSource('frontend/public/' + asset))) fail('served asset differs: ' + asset);
  }
  return {ok:true, scope:'source/deployment parity only', source_commit:source, shared_head:observedShared, parity_head:observedParity,
    captured_at:evidence.captured_at, functions, frontend:{deployment_id:web.deployment_id, source_commit:web.source_commit, assets:ASSETS.length},
    limitations:['Not authenticated business, provider, physical-device, playback, backup or restore acceptance.','Snapshots are operator-collected evidence, not cryptographic provider attestations.']};
}

export function gitReader(cwd, source) {
  const git = args => execFileSync('git', args, {cwd, encoding:'utf8', maxBuffer:32*1024*1024, stdio:['ignore','pipe','pipe']}).trimEnd();
  if (!exactSha(source)) fail('--source must be a full immutable commit SHA');
  git(['cat-file','-e',source + '^{commit}']);
  const readSource = file => execFileSync('git', ['show',source + ':' + file], {cwd, encoding:'utf8', maxBuffer:32*1024*1024, stdio:['ignore','pipe','pipe']});
  const isAncestor = (parent, child) => {
    try { git(['merge-base','--is-ancestor',parent,child]); return true; }
    catch (error) { if (error.status === 1) return false; fail('cannot verify commit ancestry'); }
  };
  return {git, readSource, isAncestor, frontendTree:commit => git(['rev-parse',commit + ':frontend'])};
}

function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(['--source','--evidence','--source-only','--bundle']);
  const seen = new Set();
  for (let i=0;i<args.length;i++) {
    if (!allowed.has(args[i]) || seen.has(args[i])) fail('unknown or duplicate argument');
    seen.add(args[i]);
    if (args[i] !== '--source-only' && !args[++i]) fail('missing argument value');
  }
  const value = key => args[args.indexOf(key)+1];
  if (!args.includes('--source')) fail('--source is required');
  const source = value('--source');
  const reader = gitReader(process.cwd(), source);
  if (args.includes('--bundle')) {
    if (args.includes('--source-only') || args.includes('--evidence')) fail('choose bundle, source-only or live evidence');
    return deploymentBundle(value('--bundle'),reader.readSource);
  }
  if (args.includes('--source-only')) {
    if (args.includes('--evidence')) fail('choose source-only or live evidence');
    return {ok:true, scope:'source closure only', source_commit:source,
      functions:FUNCTIONS.map(name => ({name, files:collectBundle(name,reader.readSource).size}))};
  }
  if (!args.includes('--evidence')) fail('--evidence is required for live parity');
  const origin = reader.git(['config','--get','remote.origin.url']);
  if (!['https://github.com/' + REPOSITORY, 'https://github.com/' + REPOSITORY + '.git', 'git@github.com:' + REPOSITORY + '.git'].includes(origin)) fail('origin is not the FIRBO repository');
  const sharedRef='refs/heads/' + SHARED_BRANCH, parityRef='refs/heads/' + PARITY_BRANCH;
  const lines=reader.git(['ls-remote','--refs','origin',sharedRef,parityRef]).split('\n');
  const refs=new Map(lines.map(line => line.split(/\s+/)).map(([commit,ref]) => [ref,commit]));
  const evidence=JSON.parse(readFileSync(value('--evidence'),'utf8'));
  return verifyRelease(evidence,{...reader,source,observedShared:refs.get(sharedRef),observedParity:refs.get(parityRef)});
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(main(),null,2) + '\n'); }
  catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode=1; }
}
