import { memoryIndexReference } from '../../supabase/functions/_shared/mem0-retrieval-boundary.ts';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const texts = ['Owner fact', 'Ελληνικά 中文 العربية', '😀 supplementary', 'quote" slash\\ newline\n tab\t return\r backspace\b formfeed\f', 'separators\u2028\u2029', ' a  b ', 'composed é / decomposed e\u0301'];
const instants = ['2026-10-08T09:00:00Z','2026-10-08T12:00:00+03:00','2026-10-08T09:00:00.123456Z','2000-02-29T23:59:59.999999Z','0001-01-01T00:00:00Z','9999-12-31T23:59:59.999Z'];
const vectors=[];
for (const content of texts) for (const updated_at of instants) for (const agent_id of [null,id(301)]) {
  const row={id:id(401),organization_id:id(201),agent_id,content,updated_at,
    expires_at:updated_at.startsWith('9999')?null:'2030-05-01T10:15:30.654321+03:00',metadata:{}};
  vectors.push({...row,revision:(await memoryIndexReference(row)).firbo_revision});
}
console.log(JSON.stringify(vectors));
