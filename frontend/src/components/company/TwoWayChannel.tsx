import { useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { toast } from 'sonner';
import { disableInbound, enableInbound } from '../../lib/company/workspace';
import { useWorkspaceCopy } from '../../lib/company/workspaceCopy';

/** Lets owners talk to their CEO from Telegram, WhatsApp or SMS (and approve actions there). Managers only. */
export function TwoWayChannel({ integration, onChange }: { integration: { id: string; kind: string; config: Record<string, unknown> }; onChange: () => void }) {
  const c = useWorkspaceCopy();
  const on = integration.config?.inbound === true;
  const [open, setOpen] = useState(false);
  const [appSecret, setAppSecret] = useState('');
  const [setup, setSetup] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) { await disableInbound(integration.id); setSetup(null); }
      else {
        const out = await enableInbound(integration.id, integration.kind === 'whatsapp' && appSecret ? { app_secret: appSecret.trim() } : {});
        const extra = Object.fromEntries(Object.entries(out).filter(([k, v]) => typeof v === 'string' && k !== 'ok')) as Record<string, string>;
        setSetup(Object.keys(extra).length ? extra : null);
        setAppSecret('');
      }
      onChange();
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      toast.error(code === 'numeric_chat_id_required' ? 'Telegram: chat_id (numeric)' : code === 'app_secret_required' ? c('cAppSecret') : c('kErr'));
    } finally { setBusy(false); }
  };

  return (
    <div className="fb-col mt-2 w-full gap-2 border-t pt-2" style={{ borderColor: 'var(--fb-border)' }}>
      <button type="button" className="flex items-center gap-2 self-start text-[13px]" onClick={() => setOpen(!open)}>
        <MessagesSquare size={14} /> {c('cTitle')} {on && <span className="fb-chip">{c('cIsOn')}</span>}
      </button>
      {open && (
        <div className="fb-col gap-2 text-[13px]">
          <p className="fb-dim">{c('cHelp')}</p>
          {integration.kind === 'whatsapp' && !on && (
            <input className="fb-input" type="password" autoComplete="off" value={appSecret} onChange={e => setAppSecret(e.target.value)} placeholder={c('cAppSecret')} />
          )}
          <button type="button" className="fb-btn fb-btn--ghost self-start" disabled={busy} onClick={() => void toggle()}>{on ? c('cOff') : c('cOn')}</button>
          {setup && (
            <div className="fb-col gap-1 rounded-lg border border-white/10 p-2 text-[12px]" dir="ltr">
              {integration.kind === 'whatsapp' && <span className="fb-dim">{c('cMetaHelp')}</span>}
              {Object.entries(setup).map(([k, v]) => (
                <div key={k}><b>{k === 'callback_url' || k === 'sms_webhook_url' ? c('cCallback') : k === 'verify_token' ? c('cVerify') : k}:</b> <code className="break-all">{v}</code></div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
