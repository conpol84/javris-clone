import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import { Panel } from '../command/Panel';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
import { OWN_KEY_PROVIDERS, OwnKeyFailure, removeOwnKey, saveOwnKey, type OwnKeyProvider } from '../../lib/company/ownKeys';
import { planHas, useOwnKeys, usePlanUsageState } from '../../lib/company/usePlan';
import { keyStatusCopy } from '../../lib/company/keyStatusCopy';

/** Pro / Business / Enterprise: connect the company's own OpenAI, Anthropic, ... keys. */
export function OwnKeysPanel({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { t, lang } = useI18n();
  const copy = keyStatusCopy(lang);
  const planState = usePlanUsageState(orgId);
  const allowed = planHas(planState.plan, 'byo_keys');
  const [rows, reload, keyState] = useOwnKeys(orgId);
  const [open, setOpen] = useState<OwnKeyProvider | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [draftOrg, setDraftOrg] = useState(orgId);
  const scope = useRef({ orgId, generation: 0 });
  if (scope.current.orgId !== orgId) scope.current = { orgId, generation: scope.current.generation + 1 };
  const generation = scope.current.generation;
  const currentDraft = draftOrg === orgId;
  const checked = planState.status === 'ready' && keyState.status === 'ready';
  const canWrite = canManage && checked && !!orgId;
  useEffect(() => { setOpen(null); setKey(''); setBusy(false); setDraftOrg(orgId); }, [orgId]);

  const fail = (err: unknown) => {
    const code = err instanceof OwnKeyFailure ? err.code : 'unknown';
    const msg: Record<string, TKey> = {
      invalid_key: 'keys.err.invalid',
      provider_unreachable: 'keys.err.unreachable',
      plan_limit: 'keys.locked',
      forbidden: 'keys.err.forbidden',
    };
    toast.error(t(msg[code] ?? 'keys.err.save'));
  };

  const save = async (provider: OwnKeyProvider) => {
    if (!canWrite || !allowed || busy || !currentDraft || scope.current.generation !== generation) return;
    if (key.trim().length < 20) return toast.error(t('keys.err.short'));
    setBusy(true);
    try {
      const out = await saveOwnKey(orgId, provider, key.trim());
      if (scope.current.generation !== generation) return;
      toast.success(t('keys.saved', { count: out.models.length }));
      setKey('');
      setOpen(null);
      reload();
    } catch (err) {
      if (scope.current.generation === generation) fail(err);
    } finally {
      if (scope.current.generation === generation) setBusy(false);
    }
  };

  const remove = async (provider: OwnKeyProvider) => {
    if (!canWrite || busy || scope.current.generation !== generation) return;
    setBusy(true);
    try {
      await removeOwnKey(orgId, provider);
      if (scope.current.generation !== generation) return;
      toast.success(t('keys.removed'));
      reload();
    } catch (err) {
      if (scope.current.generation === generation) fail(err);
    } finally {
      if (scope.current.generation === generation) setBusy(false);
    }
  };

  return (
    <Panel title={t('keys.title')} right={<KeyRound size={16} className="fb-dim" />}>
      <p className="fb-muted mb-3 text-sm">{t('keys.sub')}</p>
      {planState.loading && <p role="status" className="fb-dim mb-2 text-xs">{copy.loadingPlan}</p>}
      {keyState.loading && <p role="status" className="fb-dim mb-2 text-xs">{copy.loadingKeys}</p>}
      {planState.status === 'error' && <div role="alert" className="mb-2 text-xs">{copy.planError} <button className="fb-link" onClick={planState.retry}>{copy.retry}</button></div>}
      {keyState.status === 'error' && <div role="alert" className="mb-2 text-xs">{copy.keysError} <button className="fb-link" onClick={reload}>{copy.retry}</button></div>}
      {checked && !allowed && (
        <div className="mb-3 rounded-xl p-3 text-sm" style={{ border: '1px solid var(--fb-border)', background: 'rgba(251,191,36,0.08)' }}>
          {t('keys.locked')}{' '}
          <a className="fb-link font-semibold" href="/billing">
            {t('bill.seePlans')}
          </a>
        </div>
      )}
      <ul className="grid gap-2">
        {OWN_KEY_PROVIDERS.map((p) => {
          const row = rows.find((r) => r.provider === p.id);
          const editing = currentDraft && open === p.id;
          return (
            <li key={p.id} className="rounded-xl p-3" style={{ border: '1px solid var(--fb-border)' }}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{p.name}</span>
                  <span className="fb-dim block text-xs">
                    {checked ? row ? t('keys.connected', { hint: row.key_hint, count: row.models.length }) : t('keys.notConnected') : keyState.status === 'error' ? copy.keysError : planState.status === 'error' ? copy.planError : keyState.loading ? copy.loadingKeys : copy.loadingPlan}
                  </span>
                </span>
                {canManage && checked && allowed && !editing && (
                  <button className="fb-btn fb-btn--ghost shrink-0 whitespace-nowrap" disabled={busy} onClick={() => (setOpen(p.id), setKey(''))}>
                    {row ? t('keys.replace') : t('keys.connect')}
                  </button>
                )}
                {canManage && checked && row && !editing && (
                  <button className="fb-btn fb-btn--ghost shrink-0" style={{ color: 'var(--fb-warn)' }} disabled={busy} aria-label={t('keys.remove')} onClick={() => void remove(p.id)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              {editing && (
                <div className="mt-3 fb-col gap-2">
                  <input
                    className="fb-input font-mono text-xs"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    dir="ltr"
                    placeholder={t('keys.placeholder', { name: p.name })}
                    value={currentDraft ? key : ''}
                    disabled={busy || !canWrite || !allowed}
                    onChange={(e) => setKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void save(p.id)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="fb-btn shrink-0 whitespace-nowrap" disabled={busy || !canWrite || !allowed} onClick={() => void save(p.id)}>
                      {busy ? t('keys.checking') : t('keys.save')}
                    </button>
                    <button className="fb-btn fb-btn--ghost shrink-0" disabled={busy} onClick={() => { setOpen(null); setKey(''); }}>
                      {t('keys.cancel')}
                    </button>
                    <a className="fb-link inline-flex items-center gap-1 text-xs" href={p.keysUrl} target="_blank" rel="noreferrer">
                      {t('keys.getKey', { name: p.name })} <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!checked && <p className="fb-dim mt-3 text-xs">{copy.waiting}</p>}
      <p className="fb-dim mt-3 text-xs">{t('keys.how')}</p>
    </Panel>
  );
}
