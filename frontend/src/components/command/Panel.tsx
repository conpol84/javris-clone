import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, Maximize2, X } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';

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
  const { t } = useI18n();
  const [folded, setFolded] = useState(false);
  const [max, setMax] = useState(false);
  useEffect(() => {
    if (!max) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMax(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [max]);
  return (
    <>
      {max && <div className="fb-panel-backdrop" onClick={() => setMax(false)} aria-hidden="true" />}
      <section className={`fb-glass p-4 ${area ? `fb-a-${area}` : ''} ${max ? 'fb-panel-max' : ''} ${className}`} style={style}>
        <header className={`${folded && !max ? '' : 'mb-3'} flex items-center justify-between gap-2`}>
          <h2 className="fb-eyebrow">{title}</h2>
          <div className="flex items-center gap-1.5">
            {right}
            {!max && (
              <button type="button" className="fb-iconbtn" onClick={() => setFolded(!folded)} aria-expanded={!folded} title={t(folded ? 'panel.restore' : 'panel.minimize')} aria-label={t(folded ? 'panel.restore' : 'panel.minimize')}>
                <ChevronDown size={13} style={{ transform: folded ? 'rotate(-90deg)' : undefined, transition: 'transform .2s' }} />
              </button>
            )}
            <button type="button" className="fb-iconbtn" onClick={() => setMax(!max)} title={t(max ? 'panel.close' : 'panel.maximize')} aria-label={t(max ? 'panel.close' : 'panel.maximize')}>
              {max ? <X size={13} /> : <Maximize2 size={13} />}
            </button>
          </div>
        </header>
        {(!folded || max) && children}
      </section>
    </>
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
