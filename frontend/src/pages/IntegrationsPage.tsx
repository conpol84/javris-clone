import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BarChart3, Plug, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Panel, StatusDot } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import {
  CATEGORIES, connectIntegration, disconnectIntegration, IntegrationError, LIVE_APPS, listIntegrations, OAUTH_CONSOLE, PLANNED_APPS, mcpCall, mcpTools, snapshotIntegration, startOAuth, testIntegration,
  type IntegrationKind, type IntegrationRow, type McpTool,
} from '../lib/company/integrations';
import { MANAGER_ROLES } from '../lib/company/types';
import '../styles/firbo.css';

const BRAND = Object.fromEntries(LIVE_APPS.map((a) => [a.kind, a.name])) as Record<IntegrationKind, string>;

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
  const [setup, setSetup] = useState<{ provider: string; redirect: string } | null>(null);
  const [params, setParams] = useSearchParams();
  const [mcpOpen, setMcpOpen] = useState<string | null>(null);
  const [mcpList, setMcpList] = useState<McpTool[]>([]);
  const [mcpTool, setMcpTool] = useState('');
  const [mcpArgs, setMcpArgs] = useState('{}');
  const [mcpOut, setMcpOut] = useState('');

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

  // Back from a provider's sign-in page: ?connected=gmail or ?oauth_error=…
  useEffect(() => {
    const ok = params.get('connected');
    const bad = params.get('oauth_error');
    if (!ok && !bad) return;
    if (ok) toast.success(t('int.oauth.done', { app: BRAND[ok as IntegrationKind] ?? ok }));
    else toast.error(bad === 'plan_limit' ? t('int.err.limit') : t('int.oauth.failed', { code: String(bad).slice(0, 40) }));
    setParams({}, { replace: true });
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errText = (err: unknown) => {
    const code = err instanceof IntegrationError ? err.code : 'unknown';
    return t(`int.err.${code === 'too_many' ? 'limit' : code}` as TKey);
  };

  const open = (kind: IntegrationKind) => {
    setAdding(kind);
    setName(BRAND[kind]);
    setValues({});
    setSetup(null);
  };

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!adding || busy) return;
    setBusy('connect');
    try {
      const { url } = await startOAuth(orgId, adding, name, values);
      window.location.assign(url);
    } catch (err) {
      if (err instanceof IntegrationError && err.code === 'not_configured' && err.detail?.redirect_uri) setSetup({ provider: err.detail.provider ?? '', redirect: err.detail.redirect_uri });
      else toast.error(errText(err));
      setBusy(null);
    }
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

  const toggleMcp = async (r: IntegrationRow) => {
    if (mcpOpen === r.id) return setMcpOpen(null);
    setBusy(r.id);
    try {
      const { tools } = await mcpTools(r.id);
      setMcpList(tools);
      setMcpTool(tools[0]?.name ?? '');
      setMcpArgs('{}');
      setMcpOut('');
      setMcpOpen(r.id);
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
      await reload();
    }
  };

  const runMcp = async (r: IntegrationRow) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(mcpArgs || '{}');
    } catch {
      return void toast.error(t('int.mcp.badJson'));
    }
    setBusy(r.id);
    try {
      const out = await mcpCall(r.id, mcpTool, args);
      setMcpOut(out.text || '(empty)');
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const test = async (r: IntegrationRow) => {
    setBusy(r.id);
    try {
      if (r.kind === 'mcp') await mcpTools(r.id);
      else await testIntegration(r.id);
      toast.success(t('int.testOk', { app: r.name }));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
      await reload();
    }
  };

  const peek = async (r: IntegrationRow) => {
    setBusy(r.id);
    try {
      const { text } = await snapshotIntegration(r.id);
      toast.message(r.name, { description: text, duration: 15000 });
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
  const about = (a: (typeof LIVE_APPS)[number]) => a.about ?? t(`int.about.${a.kind}` as TKey);
  const help = (a: (typeof LIVE_APPS)[number]) => a.help ?? t(`int.help.${a.kind}` as TKey);
  const oauthInfo = def?.oauth ? OAUTH_CONSOLE[def.oauth] : null;

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-4 px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header>
          <div className="fb-eyebrow">{current?.organization.name}</div>
          <h1 className="mt-1 text-2xl font-semibold">{t('int.title')}</h1>
          <p className="fb-muted mt-1 text-sm">{t('int.sub')}</p>
          <Link to="/hub" className="mt-2 inline-block text-sm font-medium" style={{ color: 'var(--fb-accent)' }}>{t('hub.title')} →</Link>
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
                      {r.kind === 'mcp' && (
                        <button className="fb-btn fb-btn--ghost" style={{ height: 32, padding: '0 12px', fontSize: 13 }} disabled={busy !== null} onClick={() => void toggleMcp(r)}>
                          <Plug size={13} /> {t('int.mcp.tools')}
                        </button>
                      )}
                      {LIVE_APPS.find((a) => a.kind === r.kind)?.readOnly && (
                        <button className="fb-btn fb-btn--ghost" style={{ height: 32, padding: '0 12px', fontSize: 13 }} disabled={busy !== null} onClick={() => void peek(r)}>
                          <BarChart3 size={13} /> {t('int.snapshot')}
                        </button>
                      )}
                      <button className="fb-btn fb-btn--ghost" style={{ height: 32, padding: '0 10px' }} disabled={busy !== null} aria-label={t('int.disconnect')} title={t('int.disconnect')} onClick={() => void remove(r)}>
                        <Trash2 size={14} />
                      </button>
                      {mcpOpen === r.id && (
                        <div className="fb-col mt-2 w-full gap-2 border-t pt-3" style={{ borderColor: 'var(--fb-border)' }}>
                          {mcpList.length === 0 ? (
                            <p className="fb-dim text-xs">{t('int.mcp.none')}</p>
                          ) : (
                            <>
                              <select className="fb-input" value={mcpTool} onChange={(e) => setMcpTool(e.target.value)} aria-label={t('int.mcp.tools')}>
                                {mcpList.map((m) => (
                                  <option key={m.name} value={m.name}>{m.name}{m.description ? ` — ${m.description.slice(0, 60)}` : ''}</option>
                                ))}
                              </select>
                              <textarea className="fb-input" rows={3} spellCheck={false} value={mcpArgs} onChange={(e) => setMcpArgs(e.target.value)} placeholder='{"query": "…"}' aria-label={t('int.mcp.args')} style={{ fontFamily: 'monospace', padding: 10 }} />
                              <button className="fb-btn fb-btn--primary self-start" disabled={busy !== null || !mcpTool} onClick={() => void runMcp(r)}>{t('int.mcp.run')}</button>
                              {mcpOut && <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs" style={{ background: 'rgba(0,0,0,.35)' }}>{mcpOut}</pre>}
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t('int.available')}>
              {CATEGORIES.map((cat) => (
                <div key={cat} className="mb-4">
                  <div className="fb-eyebrow mb-2">{t(`int.cat.${cat}` as TKey)}</div>
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {LIVE_APPS.filter((a) => a.cat === cat).map((a) => (
                      <li key={a.kind}>
                        <button
                          onClick={() => open(a.kind)}
                          className="fb-row fb-glass--hover w-full cursor-pointer flex-col items-start gap-1.5 text-start"
                          style={adding === a.kind ? { borderColor: a.color } : undefined}
                        >
                          <span className="fb-dot" style={{ background: a.color, boxShadow: `0 0 10px ${a.color}` }} />
                          <span className="text-sm font-semibold">{a.name}</span>
                          <span className="fb-dim text-xs">{about(a)}</span>
                          <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--fb-accent)' }}><Plug size={12} /> {t('int.connect')}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {adding && def && (
                <form onSubmit={def.oauth ? signIn : connect} className="mt-4 rounded-xl p-4" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--fb-border)' }}>
                  <div className="text-sm font-semibold">{t('int.connectTitle', { app: BRAND[adding] })}</div>
                  <p className="fb-muted mt-1 text-sm">{help(def)}</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="block text-xs">
                      <span className="fb-dim">{t('int.name')}</span>
                      <input className="fb-input mt-1" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
                    </label>
                    {def.fields.map((f) => (
                      <label key={f.key} className="block text-xs">
                        <span className="fb-dim">{f.label ?? t(`int.field.${f.key}` as TKey)}{f.optional ? ` (${t('int.optional')})` : ''}</span>
                        <input
                          className="fb-input mt-1"
                          type={f.secret ? 'password' : 'text'}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={f.placeholder}
                          value={values[f.key] ?? ''}
                          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                          required={!f.optional}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="fb-dim mt-3 text-xs">{def.oauth ? t('int.oauth.note', { provider: oauthInfo?.label.split(' ')[0] ?? '' }) : t('int.secretNote')}</p>
                  {setup && oauthInfo && (
                    <div className="mt-3 rounded-xl p-3 text-xs" role="status" style={{ background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.35)' }}>
                      <div className="mb-1 text-sm font-semibold">{t('int.oauth.setupTitle', { provider: oauthInfo.label })}</div>
                      <p className="fb-muted">{t('int.oauth.setupBody', { names: oauthInfo.secrets })}</p>
                      <div className="fb-dim mt-2">{t('int.oauth.redirect')}</div>
                      <code className="mt-1 block break-all rounded-lg p-2" dir="ltr" style={{ background: 'rgba(0,0,0,.35)' }}>{setup.redirect}</code>
                      <a className="mt-2 inline-block font-medium" style={{ color: 'var(--fb-accent)' }} href={oauthInfo.url} target="_blank" rel="noreferrer">{oauthInfo.label} →</a>
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button className="fb-btn fb-btn--primary" disabled={busy !== null}>{busy === 'connect' ? t('int.connecting') : def.oauth ? t('int.signIn', { provider: oauthInfo?.label.split(' ')[0] ?? '' }) : t('int.connectAndTest')}</button>
                    <button type="button" className="fb-btn fb-btn--ghost" onClick={() => setAdding(null)}>{t('common.close')}</button>
                  </div>
                </form>
              )}
            </Panel>

            <Panel title={t('int.soon')}>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {PLANNED_APPS.map((a) => (
                  <li key={a.id} className="fb-row py-2 opacity-70" title={a.reason}>
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
