import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companySkillContext, readCompanySkill } from '../../supabase/functions/_shared/company-skills.ts';
import { parseToolRequest, runAgentLoop } from '../../supabase/functions/_shared/agent-loop.ts';

const skills = Array.from({ length: 24 }, (_, index) => ({
  id: `skill-${index}`, slug: `custom-${index}`, name: `General ${index}`,
  instructions: `Working instructions ${index}.`, agent_id: null,
}));

test('newer relevant skills beyond the previous first eight are visible and applied', () => {
  const rows = [...skills, { id: 'pdf-24', slug: 'pdf-report', name: 'PDF report', description: 'Read and summarize PDF documents', instructions: 'Verify every claim against the PDF.' }];
  const context = companySkillContext(rows, 'Prepare a PDF report');
  assert.match(context, /pdf-24/);
  assert.match(context, /Verify every claim against the PDF/);
  assert.match(readCompanySkill(rows, 'pdf-report'), /Verify every claim/);
});

test('exact skill reads preserve instructions beyond the old 1200 character clip', () => {
  const instructions = `${'a'.repeat(3800)}\nFINAL IMPORTANT STEP`;
  assert.match(readCompanySkill([{ ...skills[0], instructions }], 'skill-0'), /FINAL IMPORTANT STEP/);
  assert.throws(() => readCompanySkill(skills, 'unknown-company-skill'), /skill_not_available/);
  assert.throws(() => readCompanySkill(skills, 'custom-%'), /skill_not_available/);
});

test('employee scope wins an exact slug collision, and empty catalogue has no prompt', () => {
  const rows = [skills[0], { ...skills[0], id: 'employee-skill', agent_id: 'agent-1', instructions: 'Use employee rules.' }];
  assert.match(readCompanySkill(rows, 'custom-0'), /Use employee rules/);
  assert.equal(companySkillContext([], 'task'), '');
});

test('skill_read uses the real parser and loop, with full working instructions and existing tool permissions', async () => {
  assert.deepEqual(parseToolRequest('{"action":"skill_read","input":"custom-0"}', ['skill_read']), { action: 'skill_read', input: 'custom-0' });
  assert.equal(parseToolRequest('{"action":"skill_read","input":"custom-0"}', []), null);
  const instructions = `${'safe working step '.repeat(230)}END OF SKILL`;
  let calls = 0;
  await runAgentLoop({
    system: 'Do the task.', user: 'Use custom-0.', maxSteps: 2,
    tools: { skill_read: async id => readCompanySkill([{ ...skills[0], instructions }], id) },
    call: async messages => {
      calls++;
      if (calls === 1) return '{"action":"skill_read","input":"custom-0"}';
      assert.match(messages.at(-1).content, /END OF SKILL/);
      assert.match(messages.at(-1).content, /within your allowed tools and approval rules/);
      return '{"summary":"Done","report":"Finished using the installed instructions.","actions":[]}';
    },
  });
  assert.equal(calls, 2);
});
