import { requireClient } from './client';

/** Shared, mutable loudness (0..1) the 3D hologram reads every frame without re-rendering React. */
export const voiceLevel = { value: 0 };

const SR_LANG: Record<string, string> = {
  en: 'en-US', el: 'el-GR', es: 'es-ES', 'pt-BR': 'pt-BR', de: 'de-DE', fr: 'fr-FR', 'zh-CN': 'zh-CN', ar: 'ar-SA',
};

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

export function recognitionSupported(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/** Starts one listening turn. Returns a stop function. */
export function listenOnce(lang: string, on: { interim: (t: string) => void; final: (t: string) => void; end: () => void }): () => void {
  const w = window as unknown as Record<string, new () => RecognitionLike>;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) {
    on.end();
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = SR_LANG[lang] ?? 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  let done = false;
  rec.onresult = (e) => {
    let text = '';
    let isFinal = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      if (e.results[i].isFinal) isFinal = true;
    }
    if (isFinal) {
      done = true;
      on.final(text.trim());
    } else on.interim(text);
  };
  rec.onerror = () => {
    done = true;
    on.end();
  };
  rec.onend = () => {
    if (!done) on.end();
  };
  try {
    rec.start();
  } catch {
    on.end();
  }
  return () => {
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
  };
}

let audio: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let raf = 0;
let synthTimer = 0;

export function stopSpeaking(): void {
  if (audio) {
    audio.pause();
    audio = null;
  }
  window.speechSynthesis?.cancel();
  cancelAnimationFrame(raf);
  clearInterval(synthTimer);
  voiceLevel.value = 0;
}

function meter(el: HTMLAudioElement): void {
  try {
    ctx = ctx ?? new AudioContext();
    const src = ctx.createMediaElementSource(el);
    const an = ctx.createAnalyser();
    an.fftSize = 256;
    src.connect(an);
    an.connect(ctx.destination);
    const buf = new Uint8Array(an.frequencyBinCount);
    const tick = () => {
      an.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i];
      voiceLevel.value = Math.min(1, sum / buf.length / 90);
      raf = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    // No analyser: fake a lively level while playing.
    synthTimer = window.setInterval(() => (voiceLevel.value = 0.3 + Math.random() * 0.5), 90);
  }
}

/** Natural voice via the agent-speak function; falls back to the browser's own voice. Resolves when finished. */
export async function speak(orgId: string, text: string, lang: string): Promise<void> {
  stopSpeaking();
  const clean = text.replace(/[*_`#>]/g, '').slice(0, 700);
  try {
    const { data, error } = await requireClient().functions.invoke('agent-speak', { body: { organization_id: orgId, text: clean } });
    if (error || !(data instanceof Blob)) throw new Error('voice_unavailable');
    const url = URL.createObjectURL(data);
    const el = new Audio(url);
    audio = el;
    await new Promise<void>((resolve) => {
      el.onended = () => resolve();
      el.onerror = () => resolve();
      meter(el);
      el.play().catch(() => resolve());
    });
    URL.revokeObjectURL(url);
  } catch {
    await new Promise<void>((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = SR_LANG[lang] ?? 'en-US';
      u.rate = 0.96;
      u.pitch = 0.8;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synthTimer = window.setInterval(() => (voiceLevel.value = 0.25 + Math.random() * 0.55), 90);
      synth.speak(u);
    });
  }
  cancelAnimationFrame(raf);
  clearInterval(synthTimer);
  voiceLevel.value = 0;
}
