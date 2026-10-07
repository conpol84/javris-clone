import { canOpenBrowser, cancelJob, giveJob, isOnline, listDevices, listJobs, policyOf, type DeviceRow, type JobRow } from './computers';

type StorageLike={getItem:(k:string)=>string|null;setItem:(k:string,v:string)=>void;removeItem:(k:string)=>void};
const key=(org:string)=>`firbo.voice-laptop.v1:${org}`;
const storage=():StorageLike|null=>{try{return typeof window==='undefined'?null:window.localStorage}catch{return null}};
export function getVoiceLaptop(org:string,s:StorageLike|null=storage()){if(!org||!s)return null;try{return s.getItem(key(org))}catch{return null}}
export function setVoiceLaptop(org:string,device:string|null,s:StorageLike|null=storage()){if(!org||!s)return;try{device?s.setItem(key(org),device):s.removeItem(key(org))}catch{}}
export const browserReadyDevices=(rows:DeviceRow[],now=Date.now())=>rows.filter(d=>canOpenBrowser(d)&&isOnline(d,now));
export function chooseVoiceLaptop(rows:DeviceRow[],selected:string|null,now=Date.now()){const ready=browserReadyDevices(rows,now);return ready.find(d=>d.id===selected)??(ready.length===1?ready[0]:null)}
function safeUrl(raw:string){let value=raw.trim().replace(/[),.;!?]+$/,'');if(!value)return null;if(!/^https:\/\//i.test(value))value='https://'+value;try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!u.hostname||u.hostname==='localhost'||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname)||u.hostname.includes(':'))return null;return u.href}catch{return null}}
export function parseLaptopBrowserCommand(input:string){if(typeof input!=='string'||!input.trim()||input.length>500)return null;const text=input.trim(),plain=text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();const action=/(open|launch|browse|search|ανοιξ|ψαξ|αναζητ)/iu.test(plain);const target=/(browser|chrome|laptop|computer|φυλλομετρητ|λαπτοπ|υπολογιστ)/iu.test(plain);const direct=text.match(/https:\/\/[^\s]+/i)?.[0]??text.match(/(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}(?:\/[^\s]*)?/i)?.[0]??'';if(!action||(!target&&!direct))return null;const url=direct?safeUrl(direct):'https://www.google.com/';return url?{url,host:new URL(url).hostname}:null}

export type DirectComputerProposal={
 kind:'browser_task'|'open_app';
 params:Record<string,unknown>;
 description:string;
};

const plainText=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu,' ').replace(/\s+/g,' ').trim();

