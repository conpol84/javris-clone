// One-shot candidate builder. No deployments, branch writes, real accounts or AI calls.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const front = path.join(root, 'frontend');
const hash = value => createHash('sha256').update(value).digest('hex');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const save = (file, value) => { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive:true}); fs.writeFileSync(path.join(root, file), value); };
const run = (cmd, args, cwd = front) => execFileSync(cmd, args, {cwd, stdio:'inherit', timeout:600000});
const capture = (cmd, args, cwd = root) => execFileSync(cmd, args, {cwd, encoding:'utf8', timeout:60000, maxBuffer:10000000});
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const audit = () => {
  const output = {};
  for (const [scope, extra] of [['all', []], ['production', ['--omit=dev']]]) {
    let raw;
    try { raw = capture('npm', ['audit','--json','--ignore-scripts', ...extra], front); }
    catch (error) { raw = error.stdout; }
    const report = JSON.parse(raw || '{}');
    assert(report.metadata?.vulnerabilities && !report.error, 'Audit service failed, not a clean audit');
    output[scope] = report;
    console.log('DEPENDENCY_COUNTS', scope, JSON.stringify(report.metadata.vulnerabilities));
  }
  return output;
};
const cssOutput = () => {
  const files = fs.readdirSync(path.join(front,'dist/assets')).filter(p => p.endsWith('.css')).sort();
  assert(files.length > 0, 'No compiled CSS');
  return files.map(file => fs.readFileSync(path.join(front,'dist/assets',file),'utf8')).join('\n');
};

const originalManifest = JSON.parse(read('frontend/package.json'));
const originalLock = JSON.parse(read('frontend/package-lock.json'));
assert(originalManifest.dependencies?.shadcn, 'One-shot input already changed');
run('npm',['ci','--ignore-scripts','--no-audit','--no-fund']);
const beforeAudit = audit();
run('npm',['run','build:tauri']);
const beforeCSS = cssOutput();

