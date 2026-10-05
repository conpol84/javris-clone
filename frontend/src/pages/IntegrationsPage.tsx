import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BarChart3, Plug, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '../components/ui/dialog';
import { Panel, StatusDot } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import {
  CATEGORIES, connectIntegration, disconnectIntegration, IntegrationError, LIVE_APPS, listIntegrations, OAUTH_CONSOLE, mcpCall, mcpTools, snapshotIntegration, startOAuth, testIntegration,
  type IntegrationKind, type IntegrationRow, type McpTool,
} from '../lib/company/integrations';
import { MANAGER_ROLES } from '../lib/company/types';
import '../styles/firbo.css';
import '../styles/connected-world.css';
import {beginConnection,connectionManifest,finishConnection,connectBridge,readConnection,disconnectConnection,isConnectedApp,type ConnectionManifest,type ConnectionSnapshot} from '../lib/company/connected-apps';
import {deviceMessages} from '../lib/company/device-messages';
import { TwoWayChannel } from '../components/company/TwoWayChannel';

const BRAND = Object.fromEntries(LIVE_APPS.map((a) => [a.kind, a.name])) as Record<IntegrationKind, string>;

/** Connect the apps each company uses, and test them with one click. */
export function IntegrationsPage(){const {current,user}=useCompanyAuth();return <IntegrationWorkspace key={`${user?.id??''}:${current?.organization.id??''}:${current?.role??''}`} />;}

