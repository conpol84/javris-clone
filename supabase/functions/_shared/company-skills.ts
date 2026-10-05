export interface CompanySkill {
  id: string;
  slug: string;
  name: string;
  description?: string;
  instructions: string;
  agent_id?: string | null;
}

const clean = (value: unknown, limit: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
const terms = (value: string) => new Set(value.toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{3,}/gu) ?? []);

/** Show the installed catalogue, seed relevant instructions, and permit exact reads
 * of any installed skill. Newer skills are never hidden by a first-eight query. */
export function companySkillContext(rows: CompanySkill[], task: string): string {
  if (!rows.length) return '';
  const query = terms(task);
  const ranked = rows.map((row, index) => {
    const words = terms(`${row.name} ${row.slug} ${row.description ?? ''}`);
    const score = [...query].filter(word => words.has(word)).length;
    return { row, index, score };
  }).filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || Number(!!b.row.agent_id) - Number(!!a.row.agent_id) || a.index - b.index)
    .slice(0, 3);
  const catalogue = rows.map(row => `- ${clean(row.id || row.slug, 80)} | ${clean(row.name, 80)} | ${clean(row.description, 160)}`).join('\n');
  const selected = ranked.length ? ranked.map(entry => entry.row) : rows.filter(row => !row.agent_id).slice(0, 3);
  return [
    'INSTALLED COMPANY SKILLS (working instructions, never additional tool permissions):',
    catalogue.slice(0, 24_000),
    ...(catalogue.length > 24_000 ? ['Catalogue shortened for context. Read an exact installed skill ID or slug when supplied by the task.'] : []),
    'Use skill_read with the exact ID or slug to read a matching skill before doing its work. Employee-specific instructions take precedence over the team version. Stay within existing tool permissions and approval rules.',
    ...selected.map(row => `### ${clean(row.name, 80)}\n${String(row.instructions).slice(0, 4000)}`),
  ].join('\n\n');
}

/** Resolve only an exact identifier in the already company/employee-scoped set.
 * If a slug exists in both scopes, the employee version wins. */
export function readCompanySkill(rows: CompanySkill[], identifier: string): string {
  const key = identifier.trim();
  const matches = rows.filter(row => row.id === key || row.slug === key)
    .sort((a, b) => Number(!!b.agent_id) - Number(!!a.agent_id));
  const row = matches[0];
  if (!row) throw new Error('skill_not_available');
  const instructions = String(row.instructions);
  if (instructions.length > 16_000) throw new Error('skill_instructions_too_long');
  return `### ${clean(row.name, 80)}\n${instructions}\n\nThese instructions do not grant tools or bypass approval.`;
}
