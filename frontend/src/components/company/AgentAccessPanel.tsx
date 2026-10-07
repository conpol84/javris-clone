import { useState, type FormEvent } from 'react';
import { Bot, Download } from 'lucide-react';
import { toast } from 'sonner';
import { policyOf, setAgentPolicy, type ComputerPolicy, type DeviceRow } from '../../lib/company/computers';
import { connectorCommands, type ComputerPlatform } from '../../lib/company/computer-setup';
import { useWorkspaceCopy } from '../../lib/company/workspaceCopy';

const list = (text: string) => [...new Set(text.split(',').map(x => x.trim()).filter(Boolean))].slice(0, 40);
const HOURS = Array.from({ length: 25 }, (_, h) => h);

/** The owner's rules for AI employees on one computer: on/off, apps, files, commands and working hours. */
export function AgentAccessPanel({ device, platform, onSaved }: { device: DeviceRow; platform: ComputerPlatform; onSaved: () => void }) {
  const c = useWorkspaceCopy();
  const [p, setP] = useState<ComputerPolicy>(() => policyOf(device));
  const [apps, setApps] = useState(() => policyOf(device).apps.join(', '));
  const [shortcuts, setShortcuts] = useState(() => policyOf(device).shortcuts.join(', '));
  const [busy, setBusy] = useState(false);
  const kinds = device.capabilities?.job_kinds ?? [];
  const cmd = connectorCommands(platform, 'advanced');
  // What the Connector on the computer still has to allow for the rules below to work.
  const missing = [
    ...(platform === 'mac' && !kinds.includes('open_app') ? [cmd.allowApps] : []),
    ...(p.writes !== 'off' && !kinds.includes('write') ? [cmd.allowWrite] : []),
    ...(p.commands !== 'off' && !kinds.includes('exec') ? [cmd.allowExec] : []),
  ];
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const out = await setAgentPolicy(device.id, { ...p, apps: list(apps), shortcuts: list(shortcuts),
        hours: p.hours ? { ...p.hours, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } : null });
      setP(out.policy); setApps(out.policy.apps.join(', ')); setShortcuts(out.policy.shortcuts.join(', '));
      toast.success(c('xSaved')); onSaved();
    } catch { toast.error(c('kErr')); } finally { setBusy(false); }
  };
  const choice = <K extends 'writes' | 'commands'>(key: K, options: [ComputerPolicy[K], string][]) => (
    <label className="fb-col gap-1 text-sm">
      <span className="fb-dim text-xs">{c(key === 'writes' ? 'xWrites' : 'xCommands')}</span>
      <select className="fb-input" value={p[key]} disabled={!p.enabled} onChange={e => setP({ ...p, [key]: e.target.value as ComputerPolicy[K] })}>
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </label>
  );
  return (
    <form onSubmit={save} className="fb-col gap-3 rounded-lg border border-white/10 p-3" data-testid="agent-access">
      <h3 className="flex items-center gap-2 font-semibold"><Bot size={16} /> {c('xTitle')}</h3>
      <p className="fb-dim text-xs">{c('xHelp')}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={p.enabled} onChange={e => setP({ ...p, enabled: e.target.checked })} /> {c('xOn')}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="fb-col gap-1 text-sm sm:col-span-2">
          <span className="fb-dim text-xs">{c('xApps')}</span>
          <input className="fb-input" value={apps} disabled={!p.enabled} onChange={e => setApps(e.target.value)} />
        </label>
        <label className="fb-col gap-1 text-sm sm:col-span-2">
          <span className="fb-dim text-xs">{c('xShortcuts')}</span>
          <input className="fb-input" value={shortcuts} disabled={!p.enabled} onChange={e => setShortcuts(e.target.value)} />
        </label>
        {choice('writes', [['auto', c('xAuto')], ['ask', c('xAsk')], ['off', c('xNever')]])}
        {choice('commands', [['safe', c('xSafe')], ['ask', c('xAsk')], ['off', c('xNever')]])}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!p.hours} disabled={!p.enabled} onChange={e => setP({ ...p, hours: e.target.checked ? { from: 9, to: 18, tz: 'UTC' } : null })} /> {c('xHours')}
        </label>
        {p.hours && <>
          <span className="fb-dim">{c('xFrom')}</span>
          <select className="fb-input" style={{ width: 'auto' }} value={p.hours.from} onChange={e => setP({ ...p, hours: { ...p.hours!, from: Number(e.target.value) } })}>{HOURS.slice(0, 24).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
          <span className="fb-dim">{c('xTo')}</span>
          <select className="fb-input" style={{ width: 'auto' }} value={p.hours.to} onChange={e => setP({ ...p, hours: { ...p.hours!, to: Number(e.target.value) } })}>{HOURS.slice(1).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
        </>}
      </div>
      {p.enabled && missing.length > 0 && (
        <div className="fb-col gap-1 text-xs">
          <p>{c('xLocal')}</p>
          <a className="fb-btn fb-btn--ghost self-start" href="/firbo-connector.mjs" download><Download size={14} /> firbo-connector.mjs</a>
          {[...missing, cmd.run].map(line => <code key={line} className="fb-input block overflow-x-auto whitespace-nowrap p-2 font-mono" style={{ height: 'auto' }}>{line}</code>)}
        </div>
      )}
      <p className="fb-dim text-xs">{c('xPower')}</p>
      <button className="fb-btn fb-btn--primary self-start" disabled={busy}>{c('xSave')}</button>
    </form>
  );
}
