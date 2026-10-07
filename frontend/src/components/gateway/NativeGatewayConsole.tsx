import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ServiceAccessPanel } from './ServiceAccessPanel';
import { useI18n } from '../../i18n/I18nProvider';
import { gatewayGet, gatewayPost } from '../../lib/gateway';
import { controlLabels } from './firboControlLabels';
import { parseControl, parseModelLines, parseSession, type FirboCombo, type FirboControl, type FirboSession } from './nativeControl';

export function useFirboSession() {
  const [version, reload] = useState(0);
  const [state, setState] = useState<{ loading: boolean; data: FirboSession | null; error: boolean }>({ loading: true, data: null, error: false });
  useEffect(() => {
    let live = true;
    setState({ loading: true, data: null, error: false });
    gatewayGet<unknown>('/v1/firbo/session').then(parseSession)
      .then(data => { if (live) setState({ loading: false, data, error: false }); })
      .catch(() => { if (live) setState({ loading: false, data: null, error: true }); });
    return () => { live = false; };
  }, [version]);
  return { ...state, reload: () => reload(v => v + 1) };
}

export function GatewayUnavailable({ loading = false, retry, adminServices = false }: { loading?: boolean; retry: () => void; adminServices?: boolean }) {
  const { lang } = useI18n();
  const l = controlLabels[lang];
  return <div className="fb-root h-full overflow-y-auto"><div className="mx-auto max-w-3xl space-y-4 px-4 pt-16">
    {adminServices && <ServiceAccessPanel />}
    <h1 className="text-2xl font-semibold">{l.title}</h1>
    <p role={loading ? 'status' : 'alert'} className="fb-muted">{loading ? l.loading : l.unavailable}</p>
    {!loading && <button type="button" className="fb-btn fb-btn--ghost" onClick={retry}>{l.retry}</button>}
  </div></div>;
}

export function WorkspaceGatewayPanel({ data }: { data: FirboSession }) {
  const { lang, fmt } = useI18n();
  const l = controlLabels[lang];
  return <div className="fb-root h-full overflow-y-auto"><div className="mx-auto max-w-4xl space-y-5 px-4 pb-8 pt-16 md:pt-6">
    <h1 className="text-2xl font-semibold">{l.workspace}</h1>
    <p className="fb-muted">{l.managed}</p>
    <h2 className="text-lg font-semibold">{l.companies} · {fmt.number(data.companies.length)}</h2>
    {data.companies.length === 0 ? <p>{l.noCompanies}</p> : <div className="grid gap-3 md:grid-cols-2">{data.companies.map(c =>
      <section key={c.id} className="fb-glass p-4"><h3 className="font-semibold">{c.name}</h3><p className="fb-muted mt-2 text-sm">{l.role}: {c.role}</p></section>)}</div>}
    {data.has_more && <p className="fb-muted" role="status">{l.partial}</p>}
  </div></div>;
}

function ComboEditor({ combo, canWrite, onSaved }: { combo: FirboCombo; canWrite: boolean; onSaved: () => void }) {
  const { lang } = useI18n();
  const l = controlLabels[lang];
  const [text, setText] = useState(combo.models.join('\n'));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || !combo.managed || !combo.editable || busy) return;
    setNotice(''); setBusy(true);
    try {
      const models = parseModelLines(text);
      const result = await gatewayPost<{ ok: boolean }>('/v1/firbo/control/combos/' + encodeURIComponent(combo.name), { expected_revision: combo.revision, models });
      if (result.ok !== true) throw new Error('unconfirmed');
      onSaved();
    } catch (error) {
      setNotice((error as Error & { status?: number })?.status === 409 ? l.conflict : l.failed);
    } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="fb-glass space-y-3 p-4" aria-label={combo.name}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{combo.name}</h3><span className="fb-chip">{combo.strategy}</span></div>
    <label className="block text-sm"><span className="fb-muted">{l.modelHint}</span><textarea className="mt-2 min-h-28 w-full rounded-xl border p-3 font-mono text-xs" style={{ background: 'var(--fb-bg)', borderColor: 'var(--fb-border)' }}
      value={text} onChange={event => setText(event.target.value)} readOnly={!canWrite || !combo.managed || !combo.editable} disabled={busy} maxLength={3700} dir="ltr" /></label>
    {combo.managed && <button type="submit" className="fb-btn fb-btn--primary" disabled={!canWrite || !combo.editable || busy}>{busy ? l.loading : l.save}</button>}
    {notice && <p role="alert" className="text-sm">{notice}</p>}
  </form>;
}