function IntegrationWorkspace() {
  const { t, fmt, lang } = useI18n();
  const l=deviceMessages(lang);
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
  const [manifest,setManifest]=useState<ConnectionManifest|null>(null);
  const [manifestError,setManifestError]=useState(false);
  const [proof,setProof]=useState<ConnectionSnapshot|null>(null);
  const alive=useRef(true);
  const callback=useRef(new URLSearchParams(window.location.hash.slice(1)));
  const complete=useRef<Promise<unknown>|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{let active=true;if(!canManage||!orgId)return;
    connectionManifest(orgId).then(m=>{if(active)setManifest(m);}).catch(()=>{if(active)setManifestError(true);});
    const selected=params.get('connect');if(selected&&isConnectedApp(selected))open(selected);
    return()=>{active=false;};
  },[orgId,canManage]);
  useEffect(()=>{
    if(!canManage||!orgId||callback.current.get('firbo_connection')!=='1')return;
    const q=callback.current;
    window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
    if(q.get('error')){setBusy(null);return void toast.error(l.oauthFailed);}
    const state=q.get('state'),code=q.get('code');if(!state||!code)return;
    if(!complete.current)complete.current=finishConnection(state,code,q.get('realm_id')??undefined);
    let active=true;setBusy('connect');
    complete.current.then(()=>{if(active){toast.success(t('int.connectedOk',{app:'Account'}));void reload();}}).catch(()=>{if(active)toast.error(l.oauthFailed);}).finally(()=>{if(active)setBusy(null);});
    return()=>{active=false;};
  },[orgId,canManage]);
  const newStatus=(kind:string)=>[...(manifest?.providers??[]),...(manifest?.bridges??[])].find(p=>p.kind===kind);


  const reload = useCallback(async () => {
    if (!orgId || !canManage) return;
    try {
      const next=await listIntegrations(orgId);if(alive.current)setRows(next);
    } catch (err) {
      console.error(err);
      toast.error(t('int.loadError'));
    } finally {
      if(alive.current)setLoaded(true);
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
    if (ok && !isConnectedApp(ok)) toast.success(t('int.oauth.done', { app: BRAND[ok as IntegrationKind] ?? ok }));
    else toast.error(bad === 'plan_limit' ? t('int.err.limit') : t('int.oauth.failed', { code: String(bad).slice(0, 40) }));
    setParams({}, { replace: true });
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errText = (err: unknown) => {
    if(err instanceof Error && !(err instanceof IntegrationError))return l.oauthFailed;
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
      const {url}=isConnectedApp(adding)?await beginConnection(orgId,adding,name):await startOAuth(orgId,adding,name,values);
      if(alive.current)window.location.assign(url);
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
      if(isConnectedApp(adding))await connectBridge(orgId,adding,name,values);else await connectIntegration(orgId,adding,name,values);
      if(!alive.current)return;
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
      if(isConnectedApp(r.kind)){const response=await readConnection(r.id);if(alive.current)setProof(response);}
      else if (r.kind === 'mcp') await mcpTools(r.id);
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
      if(isConnectedApp(r.kind)){const response=await readConnection(r.id);if(alive.current)setProof(response);return;}
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
      if(isConnectedApp(r.kind)){const result=await disconnectConnection(r.id);if(alive.current)toast.message(result.provider_revocation==='manual'?l.revokeManual:l.revoked);}
      else await disconnectIntegration(r.id);
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
        <header className="cw-app-head">
          <div className="fb-eyebrow">{current?.organization.name}</div>
          <h1 className="mt-1 text-2xl font-semibold">{t('int.title')}</h1>
          <p className="fb-muted mt-1 text-sm">{t('int.sub')}</p>
          <Link to="/computers" className="fb-btn fb-btn--ghost">{l.deviceLink} →</Link>
          <Link to="/hub" className="mt-2 inline-block text-sm font-medium" style={{ color: 'var(--fb-accent)' }}>{t('hub.title')} →</Link>
        </header>

        {!canManage ? (
          <Panel title={t('int.title')}><p className="fb-muted text-sm">{t('int.managersOnly')}</p></Panel>
        ) : (
          <>
            <Panel title={l.returnApps}>
              <ul className="cw-app-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {LIVE_APPS.filter(a=>isConnectedApp(a.kind)).map(a=><li key={a.kind}><button className="fb-row fb-glass--hover h-full w-full !flex-col !items-start gap-2 !text-start" onClick={()=>open(a.kind)} data-connection-kind={a.kind}>
                  <span className="fb-chip" style={{color:a.color}}>{a.name}</span><strong className="text-sm">{about(a)}</strong>
                  <span className="fb-dim text-xs">{l.readOnly} · {newStatus(a.kind)?.configured&&newStatus(a.kind)?.enabled?l.configured:l.needsSetup}</span>
                  <span className="text-xs" style={{color:'var(--fb-accent)'}}>{l.setup} →</span>
                </button></li>)}
              </ul>
              <p className="fb-dim mt-4 text-xs">{l.providerPolicy}</p>
              {manifestError&&<p role="status" className="cw-readiness">{l.operatorSetup}</p>}
            </Panel>
            {proof&&<section className="cw-proof" role="region" aria-label={l.snapshot}><div className="flex items-center justify-between gap-3"><strong>{l.snapshot} · {proof.account}</strong><button className="fb-btn fb-btn--ghost" onClick={()=>setProof(null)}>{l.close}</button></div><p className="fb-dim text-xs">{fmt.dateTime(proof.observed_at)} · {l.readOnly}</p>{proof.sampled&&<p className="text-xs">{l.sample}</p>}<ul>{proof.rows.map(r=><li key={r.id}><strong>{r.label}</strong><pre>{r.detail??r.state??''}</pre></li>)}</ul></section>}
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
                      {LIVE_APPS.find((a) => a.kind === r.kind)?.readOnly && !r.kind.endsWith('_read') && (
                        <button className="fb-btn fb-btn--ghost" style={{ height: 32, padding: '0 12px', fontSize: 13 }} disabled={busy !== null} onClick={() => void peek(r)}>
                          <BarChart3 size={13} /> {t('int.snapshot')}
                        </button>
                      )}
                      <button className="fb-btn fb-btn--ghost" style={{ height: 32, padding: '0 10px' }} disabled={busy !== null} aria-label={t('int.disconnect')} title={t('int.disconnect')} onClick={() => void remove(r)}>
                        <Trash2 size={14} />
                      </button>
                      {['telegram', 'whatsapp', 'twilio'].includes(r.kind) && canManage && <TwoWayChannel integration={r} onChange={() => void reload()} />}
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
                    {LIVE_APPS.filter((a) => a.cat === cat && !isConnectedApp(a.kind)).map((a) => (
                      <li key={a.kind}>
                        <button
                          onClick={() => open(a.kind)}
                          className="fb-row fb-glass--hover h-full w-full cursor-pointer !flex-col !items-start gap-1.5 !text-start"
                          style={adding === a.kind ? { borderColor: a.color } : undefined}
                        >
                          <span className="grid h-9 w-9 place-items-center rounded-xl text-sm font-bold" style={{ background: `${a.color}22`, border: `1px solid ${a.color}55`, color: a.color }}>{a.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase()}</span>
                          <span className="text-sm font-semibold">{a.name}</span>
                          <span className="fb-dim text-xs">{about(a)}</span>
                          <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-medium" style={{ color: 'var(--fb-accent)' }}><Plug size={12} /> {t('int.connect')}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <Dialog open={!!adding} onOpenChange={v=>{if(!v)setAdding(null);}}>
              {adding && def && (
                <DialogContent className="cw-connect-dialog sm:max-w-2xl"><div className="fb-root" style={{minHeight:0,overflowX:'visible',background:'none'}}>
                <form onSubmit={def.oauth ? signIn : connect} className="rounded-xl p-2" id="connection-setup" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid var(--fb-border)' }}>
                  <DialogTitle>{t('int.connectTitle', { app: BRAND[adding] })}</DialogTitle>
                  <DialogDescription className="fb-muted mt-2 text-sm">{help(def)}</DialogDescription>
                  {isConnectedApp(adding)&&<div className="cw-readiness" role="status">
                    <strong>{newStatus(adding)?.configured&&newStatus(adding)?.enabled?l.configured:l.needsSetup}</strong>
                    {(!newStatus(adding)?.configured||!newStatus(adding)?.enabled)&&<p>{l.operatorSetup}</p>}
                    {manifest?.providers.find(x=>x.kind===adding)?.broad_provider_scope&&<p>{l.broadScope}</p>}
                    {manifest?.redirect_uri&&def.oauth&&<><span>{t('int.oauth.redirect')}</span><code dir="ltr">{manifest.redirect_uri}</code></>}
                    {oauthInfo&&<><code dir="ltr">{oauthInfo.secrets}</code><a href={oauthInfo.url} target="_blank" rel="noreferrer" className="fb-btn fb-btn--ghost">{oauthInfo.label} →</a></>}
                  </div>}
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
                    <button className="fb-btn fb-btn--primary" disabled={busy !== null || (isConnectedApp(adding) && (!newStatus(adding)?.configured || !newStatus(adding)?.enabled))}>{busy === 'connect' ? t('int.connecting') : def.oauth ? t('int.signIn', { provider: oauthInfo?.label.split(' ')[0] ?? '' }) : t('int.connectAndTest')}</button>
                    <button type="button" className="fb-btn fb-btn--ghost" onClick={() => setAdding(null)}>{t('common.close')}</button>
                  </div>
                </form></div></DialogContent>
              )}</Dialog>
            </Panel>


          </>
        )}
      </div>
    </div>
  );
}
