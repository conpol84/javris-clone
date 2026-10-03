import { useId, type ReactNode } from 'react';
import '../../styles/firbo.css';

/** Small building blocks shared by the 2D screens, so every page uses the same spacing, density and look. */

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow?: string; title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="fb-pagehead">
      <div className="min-w-0">
        {eyebrow && <div className="fb-eyebrow">{eyebrow}</div>}
        <h1 className="mt-1">{title}</h1>
        {sub && <p className="fb-muted mt-1 max-w-2xl text-sm">{sub}</p>}
      </div>
      {right && <div className="fb-pagehead__right">{right}</div>}
    </header>
  );
}

/** Initials in a coloured, softly glowing disc: the face of an AI employee in lists. */
export function Avatar({ name, color, size = 34 }: { name: string; color: string; size?: number }) {
  const initials = name.replace(/ Agent$/i, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className="fb-avatar" style={{ width: size, height: size, fontSize: size * 0.36, color, borderColor: `${color}66`, background: `radial-gradient(circle at 30% 25%, ${color}40, ${color}10 70%)`, boxShadow: `0 0 14px -4px ${color}` }} aria-hidden>
      {initials}
    </span>
  );
}

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'err' | 'accent'; children: ReactNode }) {
  return <span className={`fb-pill fb-pill--${tone}`}>{children}</span>;
}

/** A tiny trend line with a soft fill, no axes: for KPI cards. */
export function Spark({ values, color = '#22d3ee', height = 34 }: { values: number[]; color?: string; height?: number }) {
  const id = useId();
  const w = 120;
  const max = Math.max(...values, 0.0001);
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * w, height - 3 - (v / max) * (height - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {values.length > 1 && <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Stat({ label, value, hint, spark, color, delta }: { label: string; value: string; hint?: string; spark?: number[]; color?: string; delta?: { text: string; good: boolean } }) {
  return (
    <div className="fb-glass fb-stat">
      <div className="fb-eyebrow">{label}</div>
      <div className="fb-stat__value">{value}</div>
      <div className="fb-stat__foot">
        {delta && <span className={delta.good ? 'fb-up' : 'fb-down'}>{delta.text}</span>}
        {hint && <span className="fb-dim">{hint}</span>}
      </div>
      {spark && spark.length > 1 && (
        <div className="fb-stat__spark">
          <Spark values={spark} color={color} />
        </div>
      )}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; label?: string }) {
  return (
    <div className="fb-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} className={value === o.id ? 'is-on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="fb-glass fb-empty">
      <span className="fb-empty__icon">{icon}</span>
      <div className="text-sm font-semibold">{title}</div>
      {text && <p className="fb-muted max-w-sm text-sm">{text}</p>}
      {action}
    </div>
  );
}

/** "send_email" → "Send email" */
export const humanize = (s: string): string => {
  const t = s.replace(/[_-]+/g, ' ').replace(/\busd\b/gi, '(USD)').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** A smooth filled trend chart with light grid lines. */
export function AreaChart({ values, labels, color = '#22d3ee', height = 190, format }: { values: number[]; labels?: [string, string]; color?: string; height?: number; format?: (v: number) => string }) {
  const id = useId();
  const w = 640;
  const pad = { t: 10, b: 22, l: 4, r: 4 };
  const max = Math.max(...values, 0.0001) * 1.1;
  const x = (i: number) => pad.l + (i / Math.max(1, values.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  // Catmull-Rom → smooth cubic Bézier
  const path = pts.map(([px, py], i) => {
    if (i === 0) return `M${px},${py}`;
    const [p0x, p0y] = pts[i - 2] ?? pts[i - 1];
    const [p1x, p1y] = pts[i - 1];
    const [p3x, p3y] = pts[i + 1] ?? pts[i];
    const c1 = [p1x + (px - p0x) / 6, p1y + (py - p0y) / 6];
    const c2 = [px - (p3x - p1x) / 6, py - (p3y - p1y) / 6];
    return `C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${px},${py}`;
  }).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" role="img" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.38" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={pad.l} x2={w - pad.r} y1={pad.t + g * (height - pad.t - pad.b)} y2={pad.t + g * (height - pad.t - pad.b)} stroke="rgba(148,180,220,.12)" strokeDasharray="3 5" />
      ))}
      {values.length > 1 && <path d={`${path} L${x(values.length - 1)},${height - pad.b} L${x(0)},${height - pad.b} Z`} fill={`url(#${id})`} />}
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      {last && <circle cx={last[0]} cy={last[1]} r="4" fill={color} style={{ filter: `drop-shadow(0 0 6px ${color})` }} />}
      {labels && (
        <>
          <text x={pad.l} y={height - 5} fontSize="11" fill="#5b7494">{labels[0]}</text>
          <text x={w - pad.r} y={height - 5} fontSize="11" fill="#5b7494" textAnchor="end">{labels[1]}</text>
        </>
      )}
      {format && last && <title>{format(values[values.length - 1])}</title>}
    </svg>
  );
}

/** A ring split into coloured shares, with a label in the middle. */
export function Donut({ parts, center, sub, size = 168 }: { parts: { value: number; color: string }[]; center: string; sub?: string; size?: number }) {
  const total = parts.reduce((n, p) => n + p.value, 0) || 1;
  const R = size / 2 - 14;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="rgba(148,180,220,.1)" strokeWidth="14" />
        {parts.map((p, i) => {
          const len = (p.value / total) * C;
          const el = <circle key={i} cx={size / 2} cy={size / 2} r={R} fill="none" stroke={p.color} strokeWidth="14" strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ filter: `drop-shadow(0 0 5px ${p.color}80)` }} />;
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute text-center">
        <div className="text-xl font-semibold tabular-nums">{center}</div>
        {sub && <div className="fb-dim text-[11px]">{sub}</div>}
      </div>
    </div>
  );
}
