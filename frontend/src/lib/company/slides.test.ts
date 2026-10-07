import { describe, expect, it } from 'vitest';
import { isPresentation, parseSlides, renderPptxBytes, slideText } from './slides';

const deck = `# Ετήσια στρατηγική 2027\nTrade Athletes · Οκτώβριος 2026\n---\n# Οι πωλήσεις online ανέβηκαν 18%\n- **Q3:** 120 χιλ. €\n- Νέοι πελάτες: 340\nNotes: Ξεκινάμε από τα νούμερα.\n---\nκείμενο χωρίς τίτλο\n---\n# Πίνακας\n| A | B |\n|---|---|\n| 1 | 2 |`;

describe('slides', () => {
  it('splits slides, keeps titles, bullets and speaker notes', () => {
    const s = parseSlides(deck);
    expect(s.map((x) => x.title)).toEqual(['Ετήσια στρατηγική 2027', 'Οι πωλήσεις online ανέβηκαν 18%', 'Πίνακας']);
    expect(s[1].bullets).toEqual(['Q3: 120 χιλ. €', 'Νέοι πελάτες: 340']);
    expect(s[1].notes).toBe('Ξεκινάμε από τα νούμερα.');
    expect(s[1].body).not.toContain('Notes');
  });
  it('turns a slide without bullets into plain lines for PowerPoint', () => {
    expect(slideText(parseSlides(deck)[0])).toEqual(['Trade Athletes · Οκτώβριος 2026']);
    expect(slideText(parseSlides(deck)[2]).join(' ')).toContain('1 2');
  });
  it('shows slides only for a presentation with at least two slides', () => {
    expect(isPresentation('presentation', deck)).toBe(true);
    expect(isPresentation('report', deck)).toBe(false);
    expect(isPresentation('presentation', '# Μόνο μία')).toBe(false);
  });

  it('generates a real PPTX package with one worksheet part per rendered slide', async () => {
    const slides = parseSlides(deck).slice(0, 2);
    const bytes = await renderPptxBytes(slides);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const archiveText = new TextDecoder('latin1').decode(bytes);
    expect(archiveText).toContain('ppt/slides/slide1.xml');
    expect(archiveText).toContain('ppt/slides/slide2.xml');
    expect(archiveText).not.toContain('ppt/slides/slide3.xml');
  });
});
