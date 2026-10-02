import { agentColor } from './status';

/** Cosmetic look of an agent's 3D character. Every field is a small index so it is cheap to store and validate. */
export interface Persona {
  skin: number;
  hair: number;
  hairColor: number;
  outfit: number;
  accessory: number;
}

export const SKINS = ['#f2c9a5', '#e0a97c', '#c58c63', '#a06a46', '#7a4a30', '#4f2e1f'];
export const HAIR_COLORS = ['#1b1410', '#4a2f1a', '#8a5a2b', '#d9b36a', '#b8321f', '#cfd3da', '#6d4bd6'];
export const OUTFITS = ['#00d4ff', '#60a5fa', '#a78bfa', '#f472b6', '#fbbf24', '#fb923c', '#e2e8f0', '#334155'];
export const HAIR_STYLES = 5; // none, short, long, bun, cap
export const ACCESSORIES = 5; // none, glasses, headset, tie, visor

const LIMITS: Record<keyof Persona, number> = { skin: SKINS.length, hair: HAIR_STYLES, hairColor: HAIR_COLORS.length, outfit: OUTFITS.length, accessory: ACCESSORIES };

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** A stable look for agents nobody has customised yet, so a whole team does not look identical. */
export function defaultPersona(seed: string, color?: string): Persona {
  const h = hash(seed);
  const outfit = color ? OUTFITS.findIndex((c) => c.toLowerCase() === color.toLowerCase()) : -1;
  return {
    skin: h % SKINS.length,
    hair: (h >> 3) % HAIR_STYLES,
    hairColor: (h >> 6) % HAIR_COLORS.length,
    outfit: outfit >= 0 ? outfit : (h >> 9) % OUTFITS.length,
    accessory: (h >> 12) % ACCESSORIES,
  };
}

/** Saved values win; anything missing or out of range falls back to the stable default. */
export function resolvePersona(agent: { slug: string; type: string; persona?: Partial<Persona> | null }): Persona {
  const base = defaultPersona(agent.slug, agentColor(agent.type, agent.slug));
  const saved = agent.persona ?? {};
  const out = { ...base };
  for (const k of Object.keys(LIMITS) as (keyof Persona)[]) {
    const v = saved[k];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < LIMITS[k]) out[k] = v;
  }
  return out;
}
