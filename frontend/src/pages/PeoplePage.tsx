import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { notifyPlanLimit } from '../lib/company/limits';
import { addMemberByEmail, listMembers, removeMember, setMemberRole } from '../lib/company/data';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import type { MemberRow, Role } from '../lib/company/types';
import { Avatar, PageHeader, Pill } from '../components/ui/kit';
import '../styles/firbo.css';

const ROLE_COLOR: Record<string, string> = { owner: '#fbbf24', admin: '#a78bfa', manager: '#22d3ee', member: '#34d399', viewer: '#7f9fc4' };

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
  const { current, user, refresh } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const role = current?.role ?? 'viewer';
  const isOwner = role === 'owner';
  const isAdmin = isOwner || role === 'admin';
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const ownerCount = members.filter((m) => m.role === 'owner').length;
  const isLastOwner = (m: MemberRow) => m.role === 'owner' && ownerCount <= 1;
  const mutationError = (err: unknown, fallback: TKey) => {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('last_owner')) return t('ppl.lastOwner');
    if (message.includes('membership_not_changed')) return t('ppl.err.member_changed');
    return t(fallback);
  };

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
      if (!notifyPlanLimit(err, t as never)) toast.error(addError(err));
    } finally {
      setBusy(false);
    }
  };

  const change = async (m: MemberRow, r: Role) => {
    if (!isAdmin || (m.role === 'owner' && !isOwner)) return;
    if (isLastOwner(m) && r !== 'owner') {
      toast.error(t('ppl.lastOwner'));
      return;
    }
    setBusy(true);
    try {
      await setMemberRole(orgId, m.user_id, r);
      if (m.user_id === user?.id) await refresh();
      await load();
    } catch (err) {
      console.error(err);
      toast.error(mutationError(err, 'ppl.err.role'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: MemberRow) => {
    if (!isAdmin || (m.role === 'owner' && !isOwner)) return;
    if (isLastOwner(m)) {
      toast.error(t('ppl.lastOwner'));
      return;
    }
    const label = m.email ?? m.full_name ?? t('ppl.member');
    if (!window.confirm(t('ppl.removeConfirm', { who: label, company: current?.organization.name ?? '' }))) return;
    setBusy(true);
    try {
      await removeMember(orgId, m.user_id);
      if (m.user_id === user?.id) await refresh();
      toast.success(t('ppl.removed'));
      await load();
    } catch (err) {
      console.error(err);
      toast.error(mutationError(err, 'ppl.err.remove'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 pb-10 pt-14 md:px-8 md:pt-8">
        <PageHeader eyebrow={current?.organization.name} title={t('ppl.title')} sub={t('ppl.sub')} right={<Pill tone="accent">{members.length}</Pill>} />

        <div className="fb-glass mb-4 p-4 text-sm">
          <p>{t('ppl.permissions')}</p>
          {!isAdmin && <p className="fb-muted mt-2">{t('ppl.roleRestricted', { role: roleName(role) })}</p>}
          {ownerCount === 1 && <p className="fb-muted mt-2">{t('ppl.lastOwner')}</p>}
        </div>

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

        <div>
          {loading ? (
            <p className="fb-dim p-4 text-sm">{t('common.loading')}</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {members.map((m) => {
                const self = m.user_id === user?.id;
                const lastOwner = isLastOwner(m);
                const locked = !isAdmin || (m.role === 'owner' && !isOwner) || lastOwner;
                return (
                  <li key={m.user_id} className="fb-glass flex flex-wrap items-center gap-3 p-4">
                    <Avatar name={m.full_name || m.email || '?'} color={ROLE_COLOR[m.role] ?? '#22d3ee'} size={40} />
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
                      disabled={locked || busy}
                      aria-label={t('ppl.roleOf', { who: m.email ?? m.full_name ?? t('ppl.member') })}
                      onChange={(e) => void change(m, e.target.value as Role)}
                      title={lastOwner ? t('ppl.lastOwner') : roleHint(m.role)}
                    >
                      {ROLES.filter((r) => isOwner || r.id !== 'owner' || m.role === 'owner').map((r) => (
                        <option key={r.id} value={r.id}>
                          {roleName(r.id)}
                        </option>
                      ))}
                    </select>
                    {!locked && !self && (
                      <button disabled={busy} className="fb-link cursor-pointer text-xs underline" style={{ color: 'var(--fb-err)' }} onClick={() => void remove(m)}>
                        {t('ppl.remove')}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <ul className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {ROLES.map((r) => (
            <li key={r.id} className="fb-card">
              <Pill tone={r.id === 'owner' ? 'accent' : 'neutral'}>{roleName(r.id)}</Pill>
              <p className="fb-dim mt-2 text-xs leading-snug">{roleHint(r.id)}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
