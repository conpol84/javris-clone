import { beforeEach, describe, expect, it, vi } from 'vitest';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('./client',()=>({requireClient:()=>({functions:{invoke}})}));
import { sendChat } from './runner';

describe('CEO local-only backup is an explicit new request, never an automatic retry',()=>{
  beforeEach(()=>invoke.mockReset());
  it('default cloud request has no backup header or body flag',async()=>{
    invoke.mockResolvedValue({data:{message:{content:'cloud answer'}},error:null});
    const result=await sendChat('conversation','new user request','en',true);
    expect(result.message.content).toBe('cloud answer');
    expect(invoke).toHaveBeenCalledTimes(1);
    const [functionName,settings]=invoke.mock.calls[0];
    expect(functionName).toBe('agent-chat');
    expect(settings.body.voice).toBe(true);
    expect(settings.body).not.toHaveProperty('prefer_local_backup');
    expect(settings.body.request_id).toMatch(/^[0-9a-f-]{36}$/i);
  });
  it('new local request includes a distinct request id and bounded opt-in only',async()=>{
    invoke.mockResolvedValue({data:{message:{content:'local answer'}},error:null});
    await sendChat('conversation','first question','en',true);
    await sendChat('conversation','second new question','en',true,undefined,{preferLocalBackup:true});
    expect(invoke).toHaveBeenCalledTimes(2);
    const first=invoke.mock.calls[0][1].body;
    const next=invoke.mock.calls[1][1].body;
    expect(first).not.toHaveProperty('prefer_local_backup');
    expect(next).toMatchObject({conversation_id:'conversation',message:'second new question',prefer_local_backup:true});
    expect(next.request_id).not.toBe(first.request_id);
  });
  it('a caller cannot use backup in an unrequested request',async()=>{
    invoke.mockResolvedValue({data:{message:{content:'cloud answer'}},error:null});
    await sendChat('conversation','new question','el',false,undefined,{preferLocalBackup:false});
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty('prefer_local_backup');
  });
});