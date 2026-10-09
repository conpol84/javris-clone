import { requireClient } from './client';
import { isOnline, listDevices, type DeviceRow, type JobRow } from './computers';
import type { DirectComputerProposal } from './laptop-bridge';

type RecentJob = Pick<JobRow, 'id'|'device_id'|'kind'|'params'|'origin'|'status'|'result'|'receipt'|'report_sha256'|'created_at'|'finished_at'>;
export type UnlockContinuation =
  | { recognized:false }
  | { recognized:true; proposal:DirectComputerProposal|null; reply:string };

const fold = (s:string) => s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()
  .replace(/[^\p{L}\p{N}\s]+/gu,' ').replace(/\s+/g,' ').trim();

/** Only a simple statement that the desktop is NOW unlocked, not a command to unlock it. */
export function isUnlockContinuation(input:string):boolean {
 if(typeof input!=='string'||input.length>180)return false;
 const words=fold(input).split(' ');
 const allowed=new Set(['ok','okay','οκ','ενταξει','yes','ναι','nai','tora','τωρα','now','its','it','is','einai','ειναι','πλεον','to','το','the','shell','screen','οθονη','desktop','debian','my','εχει','exei','been','already','εγινε']);
 const unlocked=/^(unlock|unlocked|ξεκλειδωσα|ξεκλειδωσε|ξεκλειδωτο|ξεκλειδωμενο|ksekleidosa|ksekleidose|ksekleidoto|ksekleidomeno)$/u;
 return words.length>=2&&words.length<=10
  &&words.some(word=>unlocked.test(word))
  &&words.every(word=>allowed.has(word)||unlocked.test(word))
  &&words.some(word=>['ok','okay','οκ','ναι','nai','tora','τωρα','now','einai','ειναι','its','is','εχει','exei'].includes(word));
}
function rowObject(value:unknown):Record<string,unknown>|null {
 return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
}
const nope=(lang:string):UnlockContinuation=>({
 recognized:true,proposal:null,
 reply:lang==='el'
  ? 'Δεν βρέθηκε πρόσφατη, επιβεβαιωμένα μπλοκαρισμένη εργασία του δικού σου υπολογιστή που να μπορεί να συνεχιστεί. Δεν μπήκε νέα εργασία στην ουρά. Δώσε ξανά τον στόχο και τον υπολογιστή.'
  : 'No recent verified lock-blocked task from your own computer was found to resume. No job was queued. State the goal and target computer again.',
});
/**
 * An unlock follow-up belongs to the SAME user/company, most recent terminal
 * owner desktop job and exact original device. The message is fresh user intent
 * to retry after the worker asked for an unlock, not an assistant-generated goal.
 * A NEW worker job receives a NEW server-bound request ID, never replays an ACK.
 */
export async function resolveUnlockContinuation(
 orgId:string,userId:string,input:string,lang:string,signal?:AbortSignal,
 deps?:{
  latestOwnerJob?:(org:string,user:string)=>Promise<RecentJob|null>;
  devices?:(org:string)=>Promise<DeviceRow[]>;
  now?:()=>number;
 },
):Promise<UnlockContinuation>{
 if(!isUnlockContinuation(input))return{recognized:false};
 const check=()=>{if(signal?.aborted)throw new DOMException('Stopped','AbortError')};
 if(!orgId||!userId)return nope(lang);
 try{
  check();
  let row:RecentJob|null;
  if(deps?.latestOwnerJob)row=await deps.latestOwnerJob(orgId,userId);
  else{
   const {data,error}=await requireClient().from('connector_jobs')
    .select('id,device_id,kind,params,origin,status,result,receipt,report_sha256,created_at,finished_at')
    .eq('organization_id',orgId).eq('created_by',userId)
    .eq('origin','owner').eq('kind','desktop_task')
    .order('created_at',{ascending:false}).limit(1).maybeSingle();
   if(error)throw error;
   row=data as RecentJob|null;
  }
  check();
  if(!row||row.status!=='done'||row.kind!=='desktop_task'||row.origin!=='owner'
   ||rowObject(row.result)?.completed!==false)return nope(lang);
  const result=rowObject(row.result),receipt=rowObject(row.receipt),params=rowObject(row.params);
  const goal=params?.goal;
  const digest=row.report_sha256;
  // No replay of unrelated tasks (e.g. files/commands) or unverified/stale reports.
  if(typeof goal!=='string'||!goal.trim()||goal.length>4000
   ||!/(youtube|browser|browse|music|play|video|τραγουδ|μουσικ)/iu.test(goal)
   ||typeof result?.summary!=='string'
   ||!/(light-locker|screen black|screen locked|unlock|session lock)/iu.test(result.summary)
   ||typeof digest!=='string'||!/^[a-f0-9]{64}$/i.test(digest)
   ||receipt?.ok!==true||receipt.job_id!==row.id||receipt.device_id!==row.device_id
   ||receipt.report_sha256!==digest)return nope(lang);
  const finished=Date.parse(row.finished_at??''),age=(deps?.now??Date.now)()-finished;
  if(!Number.isFinite(finished)||age< -5000||age>20*60_000)return nope(lang);
  const devices=await (deps?.devices??listDevices)(orgId);
  check();
  const device=devices.find(d=>d.id===row.device_id&&d.paired&&!d.revoked_at
   &&isOnline(d,(deps?.now??Date.now)())&&d.capabilities?.job_kinds?.includes('desktop_task')
   &&d.agent_policy?.enabled===true&&d.agent_policy?.control==='full'&&d.capabilities?.full_control===true);
  if(!device)return nope(lang);
  return{
   recognized:true,
   proposal:{kind:'desktop_task',description:goal,params:{goal},target:device.name,deviceId:device.id},
   reply:lang==='el'?`Συνεχίζω μόνο στο ${device.name}, ως νέα ελεγχόμενη εργασία· απαιτείται νέο terminal receipt.`
    :`Retrying only on ${device.name} as a new authorized task; a new terminal receipt is required.`,
  };
 }catch(error){
  check();
  // Invalid/stale/unavailable history may never become an invented CEO handoff.
  return nope(lang);
 }
}
