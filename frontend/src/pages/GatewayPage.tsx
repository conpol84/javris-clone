import { RefreshCw } from 'lucide-react';
import { Panel, StatusDot } from '../components/command/Panel';
import { ProviderTopology } from '../components/command/ProviderTopology';
import { STRATEGY_INFO, useGateway } from '../lib/gateway';
import '../styles/firbo.css';

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="fb-glass p-4">
      <div className="fb-eyebrow">{label}</div>
      <div className="fb-grad-text mt-2 text-3xl font-bold tabular-nums">{value}</div>
      {hint && <div className="fb-dim mt-1 text-xs">{hint}</div>}
    </div>
  );
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toLocaleString());

export function GatewayPage() {
  const gw = useGateway();
  const data = gw.status === 'ready' ? gw.data : null;
  const online = !!data?.connected;

  const modelsByProvider = new Map(data?.models.providers.map((p) => [p.provider, p.models]));
  const stats = new Map((data?.stats ?? []).map((s) => [s.provider.toLowerCase(), s]));
  const requests = (data?.stats ?? []).reduce((sum, s) => sum + s.requests, 0);

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1300px] space-y-4 px-4 pb-6 pt-14 md:px-6 md:pt-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="fb-eyebrow">Model routing</div>
            <h1 className="mt-1 text-2xl font-semibold">AI Gateway</h1>
            <p className="fb-muted mt-1 text-sm">One endpoint for every model — routing, fallback and cost control for all your agents.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="fb-chip">
              <StatusDot tone={gw.status === 'loading' ? 'idle' : online ? 'ok' : 'err'} live={online} />
              {gw.status === 'loading' ? 'CHECKING' : gw.status === 'unreachable' ? 'BACKEND UNREACHABLE' : online ? 'CONNECTED' : 'OFFLINE'}
            </span>
            <button className="fb-btn fb-btn--ghost" style={{ height: 34, padding: '0 12px' }} onClick={gw.reload} aria-label="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </header>

        {gw.status === 'unreachable' && (
          <Panel title="Backend not reachable">
            <p className="fb-muted text-sm">
              This page reads the gateway through the Firbo backend ({gw.reason}). Make sure the backend is running and its URL is configured, then refresh.
            </p>
          </Panel>
        )}

        {data && !online && (
          <Panel title="Gateway offline">
            <p className="fb-muted text-sm">
              The backend can't reach the gateway at <code>{data.host}</code>. Start it and set these on the backend:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-xl p-3 text-xs" style={{ background: 'rgba(5,10,20,.8)', border: '1px solid var(--fb-border)' }}>
{`OMNIROUTE_HOST=http://localhost:20128
OMNIROUTE_MANAGEMENT_KEY=<API key with manage scope>`}
            </pre>
          </Panel>
        )}

        {data && online && Object.keys(data.errors).length > 0 && (
          <p className="fb-chip" style={{ color: 'var(--fb-warn)' }}>
            Some data is unavailable: {Object.entries(data.errors).map(([k, v]) => `${k} (${v})`).join(', ')}.
            {data.errors.providers === 'unauthorized' && ' Set OMNIROUTE_MANAGEMENT_KEY to a key with manage scope.'}
          </p>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Providers connected" value={data ? data.connections.length : '–'} />
          <Stat label="Models available" value={data ? fmt(data.models.total) : '–'} />
          <Stat label="Combos" value={data ? data.combos.length : '–'} hint="Routing chains" />
          <Stat label="Requests routed" value={data ? fmt(requests) : '–'} />
        </section>

        <Panel title="Provider topology" className="!p-2">
          <div className="h-[420px] md:h-[500px]">
            <ProviderTopology data={data} online={online} />
          </div>
        </Panel>

        <Panel title="Providers">
          {!data || data.connections.length === 0 ? (
            <p className="fb-dim text-sm">{online ? 'No providers connected yet. Connect one in the gateway dashboard.' : 'Connect the gateway to see providers.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="fb-table">
                <thead>
                  <tr>
                    {['Provider', 'Accounts', 'Healthy', 'Limited', 'Models', 'Requests', 'Success', 'Latency', 'Tokens'].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.connections.map((c) => {
                    const s = stats.get(c.provider.toLowerCase());
                    return (
                      <tr key={c.provider}>
                        <td className="font-medium">
                          <span className="inline-flex items-center gap-2">
                            <StatusDot tone={c.limited ? 'warn' : c.healthy ? 'ok' : 'idle'} />
                            {c.provider}
                          </span>
                        </td>
                        <td>{c.active}/{c.connections}</td>
                        <td>{c.healthy}</td>
                        <td style={{ color: c.limited ? 'var(--fb-warn)' : undefined }}>{c.limited}</td>
                        <td>{fmt(modelsByProvider.get(c.provider))}</td>
                        <td>{fmt(s?.requests)}</td>
                        <td>{s?.success_rate == null ? '–' : `${Math.round(s.success_rate * 100)}%`}</td>
                        <td>{s?.avg_latency_ms == null ? '–' : `${s.avg_latency_ms} ms`}</td>
                        <td>{s ? fmt(s.tokens_in + s.tokens_out) : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Combos (routing chains)">
          {data && data.combos.length > 0 ? (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.combos.map((c) => (
                <li key={c.name} className="fb-row fb-col gap-1">
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{c.name}</span>
                    <span className="fb-chip">{c.strategy}</span>
                  </div>
                  <div className="fb-dim text-xs">
                    {c.steps} step{c.steps === 1 ? '' : 's'} · {STRATEGY_INFO[c.strategy] ?? 'Custom strategy'}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fb-dim text-sm">
              {online ? 'No custom combos yet. The built-in "auto" route picks the best available model for each request.' : 'Connect the gateway to see combos.'}
            </p>
          )}
        </Panel>

        <Panel title="Routing strategies supported">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Object.entries(STRATEGY_INFO).map(([k, v]) => (
              <li key={k} className="fb-row py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{k}</div>
                  <div className="fb-dim truncate text-xs">{v}</div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
