/** Server-owned JARVIS tasks are identified by exact assistant-message UUID.
 * Treat raw task rows as untrusted even if a generic company member can read
 * them. This is a display helper, never proof that work was executed.
 */
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const record=(value:unknown):Record<string,unknown>|null=>
 value!==null&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:null;
const hasText=(value:unknown):boolean=>typeof value==='string'&&value.trim().length>0;
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
 const result=record(task.result);
 const computer=record(result?.computer_execution);
 const hasComputer=result?.computer_execution!==undefined&&result.computer_execution!==null;
 const computerNeedsReview=hasComputer&&(!computer||computer.verified_success!==true
  ||computer.completed===false||!!computer.error||computer.reconcile_required===true);
 // Keep the persisted status; the existing translated receipt labels review
 // rather than "completed" when the result is absent or contradicts success.
 // A nonempty saved report is available content, not an artifact/hash receipt.
 const missingCompletedResult=task.status==='completed'&&(!result||(
  !hasText(result.summary)&&!hasText(result.report)&&!(hasComputer&&!computerNeedsReview)));
 const needsReview=!!result?.error||result?.reconcile_required===true
  ||result?.verified_success===false||computerNeedsReview||missingCompletedResult;
 return{status:task.status,needsReview,reportAvailable:task.status==='completed'
   &&!needsReview&&hasText(result?.report)};
}
