import { requireClient } from './client';
/** Journal is server-created from a real terminal Connector job. No client-sent
 * assistant response or physical replay is accepted. */
export async function journalCeoComputerJob(conversationId:string,jobId:string,signal?:AbortSignal):Promise<boolean>{
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(conversationId)
   ||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(jobId))throw new Error('journal_bad_identity');
 if(signal?.aborted)throw new DOMException('Stopped','AbortError');
 const {data,error}=await requireClient().functions.invoke('agent-chat',{
  body:{action:'journal_computer_job',conversation_id:conversationId,computer_job_id:jobId,
    request_id:crypto.randomUUID()},
  signal
 });
 if(signal?.aborted)throw new DOMException('Stopped','AbortError');
 if(error||data?.journaled!==true||data.message_id!==jobId)throw new Error('journal_not_recorded');
 return true;
}