/** Native Firbo UI; there is intentionally no iframe, gateway cookie or API-key field. */
export function NativeGatewayConsole() {
  const { lang, fmt } = useI18n();
  const l = controlLabels[lang];
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<FirboControl | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true); setData(null);
    gatewayGet<unknown>('/v1/firbo/control').then(parseControl)
      .then(value => { if (live) { setData(value); setLoading(false); } })
      .catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [version]);
  const reload = () => setVersion(v => v + 1);
  if (loading || !data) return <GatewayUnavailable loading={loading} retry={reload} adminServices />;
  const shown = data.models.filter(m => (m.id + ' ' + m.provider).toLowerCase().includes(query.toLowerCase())).slice(0, 100);
  return <div className="fb-root h-full overflow-y-auto"><div className="mx-auto max-w-[1300px] space-y-5 px-4 pb-8 pt-16 md:px-6 md:pt-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{l.title}</h1><p className="fb-muted mt-2 text-sm">{l.intro}</p></div>
      <div className="flex gap-2"><Link to="/admin?tab=overview" className="fb-btn fb-btn--ghost">{l.back}</Link><button type="button" className="fb-btn fb-btn--ghost" onClick={reload}>{l.retry}</button></div></header>
    <ServiceAccessPanel />
    <div className="flex flex-wrap gap-3"><span className="fb-chip">{data.reachable ? l.connected : l.disconnected}</span><span className="fb-chip">{l.models}: {fmt.number(data.models.length)}</span></div>
    {!data.available && <div role="alert" className="fb-glass p-4"><p>{l.partial}</p><pre className="mt-2 overflow-x-auto text-xs">{Object.entries(data.errors).map(([name, error]) => `${name}: ${error}`).join('\n')}</pre></div>}
    {!data.writes_enabled && <p className="fb-muted" role="status">{l.readonly}</p>}
    {saved && <p role="status">{l.saved}</p>}
    <section className="space-y-3"><h2 className="text-lg font-semibold">{l.providers}</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.providers.map(p =>
      <div key={p.id} className="fb-glass p-4"><h3 className="font-semibold">{p.name || p.provider}</h3><p className="fb-muted mt-2 text-sm">{p.provider} · {p.active ? l.active : l.inactive} · {p.status}</p></div>)}</div>{!data.providers.length && <p>{l.empty}</p>}</section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">{l.routes}</h2><div className="grid gap-3 lg:grid-cols-2">{data.combos.map(c =>
      <ComboEditor key={c.name + c.revision} combo={c} canWrite={data.writes_enabled} onSaved={() => { setSaved(true); reload(); }} />)}</div>{!data.combos.length && <p>{l.empty}</p>}</section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">{l.models}</h2><label className="block"><span className="sr-only">{l.search}</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={l.search} className="w-full rounded-xl border p-3" style={{ background: 'var(--fb-bg)', borderColor: 'var(--fb-border)' }} /></label>
      <div className="max-h-96 overflow-y-auto rounded-xl border p-3" style={{ borderColor: 'var(--fb-border)' }}>{shown.map(m => <div key={m.id} className="fb-row py-2"><code dir="ltr" className="break-all text-xs">{m.id}</code><span className="fb-dim text-xs">{m.provider}</span></div>)}</div>
    </section>
  </div></div>;
}
