// What kind of work product a task asks for, and the professional standard each one is written to.
// A report reads like a consultant's report, a presentation is real slides, a memo or email is ready to send.
// A short or unstructured draft gets one improvement pass before the owner sees it (same facts, better work).

export type Deliverable = 'report' | 'presentation' | 'memo';

const PRESENTATION = /\b(presentation|slides?|slide deck|deck|pitch|keynote|powerpoint|pptx)\b|παρουσίαση|παρουσιάση|παρουσιασ|διαφάνει|σλάιντ|presentaci[oó]n|apresenta[cç][aã]o|pr[äa]sentation|folien|diapositiv|演示|幻灯片|عرض تقديمي|شرائح/i;
const MEMO = /\b(e-?mail|memo|letter|message|newsletter|announcement|post)\b|email|μέιλ|επιστολή|γράμμα|μήνυμα|ανακοίνωση|υπόμνημα|correo|carta|mensagem|nachricht|courriel|lettre|邮件|信函|بريد|رسالة/i;

/** The deliverable a task asks for, from its title and description. */
export function detectDeliverable(title: string, description = ''): Deliverable {
  const text = `${title}\n${description}`;
  if (PRESENTATION.test(text)) return 'presentation';
  if (MEMO.test(title)) return 'memo';
  return 'report';
}

/** The standard the report field must meet, added to the employee's instructions. */
export function deliverableInstructions(kind: Deliverable): string {
  if (kind === 'presentation') {
    return [
      'DELIVERABLE: a presentation. The "report" field must be the slides themselves, 8 to 12 slides, in markdown:',
      '- Separate slides with a line containing only ---',
      '- Each slide starts with "# " and a short, specific title (a message, not a label: "Online sales grew 18% in Q3", not "Sales").',
      '- Then 3 to 5 concise bullet points with concrete facts, figures, names and dates from your material. No paragraphs on slides.',
      '- Optionally end a slide with a line "Notes: ..." holding what the presenter says (1 to 3 sentences).',
      '- Slide 1: title slide (topic, company, date). Slide 2: the key message in one sentence plus 3 headline points. Last slides: recommendations and next steps (who, what, when), then sources.',
      'Use a markdown table on a slide when comparing options or numbers.',
    ].join('\n');
  }
  if (kind === 'memo') {
    return [
      'DELIVERABLE: a message ready to send. The "report" field holds the final text the owner can copy as is:',
      'a clear subject line ("Subject: ..."), a greeting, short paragraphs with the point first, a specific call to action and a professional sign-off.',
      'No placeholders like [Name] unless the information truly is missing; then say in one line under the text what to fill in. Propose sending it as an action, never send it yourself.',
    ].join('\n');
  }
  return [
    'DELIVERABLE: a professional report, written like a senior consultant for a busy owner. The "report" field in markdown must contain these sections with "## " headings:',
    '1. Executive summary: the answer and the 3 to 5 most important points, in plain words.',
    '2. Findings: what you found, with concrete facts, figures, names and dates, each tied to its source.',
    '3. Analysis: what it means for this company specifically (its goal, industry, customers): opportunities, risks, comparisons. Use a markdown table when comparing options, prices or competitors.',
    '4. Recommendations: numbered, specific actions with expected impact and priority.',
    '5. Next steps: who does what by when.',
    '6. Sources: the links you used.',
    'Be thorough: a real report is usually 500 to 1200 words. Never pad with generic advice; every sentence must be specific to the task and the company. When information is missing, say exactly what is missing and how to get it.',
  ].join('\n');
}

/** Slides in a presentation report (split on lines holding only ---). */
export function slidesIn(report: string): string[] {
  return report.split(/\n\s*-{3,}\s*\n/).map(s => s.trim()).filter(s => /^#\s/m.test(s));
}

/** True when a draft is below the standard of its deliverable, so one improvement pass is worth it. */
export function needsPolish(kind: Deliverable, report: string): boolean {
  const text = report.trim();
  if (kind === 'presentation') return slidesIn(text).length < 6;
  if (kind === 'memo') return text.length < 250;
  const headings = (text.match(/^#{1,3}\s/gm) ?? []).length;
  return text.length < 1800 || headings < 3;
}

/** System prompt for the improvement pass: same facts, the full professional standard. */
export function polishSystem(kind: Deliverable, languageName: string): string {
  return [
    'You are a senior editor at a top consulting firm. Rewrite the DRAFT below into the finished deliverable.',
    'Use ONLY the facts, figures and links in the DRAFT and the MATERIAL; never add new facts, numbers or links. You may add structure, analysis of what the facts mean for the company, and clear recommendations.',
    deliverableInstructions(kind),
    `Write in ${languageName}. Reply with ONLY one JSON object: {"summary": string (max 300 chars), "report": string, "actions": []}.`,
  ].join('\n\n');
}
