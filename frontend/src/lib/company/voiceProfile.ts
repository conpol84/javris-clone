/** Sound preference only; no user data, transcripts, recordings or credentials. */
export type VoiceProfile = 'firbo-dark-v1' | 'natural-v1';
const KEY = 'firbo.voice.profile.v1';
let current: VoiceProfile | undefined;
const subscribers = new Set<() => void>();
export const defaultVoiceProfile = (): VoiceProfile => 'firbo-dark-v1';
export function getVoiceProfile(): VoiceProfile {
  if (current) return current;
  try { current = globalThis.localStorage?.getItem(KEY) === 'natural-v1' ? 'natural-v1' : 'firbo-dark-v1'; }
  catch { current = 'firbo-dark-v1'; }
  return current;
}
export function setVoiceProfile(value: VoiceProfile): void {
  if (!['firbo-dark-v1','natural-v1'].includes(value)) return;
  current = value;
  try { globalThis.localStorage?.setItem(KEY, value); } catch { /* Memory preference still works. */ }
  for (const cb of subscribers) cb();
}
export const subscribeVoiceProfile = (cb: () => void) => { subscribers.add(cb); return () => { subscribers.delete(cb); }; };
