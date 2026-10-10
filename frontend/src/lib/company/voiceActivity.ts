/** One in-memory voice turn. Contains no account IDs, recordings, text or keys.
 * Cancellation is synchronous locally; it does not certify server-job cancellation.
 */
export type VoicePhase = 'idle' | 'opening' | 'listening' | 'transcribing' | 'thinking' | 'preparing' | 'speaking' | 'error';
export type VoiceSource = 'none' | 'microphone' | 'server' | 'local' | 'browser';
export interface VoiceSnapshot { phase: VoicePhase; source: VoiceSource; measured: boolean }
export interface VoiceTurn {
  readonly signal: AbortSignal;
  current(): boolean;
  phase(phase: VoicePhase, source?: VoiceSource): void;
  level(value: number, measured?: boolean): void;
  finish(failed?: boolean): void;
  cancel(): void;
}
const IDLE: VoiceSnapshot = Object.freeze({ phase: 'idle', source: 'none', measured: false });
let snapshot: VoiceSnapshot = IDLE;
let active: VoiceTurn | null = null;
const listeners = new Set<() => void>();
/** Only real input/output measurements. Browser synthesis has no accessible meter. */
export const voiceLevel = { value: 0 };
export const getVoiceSnapshot = () => snapshot;
export const getServerVoiceSnapshot = () => IDLE;
export const subscribeVoice = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function hologramState(phase: VoicePhase): 'idle' | 'listening' | 'thinking' | 'speaking' {
  if (phase === 'listening' || phase === 'speaking') return phase;
  return ['opening', 'transcribing', 'thinking', 'preparing'].includes(phase) ? 'thinking' : 'idle';
}
function publish(next: VoiceSnapshot) {
  if (snapshot.phase === next.phase && snapshot.source === next.source && snapshot.measured === next.measured) return;
  snapshot = Object.freeze(next);
  for (const fn of listeners) fn();
}
export function beginVoiceTurn(onPhase?: (state: VoiceSnapshot) => void): VoiceTurn {
  active?.cancel();
  const controller = new AbortController();
  let ended = false;
  const emit = (next: VoiceSnapshot) => { publish(next); onPhase?.(snapshot); };
  const turn: VoiceTurn = {
    signal: controller.signal,
    current: () => active === turn && !ended && !controller.signal.aborted,
    phase: (phase, source = 'none') => {
      if (!turn.current()) return;
      voiceLevel.value = 0;
      emit({ phase, source, measured: false });
    },
    level: (value, measured = true) => {
      if (!turn.current()) return;
      voiceLevel.value = measured && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      if (snapshot.measured !== measured) emit({ ...snapshot, measured });
    },
    finish: (failed = false) => {
      if (!turn.current()) return;
      ended = true; active = null; voiceLevel.value = 0;
      emit(failed ? { phase: 'error', source: snapshot.source, measured: false } : IDLE);
    },
    cancel: () => {
      if (ended) return;
      ended = true;
      if (active === turn) { active = null; voiceLevel.value = 0; emit(IDLE); }
      controller.abort();
    },
  };
  active = turn;
  emit(IDLE);
  return turn;
}
export function stopVoiceActivity(): void { active?.cancel(); }
/** Ignore late SDK answers even when the underlying transport ignores AbortSignal. */
export async function voiceDeadline<T>(run: (signal: AbortSignal) => PromiseLike<T>, parent: AbortSignal, ms: number): Promise<T> {
  if (parent.aborted) throw new DOMException('Cancelled', 'AbortError');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => { controller.abort(); reject(new DOMException('Cancelled', 'AbortError')); };
      parent.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new Error('voice_timeout')); }, ms);
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        return run(controller.signal);
      }).then(resolve, reject);
    });
  } finally { clearTimeout(timer); parent.removeEventListener('abort', abort); }
}
