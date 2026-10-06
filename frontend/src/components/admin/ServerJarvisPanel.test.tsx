import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({index:0,states:[] as unknown[],setters:[] as ReturnType<typeof vi.fn>[],invoke:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:()=>{const i=fixture.index++;const setter=vi.fn();fixture.setters[i]=setter;return [fixture.states[i],setter]},useEffect:()=>undefined,useCallback:(fn:unknown)=>fn}));
vi.mock('../../i18n/I18nProvider',()=>({useI18n:()=>({t:(k:string)=>k})}));
vi.mock('../../lib/company/client',()=>({requireClient:()=>({functions:{invoke:fixture.invoke}})}));
import { ServerJarvisPanel } from './ServerJarvisPanel';
function elements(n:ReactNode):ReactElement<{children?:ReactNode;onSubmit?:(e:unknown)=>Promise<void>}>[]{
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
});
