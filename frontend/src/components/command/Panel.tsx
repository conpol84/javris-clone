import type { CSSProperties, ReactNode } from 'react';

export function Panel({
  title,
  right,
  area,
  className = '',
  style,
  children,
}: {
  title: string;
  right?: ReactNode;
  area?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section className={`fb-glass p-4 ${area ? `fb-a-${area}` : ''} ${className}`} style={style}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="fb-eyebrow">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Wave({ color = 'currentColor', active = true }: { color?: string; active?: boolean }) {
  return (
    <span className="fb-wave" style={{ color }} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} style={active ? undefined : { animation: 'none', height: '25%' }} />
      ))}
    </span>
  );
}

export function StatusDot({ tone = 'idle', live = false }: { tone?: 'ok' | 'warn' | 'err' | 'idle'; live?: boolean }) {
  const cls = tone === 'idle' ? '' : `fb-dot--${tone}`;
  return <span className={`fb-dot ${cls} ${live ? 'fb-dot--live' : ''}`} />;
}
