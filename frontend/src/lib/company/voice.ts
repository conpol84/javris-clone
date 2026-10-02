import { requireClient } from './client';

/** Shared, mutable loudness (0..1) the 3D hologram reads every frame without re-rendering React. */
export const voiceLevel = { value: 0 };

const SR_LANG: Record<string, string> = {
  en: 'en-US', el: 'el-GR', es: 'es-ES', 'pt-BR': 'pt-BR', de: 'de-DE', fr: 'fr-FR', 'zh-CN': 'zh-CN', ar: 'ar-SA',
};

export type VoiceError = 'denied' | 'no_speech' | 'network' | 'other';

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
}

export function recognitionSupported(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/** Starts one listening turn. Returns a stop function. */
export function listenOnce(lang: string, on: { interim: (t: string) => void; final: (t: string) => void; end: () => void; error?: (c: VoiceError) => void; spoke?: () => void }): () => void {
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
  rec.onspeechstart = () => on.spoke?.();
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
  rec.onerror = (e) => {
    done = true;
    const code = e?.error;
    on.error?.(code === 'not-allowed' || code === 'service-not-allowed' ? 'denied' : code === 'no-speech' || code === 'aborted' ? 'no_speech' : code === 'network' ? 'network' : 'other');
    on.end();
  };
  rec.onend = () => {
    if (!done) on.end();
  };
  try {
    rec.start();
  } catch {
    on.error?.('other');
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

/** Browsers only allow sound after a tap. Call this from the tap that starts a conversation so replies can play later. */
export function unlockAudio(): void {
  try {
    ctx = ctx ?? new AudioContext();
    void ctx.resume();
    window.speechSynthesis?.speak(new SpeechSynthesisUtterance(''));
  } catch {
    /* no audio support: replies stay silent but readable */
  }
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
      const voices = synth.getVoices();
      const want = (SR_LANG[lang] ?? 'en-US').toLowerCase();
      const v = voices.find((x) => x.lang.toLowerCase() === want) ?? voices.find((x) => x.lang.toLowerCase().startsWith(want.slice(0, 2)));
      if (v) u.voice = v;
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

// ---------------------------------------------------------------- server-side listening (works in every browser)

function pickMime(): string {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

/**
 * Records one spoken turn with the microphone (stops by itself after a pause) and has the server turn it into text.
 * The loudness feeds `voiceLevel`, so the hologram visibly reacts to the user's voice.
 */
export function recordAndTranscribe(orgId: string, lang: string, on: { interim: (t: string) => void; final: (t: string) => void; end: () => void; error?: (c: VoiceError | 'server') => void }): () => void {
  let cancelled = false;
  let stopNow = () => {};
  void (async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      on.error?.('denied');
      on.end();
      return;
    }
    if (cancelled) return stream.getTracks().forEach((t) => t.stop());
    const ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 512;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const mime = pickMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const startedAt = Date.now();
    let lastVoice = 0;
    let spoke = false;
    let timer = 0;
    const finish = (send: boolean) => {
      window.clearInterval(timer);
      voiceLevel.value = 0;
      stream.getTracks().forEach((t) => t.stop());
      void ac.close().catch(() => undefined);
      if (rec.state !== 'inactive') rec.stop();
      rec.onstop = async () => {
        if (!send || !spoke || cancelled) return on.end();
        on.interim('…');
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          const form = new FormData();
          form.append('organization_id', orgId);
          form.append('lang', lang);
          form.append('audio', blob, 'speech.webm');
          const { data, error } = await requireClient().functions.invoke('agent-listen', { body: form });
          const text = typeof data?.text === 'string' ? data.text.trim() : '';
          if (error) throw error;
          on.interim('');
          if (text) on.final(text);
          else on.end();
        } catch {
          on.interim('');
          on.error?.('server');
          on.end();
        }
      };
    };
    stopNow = () => finish(false);
    rec.start(250);
    timer = window.setInterval(() => {
      an.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i];
      const level = sum / buf.length / 60;
      voiceLevel.value = Math.min(1, level);
      const now = Date.now();
      if (level > 0.18) {
        if (!spoke) on.interim('🎙 …');
        spoke = true;
        lastVoice = now;
      }
      if ((spoke && now - lastVoice > 1300) || now - startedAt > 20_000 || (!spoke && now - startedAt > 9000)) finish(true);
    }, 80);
  })();
  return () => {
    cancelled = true;
    stopNow();
  };
}

/**
 * Listening for one turn. The microphone is recorded directly and transcribed on the server (reliable in every browser, any language).
 * If recording is impossible or the server fails, the browser's own speech recognition is used instead.
 */
export function listenSmart(orgId: string, lang: string, on: { interim: (t: string) => void; final: (t: string) => void; end: () => void; error?: (c: VoiceError | 'server') => void }): () => void {
  let stopFn: () => void = () => {};
  let off = false;
  const canRecord = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const browser = () => {
    if (off) return;
    if (!recognitionSupported()) {
      on.error?.('other');
      return on.end();
    }
    stopFn = listenOnce(lang, { interim: on.interim, final: on.final, end: on.end, error: on.error });
  };
  if (!canRecord) {
    browser();
  } else {
    let sawError: VoiceError | 'server' | null = null;
    stopFn = recordAndTranscribe(orgId, lang, {
      interim: on.interim,
      final: on.final,
      error: (c) => {
        sawError = c;
      },
      end: () => {
        if (sawError === 'server' && !off) {
          sawError = null;
          on.interim('');
          browser();
        } else {
          if (sawError) on.error?.(sawError);
          on.end();
        }
      },
    });
  }
  return () => {
    off = true;
    stopFn();
  };
}
