import { useId } from 'react';

/** Firbo AI "F" mark. Pure SVG so it scales crisply and needs no asset request. */
export function LogoMark({ size = 28, rounded = true }: { size?: number; rounded?: boolean }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="Firbo AI">
      <defs>
        <linearGradient id={`g${uid}`} gradientUnits="userSpaceOnUse" x1="160" y1="112" x2="416" y2="428">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#0891b2" />
        </linearGradient>
        <linearGradient id={`b${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#101a2e" />
          <stop offset="1" stopColor="#050a14" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx={rounded ? 112 : 0} fill={`url(#b${uid})`} />
      <g fill={`url(#g${uid})`}>
        <rect x="160" y="112" width="56" height="316" rx="28" />
        <rect x="160" y="112" width="256" height="56" rx="28" />
        <rect x="160" y="232" width="224" height="56" rx="28" />
      </g>
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span
        className="font-semibold tracking-tight"
        style={{ fontSize: size * 0.6, color: 'var(--fb-text, var(--color-text))' }}
      >
        Firbo <span style={{ color: 'var(--fb-accent, var(--color-accent))' }}>AI</span>
      </span>
    </span>
  );
}
