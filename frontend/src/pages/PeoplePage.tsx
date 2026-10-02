import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { addMemberByEmail, listMembers, removeMember, setMemberRole } from '../lib/company/data';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import type { MemberRow, Role } from '../lib/company/types';
import '../styles/firbo.css';

const ROLES: { id: Role }[] = [{ id: 'owner' }, { id: 'admin' }, { id: 'manager' }, { id: 'member' }, { id: 'viewer' }];

export function PeoplePage() {
  const { t } = useI18n();
  const roleName = (r: string) => t(`role.${r}` as TKey);
  const roleHint = (r: string) => t(`role.${r}.hint` as TKey);
  /** The RPCs raise stable codes; anything else is logged and shown generically. */
  const addError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : '';
    const code = (['no_account', 'already_member', 'not_allowed'] as const).find((c) => msg.includes(c.replace('_', c === 'not_allowed' ? ' ' : '_')));
    if (!code) console.error(err);
    return code ? t(`ppl.err.${code}` as TKey) : t('ppl.err.add');
  };
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const role = current?.role ?? 'viewer';
  const isOwner = role === 'owner';
  const isAdmin = isOwner || role === 'admin';
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setMembers(await listMembers(orgId));
    } catch (err) {
      console.error(err);
      toast.error(t('ppl.err.load'));
    } finally {
      setLoading(false);
    }
  }, [orgId, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await addMemberByEmail(orgId, email, newRole);
      toast.success(t('ppl.added'));
      setEmail('');
      await load();
    } catch (err) {
      toast.error(addError(err));
    } finally {
      setBusy(false);
    }
  };

  const change = async (m: MemberRow, r: Role) => {
    try {
      await setMemberRole(orgId, m.user_id, r);
      await load();
    } catch (err) {
      console.error(err);
      toast.error(t('ppl.err.role'));
    }
  };

  const remove = async (m: MemberRow) => {
    const label = m.email ?? m.full_name ?? t('ppl.member');
    if (!window.confirm(t('ppl.removeConfirm', { who: label, company: current?.organization.name ?? '' }))) return;
    try {
      await removeMember(orgId, m.user_id);
      toast.success(t('ppl.removed'));
      await load();
    } catch (err) {
      console.error(err);
      toast.error(t('ppl.err.remove'));
    }
  };

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header className="mb-5">
          <div className="fb-eyebrow">{current?.organization.name}</div>
          <h1 className="mt-1 text-2xl font-semibold">{t('ppl.title')}</h1>
          <p className="fb-muted mt-1 text-sm">{t('ppl.sub')}</p>
        </header>

        {isAdmin && (
          <form onSubmit={add} className="fb-glass mb-4 p-4">
            <div className="fb-eyebrow mb-2">{t('ppl.add')}</div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="fb-input"
                type="email"
                required
                placeholder={t('ppl.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label={t('ppl.emailAria')}
              />
              <select className="fb-input fb-w-select" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} aria-label={t('ppl.roleAria')}>
                {ROLES.filter((r) => isOwner || r.id !== 'owner').map((r) => (
                  <option key={r.id} value={r.id}>
                    {roleName(r.id)}
                  </option>
                ))}
              </select>
              <button className="fb-btn fb-btn--primary" disabled={busy || !email.trim()}>
                {busy ? t('ppl.adding') : t('ppl.addBtn')}
              </button>
            </div>
            <p className="fb-dim mt-2 text-xs">{t('ppl.addHint')}</p>
          </form>
        )}

        <div className="fb-glass p-2">
          {loading ? (
            <p className="fb-dim p-4 text-sm">{t('common.loading')}</p>
          ) : (
            <ul>
              {members.map((m) => {
                const self = m.user_id === user?.id;
                const locked = !isAdmin || (m.role === 'owner' && !isOwner);
                return (
                  <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-3 py-3" style={{ borderTop: '1px solid var(--fb-border)' }}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold" style={{ background: 'rgba(74, 222, 128,.14)', color: 'var(--fb-accent)' }}>
                      {(m.full_name || m.email || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {m.full_name || m.email || t('ppl.member')} {self && <span className="fb-dim text-xs">{t('ppl.you')}</span>}
                      </div>
                      {m.email && m.full_name && <div className="fb-dim truncate text-xs">{m.email}</div>}
                    </div>
                    <select
                      className="fb-input fb-w-role"
                      style={{ height: 34 }}
                      value={m.role}
                      disabled={locked}
                      aria-label={t('ppl.roleOf', { who: m.email ?? m.full_name ?? t('ppl.member') })}
                      onChange={(e) => void change(m, e.target.value as Role)}
                      title={roleHint(m.role)}
                    >
                      {ROLES.filter((r) => isOwner || r.id !== 'owner' || m.role === 'owner').map((r) => (
                        <option key={r.id} value={r.id}>
                          {roleName(r.id)}
                        </option>
                      ))}
                    </select>
                    {!locked && !self && (
                      <button className="fb-link cursor-pointer text-xs underline" style={{ color: 'var(--fb-err)' }} onClick={() => void remove(m)}>
                        {t('ppl.remove')}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <ul className="fb-dim mt-4 space-y-1 text-xs">
          {ROLES.map((r) => (
            <li key={r.id}>
              <b className="text-[color:var(--fb-muted)]">{roleName(r.id)}</b> — {roleHint(r.id)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
