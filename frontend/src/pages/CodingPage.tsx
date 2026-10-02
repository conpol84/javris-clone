import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { CODING_TOOLS } from '../lib/company/coding';
import '../styles/firbo.css';

const GATEWAY = ((import.meta.env.VITE_OMNIROUTE_URL as string | undefined) ?? 'https://gateway.firboai.app').replace(/\/+$/, '');
const TONE = { auto: '#00d4ff', manual: '#fbbf24', limited: '#8aa4c4' } as const;

function Code({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <div className="relative">
      <pre className="fb-input overflow-x-auto whitespace-pre-wrap break-all p-3 pe-12 font-mono text-xs" style={{ height: 'auto' }}>{text}</pre>
      <button
        className="fb-btn fb-btn--ghost absolute end-2 top-2"
        style={{ height: 28, padding: '0 8px' }}
        aria-label={t('coding.copy')}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/** Point any coding assistant on your own computer at the company's AI gateway. Nothing typed here leaves the browser. */
export function CodingPage() {
  const { t } = useI18n();
  const [url, setUrl] = useState(GATEWAY);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('auto');
  const [sel, setSel] = useState('claude');
  const tool = useMemo(() => CODING_TOOLS.find((x) => x.id === sel) ?? CODING_TOOLS[0], [sel]);
  const steps = tool.steps({ url, key, model: model.trim() || 'auto' });

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-5 px-4 pb-10 pt-14 md:px-6 md:pt-6">
        <header>
          <div className="fb-eyebrow">{t('coding.eyebrow')}</div>
          <h1 className="fb-grad-text mt-1 text-2xl font-semibold">{t('coding.title')}</h1>
          <p className="fb-muted mt-1 max-w-3xl text-sm">{t('coding.intro')}</p>
        </header>

        <section className="fb-glass fb-col gap-3 p-5">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-xs">
              <span className="fb-dim">{t('coding.url')}</span>
              <input className="fb-input mt-1" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
            </label>
            <label className="block text-xs">
              <span className="fb-dim">{t('coding.key')}</span>
              <input className="fb-input mt-1" type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} />
            </label>
            <label className="block text-xs">
              <span className="fb-dim">{t('coding.model')}</span>
              <input className="fb-input mt-1" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
            </label>
          </div>
          <p className="fb-dim text-xs">{t('coding.keyNote')}</p>
          <div>
            <div className="fb-eyebrow mb-1">{t('coding.step1')}</div>
            <Code text="npm install -g omniroute" />
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <ul className="fb-glass fb-col gap-1 p-2" role="listbox" aria-label={t('coding.tools')}>
            {CODING_TOOLS.map((x) => (
              <li key={x.id}>
                <button
                  role="option"
                  aria-selected={sel === x.id}
                  onClick={() => setSel(x.id)}
                  className="fb-row w-full cursor-pointer justify-between text-start"
                  style={sel === x.id ? { borderColor: TONE[x.support] } : undefined}
                >
                  <span className="truncate text-sm font-medium">{x.name}</span>
                  <span className="fb-dot" style={{ background: TONE[x.support] }} title={t(`coding.support.${x.support}` as TKey)} />
                </button>
              </li>
            ))}
          </ul>

          <section className="fb-glass fb-col gap-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{tool.name}</h2>
              <span className="fb-chip" style={{ color: TONE[tool.support], borderColor: TONE[tool.support] }}>{t(`coding.support.${tool.support}` as TKey)}</span>
            </div>
            <p className="fb-muted text-sm">{t(`coding.about.${tool.support}` as TKey)}</p>
            {steps.length === 0 ? (
              <p className="text-sm">{t('coding.kiro')}</p>
            ) : (
              steps.map((s) => (
                <div key={s.label}>
                  <div className="fb-eyebrow mb-1">{t(`coding.how.${s.label}` as TKey)}</div>
                  <Code text={s.code} />
                </div>
              ))
            )}
            <p className="fb-dim text-xs">{t('coding.getKey')}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
