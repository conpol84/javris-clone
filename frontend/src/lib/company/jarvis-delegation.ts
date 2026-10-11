/**
 * Idempotent CEO -> employee task claim with the EXISTING tasks and messages
 * tables. No separate task runner, duplicate ledger or background executor.
 *
 * A durable saved assistant message UUID becomes the task UUID (different
 * tables). The database's existing task primary key is the at-most-once claim:
 * if a network response is lost after INSERT, recover ONLY the exact matching
 * saved task. NEVER re-run it automatically on read-back, reload or retry.
 */
import { requireClient } from './client';
import { parseHandoff } from './handoff';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export interface JarvisDelegationInput {
 organizationId:string;userId:string;conversationId:string;
 messageId:string;agentId:string;title:string;details:string;
}
export interface JarvisDelegationClaim {
 taskId:string;created:boolean;status:string;
}
type Row={
 id:string;organization_id:string;created_by:string|null;
 assigned_agent_id:string|null;title:string;description:string|null;
 status:string;metadata:Record<string,unknown>|null;
};
function matched(row:Row,i:JarvisDelegationInput):boolean {
 return row.id===i.messageId&&row.organization_id===i.organizationId
   &&row.created_by===i.userId&&row.assigned_agent_id===i.agentId
   &&row.title===i.title.trim()&&row.description===(i.details.trim()||null)
   &&(row.metadata?.source==='jarvis_ceo_handoff_v1'||row.metadata?.source==='jarvis_autopilot_server_v1')
   &&row.metadata?.conversation_id===i.conversationId
   &&row.metadata?.message_id===i.messageId;
}
function legitimate(i:JarvisDelegationInput):boolean {
 return UUID.test(i.organizationId)&&UUID.test(i.userId)
   &&UUID.test(i.conversationId)&&UUID.test(i.messageId)&&UUID.test(i.agentId)
   &&i.title.trim().length>0&&i.title===i.title.trim()&&i.title.length<=160
   &&i.details.length<=1500&&i.details===i.details.trim();
}
export class JarvisDelegationError extends Error {
 constructor(public readonly code:'invalid_scope'|'source_not_verified'|'task_unavailable'|'task_conflict') {
  super(code);
 }
}
export async function claimJarvisDelegation(i:JarvisDelegationInput):Promise<JarvisDelegationClaim> {
 if(!legitimate(i))throw new JarvisDelegationError('invalid_scope');
 const db=requireClient();
 // A client may neither fabricate an LLM action nor borrow another user's
 // authorized CEO session to initiate an unattended task.
 const {data:conversation,error:conversationError}=await db.from('conversations')
   .select('id,agent_id,organization_id,user_id,status')
   .eq('id',i.conversationId).eq('organization_id',i.organizationId)
   .eq('user_id',i.userId).eq('status','active').maybeSingle();
 if(conversationError||!conversation?.agent_id)throw new JarvisDelegationError('source_not_verified');
 const {data:ceo,error:ceoError}=await db.from('agents')
   .select('id,type,slug,enabled').eq('id',conversation.agent_id)
   .eq('organization_id',i.organizationId).maybeSingle();
 if(ceoError||!ceo?.enabled||!(ceo.type==='ceo'||String(ceo.slug??'').startsWith('ceo')))
   throw new JarvisDelegationError('source_not_verified');
 const {data:message,error:messageError}=await db.from('messages')
   .select('id,conversation_id,organization_id,role,content')
   .eq('id',i.messageId).eq('organization_id',i.organizationId)
   .eq('conversation_id',i.conversationId).eq('role','assistant').maybeSingle();
 if(messageError||!message||typeof message.content!=='string')
   throw new JarvisDelegationError('source_not_verified');
 // Agent ID / title / details must match the SERVER-SAVED, validated CEO
 // handoff marker. Caller-supplied text never becomes a new authority.
 const offer=parseHandoff(message.content).task;
 if(!offer||offer.agentId!==i.agentId||offer.title!==i.title||offer.details!==i.details)
   throw new JarvisDelegationError('source_not_verified');
 const source={source:'jarvis_ceo_handoff_v1',conversation_id:i.conversationId,message_id:i.messageId};
 const {data:created,error:insertError}=await db.from('tasks')
   .insert({id:i.messageId,organization_id:i.organizationId,created_by:i.userId,
     assigned_agent_id:i.agentId,title:i.title,description:i.details||null,
     priority:'normal',metadata:source})
   .select('id,status').single();
 if(!insertError&&created?.id===i.messageId)
   return{taskId:created.id,created:true,status:created.status};
 // Lost ACK is ambiguous: only read the saved exact task. If already stored,
 // do not re-dispatch the runner, even if the task is still pending.
 const {data:existing,error:readError}=await db.from('tasks')
   .select('id,organization_id,created_by,assigned_agent_id,title,description,status,metadata')
   .eq('id',i.messageId).eq('organization_id',i.organizationId)
   .eq('created_by',i.userId).maybeSingle();
 if(readError)throw new JarvisDelegationError('task_unavailable');
 if(!existing)throw new JarvisDelegationError('task_unavailable');
 if(!matched(existing as Row,i))throw new JarvisDelegationError('task_conflict');
 return{taskId:i.messageId,created:false,status:existing.status};
}
