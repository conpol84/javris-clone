import { useI18n } from '../../i18n/I18nProvider';
import type { VoicePhase } from '../../lib/company/voiceActivity';
import { voiceMessages } from '../../lib/company/voiceMessages';
import { coreLabels, coreVoiceLabel } from './corePresentation';

export function CoreControls({ paused, reduced, lightweight, phase, onPause, onLightweight }: {
  paused: boolean; reduced: boolean; lightweight: boolean; phase: VoicePhase;
  onPause: () => void; onLightweight: () => void;
}) {
  const { lang } = useI18n();
  const labels = coreLabels[lang] ?? coreLabels.en;
  return (
    <div className="absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2 text-xs">
      <span role="status" aria-live="polite" className="fb-chip" data-core-voice-phase={phase}>
        {coreVoiceLabel(phase, labels, voiceMessages(lang))}
      </span>
      <div className="flex max-w-full flex-col items-end gap-1">
        <div className="flex flex-wrap justify-end gap-1">
          <button type="button" className="fb-btn fb-btn--ghost" aria-pressed={paused} title={reduced ? labels.reduced : undefined} disabled={reduced} onClick={onPause}>
            {paused ? labels.resume : labels.pause}
          </button>
          <button type="button" className="fb-btn fb-btn--ghost" aria-pressed={lightweight} onClick={onLightweight}>
            {labels.lightweight}
          </button>
        </div>
      </div>
    </div>
  );
}
