import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({index:0,states:[] as unknown[],setters:[] as ReturnType<typeof vi.fn>[],invoke:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:()=>{const i=fixture.index++;const setter=vi.fn();fixture.setters[i]=setter;return [fixture.states[i],setter]},useEffect:()=>undefined,useCallback:(fn:unknown)=>fn}));
vi.mock('../../i18n/I18nProvider',()=>({useI18n:()=>({t:(k:string)=>k})}));
vi.mock('../../lib/company/client',()=>({requireClient:()=>({functions:{invoke:fixture.invoke}})}));
import { ServerJarvisPanel } from './ServerJarvisPanel';
import { ServerRuntimeInventory } from './ServerRuntimeInventory';
import { ServerToolCheck } from './ServerToolCheck';
function elements(n:ReactNode):ReactElement<{children?:ReactNode;href?:string;onClick?:()=>void;onSubmit?:(e:unknown)=>Promise<void>;value?:unknown;runtime?:unknown}>[]{
 if(Array.isArray(n))return n.flatMap(elements);if(!isValidElement(n))return [];
 const e=n as ReactElement<{children?:ReactNode}>;return [e,...elements(e.props.children)];
}
async function send(){fixture.index=0;const tree=ServerJarvisPanel();await elements(tree).find(e=>e.type==='form')!.props.onSubmit!({preventDefault(){}});return fixture.setters[5].mock.calls[0][0]([])[0];}
describe('server panel execution response',()=>{
 beforeEach(()=>{vi.clearAllMocks();fixture.index=0;fixture.states=[{configured:true,online:true},false,'','Test',false,[],false];fixture.setters=[]});
 it('retains tool evidence without a final model answer',async()=>{
  const execution={contract:'openjarvis-execution/v1',mode:'agent',tool_count:1,failed_count:1,tools:[{name:'file_write',success:false,output:'Denied',truncated:false}],truncated:false};
  fixture.invoke.mockResolvedValue({data:{reply:'',execution},error:null});const turn=await send();
  expect(turn.execution).toEqual(execution);expect(turn.error).not.toBe(true);expect(turn.a).toBe('jv.emptyReply');expect(fixture.setters[4]).toHaveBeenLastCalledWith(false);
 });
 it('a transport rejection releases the busy state and records failure',async()=>{
  fixture.invoke.mockRejectedValue(new Error('Network failed'));const turn=await send();expect(turn.error).toBe(true);expect(fixture.setters[4]).toHaveBeenLastCalledWith(false);
 });
 it('opens the actual server management dashboard rather than its coding wrapper',()=>{
  const link=elements(ServerJarvisPanel()).find(e=>e.type==='a'&&e.props.children?.toString().includes('jv.open'));
  expect(link?.props.href).toBe('https://jarvis.firboai.app/');
 });
 it('passes only the server-reported inventory to the existing inventory and manual tool check',()=>{
  const runtime={contract:'openjarvis-runtime/v1',agent_loaded:true,tool_inventory_known:true,tool_count:1,tool_names:['file_read'],truncated:false};
  fixture.states[0]={configured:true,online:true,runtime};const tree=elements(ServerJarvisPanel());
  expect(tree.find(e=>e.type===ServerRuntimeInventory)?.props.value).toBe(runtime);expect(tree.find(e=>e.type===ServerToolCheck)?.props.runtime).toBe(runtime);
  fixture.index=0;fixture.states[0]={configured:true,online:false};expect(elements(ServerJarvisPanel()).some(e=>e.type===ServerRuntimeInventory)).toBe(false);expect(fixture.invoke).not.toHaveBeenCalled();
 });
 it('refreshes runtime status through the authenticated admin bridge',async()=>{
  const status={configured:true,online:true,agent:'orchestrator',runtime:null};fixture.invoke.mockResolvedValue({data:status,error:null});
  elements(ServerJarvisPanel()).find(e=>e.type==='button')!.props.onClick!();
  await vi.waitFor(()=>expect(fixture.setters[0]).toHaveBeenLastCalledWith(status));
  expect(fixture.invoke).toHaveBeenCalledExactlyOnceWith('server-jarvis',{body:{action:'status'}});
 });
});
