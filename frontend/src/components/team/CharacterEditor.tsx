import { useState } from 'react';
import { toast } from 'sonner';
import { Panel } from '../command/Panel';
import { updateAgent } from '../../lib/company/data';
import { ACCESSORIES, HAIR_COLORS, HAIR_STYLES, OUTFITS, resolvePersona, SKINS, type Persona } from '../../lib/company/persona';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
import type { AgentRow } from '../../lib/company/types';

function Swatches({ label, colors, value, disabled, onPick }: { label: string; colors: string[]; value: number; disabled: boolean; onPick: (i: number) => void }) {
  return (
    <div>
      <div className="fb-dim mb-1 text-[11px]">{label}</div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {colors.map((c, i) => (
          <button key={c} role="radio" aria-checked={value === i} aria-label={`${label} ${i + 1}`} disabled={disabled} onClick={() => onPick(i)} className="h-6 w-6 cursor-pointer rounded-full disabled:cursor-not-allowed" style={{ background: c, outline: value === i ? '2px solid var(--fb-accent)' : '1px solid rgba(255,255,255,0.2)', outlineOffset: 2 }} />
        ))}
      </div>
    </div>
  );
}

function Choices({ label, count, value, disabled, text, onPick }: { label: string; count: number; value: number; disabled: boolean; text: (i: number) => string; onPick: (i: number) => void }) {
  return (
    <div>
      <div className="fb-dim mb-1 text-[11px]">{label}</div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {Array.from({ length: count }, (_, i) => (
          <button key={i} role="radio" aria-checked={value === i} disabled={disabled} onClick={() => onPick(i)} className="fb-chip cursor-pointer disabled:cursor-not-allowed" style={value === i ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)' } : undefined}>
            {text(i)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Give an agent a name and a look. The 3D stage previews every change live; nothing is saved until you press Save. */
export function CharacterEditor({ agent, canManage, onDraft, onSaved }: { agent: AgentRow; canManage: boolean; onDraft: (p: Persona | null) => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(agent.name);
  const [look, setLook] = useState<Persona>(() => resolvePersona(agent));
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Persona) => (i: number) => {
    const next = { ...look, [k]: i };
    setLook(next);
    onDraft(next);
  };
  const save = async () => {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 1 || clean.length > 40) return toast.error(t('char.nameInvalid'));
    setBusy(true);
    try {
      await updateAgent(agent.id, { name: clean, persona: { ...look } });
      toast.success(t('char.saved'));
      onSaved();
    } catch (err) {
      console.error(err);
      toast.error(t('drawer.saveError'));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setLook(resolvePersona({ slug: agent.slug, type: agent.type, persona: null }));
    onDraft(null);
  };
  return (
    <Panel title={t('char.title')}>
      <div className="fb-col gap-3">
        <label className="block">
          <span className="fb-dim mb-1 block text-[11px]">{t('char.name')}</span>
          <input className="fb-input" value={name} maxLength={40} disabled={!canManage} placeholder={t('char.namePh')} onChange={(e) => setName(e.target.value)} />
        </label>
        <Swatches label={t('char.skin')} colors={SKINS} value={look.skin} disabled={!canManage} onPick={set('skin')} />
        <Choices label={t('char.hair')} count={HAIR_STYLES} value={look.hair} disabled={!canManage} text={(i) => t(`char.hairstyle.${i}` as TKey)} onPick={set('hair')} />
        <Swatches label={t('char.hairColor')} colors={HAIR_COLORS} value={look.hairColor} disabled={!canManage} onPick={set('hairColor')} />
        <Swatches label={t('char.outfit')} colors={OUTFITS} value={look.outfit} disabled={!canManage} onPick={set('outfit')} />
        <Choices label={t('char.accessory')} count={ACCESSORIES} value={look.accessory} disabled={!canManage} text={(i) => t(`char.acc.${i}` as TKey)} onPick={set('accessory')} />
        <div className="flex gap-2">
          <button className="fb-btn fb-btn--primary" disabled={!canManage || busy} onClick={() => void save()}>{t('char.save')}</button>
          <button className="fb-btn fb-btn--ghost" disabled={!canManage || busy} onClick={reset}>{t('char.reset')}</button>
        </div>
      </div>
    </Panel>
  );
}
