import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { downloadPptx, type Slide } from '../../lib/company/slides';
import { useWorkspaceCopy } from '../../lib/company/workspaceCopy';

/** A presentation an employee made: one slide at a time, arrows to move, and a real PowerPoint download. */
export function SlideDeck({ slides, title }: { slides: Slide[]; title: string }) {
  const copy = useWorkspaceCopy();
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const slide = slides[Math.min(at, slides.length - 1)];
  const go = (d: number) => setAt((i) => Math.max(0, Math.min(slides.length - 1, i + d)));
  return (
    <div className="fb-col gap-2" onKeyDown={(e) => { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); }}>
      <div className="relative flex min-h-[260px] flex-col rounded-xl border border-white/10 bg-white/[0.03] p-5" style={at === 0 ? { background: 'linear-gradient(135deg, rgba(0,212,255,.10), rgba(129,140,248,.10))' } : undefined} dir="auto">
        <h3 className={at === 0 ? 'mt-auto text-2xl font-semibold' : 'text-lg font-semibold'}>{slide.title}</h3>
        {slide.body && (
          <div className={`fb-report mt-3 break-words text-[13px] leading-relaxed ${at === 0 ? 'mb-auto fb-dim' : ''}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{slide.body}</ReactMarkdown>
          </div>
        )}
        <span className="fb-dim absolute bottom-2 end-3 text-[11px]">{copy('dSlide', { n: at + 1, total: slides.length })}</span>
      </div>
      {slide.notes && (
        <p className="fb-dim text-[12px]" dir="auto"><span className="fb-eyebrow me-1">{copy('dNotes')}</span>{slide.notes}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="fb-btn fb-btn--ghost" style={{ height: 32 }} disabled={at === 0} onClick={() => go(-1)} aria-label={copy('dPrev')}><ChevronLeft size={14} /></button>
        <button type="button" className="fb-btn fb-btn--ghost" style={{ height: 32 }} disabled={at >= slides.length - 1} onClick={() => go(1)} aria-label={copy('dNext')}><ChevronRight size={14} /></button>
        <button type="button" className="fb-btn fb-btn--ghost ms-auto" style={{ height: 32 }} disabled={busy}
          onClick={() => { setBusy(true); void downloadPptx(slides, title).catch((err) => console.error(err)).finally(() => setBusy(false)); }}>
          <Download size={14} /> {copy('dPptx')}
        </button>
      </div>
    </div>
  );
}
