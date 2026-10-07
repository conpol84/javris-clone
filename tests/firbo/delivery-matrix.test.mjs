import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../../frontend/src/App.tsx',import.meta.url),'utf8');
const matrix=JSON.parse(await readFile(new URL('../../docs/FIRBO-DELIVERY-MATRIX.json',import.meta.url),'utf8'));
test('every actual App route stays in the delivery inventory',()=>{
 const paths=['/',...Array.from(app.matchAll(/<Route\s+path="([^"]+)"/g),m=>'/'+m[1])].sort();
 assert.deepEqual(matrix.routes.map(r=>r.route).sort(),paths);assert.equal(new Set(paths).size,paths.length);
});
test('desktop/mouse/voice/integrations/recovery requirements cannot silently disappear',()=>{
 for(const id of ['desktop_installer','computer_pairing','computer_local_stop','computer_browser','computer_os','native_gateway','free_models','missions_voice','ledger_budgets','integrations','recovery','migrations','mcp_shifts','isolation','operations','release','assessment'])assert.ok(matrix.cross_cutting.some(r=>r.id===id&&r.requirement&&r.status),id);
});
