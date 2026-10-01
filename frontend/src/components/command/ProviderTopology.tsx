import { useI18n } from '../../i18n/I18nProvider';
import type { GatewayOverview } from '../../lib/gateway';

interface Node {
  id: string;
  label: string;
  models: number;
  tone: 'ok' | 'warn' | 'idle' | 'off';
  connected: boolean;
}

const TONE = { ok: '#34d399', warn: '#fbbf24', idle: '#22d3ee', off: '#5b7494' } as const;

export function buildNodes(data: GatewayOverview, max = 14): Node[] {
  const models = new Map(data.models.providers.map((p) => [p.provider, p.models]));
  const nodes: Node[] = data.connections.map((c) => ({
    id: c.provider,
    label: c.provider,
    models: models.get(c.provider) ?? 0,
    tone: c.limited > 0 ? 'warn' : c.active === 0 ? 'off' : c.healthy > 0 ? 'ok' : 'idle',
    connected: true,
  }));
  const have = new Set(nodes.map((n) => n.id));
  for (const p of data.models.providers) {
    if (nodes.length >= max) break;
    if (!have.has(p.provider)) {
      nodes.push({ id: p.provider, label: p.provider, models: p.models, tone: 'off', connected: false });
    }
  }
  return nodes.slice(0, max);
}

/** Animated gateway map: the hub in the middle, one node per provider, flow along live connections. */
export function ProviderTopology({ data, online }: { data: GatewayOverview | null; online: boolean }) {
  const { t } = useI18n();
  const nodes = data && online ? buildNodes(data) : [];
  const RX = 330;
  const RY = 185;
  return (
    <svg viewBox="-450 -250 900 500" role="img" aria-label={t('gw.topology.aria')} className="h-full w-full">
      <defs>
        <radialGradient id="hubGlow">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0.55" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
      </defs>
      {[0.45, 0.72, 1].map((k) => (
        <ellipse key={k} rx={RX * k} ry={RY * k} fill="none" stroke="rgba(56,189,248,0.1)" strokeDasharray="2 6" />
      ))}
      {nodes.map((n, i) => {
        const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * RX;
        const y = Math.sin(a) * RY;
        const color = TONE[n.tone];
        return (
          <g key={n.id}>
            <line
              x1={0}
              y1={0}
              x2={x}
              y2={y}
              stroke={color}
              strokeOpacity={n.connected ? 0.6 : 0.18}
              strokeWidth={n.connected ? 1.4 : 1}
              strokeDasharray={n.connected ? '6 6' : '2 6'}
              style={n.connected ? { animation: 'fb-dash 1.2s linear infinite' } : undefined}
            />
            <circle cx={x} cy={y} r={n.connected ? 9 : 6} fill="#07101d" stroke={color} strokeWidth={2} />
            {n.connected && <circle cx={x} cy={y} r={3.5} fill={color} />}
            <text
              x={x}
              y={y + (y > 0 ? 26 : -30)}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill={n.connected ? '#e6f1ff' : '#5b7494'}
            >
              {n.label.length > 14 ? `${n.label.slice(0, 13)}…` : n.label}
            </text>
            {n.models > 0 && (
              <text x={x} y={y + (y > 0 ? 39 : -17)} textAnchor="middle" fontSize="9.5" fill="#5b7494">
                {t('gw.node.models', { count: n.models })}
              </text>
            )}
          </g>
        );
      })}
      <circle r={86} fill="url(#hubGlow)" />
      <circle r={44} fill="#07101d" stroke={online ? '#22d3ee' : '#f87171'} strokeWidth={2.5} />
      <circle r={52} fill="none" stroke={online ? '#22d3ee' : '#f87171'} strokeOpacity={0.35} strokeDasharray="4 8" style={{ animation: 'fb-spin 24s linear infinite', transformOrigin: 'center', transformBox: 'fill-box' }} />
      <text y={-3} textAnchor="middle" fontSize="13" fontWeight="700" fill="#e6f1ff">
        {t('gw.hub.name')}
      </text>
      <text y={13} textAnchor="middle" fontSize="11" fontWeight="600" fill={online ? '#22d3ee' : '#f87171'}>
        {online ? t('gw.hub.online') : t('gw.hub.offline')}
      </text>
    </svg>
  );
}
