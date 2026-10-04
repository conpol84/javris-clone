import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, Globe, BookOpen, Brain, Search } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import type { TaskResult } from '../../lib/company/types';

const STEP_ICON = { web_search: Search, read_page: Globe, memory_search: BookOpen, think: Brain } as const;

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
  const report = result.report ?? '';
  const sources = reportSources(report);
  const steps = result.steps ?? [];
  return (
    <div className="fb-col gap-3">
      {steps.length > 0 && (
        <div>
          <div className="fb-eyebrow mb-1">{t('report.steps', { count: steps.length })}</div>
          <ol className="flex flex-wrap gap-1.5">
            {steps.map((s, i) => {
              const Icon = STEP_ICON[s.action as keyof typeof STEP_ICON] ?? Search;
              return (
                <li key={i} className="fb-chip max-w-full" title={s.input} style={s.ok === false ? { opacity: 0.55 } : undefined}>
                  <Icon size={11} /> <span className="truncate">{s.action === 'read_page' ? host(s.input) : s.input}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {report && (
        <div className={`fb-report break-words text-[13px] leading-relaxed ${compact ? 'max-h-72 overflow-y-auto pr-1' : ''}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
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
