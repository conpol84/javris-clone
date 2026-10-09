import { describe, expect, it } from 'vitest';
import { defaultPersona, HAIR_COLORS, OUTFITS, resolvePersona, SKINS } from './persona';

describe('persona', () => {
  it('gives the same look for the same agent every time', () => {
    expect(defaultPersona('sales')).toEqual(defaultPersona('sales'));
  });
  it('keeps every field inside its palette', () => {
    for (const seed of ['a', 'sales', 'ceo-2', 'x'.repeat(40), 'ΕΛΛΗΝΙΚΑ']) {
      const p = defaultPersona(seed);
      expect(p.skin).toBeLessThan(SKINS.length);
      expect(p.hairColor).toBeLessThan(HAIR_COLORS.length);
      expect(p.outfit).toBeLessThan(OUTFITS.length);
      expect(p.hair).toBeLessThan(5);
      expect(p.accessory).toBeLessThan(5);
    }
  });
  it('uses saved values and ignores invalid ones', () => {
    const p = resolvePersona({ slug: 'sales', type: 'sales', persona: { skin: 2, hair: 99, outfit: -1, accessory: 1.5, hairColor: 3 } });
    expect(p.skin).toBe(2);
    expect(p.hairColor).toBe(3);
    const d = defaultPersona('sales', '#00d97a');
    expect(p.hair).toBe(d.hair);
    expect(p.accessory).toBe(d.accessory);
  });
});