// Verify there is no JS/runtime/CLI use before removing the package.
const tracked = capture('git',['ls-files','-z','frontend']).split('\0').filter(Boolean);
const mentions = [];
for (const file of tracked) {
  if (!/\.(?:[cm]?[jt]sx?|css|scss|html|json)$/.test(file) || /package(?:-lock)?\.json$/.test(file) || file.endsWith('components.json')) continue;
  const text = read(file);
  if (!text.includes('shadcn')) continue;
  mentions.push(file);
  assert(file === 'frontend/src/index.css', 'Additional shadcn usage requires review: ' + file);
  const stripped = text.replace('@import "shadcn/tailwind.css";', '');
  assert(!stripped.includes('shadcn'), 'Unexpected CSS shadcn reference');
}
assert(mentions.length === 1, 'Expected exactly one CSS-only package reference');
const require = createRequire(path.join(front,'package.json'));
const cssPath = require.resolve('shadcn/tailwind.css');
const packageDir = path.join(front,'node_modules/shadcn');
assert(cssPath.startsWith(packageDir + path.sep), 'Unexpected package export path');
const packageInfo = JSON.parse(fs.readFileSync(path.join(packageDir,'package.json'),'utf8'));
const vendorCSS = fs.readFileSync(cssPath,'utf8');
assert(vendorCSS.length > 20 && !/@import\b|url\s*\(/i.test(vendorCSS), 'CSS has dependent assets/imports; manual review required');
const licensePath = ['LICENSE','LICENSE.md','LICENSE.txt','license'].map(p => path.join(packageDir,p)).find(p => fs.existsSync(p));
assert(licensePath, 'Do not vendor third-party code without its license');
const license = fs.readFileSync(licensePath,'utf8');
assert(license.includes('Permission is hereby granted'), 'Review non-MIT license before vendoring');
save('frontend/src/styles/vendor/shadcn-tailwind.css', vendorCSS);
save('frontend/src/styles/vendor/shadcn-LICENSE.txt', license);
save('frontend/src/index.css', read('frontend/src/index.css').replace('@import "shadcn/tailwind.css";', '@import "./styles/vendor/shadcn-tailwind.css";'));
const manifest = structuredClone(originalManifest);
delete manifest.dependencies.shadcn;
save('frontend/package.json', JSON.stringify(manifest,null,2) + '\n');

// Regenerate with npm, then update ONLY the advisory leaf packages within dependency ranges.
run('npm',['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund']);
const leafPackages = ['brace-expansion','dompurify','fast-uri','hono','ip-address','js-yaml','undici'];
run('npm',['update',...leafPackages,'--package-lock-only','--ignore-scripts','--no-audit','--no-fund']);
assert(JSON.stringify(JSON.parse(read('frontend/package.json'))) === JSON.stringify(manifest), 'Unexpected manifest change');
const newLock = JSON.parse(read('frontend/package-lock.json'));
const changes = [];
for (const [name, oldEntry] of Object.entries(originalLock.packages)) {
  const next = newLock.packages[name];
  if (next && oldEntry.version !== next.version) {
    const packageName = name.split('node_modules/').at(-1);
    assert(leafPackages.includes(packageName), 'Unreviewed version change: ' + name);
    assert(String(oldEntry.version).split('.')[0] === String(next.version).split('.')[0], 'Major version change requires review: ' + name);
    changes.push({path:name,from:oldEntry.version,to:next.version});
  }
}
const removed = Object.keys(originalLock.packages).filter(p => !(p in newLock.packages));
const added = Object.keys(newLock.packages).filter(p => !(p in originalLock.packages));
console.log('REVIEWED_VERSION_CHANGES', JSON.stringify(changes));
console.log('PACKAGE_TREE_DELTA', JSON.stringify({removed:removed.length,added}));
const afterAudit = audit();
for (const report of Object.values(afterAudit)) assert(report.metadata.vulnerabilities.total === 0, 'Advisories remain: do not publish a clean result');
run('npm',['ci','--ignore-scripts','--no-audit','--no-fund']);
run('npm',['test']);
run('node',['--experimental-strip-types','--test','../tests/firbo/native-control.test.mjs','../tests/firbo/gateway-routing.test.mjs','../tests/firbo/edge-entrypoints.test.mjs']);
run('npx',['--no-install','tsc','--project','../tests/firbo/tsconfig.edge.json']);
run('npx',['--no-install','tsc','-b']);
run('npm',['run','build:tauri']);
const afterCSS = cssOutput();
console.log('COMPILED_CSS_COMPARISON', JSON.stringify({before:hash(beforeCSS),after:hash(afterCSS),equal:beforeCSS===afterCSS}));
assert(beforeCSS === afterCSS, 'Compiled CSS differs: inspect before linking candidate');
assert(!newLock.packages['node_modules/shadcn'], 'CLI package remains installed');
const evidence = {checked_at:new Date().toISOString(),base_commit:process.env.GITHUB_SHA,
  source:{name:'shadcn',version:packageInfo.version,license:packageInfo.license,css_sha256:hash(vendorCSS)},
  before:Object.fromEntries(Object.entries(beforeAudit).map(([k,v])=>[k,v.metadata.vulnerabilities])),
  after:Object.fromEntries(Object.entries(afterAudit).map(([k,v])=>[k,v.metadata.vulnerabilities])),
  changes,removed,added,compiled_css_sha256:hash(afterCSS),compiled_css_identical:true,
  tests:{frontend:'passed',native_and_shared_routing:'passed',edge_stub_typecheck:'passed',frontend_typecheck:'passed',production_build:'passed'},
  limits:['No real account/gateway/microphone test','No production deployment','Registry findings are point-in-time']};
save('docs/FIRBO-DEPENDENCY-REMEDIATION.json', JSON.stringify(evidence,null,2)+'\n');
save('frontend/src/styles/vendor/README.md', '# Vendored shadcn Tailwind utilities\n\nSource: shadcn@'+packageInfo.version+' npm package, `tailwind.css` export.\nMIT license retained in shadcn-LICENSE.txt. CSS copied byte-for-byte; SHA-256: `'+hash(vendorCSS)+'`.\n\nOnly use was the CSS import in src/index.css. Removing the CLI dependency does not remove the existing local UI components. This follows the supported shadcn eject pattern, using the exact locked package rather than an unpinned CLI.\n\nCompiled application CSS before/after was byte-identical. Future upstream utility changes require explicit review; do not restore an unpinned CLI dependency automatically.\n\nDocumentation: https://ui.shadcn.com/docs/cli#eject\n');
console.log('CANDIDATE_READY', JSON.stringify(evidence));
