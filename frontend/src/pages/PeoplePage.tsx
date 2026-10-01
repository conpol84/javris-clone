import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { addMemberByEmail, listMembers, removeMember, setMemberRole } from '../lib/company/data';
import type { MemberRow, Role } from '../lib/company/types';
import '../styles/firbo.css';

const ROLES: { id: Role; hint: string }[] = [
  { id: 'owner', hint: 'Everything, including deleting the company' },
  { id: 'admin', hint: 'Manage people, agents and settings' },
  { id: 'manager', hint: 'Approve actions, manage agents and workflows' },
  { id: 'member', hint: 'Work with agents and tasks' },
  { id: 'viewer', hint: 'Read-only' },
];

export function PeoplePage() {
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
      toast.error(err instanceof Error ? err.message : 'Could not load the team');
    } finally {
      setLoading(false);
    }
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await addMemberByEmail(orgId, email, newRole);
      toast.success('Added to your company');
      setEmail('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add that person');
    } finally {
      setBusy(false);
    }
  };

  const change = async (m: MemberRow, r: Role) => {
    try {
      await setMemberRole(orgId, m.user_id, r);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the role');
    }
  };

  const remove = async (m: MemberRow) => {
    const label = m.email ?? m.full_name ?? 'this person';
    if (!window.confirm(`Remove ${label} from ${current?.organization.name}? They will lose access immediately.`)) return;
    try {
      await removeMember(orgId, m.user_id);
      toast.success('Removed');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove that person');
    }
  };

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header className="mb-5">
          <div className="fb-eyebrow">{current?.organization.name}</div>
          <h1 className="mt-1 text-2xl font-semibold">People</h1>
          <p className="fb-muted mt-1 text-sm">Who can see and control your AI team.</p>
        </header>

        {isAdmin && (
          <form onSubmit={add} className="fb-glass mb-4 p-4">
            <div className="fb-eyebrow mb-2">Add a teammate</div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className="fb-input"
                type="email"
                required
                placeholder="teammate@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Teammate email"
              />
              <select className="fb-input fb-w-select" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} aria-label="Role">
                {ROLES.filter((r) => isOwner || r.id !== 'owner').map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id}
                  </option>
                ))}
              </select>
              <button className="fb-btn fb-btn--primary" disabled={busy || !email.trim()}>
                {busy ? 'Adding…' : 'Add'}
              </button>
            </div>
            <p className="fb-dim mt-2 text-xs">They need a Firbo AI account first — ask them to sign up, then add their email here.</p>
          </form>
        )}

        <div className="fb-glass p-2">
          {loading ? (
            <p className="fb-dim p-4 text-sm">Loading…</p>
          ) : (
            <ul>
              {members.map((m) => {
                const self = m.user_id === user?.id;
                const locked = !isAdmin || (m.role === 'owner' && !isOwner);
                return (
                  <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-3 py-3" style={{ borderTop: '1px solid var(--fb-border)' }}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold" style={{ background: 'rgba(34,211,238,.14)', color: 'var(--fb-accent)' }}>
                      {(m.full_name || m.email || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {m.full_name || m.email || 'Team member'} {self && <span className="fb-dim text-xs">(you)</span>}
                      </div>
                      {m.email && m.full_name && <div className="fb-dim truncate text-xs">{m.email}</div>}
                    </div>
                    <select
                      className="fb-input fb-w-role"
                      style={{ height: 34 }}
                      value={m.role}
                      disabled={locked}
                      aria-label={`Role of ${m.email ?? m.full_name ?? 'member'}`}
                      onChange={(e) => void change(m, e.target.value as Role)}
                      title={ROLES.find((r) => r.id === m.role)?.hint}
                    >
                      {ROLES.filter((r) => isOwner || r.id !== 'owner' || m.role === 'owner').map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.id}
                        </option>
                      ))}
                    </select>
                    {!locked && !self && (
                      <button className="fb-link cursor-pointer text-xs underline" style={{ color: 'var(--fb-err)' }} onClick={() => void remove(m)}>
                        Remove
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
              <b className="text-[color:var(--fb-muted)]">{r.id}</b> — {r.hint}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
