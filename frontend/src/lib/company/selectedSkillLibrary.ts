import type { LibrarySkill } from './skillLibrary';

// Owner-selected, bounded FIRBO adaptations; not the upstream plugins or engines.
// Attribution, reviewed source hashes and integration limits:
// third_party/firbo-selected-skills/NOTICE.md
const names = (en: string, el: string, es: string, pt: string, de: string, fr: string, zh: string, ar: string) =>
  ({ en, el, es, 'pt-BR': pt, de, fr, 'zh-CN': zh, ar });

export const SELECTED_SKILL_LIBRARY: LibrarySkill[] = [
  {
    slug: 'superpowers-delivery',
    names: names('Superpowers — FIRBO delivery', 'Superpowers — υλοποίηση FIRBO', 'Superpowers — entrega FIRBO', 'Superpowers — entrega FIRBO', 'Superpowers — FIRBO-Umsetzung', 'Superpowers — réalisation FIRBO', 'Superpowers — FIRBO 交付', 'Superpowers — تنفيذ FIRBO'),
    requiredTools: ['knowledge_search'],
    instructions: 'Use this delivery method for an authorized implementation or repair. Read the existing goal, accepted work and constraints before changing anything. Define the expected behavior and an observable acceptance check. For a defect, reproduce the exact symptom and distinguish observations from hypotheses before proposing a minimal correction. For new behavior, state the input, output and meaningful verification. Preserve previous contributor work and use a separate candidate when concurrent changes exist. Use available, permitted implementation tools; if none can access the target, provide the exact patch or handoff and mark execution blocked. Verify the changed behavior and relevant regressions with real results before claiming completion. Report Changed, Tested, Passed, Failed and Remains with source/artifact references. This skill does not start subagents, invoke a plugin, install software, grant tool access, or authorize a merge or deployment.',
  },
  {
    slug: 'ui-ux-pro-max-review',
    names: names('UI UX Pro Max — FIRBO review', 'UI UX Pro Max — έλεγχος FIRBO', 'UI UX Pro Max — revisión FIRBO', 'UI UX Pro Max — revisão FIRBO', 'UI UX Pro Max — FIRBO-Prüfung', 'UI UX Pro Max — revue FIRBO', 'UI UX Pro Max — FIRBO 审查', 'UI UX Pro Max — مراجعة FIRBO'),
    requiredTools: ['knowledge_search'],
    instructions: 'Review or design the requested interface using the existing company brand and design system. Preserve accepted FIRBO components and behavior. Prioritize a clear user task, accessible labels, keyboard focus, readable contrast, meaningful loading/empty/error/success states and touch targets. Check narrow mobile and wide desktop layouts, long translated text and right-to-left layout when relevant. Keep typography, spacing, icons and color consistent rather than introducing a new theme for each page. Explain each proposed change in terms of the user task it improves. If an authorized implementation or rendered-browser tool is available, apply the scoped change and verify it with that tool; otherwise return a design brief and explicitly mark implementation/rendering unverified. Do not claim the upstream search datasets, Python scripts or plugin are installed, and do not grant access through this skill.',
  },
  {
    slug: 'last30days-research',
    names: names('Last30Days — FIRBO research', 'Last30Days — έρευνα FIRBO', 'Last30Days — investigación FIRBO', 'Last30Days — pesquisa FIRBO', 'Last30Days — FIRBO-Recherche', 'Last30Days — recherche FIRBO', 'Last30Days — FIRBO 调研', 'Last30Days — بحث FIRBO'),
    requiredTools: ['web_search', 'read_page'],
    instructions: 'Research the requested topic over the last 30 days using the current date; state the exact date range and timezone used. Search with distinct queries and read relevant accessible pages. Record each source URL, publication date and event date when available. Exclude undated or older material from current findings, or label it separately as background. Prefer primary evidence; distinguish official announcements, individual reports and your inference. Deduplicate repeated coverage of the same event and compare conflicting accounts. Summarize the main developments, useful implications and evidence gaps in the company language. Report which sources were actually accessible: web-only research is not complete Reddit, X, YouTube or other platform coverage. Missing dates, blocked tools and failed searches are limitations, never proof that nothing happened. Use only enabled search/read tools; do not import cookies, create accounts, run upstream scripts, send messages or enable a paid search provider. The full upstream multi-source engine is not installed by this skill.',
  },
  {
    slug: 'humanizer-editing',
    names: names('Humanizer — FIRBO writing', 'Humanizer — κείμενα FIRBO', 'Humanizer — textos FIRBO', 'Humanizer — textos FIRBO', 'Humanizer — FIRBO-Texte', 'Humanizer — rédaction FIRBO', 'Humanizer — FIRBO 写作', 'Humanizer — كتابة FIRBO'),
    instructions: 'Edit the supplied draft into clear, natural prose for its intended reader and language, including Greek when requested. Keep the meaning, names, dates, numbers, quotations, citations, links and degree of certainty intact. Replace filler, vague praise, inflated claims, repetitive transitions and mechanical sentence patterns with concrete wording. Preserve the company tone and useful technical terms. Do not invent personal experience, people, statistics, sources or credentials, and do not frame this as evading authorship disclosure. Preserve exact operational states: proposed, queued, running, blocked, failed and completed must never be rewritten into a stronger success claim. Keep approvals, risks and missing evidence visible when material. Return the edited text and briefly flag ambiguous facts that need verification. Editing does not publish or send the text.',
  },
];
