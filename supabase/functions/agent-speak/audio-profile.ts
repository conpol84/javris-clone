/** Firbo's original synthetic voice, not an imitation of a real speaker.
 * Bounded deterministic DSP: pitch/time resampling, dark EQ and subtle ring mix.
 * No ambient noise/music, no randomized processing and no long echo tail.
 */
export const DARK_PROFILE = 'firbo-dark-v1';
export const NATURAL_PROFILE = 'natural-v1';
export const SAMPLE_RATE = 24_000;
export const MAX_PCM_BYTES = SAMPLE_RATE * 2 * 64;
export const DARK_RATE = 0.86; // ~-2.61 semitones; duration increases by 1 / rate.
export const DARK_INSTRUCTIONS = 'You are Firbo, an original synthetic AI voice. Speak in a deep, resonant bass-baritone register with a dark cinematic cybernetic character. Use restrained, deliberate phrasing, low pitch and a composed, authoritative delivery. Keep every word clear and natural in the input language, including Greek. Avoid cheerful customer-service intonation, breathy whispering, shouting, growling, music and sound effects. Read only the supplied text; do not add words. Do not imitate any actor, celebrity or named character.';
export const NATURAL_INSTRUCTIONS = 'Read only the supplied text clearly, in its original language, with calm natural phrasing. Do not add words or sound effects.';
export type VoiceProfile = typeof DARK_PROFILE | typeof NATURAL_PROFILE;
export function profileOf(value: unknown): VoiceProfile {
  if (value === undefined || value === DARK_PROFILE) return DARK_PROFILE;
  if (value === NATURAL_PROFILE) return NATURAL_PROFILE;
  throw new Error('invalid_voice_profile');
}
export function speechRequest(model: string, input: string, profile: VoiceProfile, wave: boolean) {
  if (!['gpt-4o-mini-tts', 'tts-1'].includes(model)) throw new Error('invalid_model');
  return {
    model, voice: 'onyx', input, response_format: wave ? 'pcm' : 'mp3',
    // Processing slows/lowers the PCM itself. Legacy MP3 gets slower delivery too.
    speed: profile === DARK_PROFILE ? (wave ? 1.02 : 0.88) : 1,
    ...(model === 'gpt-4o-mini-tts' ? { instructions: profile === DARK_PROFILE ? DARK_INSTRUCTIONS : NATURAL_INSTRUCTIONS } : {}),
  };
}
export function validMp3(bytes: Uint8Array): boolean {
  const h = bytes;
  const id3 = h.length >= 10 && h[0] === 73 && h[1] === 68 && h[2] === 51 && h[3] >= 2 && h[3] <= 4 && h[4] !== 255 && h.slice(6, 10).every(b => b < 128);
  const frame = h.length >= 4 && h[0] === 255 && (h[1] & 224) === 224 && (h[1] & 24) !== 8 && (h[1] & 6) !== 0 && (h[2] & 240) !== 240 && (h[2] & 12) !== 12;
  return id3 || frame;
}
export function renderWave(pcm: Uint8Array, profile: VoiceProfile): Uint8Array {
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_PCM_BYTES) throw new Error('invalid_pcm');
  // Reject obvious HTML/JSON/encoded audio rather than interpreting it as PCM.
  const prefix = new TextDecoder().decode(pcm.slice(0, 16)).trimStart();
  if (/^(?:RIFF|ID3|OggS|fLaC|<!|<html|\{"|\[\{)/.test(prefix)) throw new Error('invalid_pcm');
  const input = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const rate = profile === DARK_PROFILE ? DARK_RATE : 1;
  const samples = pcm.length / 2;
  const length = Math.ceil(samples / rate);
  const out = new Uint8Array(44 + length * 2);
  const view = new DataView(out.buffer);
  const tag = (at: number, value: string) => { for (let i = 0; i < value.length; i++) out[at + i] = value.charCodeAt(i); };
  tag(0, 'RIFF'); view.setUint32(4, out.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, length * 2, true);
  if (profile === NATURAL_PROFILE) { out.set(pcm, 44); return out; }
  const highPass = Math.exp(-2 * Math.PI * 55 / SAMPLE_RATE);
  const bassAlpha = 1 - Math.exp(-2 * Math.PI * 220 / SAMPLE_RATE);
  const presenceAlpha = 1 - Math.exp(-2 * Math.PI * 5800 / SAMPLE_RATE);
  const ringStep = 2 * Math.PI * 42 / SAMPLE_RATE;
  let previous = 0, hp = 0, bass = 0, smoothed = 0;
  const fade = Math.round(SAMPLE_RATE * 0.006);
  for (let i = 0; i < length; i++) {
    const pos = Math.min(i * rate, samples - 1), a = Math.floor(pos), f = pos - a;
    const x0 = input.getInt16(a * 2, true) / 32768;
    const x1 = input.getInt16(Math.min(a + 1, samples - 1) * 2, true) / 32768;
    const x = x0 + (x1 - x0) * f;
    hp = highPass * (hp + x - previous); previous = x;
    bass += bassAlpha * (hp - bass);
    const dark = hp + 0.32 * bass;
    smoothed += presenceAlpha * (dark - smoothed);
    // 12% ring-modulated signal, 88% intelligible dry voice; no added sound.
    const mix = smoothed * (0.88 + 0.12 * Math.sin(i * ringStep));
    const envelope = Math.max(0, Math.min(1, i / fade, (length - 1 - i) / fade));
    // Smooth saturation at <90% full-scale avoids integer wrap/hard clipping.
    const limited = 0.9 * Math.tanh(mix * 1.2) * envelope;
    view.setInt16(44 + 2 * i, Math.round(limited * 32767), true);
  }
  return out;
}
