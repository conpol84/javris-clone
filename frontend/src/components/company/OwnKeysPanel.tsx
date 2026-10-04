import { useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import { Panel } from '../command/Panel';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
import { OWN_KEY_PROVIDERS, OwnKeyFailure, removeOwnKey, saveOwnKey, type OwnKeyProvider } from '../../lib/company/ownKeys';
import { planHas, useOwnKeys, usePlanUsage } from '../../lib/company/usePlan';

/** Pro / Business / Enterprise: connect the company's own OpenAI, Anthropic, ... keys. */
export function OwnKeysPanel({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { t } = useI18n();
  const plan = usePlanUsage(orgId);
  const allowed = planHas(plan, 'byo_keys');
  const [rows, reload] = useOwnKeys(orgId);
  const [open, setOpen] = useState<OwnKeyProvider | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = (err: unknown) => {
    const code = err instanceof OwnKeyFailure ? err.code : 'unknown';
    const msg: Record<string, TKey> = {
      invalid_key: 'keys.err.invalid',
      provider_unreachable: 'keys.err.unreachable',
      plan_limit: 'keys.locked',
      forbidden: 'keys.err.forbidden',
    };
    toast.error(t(msg[code] ?? 'keys.err.save'));
  };

  const save = async (provider: OwnKeyProvider) => {
    if (key.trim().length < 20) return toast.error(t('keys.err.short'));
    setBusy(true);
    try {
      const out = await saveOwnKey(orgId, provider, key.trim());
      toast.success(t('keys.saved', { count: out.models.length }));
      setKey('');
      setOpen(null);
      reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (provider: OwnKeyProvider) => {
    setBusy(true);
    try {
      await removeOwnKey(orgId, provider);
      toast.success(t('keys.removed'));
      reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t('keys.title')} right={<KeyRound size={16} className="fb-dim" />}>
      <p className="fb-muted mb-3 text-sm">{t('keys.sub')}</p>
      {plan && !allowed && (
        <div className="mb-3 rounded-xl p-3 text-sm" style={{ border: '1px solid var(--fb-border)', background: 'rgba(251,191,36,0.08)' }}>
          {t('keys.locked')}{' '}
          <a className="fb-link font-semibold" href="/billing">
            {t('bill.seePlans')}
          </a>
        </div>
      )}
      <ul className="grid gap-2">
        {OWN_KEY_PROVIDERS.map((p) => {
          const row = rows.find((r) => r.provider === p.id);
          const editing = open === p.id;
          return (
            <li key={p.id} className="rounded-xl p-3" style={{ border: '1px solid var(--fb-border)' }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{p.name}</span>
                  <span className="fb-dim block text-xs">
                    {row ? t('keys.connected', { hint: row.key_hint, count: row.models.length }) : t('keys.notConnected')}
                  </span>
                </span>
                {canManage && allowed && !editing && (
                  <button className="fb-btn fb-btn--ghost shrink-0 whitespace-nowrap" disabled={busy} onClick={() => (setOpen(p.id), setKey(''))}>
                    {row ? t('keys.replace') : t('keys.connect')}
                  </button>
                )}
                {canManage && row && !editing && (
                  <button className="fb-btn fb-btn--ghost shrink-0" style={{ color: 'var(--fb-warn)' }} disabled={busy} aria-label={t('keys.remove')} onClick={() => void remove(p.id)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              {editing && (
                <div className="mt-3 fb-col gap-2">
                  <input
                    className="fb-input font-mono text-xs"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    dir="ltr"
                    placeholder={t('keys.placeholder', { name: p.name })}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void save(p.id)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="fb-btn shrink-0 whitespace-nowrap" disabled={busy} onClick={() => void save(p.id)}>
                      {busy ? t('keys.checking') : t('keys.save')}
                    </button>
                    <button className="fb-btn fb-btn--ghost shrink-0" disabled={busy} onClick={() => setOpen(null)}>
                      {t('keys.cancel')}
                    </button>
                    <a className="fb-link inline-flex items-center gap-1 text-xs" href={p.keysUrl} target="_blank" rel="noreferrer">
                      {t('keys.getKey', { name: p.name })} <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="fb-dim mt-3 text-xs">{t('keys.how')}</p>
    </Panel>
  );
}
