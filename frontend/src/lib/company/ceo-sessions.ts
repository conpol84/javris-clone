import { requireClient } from './client';
import { parseHandoff } from './handoff';
import type { CeoLine } from './useCeoSession';

/** Personal CEO conversations only. Admin access to other people's records
 * under the general DB policy does NOT grant access to their CEO chat history. */
export interface CeoSessionPreview {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
}
type SessionRecord={id:string;title:string|null;updated_at:string};
type MessageRecord={id:string;conversation_id:string;role:string;content:string;created_at:string};

const previewOf=(value:unknown,max=130)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,max):'';
const fail=(error:{message:string}|null)=>{if(error)throw new Error(error.message)};

/** Read only conversations owned by this user, in this company, for this CEO. */
export async function listCeoSessions(orgId:string,userId:string,ceoId:string):Promise<CeoSessionPreview[]>{
 if(!orgId||!userId||!ceoId)throw new Error('ceo_session_scope_required');
 const db=requireClient();
 const {data,error}=await db.from('conversations')
  .select('id,title,updated_at').eq('organization_id',orgId)
  .eq('user_id',userId).eq('agent_id',ceoId).eq('status','active')
  .order('updated_at',{ascending:false}).limit(60);
 fail(error);
 const rows=(data??[]) as SessionRecord[];
 if(rows.length===0)return[];
 // One bounded batch, not an N+1 query per session. Older sessions can
 // fall back to their titles when a very large recent thread fills the cap.
 const {data:messages,error:readError}=await db.from('messages')
  .select('id,conversation_id,role,content,created_at')
  .eq('organization_id',orgId).in('conversation_id',rows.map(x=>x.id))
  .in('role',['user','assistant'])
  .order('created_at',{ascending:false}).limit(360);
 fail(readError);
 const latest=new Map<string,string>();
 for(const m of (messages??[]) as MessageRecord[]){
  if(!latest.has(m.conversation_id))latest.set(m.conversation_id,previewOf(parseHandoff(m.content).text));
 }
 return rows.map(row=>({id:row.id,title:previewOf(row.title,75)||'Conversation',
  preview:latest.get(row.id)||previewOf(row.title)||'',
  updated_at:row.updated_at}));
}

export function ceoLinesFromMessages(messages:{id?:string;role:string;content:string}[]):CeoLine[]{
 return messages.filter(m=>m.role==='user'||m.role==='assistant').map(m=>{
  if(m.role==='user')return{who:'me' as const,text:m.content,...(m.id?{messageId:m.id}:{})};
  const parsed=parseHandoff(m.content);
  return{who:'ceo' as const,text:parsed.text,...(m.id?{messageId:m.id}:{}),ask:parsed.ask,task:parsed.task,meet:parsed.meet,app:parsed.app};
 });
}

/** Permission check first, then load its messages. Neither UI controls nor
 * owner/admin role can silently open another member's private CEO session. */
export async function readCeoSession(orgId:string,userId:string,ceoId:string,conversationId:string):Promise<CeoLine[]>{
 if(!orgId||!userId||!ceoId||!conversationId)throw new Error('ceo_session_scope_required');
 const db=requireClient();
 const {data:own,error}=await db.from('conversations')
  .select('id').eq('id',conversationId).eq('organization_id',orgId)
  .eq('user_id',userId).eq('agent_id',ceoId).eq('status','active').maybeSingle();
 fail(error);
 if(!own)throw new Error('ceo_session_not_found');
 const {data,error:readError}=await db.from('messages')
  .select('id,role,content').eq('organization_id',orgId).eq('conversation_id',conversationId)
  .in('role',['user','assistant']).order('created_at',{ascending:false}).limit(220);
 fail(readError);
 // Fetch the most recent bounded 220 messages, then restore chronological
 // display order. A lengthy user conversation must not always reopen at day 1.
 return ceoLinesFromMessages([...(data??[])].reverse() as {role:string;content:string}[]);
}
