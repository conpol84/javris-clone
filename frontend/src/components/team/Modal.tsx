import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';

/** Accessible overlay: Esc closes, backdrop click closes, body scroll stays put. */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 md:p-10"
      style={{ background: 'rgba(3,7,14,0.72)', backdropFilter: 'blur(6px)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fb-root fb-glass fb-fade-up w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} p-5`}
        style={{ minHeight: 0, background: 'var(--fb-glass-strong)', borderColor: 'var(--fb-border-strong)' }}
      >
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label={t('common.close')} className="fb-link fb-muted cursor-pointer rounded-lg p-1.5 hover:text-white">
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
