import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Check, ChevronsUpDown, LayoutGrid, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../../i18n/I18nProvider';
import { useCompanyAuth } from '../../lib/company/AuthProvider';

/** Switch between the companies you belong to, or start a new one. */
export function OrgSwitcher() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { memberships, current, selectOrg, createOrg } = useCompanyAuth();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await createOrg(name);
      setName('');
      setAdding(false);
      setOpen(false);
      navigate('/');
    } catch (err) {
      console.error(err);
      toast.error(t('org.create.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={box} className="relative mx-3 mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('org.switch')}
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-start text-xs"
        style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
      >
        <span className="min-w-0 flex-1 truncate font-medium" style={{ color: 'var(--color-text)' }}>{current?.organization.name}</span>
        <ChevronsUpDown size={13} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl p-1.5 shadow-xl"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
        >
          {memberships.map((m) => (
            <button
              key={m.organization.id}
              role="option"
              aria-selected={m.organization.id === current?.organization.id}
              onClick={() => {
                selectOrg(m.organization.id);
                setOpen(false);
                navigate('/');
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm hover:bg-[var(--color-bg-tertiary)]"
              style={{ color: 'var(--color-text)' }}
            >
              <span className="min-w-0 flex-1 truncate">{m.organization.name}</span>
              {m.organization.id === current?.organization.id && <Check size={14} style={{ color: 'var(--color-accent)' }} />}
            </button>
          ))}
          <div className="my-1 h-px" style={{ background: 'var(--color-border)' }} />
          <button
            onClick={() => {
              setOpen(false);
              navigate('/companies');
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm hover:bg-[var(--color-bg-tertiary)]"
            style={{ color: 'var(--color-text)' }}
          >
            <LayoutGrid size={14} /> {t('nav.companies')}
          </button>
          {adding ? (
            <form onSubmit={add} className="flex gap-1.5 p-1.5">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder={t('org.create.name')}
                aria-label={t('org.create.name')}
                className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-sm"
                style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              />
              <button disabled={!name.trim() || busy} className="cursor-pointer rounded-lg px-2.5 text-sm font-medium disabled:opacity-50" style={{ background: 'var(--color-accent)', color: '#04121a' }}>
                {busy ? '…' : t('org.add')}
              </button>
            </form>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm hover:bg-[var(--color-bg-tertiary)]"
              style={{ color: 'var(--color-accent)' }}
            >
              <Plus size={14} /> {t('org.new')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
