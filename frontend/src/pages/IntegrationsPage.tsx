import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plug, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Panel, StatusDot } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import {
  connectIntegration, disconnectIntegration, IntegrationError, LIVE_APPS, listIntegrations, PLANNED_APPS, testIntegration,
  type IntegrationKind, type IntegrationRow,
} from '../lib/company/integrations';
import { MANAGER_ROLES } from '../lib/company/types';
import '../styles/firbo.css';

const BRAND: Record<IntegrationKind, string> = { slack: 'Slack', discord: 'Discord', telegram: 'Telegram', webhook: 'Webhook' };

/** Connect the apps each company uses, and test them with one click. */
export function IntegrationsPage() {
  const { t, fmt } = useI18n();
  const { current } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canManage = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState<IntegrationKind | null>(null);
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!orgId || !canManage) return;
    try {
      setRows(await listIntegrations(orgId));
    } catch (err) {
      console.error(err);
      toast.error(t('int.loadError'));
    } finally {
      setLoaded(true);
    }
  }, [orgId, canManage, t]);

  useEffect(() => {
    setLoaded(false);
    void reload();
  }, [reload]);

  const errText = (err: unknown) => {
    const code = err instanceof IntegrationError ? err.code : 'unknown';
    return t(`int.err.${code === 'too_many' ? 'limit' : code}` as TKey);
  };

  const open = (kind: IntegrationKind) => {
    setAdding(kind);
    setName(BRAND[kind]);
    setValues({});
  };

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    if (!adding || busy) return;
    setBusy('connect');
    try {
      await connectIntegration(orgId, adding, name, values);
      toast.success(t('int.connectedOk', { app: name }));
      setAdding(null);
      await reload();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const test = async (r: IntegrationRow) => {
    setBusy(r.id);
    try {
      await testIntegration(r.id);
      toast.success(t('int.testOk', { app: r.name }));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
      await reload();
    }
  };

  const remove = async (r: IntegrationRow) => {
    if (!window.confirm(t('int.confirmDisconnect', { app: r.name }))) return;
    setBusy(r.id);
    try {
      await disconnectIntegration(r.id);
      await reload();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const def = LIVE_APPS.find((a) => a.kind === adding);

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-4 px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header>
          <div className="fb-eyebrow">{current?.organization.name}</div>
          <h1 className="mt-1 text-2xl font-semibold">{t('int.title')}</h1>
          <p className="fb-muted mt-1 text-sm">{t('int.sub')}</p>
        </header>

        {!canManage ? (
          <Panel title={t('int.title')}><p className="fb-muted text-sm">{t('int.managersOnly')}</p></Panel>
        ) : (
          <>
            <Panel title={t('int.connected')}>
              {!loaded ? (
                <p className="fb-dim text-sm">{t('common.loading')}</p>
              ) : rows.length === 0 ? (
                <p className="fb-dim text-sm">{t('int.empty')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {rows.map((r) => (
                    <li key={r.id} className="fb-row flex-wrap">
                      <StatusDot tone={r.status === 'active' ? 'ok' : 'err'} live={r.status === 'active'} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{r.name} <span className="fb-dim font-normal">· {BRAND[r.kind]}</span></div>
                        <div className="fb-dim text-xs">
                          {r.status === 'error' ? t('int.failing') : r.last_used_at ? t('int.lastUsed', { when: fmt.dateTime(r.last_used_at) }) : t('int.neverUsed')}
                        </div>
                      </div>
                      <button className="fb-btn fb-btn--ghost" style={{ height: 32, padding: '0 12px', fontSize: 13 }} disabled={busy !== null} onClick={() => void test(r)}>
                        <Send size={13} /> {busy === r.id ? t('common.loading') : t('int.test')}
                      </button>
                      <button className="fb-btn fb-btn--ghost" style={{ height: 32, padding: '0 10px' }} disabled={busy !== null} aria-label={t('int.disconnect')} title={t('int.disconnect')} onClick={() => void remove(r)}>
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t('int.available')}>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {LIVE_APPS.map((a) => (
                  <li key={a.kind}>
                    <button
                      onClick={() => open(a.kind)}
                      className="fb-row fb-glass--hover w-full cursor-pointer flex-col items-start gap-1.5 text-start"
                      style={adding === a.kind ? { borderColor: a.color } : undefined}
                    >
                      <span className="fb-dot" style={{ background: a.color, boxShadow: `0 0 10px ${a.color}` }} />
                      <span className="text-sm font-semibold">{BRAND[a.kind]}</span>
                      <span className="fb-dim text-xs">{t(`int.about.${a.kind}` as TKey)}</span>
                      <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--fb-accent)' }}><Plug size={12} /> {t('int.connect')}</span>
                    </button>
                  </li>
                ))}
              </ul>

              {adding && def && (
                <form onSubmit={connect} className="mt-4 rounded-xl p-4" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--fb-border)' }}>
                  <div className="text-sm font-semibold">{t('int.connectTitle', { app: BRAND[adding] })}</div>
                  <p className="fb-muted mt-1 text-sm">{t(`int.help.${adding}` as TKey)}</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="block text-xs">
                      <span className="fb-dim">{t('int.name')}</span>
                      <input className="fb-input mt-1" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
                    </label>
                    {def.fields.map((f) => (
                      <label key={f.key} className="block text-xs">
                        <span className="fb-dim">{t(`int.field.${f.key}` as TKey)}</span>
                        <input
                          className="fb-input mt-1"
                          type={f.secret ? 'password' : 'text'}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={f.placeholder}
                          value={values[f.key] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                          required
                        />
                      </label>
                    ))}
                  </div>
                  <p className="fb-dim mt-3 text-xs">{t('int.secretNote')}</p>
                  <div className="mt-3 flex gap-2">
                    <button className="fb-btn fb-btn--primary" disabled={busy !== null}>{busy === 'connect' ? t('int.connecting') : t('int.connectAndTest')}</button>
                    <button type="button" className="fb-btn fb-btn--ghost" onClick={() => setAdding(null)}>{t('common.close')}</button>
                  </div>
                </form>
              )}
            </Panel>

            <Panel title={t('int.soon')}>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {PLANNED_APPS.map((a) => (
                  <li key={a.id} className="fb-row py-2 opacity-70" title={t('int.soonHint')}>
                    <span className="fb-dot" style={{ background: a.color }} />
                    <span className="min-w-0 truncate text-xs font-medium">{a.name}</span>
                  </li>
                ))}
              </ul>
              <p className="fb-dim mt-3 text-xs">{t('int.soonHint')}</p>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
