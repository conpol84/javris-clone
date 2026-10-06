// A presentation an AI employee wrote: markdown slides separated by lines holding only ---.
// Each slide starts with "# Title", then bullets (or a small table), optionally ending with "Notes: ...".

export interface Slide { title: string; body: string; bullets: string[]; notes: string }

/** The slides of a presentation report; slides without a "# " title are skipped. */
export function parseSlides(report: string): Slide[] {
  return report.split(/\n\s*-{3,}\s*\n/).map((raw) => raw.trim()).filter((raw) => /^#\s/m.test(raw)).map((raw) => {
    const lines = raw.split('\n');
    const at = lines.findIndex((l) => /^#\s/.test(l));
    const title = lines[at].replace(/^#\s+/, '').trim();
    const rest = lines.slice(at + 1);
    const notesAt = rest.findIndex((l) => /^\s*(notes|σημειώσεις|notas|notizen|remarques|备注|ملاحظات)\s*:/i.test(l));
    const notes = notesAt < 0 ? '' : rest.slice(notesAt).join(' ').replace(/^\s*[^:]+:\s*/, '').trim();
    const bodyLines = notesAt < 0 ? rest : rest.slice(0, notesAt);
    const body = bodyLines.join('\n').trim();
    const bullets = bodyLines.filter((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1').trim());
    return { title, body, bullets, notes };
  });
}

/** True when a report should be shown as slides. */
export function isPresentation(format: string | undefined, report: string): boolean {
  return format === 'presentation' && parseSlides(report).length >= 2;
}

/** Plain text of a slide body for PowerPoint: bullets when there are any, otherwise the lines without markdown marks. */
export function slideText(slide: Slide): string[] {
  if (slide.bullets.length) return slide.bullets;
  return slide.body.split('\n').map((l) => l.replace(/[#*_`>|]/g, ' ').replace(/\s+/g, ' ').trim()).filter((l) => l && !/^-+$/.test(l));
}

/** Builds and downloads a .pptx of the slides (the library loads only when asked). */
export async function downloadPptx(slides: Slide[], fileName: string): Promise<void> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: i === 0 ? '0B1220' : 'FFFFFF' };
    const dark = i === 0;
    slide.addText(s.title, { x: 0.6, y: dark ? 2.4 : 0.4, w: 12.1, h: dark ? 1.4 : 0.9, fontSize: dark ? 40 : 28, bold: true, color: dark ? 'FFFFFF' : '0B1220', fontFace: 'Arial' });
    const text = slideText(s);
    if (text.length) {
      slide.addText(text.map((t) => ({ text: t, options: { bullet: !dark, breakLine: true } })),
        { x: 0.8, y: dark ? 3.9 : 1.5, w: 11.8, h: dark ? 2 : 5.4, fontSize: dark ? 18 : 18, color: dark ? 'B8C4D9' : '1F2937', valign: 'top', fontFace: 'Arial', paraSpaceAfter: 8 });
    }
    if (s.notes) slide.addNotes(s.notes);
    slide.addText(`${i + 1} / ${slides.length}`, { x: 11.9, y: 7.0, w: 1, h: 0.3, fontSize: 10, color: dark ? '8899AA' : '9CA3AF', align: 'right' });
  });
  await pptx.writeFile({ fileName: `${fileName.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'presentation'}.pptx` });
}
