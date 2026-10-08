// Read-only npm advisory report. Never installs upgrades or runs audit fix.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../../frontend/', import.meta.url));
let blocked = false;
for (const [scope, flags] of [['all', []], ['production', ['--omit=dev']]]) {
  const run = spawnSync('npm', ['audit', '--json', ...flags], { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 12_000_000 });
  let report;
  try { report = JSON.parse(run.stdout); } catch { console.error(`AUDIT_UNAVAILABLE ${scope}`); process.exit(2); }
  if (run.error || report.error || !report.metadata?.vulnerabilities || (run.status !== 0 && run.status !== 1)) {
    console.error(`AUDIT_UNAVAILABLE ${scope}`); process.exit(2);
  }
  const counts = report.metadata.vulnerabilities;
  console.log('FIRBO_AUDIT_COUNTS ' + JSON.stringify({ scope, ...counts }));
  for (const [name, item] of Object.entries(report.vulnerabilities ?? {})) {
    console.log('FIRBO_AUDIT_FINDING ' + JSON.stringify({ scope, name, severity: item.severity, direct: item.isDirect,
      range: item.range, fix: item.fixAvailable,
      via: (item.via ?? []).map(v => typeof v === 'string' ? v : {name: v.name, title: v.title, url: v.url, range: v.range}),
    }));
  }
  if (Number(counts.high) > 0 || Number(counts.critical) > 0) blocked = true;
}
if (blocked) {
  console.error('RELEASE_BLOCKED: unresolved high/critical dependency advisories; review scope and tested fixes.');
  process.exit(1);
}
console.log('Dependency audit gate passed at this registry snapshot; this is not a runtime security audit.');