export function parseOwnerDecision(input:string):'approve'|'reject'|null{
 const plain=plainText(input);
 if(/(?:^|\s)(no|nope|cancel|stop|oxi|οχι|μην|min)(?:\s|$)/u.test(plain))return'reject';
 if(/(?:^|\s)(yes|yeah|yep|approve|approved|proceed|go ahead|do it|start|begin|ok|okay|nai|ναι|egkrino|εγκρινω|kanto|καντο|prohora|προχωρα|ksekina|xekina|ksekinise|ξεκινα|ξεκινησε)(?:\s|$)/u.test(plain))return'approve';
 return null;
}
function youtubeQuery(text:string){
 const patterns=[
  /(?:vale|βαλε|βάλε)\s+["“]?(.+?)["”]?\s+(?:sto|στο)\s+(?:search|serch|ψαξιμο|ψάξιμο|αναζητηση|αναζήτηση)/iu,
  /(?:search|serch|ψαξε|ψάξε|αναζητησε|αναζήτησε)\s+(?:for\s+)?["“]?(.+?)["”]?(?=\s+(?:και|kai|and|then|first|proto|πρωτ|play|παιξ|παίξ|pekse|kane|κανε|κάνε)|$)/iu,
  /youtube\s+(?:for\s+)?["“]?(.+?)["”]?(?=\s+(?:first|proto|πρωτ|play|παιξ|παίξ|pekse|kane|κανε|κάνε)|$)/iu,
 ];
 for(const re of patterns){const m=text.match(re);const q=m?.[1]?.trim().replace(/^["“]|["”]$/g,'');if(q&&q.length<=100)return q;}
 return null;
}
const APP_ALIASES:[string,string[]][]=[
 ['Microsoft Word',['microsoft word','word']],
 ['Microsoft Excel',['microsoft excel','excel']],
 ['Google Chrome',['google chrome','chrome']],
 ['Visual Studio Code',['visual studio code','vs code','vscode']],
 ['Safari',['safari']],['Finder',['finder']],['Notes',['notes','σημειωσεις']],['Mail',['mail']],
 ['Calendar',['calendar','ημερολογιο']],['Preview',['preview']],['TextEdit',['textedit']],
 ['Numbers',['numbers']],['Pages',['pages']],['Keynote',['keynote']],
];
export function parseDirectComputerCommand(input:string):DirectComputerProposal|null{
 if(typeof input!=='string'||!input.trim()||input.length>500)return null;
 const text=input.trim(),plain=plainText(text);
 if(/youtube/u.test(plain)&&/(search|serch|ψαξ|αναζητ|vale|βαλε|play|παιξ|pekse|proto|πρωτ|first)/u.test(plain)){
  const query=youtubeQuery(text);
  if(query){
   const url=`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
   return{kind:'browser_task',description:`YouTube: ${query} → first result`,params:{timeout_ms:120000,steps:[
    {action:'open',url},
    {action:'click',selector:'ytd-video-renderer:first-of-type a#video-title'},
   ]}};
  }
 }
 if(/(?:^|\s)(open|launch|start|anoikse|anikse|ανοιξε|ανοιξ)(?:\s|$)/u.test(plain)){
  for(const [app,aliases] of APP_ALIASES)if(aliases.some(a=>plain.includes(a)))return{kind:'open_app',description:`Open ${app}`,params:{app}};
 }
 return null;
}
function directReady(d:DeviceRow,kind:DirectComputerProposal['kind'],now:number){
 const p=policyOf(d),k=d.capabilities?.job_kinds??[];
 return d.paired&&!d.revoked_at&&isOnline(d,now)&&p.enabled&&p.control==='full'&&d.capabilities?.full_control===true&&k.includes(kind);
}
export async function dispatchDirectComputerCommand(orgId:string,proposal:DirectComputerProposal,lang:string,signal?:AbortSignal,deps?:{
 loadDevices?:(o:string)=>Promise<DeviceRow[]>;queue?:(d:string,k:JobRow['kind'],p:Record<string,unknown>,c?:boolean)=>Promise<{job_id:string}>;
 loadJobs?:(o:string,d:string)=>Promise<JobRow[]>;cancel?:(j:string)=>Promise<unknown>;storage?:StorageLike|null;now?:()=>number;sleep?:(m:number,s?:AbortSignal)=>Promise<void>
}){
 const greek=lang==='el',load=deps?.loadDevices??listDevices,queue=deps?.queue??giveJob,loadJobs=deps?.loadJobs??listJobs,cancel=deps?.cancel??cancelJob,now=deps?.now??Date.now,s=deps?.storage===undefined?storage():deps.storage,sleep=deps?.sleep??delay;
 let jobId:string|undefined;
 try{
  const rows=await load(orgId);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const selected=getVoiceLaptop(orgId,s),ready=rows.filter(d=>directReady(d,proposal.kind,now()));
  const device=ready.find(d=>d.id===selected)??(ready.length===1?ready[0]:null);
  if(!device){
   const online=rows.filter(d=>d.paired&&!d.revoked_at&&isOnline(d,now()));
   if(online.length)return{handled:true,status:'upgrade_required',reply:greek?'Το Mac είναι online, αλλά ο νέος Full Control Connector δεν είναι ενεργός ακόμη. Άνοιξε Computers → Polis1984 → Λήψη Mac updater και τρέξ’ τον μία φορά. Μετά θα εκτελώ browser clicks και apps χωρίς δεύτερο Inbox approval.':'The Mac is online, but the new Full Control Connector is not active yet. Open Computers → Polis1984 → Download Mac updater and run it once. Then I can execute browser clicks and apps without a second Inbox approval.'};
   return{handled:true,status:'failed',reply:greek?'Δεν υπάρχει online Mac με Full Control.':'No Full Control Mac is online.'};
  }
  if(device.id!==selected)setVoiceLaptop(orgId,device.id,s);
  const job=await queue(device.id,proposal.kind,proposal.params,true);jobId=job.job_id;
  const deadline=now()+45_000;
  while(now()<deadline&&!signal?.aborted){
   const row=(await loadJobs(orgId,device.id)).find(x=>x.id===job.job_id);
   if(row?.status==='done')return{handled:true,status:'done',job_id:job.job_id,reply:greek?`Έγινε στο ${device.name}: ${proposal.description}.`:`Done on ${device.name}: ${proposal.description}.`};
   if(row&&['error','cancelled'].includes(row.status))return{handled:true,status:'failed',job_id:job.job_id,reply:greek?`Το ${device.name} δεν ολοκλήρωσε την ενέργεια.`:`${device.name} did not complete the action.`};
   await sleep(650,signal);
  }
  if(signal?.aborted){await cancel(job.job_id).catch(()=>{});throw new DOMException('Cancelled','AbortError');}
  return{handled:true,status:'queued',job_id:job.job_id,reply:greek?`Η ενέργεια ξεκίνησε στο ${device.name}, αλλά δεν έχει επιβεβαιωθεί ακόμη.`:`The action started on ${device.name}, but it is not confirmed yet.`};
 }catch(error){
  if(error instanceof DOMException&&error.name==='AbortError'){if(jobId)await cancel(jobId).catch(()=>{});throw error;}
  return{handled:true,status:'failed',reply:greek?'Το Mac δεν μπόρεσε να εκτελέσει την ενέργεια.':'The Mac could not execute the action.'};
 }
}
const delay=(ms:number,signal?:AbortSignal)=>new Promise<void>(resolve=>{if(signal?.aborted)return resolve();const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true})});
export async function dispatchLaptopBrowserCommand(orgId:string,input:string,lang:string,signal?:AbortSignal,deps?:{loadDevices?:(o:string)=>Promise<DeviceRow[]>;queue?:(d:string,k:JobRow['kind'],p:Record<string,unknown>,c?:boolean)=>Promise<{job_id:string}>;loadJobs?:(o:string,d:string)=>Promise<JobRow[]>;storage?:StorageLike|null;now?:()=>number;sleep?:(m:number,s?:AbortSignal)=>Promise<void>}){
 const intent=parseLaptopBrowserCommand(input);if(!intent)return{handled:false};const greek=lang==='el';
 const load=deps?.loadDevices??listDevices,queue=deps?.queue??giveJob,loadJobs=deps?.loadJobs??listJobs,now=deps?.now??Date.now,s=deps?.storage===undefined?storage():deps.storage,sleep=deps?.sleep??delay;
 try{const rows=await load(orgId);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');const selected=getVoiceLaptop(orgId,s),ready=browserReadyDevices(rows,now()),device=chooseVoiceLaptop(rows,selected,now());if(!device)return{handled:true,status:'failed',reply:ready.length>1?(greek?'Διάλεξε Voice laptop στους Υπολογιστές.':'Choose your Voice laptop in Computers.'):(greek?'Δεν υπάρχει online laptop με άδεια browser.':'No browser-ready laptop is online.')};if(device.id!==selected)setVoiceLaptop(orgId,device.id,s);const job=await queue(device.id,'browser_open',{url:intent.url},false),deadline=now()+16000;while(now()<deadline&&!signal?.aborted){const row=(await loadJobs(orgId,device.id)).find(x=>x.id===job.job_id);if(row?.status==='done'&&row.result?.launched===true)return{handled:true,status:'done',job_id:job.job_id,reply:greek?`Άνοιξα το browser στο ${device.name}.`:`Opened the browser on ${device.name}.`};if(row&&['error','cancelled'].includes(row.status))return{handled:true,status:'failed',job_id:job.job_id,reply:greek?'Το laptop δεν μπόρεσε να ανοίξει το browser.':'The laptop could not open the browser.'};await sleep(650,signal)}return{handled:true,status:'queued',job_id:job.job_id,reply:greek?`Έστειλα την εντολή στο ${device.name}, αλλά δεν επιβεβαιώθηκε ακόμη.`:`Browser request sent to ${device.name}; not confirmed yet.`}}catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw error;return{handled:true,status:'failed',reply:greek?'Το laptop δεν μπόρεσε να ανοίξει το browser.':'The laptop could not open the browser.'}}
}
