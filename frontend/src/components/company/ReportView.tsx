import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, Globe, BookOpen, Brain, Search, Calculator, CloudSun, Coins, Library, ImagePlus, ScanEye, Server } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import type { TaskResult } from '../../lib/company/types';
import { useWorkspaceCopy } from '../../lib/company/workspaceCopy';
import { isPresentation, parseSlides } from '../../lib/company/slides';
import { SlideDeck } from './SlideDeck';

const STEP_ICON = { web_search: Search, read_page: Globe, memory_search: BookOpen, think: Brain, calculator: Calculator, weather: CloudSun, exchange_rate: Coins,
  knowledge_search: Library, generate_image: ImagePlus, analyze_image: ScanEye, server_task: Server } as const;

/** Links found in the report: the sources the agent cites. Only http(s), deduplicated, at most 12. */
export function reportSources(report: string): string[] {
  const urls = report.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
  return [...new Set(urls.map((u) => u.replace(/[.,;:]+$/, '')))].slice(0, 12);
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

/** A task's report as a readable document: formatted text, the research steps taken and the sources. */
export function ReportView({ result, compact = false }: { result: TaskResult; compact?: boolean }) {
  const { t } = useI18n();
  const copy = useWorkspaceCopy();
  const report = result.report ?? '';
  const sources = reportSources(report);
  const steps = result.steps ?? [];
  return (
    <div className="fb-col gap-3">
      {steps.length > 0 && (
        <div>
          <div className="fb-eyebrow mb-1">{t('report.steps', { count: steps.length })}</div>
          <ol className="fb-col gap-1.5">
            {steps.map((s, i) => {
              const Icon = STEP_ICON[s.action as keyof typeof STEP_ICON] ?? Search;
              const label = <><Icon size={11} className="shrink-0" /> <span className="fb-dim shrink-0">{i + 1}.</span> <span className="truncate">{s.action === 'read_page' ? host(s.input) : s.input}</span></>;
              // What the step found, so the owner can see the work and not only the final report.
              return s.out ? (
                <li key={i}>
                  <details className="rounded-lg border border-white/10 px-2 py-1 text-[12px]">
                    <summary className="flex cursor-pointer items-center gap-1.5" title={s.input}>{label}</summary>
                    <p className="fb-dim mt-1 whitespace-pre-wrap break-words" dir="auto"><span className="fb-eyebrow mr-1">{copy('aFound')}</span>{s.out}</p>
                  </details>
                </li>
              ) : (
                <li key={i} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-[12px]" title={s.input} style={s.ok === false ? { opacity: 0.55 } : undefined}>{label}</li>
              );
            })}
          </ol>
        </div>
      )}
      {report && isPresentation(result.format, report) && <SlideDeck slides={parseSlides(report)} title={parseSlides(report)[0]?.title ?? result.summary ?? 'presentation'} />}
      {report && !isPresentation(result.format, report) && (
        <div className={`fb-report break-words text-[13px] leading-relaxed ${compact ? 'max-h-72 overflow-y-auto pr-1' : ''}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Images an employee created: only https links, never bigger than the report.
              img: ({ src, alt }) => (typeof src === 'string' && /^https:\/\//.test(src)
                ? <a href={src} target="_blank" rel="noopener noreferrer nofollow"><img src={src} alt={alt ?? ''} loading="lazy" className="my-2 max-h-96 max-w-full rounded-lg border border-white/10" /></a>
                : null),
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="fb-link underline">
                  {children}
                </a>
              ),
            }}
          >
            {report}
          </ReactMarkdown>
        </div>
      )}
      {sources.length > 0 && (
        <div>
          <div className="fb-eyebrow mb-1">{t('report.sources', { count: sources.length })}</div>
          <ul className="flex flex-wrap gap-1.5">
            {sources.map((u) => (
              <li key={u}>
                <a className="fb-chip cursor-pointer" href={u} target="_blank" rel="noopener noreferrer nofollow" title={u}>
                  <ExternalLink size={11} /> {host(u)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
