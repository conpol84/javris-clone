/** A donut gauge, like the CPU/RAM/Disk rings of a real HUD. `value` is 0..1. */
export function Gauge({ value, label, sub, color = 'var(--fb-accent)' }: { value: number; label: string; sub: string; color?: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const R = 34;
  const C = 2 * Math.PI * R;
  const tone = v > 0.9 ? 'var(--fb-err)' : v > 0.7 ? 'var(--fb-warn)' : color;
  return (
    <div className="flex flex-col items-center gap-1 text-center" role="img" aria-label={`${label}: ${Math.round(v * 100)}%`}>
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden>
        <circle cx="44" cy="44" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
        <circle cx="44" cy="44" r={R} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${C * v} ${C}`} transform="rotate(-90 44 44)" style={{ filter: `drop-shadow(0 0 5px ${tone})`, transition: 'stroke-dasharray .6s' }} />
        <text x="44" y="49" textAnchor="middle" fontSize="16" fontWeight="700" fill="currentColor">{Math.round(v * 100)}%</text>
      </svg>
      <div className="text-xs font-semibold">{label}</div>
      <div className="fb-dim text-[11px]">{sub}</div>
    </div>
  );
}
