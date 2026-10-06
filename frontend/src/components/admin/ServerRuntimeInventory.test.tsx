import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../i18n/I18nProvider',()=>({useI18n:()=>({t:(key:string)=>key})}));
import { ServerRuntimeInventory } from './ServerRuntimeInventory';
const runtime={contract:'openjarvis-runtime/v1',agent_loaded:true,tool_inventory_known:true,tool_count:1,tool_names:['file_read'],truncated:false};
describe('loaded runtime inventory',()=>{
 it('does not convert old-server status into verified zero tools',()=>{
  const html=renderToStaticMarkup(<ServerRuntimeInventory value={undefined}/>);
  expect(html).toContain('jv.runtimeUnknown');expect(html).not.toContain('jv.noLoadedTools');
 });
 it('flags missing agent and empty tool map separately',()=>{
  const missing=renderToStaticMarkup(<ServerRuntimeInventory value={{...runtime,agent_loaded:false,tool_inventory_known:false,tool_count:null,tool_names:[]}}/>);
  expect(missing).toContain('jv.agentMissing');
  const empty=renderToStaticMarkup(<ServerRuntimeInventory value={{...runtime,tool_count:0,tool_names:[]}}/>);
  expect(empty).toContain('jv.noLoadedTools');expect(empty).toContain('jv.agentLoaded');
 });
 it('shows escaped loaded names with an execution caveat',()=>{
  const html=renderToStaticMarkup(<ServerRuntimeInventory value={{...runtime,tool_names:['<script>']}}/>);
  expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('jv.runtimeCaveat');
 });
});
