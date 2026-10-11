/** Server-owned JARVIS tasks are identified by exact assistant-message UUID.
 * Treat raw task rows as untrusted even if a generic company member can read
 * them. This is a display helper, never proof that work was executed.
 */
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export interface JarvisTaskView {
 id:string;organization_id:string;created_by:string;status:string;
 result?:unknown;metadata?:Record<string,unknown>|null;
}
export function trustedJarvisTaskView(row:unknown,orgId:string,userId:string,
  conversationId:string,messageId:string):{status:string;reportAvailable:boolean;needsReview:boolean}|null {
 if(!UUID.test(orgId)||!UUID.test(userId)||!UUID.test(conversationId)||!UUID.test(messageId)
    ||!row||typeof row!=='object'||Array.isArray(row))return null;
 const task=row as Partial<JarvisTaskView>;
 if(task.id!==messageId||task.organization_id!==orgId||task.created_by!==userId
    ||task.metadata?.source!=='jarvis_autopilot_server_v1'
    ||task.metadata?.conversation_id!==conversationId
    ||task.metadata?.message_id!==messageId
    ||typeof task.status!=='string'
    ||!['pending','running','awaiting_approval','completed','failed','blocked','cancelled'].includes(task.status))
    return null;
 const result=task.result&&typeof task.result==='object'&&!Array.isArray(task.result)
   ? task.result as Record<string,unknown>:{};
 const needsReview=result.reconcile_required===true || (result.computer_execution!==undefined
  &&result.computer_execution!==null
  &&typeof result.computer_execution==='object'
  &&(result.computer_execution as Record<string,unknown>).verified_success!==true);
 return{status:task.status,needsReview,reportAvailable:task.status==='completed'
   &&!needsReview &&result.verified_success!==false
   &&typeof result.report==='string'&&result.report.length>0};
}
