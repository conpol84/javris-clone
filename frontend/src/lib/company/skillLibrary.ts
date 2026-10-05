// Ready-made skills (OpenJarvis's skills library, adapted for business work). The instructions are given to the
// AI employee in English; it still writes in the company's language. Names and blurbs are shown in the user's language.
export interface LibrarySkill {
  slug: string;
  names: Record<string, string>;
  instructions: string;
}

const n = (en: string, el: string, es: string, pt: string, de: string, fr: string, zh: string, ar: string) =>
  ({ en, el, es, 'pt-BR': pt, de, fr, 'zh-CN': zh, ar });

export const SKILL_LIBRARY: LibrarySkill[] = [
  { slug: 'deep-research', names: n('Deep research', 'Σε βάθος έρευνα', 'Investigación a fondo', 'Pesquisa aprofundada', 'Tiefe Recherche', 'Recherche approfondie', '深度研究', 'بحث معمّق'),
    instructions: '1. Search the web with 2-3 different queries. 2. Read the 2-3 most relevant pages, not only the snippets. 3. Compare what the sources say and note disagreements. 4. Write the findings as short sections with the source link after each fact. 5. End with "What we still do not know".' },
  { slug: 'competitor-scan', names: n('Competitor scan', 'Ανάλυση ανταγωνιστών', 'Análisis de competidores', 'Análise de concorrentes', 'Wettbewerbsanalyse', 'Analyse des concurrents', '竞争对手分析', 'تحليل المنافسين'),
    instructions: 'For each competitor: what they sell, price (if public), who they target, their latest news (last 60 days) and one weakness we can use. Put it in a table, then 3 concrete recommendations for us. Cite a link for every price and news item.' },
  { slug: 'sales-email', names: n('Sales email', 'Email πωλήσεων', 'Email de ventas', 'Email de vendas', 'Verkaufs-E-Mail', 'Email commercial', '销售邮件', 'بريد مبيعات'),
    instructions: 'Write a short sales email (under 120 words): a subject line under 7 words, one sentence about the reader\'s problem, one about our solution with a concrete number from company knowledge, and a single clear call to action. Offer a second, shorter variant. Propose sending only as an approval action.' },
  { slug: 'social-post', names: n('Social media post', 'Ανάρτηση social media', 'Publicación en redes', 'Post para redes sociais', 'Social-Media-Beitrag', 'Publication réseaux sociaux', '社交媒体帖子', 'منشور تواصل اجتماعي'),
    instructions: 'Write 3 versions of the post (short, medium, with a question to the audience), each with up to 3 relevant hashtags. Match the company\'s tone from memory. If an image would help and you can create images, create one. Propose publishing only as an approval action.' },
  { slug: 'meeting-notes', names: n('Meeting notes', 'Σημειώσεις συνάντησης', 'Notas de reunión', 'Notas de reunião', 'Besprechungsnotizen', 'Compte rendu de réunion', '会议纪要', 'محضر اجتماع'),
    instructions: 'Turn the input into: Summary (3 lines), Decisions, Action items as a table (owner, task, due date), Open questions. Never invent owners or dates: write "not set" when they are missing.' },
  { slug: 'customer-reply', names: n('Customer reply', 'Απάντηση σε πελάτη', 'Respuesta a cliente', 'Resposta ao cliente', 'Kundenantwort', 'Réponse client', '客户回复', 'رد على عميل'),
    instructions: 'Search the company knowledge for the answer first. Reply politely and briefly, answer the exact question, and give one next step. If the knowledge does not contain the answer, say what you need to check instead of guessing. Propose sending only as an approval action.' },
  { slug: 'price-quote', names: n('Price quote', 'Προσφορά τιμής', 'Presupuesto', 'Orçamento', 'Angebot', 'Devis', '报价单', 'عرض سعر'),
    instructions: 'Take prices only from the company knowledge. Use the calculator for every line total, VAT and discount. Show a table: item, quantity, unit price, total; then subtotal, VAT and grand total. Convert currency with today\'s rate only if asked.' },
  { slug: 'weekly-report', names: n('Weekly report', 'Εβδομαδιαία αναφορά', 'Informe semanal', 'Relatório semanal', 'Wochenbericht', 'Rapport hebdomadaire', '周报', 'تقرير أسبوعي'),
    instructions: 'Report on: what was finished, what failed or is blocked and why, money spent, approvals waiting, and the top 3 priorities for next week tied to the company goal. Use numbers from the company data, never estimates.' },
  { slug: 'seo-article', names: n('SEO article', 'Άρθρο SEO', 'Artículo SEO', 'Artigo SEO', 'SEO-Artikel', 'Article SEO', 'SEO 文章', 'مقال SEO'),
    instructions: 'Research the topic and 2-3 top-ranking pages first. Write a title under 60 characters, a meta description under 155 characters, an outline with H2/H3 headings and the full article (600-900 words) with the main keyword in the first paragraph. List the sources used.' },
  { slug: 'data-check', names: n('Numbers check', 'Έλεγχος αριθμών', 'Revisión de cifras', 'Conferência de números', 'Zahlenprüfung', 'Vérification des chiffres', '数字核对', 'تدقيق الأرقام'),
    instructions: 'Recalculate every number in the input with the calculator (or the server agent for larger data). List each figure as: stated value, recalculated value, OK or WRONG. Explain every difference in one line.' },
  { slug: 'lead-research', names: n('Lead research', 'Έρευνα υποψήφιων πελατών', 'Investigación de clientes potenciales', 'Pesquisa de leads', 'Lead-Recherche', 'Recherche de prospects', '潜在客户调研', 'بحث العملاء المحتملين'),
    instructions: 'Find companies that match the target described. For each: name, website, size or location if public, why they fit, and a public contact page link. Never invent people\'s names or emails. Maximum 10 leads, best first.' },
  { slug: 'translate-localize', names: n('Translate and localize', 'Μετάφραση και προσαρμογή', 'Traducir y localizar', 'Traduzir e localizar', 'Übersetzen und lokalisieren', 'Traduire et localiser', '翻译与本地化', 'الترجمة والتوطين'),
    instructions: 'Translate the input into the requested language, keeping the meaning, tone and formatting. Adapt units, dates, currency format and idioms to the target country. Add a short list of terms you were unsure about.' },
];

export const skillName = (s: LibrarySkill, lang: string) => s.names[lang] ?? s.names.en;
