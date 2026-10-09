/** Normalize negotiated audio without decoding HTML/JSON as speech.
 * Octet-stream is deliberate: Supabase functions-js returns it as a Blob.
 */
export async function speechAudioBlob(value: unknown, requireWave = false): Promise<Blob> {
  if (!(value instanceof Blob) || !value.size || value.size > 8_000_000) throw new Error('invalid_audio');
  const type = value.type.split(';',1)[0].trim().toLowerCase();
  if (!requireWave && type.startsWith('audio/') && !['audio/wav','audio/x-wav'].includes(type)) return value;
  const h = new Uint8Array(await value.slice(0,44).arrayBuffer());
  const word = (at: number, text: string) => [...text].every((c,i) => h[at+i] === c.charCodeAt(0));
  const wave = h.length >= 44 && word(0,'RIFF') && word(8,'WAVE') && word(12,'fmt ') && word(36,'data');
  if (wave) {
    const v = new DataView(h.buffer, h.byteOffset, h.byteLength);
    if (v.getUint32(4,true) + 8 !== value.size || v.getUint32(16,true) !== 16 || v.getUint16(20,true) !== 1 || v.getUint16(22,true) !== 1 || v.getUint32(24,true) !== 24000 || v.getUint32(28,true) !== 48000 || v.getUint16(32,true) !== 2 || v.getUint16(34,true) !== 16 || v.getUint32(40,true) + 44 !== value.size || !v.getUint32(40,true) || v.getUint32(40,true)%2) throw new Error('invalid_audio');
    if (!['application/octet-stream','audio/wav','audio/x-wav'].includes(type)) throw new Error('invalid_audio');
    return value.slice(0,value.size,'audio/wav');
  }
  // Never quietly label the old MP3 or a browser voice as the processed Dark preset.
  if (requireWave) throw new Error('dark_voice_not_available');
  if (type.startsWith('audio/')) return value;
  if (type !== 'application/octet-stream') throw new Error('invalid_audio');
  const id3=h.length>=10 && h[0]===73 && h[1]===68 && h[2]===51 && h[3]>=2 && h[3]<=4 && h[4]!==255 && h.slice(6,10).every(b=>b<128);
  const frame=h.length>=4 && h[0]===255 && (h[1]&224)===224 && (h[1]&24)!==8 && (h[1]&6)!==0 && (h[2]&240)!==240 && (h[2]&12)!==12;
  if (!id3&&!frame) throw new Error('invalid_audio');
  return value.slice(0,value.size,'audio/mpeg');
}
