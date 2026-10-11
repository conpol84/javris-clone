import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CoreControls } from './CoreControls';
import { coreLabels, corePresentation, coreVoiceLabel } from './corePresentation';
import { beginVoiceTurn, getVoiceSnapshot, stopVoiceActivity } from '../../lib/company/voiceActivity';
import { voiceMessages } from '../../lib/company/voiceMessages';

describe('core presentation controls', () => {
  it('reduces point count and resolution and removes bloom in lightweight mode', () => {
    expect(corePresentation(false, false, true)).toEqual({ static: false, pointCount: 4000, dpr: 1, bloom: false });
    expect(corePresentation(false, false, false)).toEqual({ static: false, pointCount: 16000, dpr: 1.75, bloom: true });
  });
  it.each([[true, false], [false, true], [true, true]])('keeps animation static for paused=%s and reduced=%s', (paused, reduced) => {
    const mode = corePresentation(paused, reduced, false);
    expect(mode.static).toBe(true);
    expect(mode.bloom).toBe(false);
  });
  it('has complete nonempty labels in all eight UI languages', () => {
    expect(Object.keys(coreLabels)).toHaveLength(8);
    for (const labels of Object.values(coreLabels)) {
      expect(Object.keys(labels).sort()).toEqual(Object.keys(coreLabels.en).sort());
      expect(Object.values(labels).every(value => value.trim())).toBe(true);
    }
  });
  it('represents every actual voice phase including error without inventing activity', () => {
    for (const phase of ['opening', 'listening', 'transcribing', 'thinking', 'preparing', 'speaking'] as const) {
      expect(coreVoiceLabel(phase, coreLabels.en, voiceMessages('en'))).toBe(voiceMessages('en')[phase]);
    }
    expect(coreVoiceLabel('idle', coreLabels.en, voiceMessages('en'))).toBe('Voice idle');
    expect(coreVoiceLabel('error', coreLabels.en, voiceMessages('en'))).toBe('Voice error');
  });
  it('renders accessible controls without visual-only disclaimer', () => {
    const html = renderToStaticMarkup(<CoreControls paused lightweight={false} reduced={false} phase="listening" onPause={vi.fn()} onLightweight={vi.fn()} />);
    expect(html).toContain('Resume animation');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('aria-describedby=');
    expect(html).not.toContain('Visual controls only.');
    expect(html).toContain('role="status"');
    expect(html).toContain('Microphone on. Speak now.');
  });
  it('does not offer an override of device reduced motion', () => {
    const html = renderToStaticMarkup(<CoreControls paused={false} lightweight reduced phase="idle" onPause={vi.fn()} onLightweight={vi.fn()} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('title="Reduced motion is enabled on your device."');
  });
  it('changing presentation never cancels the active voice turn', () => {
    const turn = beginVoiceTurn();
    try {
      turn.phase('listening', 'microphone');
      corePresentation(true, true, true);
      renderToStaticMarkup(<CoreControls paused lightweight reduced phase="listening" onPause={vi.fn()} onLightweight={vi.fn()} />);
      expect(turn.current()).toBe(true);
      expect(turn.signal.aborted).toBe(false);
      expect(getVoiceSnapshot().phase).toBe('listening');
    } finally { stopVoiceActivity(); }
  });
});
