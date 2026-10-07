import { canOpenBrowser, giveJob, isOnline, listDevices, listJobs, type DeviceRow, type JobRow } from './computers';

type StorageLike={getItem:(k:string)=>string|null;setItem:(k:string,v:string)=>void;removeItem:(k:string)=>void};
const key=(org:string)=>`firbo.voice-laptop.v1:${org}`;
const storage=():StorageLike|null=>{try{return typeof window==='undefined'?null:window.localStorage}catch{return null}};
export function getVoiceLaptop(org:string,s:StorageLike|null=storage()){if(!org||!s)return null;try{return s.getItem(key(org))}catch{return null}}
export function setVoiceLaptop(org:string,device:string|null,s:StorageLike|null=storage()){if(!org||!s)return;try{device?s.setItem(key(org),device):s.removeItem(key(org))}catch{}}

export interface PreparedLaptopAction { deviceId:string; deviceName:string; kind:'browser_task'; params:Record<string,unknown>; description:string }
const words=(s:string)=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const cleanQuery=(s:string)=>s
  .replace(/\b(?:the\s+)?first\s+(?:song|video|result)\b.*$/i,'')
  .replace(/\b(?:το\s+)?πρωτο\s+(?:τραγουδι|βιντεο|αποτελεσμα)\b.*$/iu,'')
  .replace(/\b(?:to\s+)?proto\s+(?:tragoudi|video|apotelesma)\b.*$/i,'')
  .replace(/\b(?:kane|κανε|κάνε)\s+play\b.*$/iu,'')
  .replace(/\b(?:esi|εσυ|εσύ)\b.*$/iu,'')
  .trim().replace(/^[\s"'“”]+|[\s"'“”]+$/g,'').slice(0,120);
export function parseLaptopAutomationCommand(input:string){
  if(typeof input!=='string'||!input.trim()||input.length>500)return null;
  const text=input.trim(),plain=words(text);
  if(!/\byoutube\b/.test(plain)&&!/(play|παιξ|pekse|βαλε|vale)/iu.test(plain))return null;
  const quoted=text.match(/["“”]([^"“”]{1,120})["“”]/u)?.[1];
  const patterns=[
    /(?:search|serch|ψαξ(?:ε|τε)?|αναζητ(?:ησε|ήσε)?)\s+(?:for\s+)?(.+?)(?=\s+(?:and|και)\s+(?:play|παιξ|pekse|βαλε|vale)|$)/iu,
    /(?:βαλε|βάλε|vale)\s+(.+?)\s+(?:στο|sto)\s+(?:search|serch)/iu,
    /(?:play|παιξε|παίξε|pekse)\s+(?:το\s+|to\s+)?(.+?)(?=\s+(?:πρωτ|proto|first|και|and|κανε|kane|εσυ|esi|μην|min)|$)/iu,
  ];
  const raw=quoted??patterns.map(r=>r.exec(text)?.[1]).find(Boolean)??'';
  const query=cleanQuery(raw);
  if(!query)return null;
  const url='https://www.youtube.com/results?search_query='+encodeURIComponent(query);
  return {query,params:{steps:[{action:'open',url},{action:'click',selector:'ytd-video-renderer a#video-title'}],timeout_ms:120000}};
}
export const isLaptopActionConfirmation=(input:string)=>/^(?:yes|y|ok|okay|go ahead|do it|approve|approved|ναι|εγκρινω|εγκρίνω|εγκρινε|εγκρίνε|καντο|κάντο|κανε το|κάνε το|kanto|kane to)[.!\s]*$/iu.test(input.trim());
export const isLaptopActionRejection=(input:string)=>/^(?:no|cancel|stop|nope|οχι|όχι|ακυρο|άκυρο|oxi)[.!\s]*$/iu.test(input.trim());
const browserTaskReadyDevices=(rows:DeviceRow[],now=Date.now())=>rows.filter(d=>d.paired===true&&!d.revoked_at&&isOnline(d,now)&&d.capabilities?.full_control===true&&d.capabilities?.job_kinds?.includes('browser_task'));
export async function prepareLaptopAutomation(orgId:string,input:string,lang:string,signal?:AbortSignal,deps?:{loadDevices?:(o:string)=>Promise<DeviceRow[]>;storage?:StorageLike|null;now?:()=>number}){
  const parsed=parseLaptopAutomationCommand(input);if(!parsed)return{handled:false as const};
  const greek=lang==='el',load=deps?.loadDevices??listDevices,now=deps?.now??Date.now,s=deps?.storage===undefined?storage():deps.storage;
  try{
    const rows=await load(orgId);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const selected=getVoiceLaptop(orgId,s),ready=browserTaskReadyDevices(rows,now());
    const device=ready.find(d=>d.id===selected)??(ready.length===1?ready[0]:null);
    if(!device){
      const online=rows.filter(d=>d.paired===true&&!d.revoked_at&&isOnline(d,now()));
      const preferred=online.find(d=>d.id===selected)??(online.length===1?online[0]:null);
      if(preferred?.capabilities?.job_kinds?.includes('browser_open')){
        return{handled:true as const,status:'setup_required' as const,reply:greek
          ?`Το ${preferred.name} είναι online, αλλά τρέχει ακόμη τον παλιό Connector. Δεν θα το αναθέσω σε άλλον agent. Πήγαινε Computers → ${preferred.name} → Λήψη Mac updater και ενεργοποίησε Full Control μία φορά· μετά ο CEO θα μπορεί να ψάξει/πατήσει/play μόνος του.`
          :`${preferred.name} is online but still runs the old Connector. I will not delegate this. Open Computers → ${preferred.name} → Download Mac updater and enable Full Control once; then the CEO can search/click/play directly.`};
      }
      return{handled:true as const,status:'failed' as const,reply:ready.length>1
        ?(greek?'Διάλεξε Voice laptop στους Υπολογιστές.':'Choose your Voice laptop in Computers.')
        :(greek?'Δεν υπάρχει online Mac με Full Control για browser actions.':'No online Mac has Full Control for browser actions.')};
    }
    if(device.id!==selected)setVoiceLaptop(orgId,device.id,s);
    const description=greek?`YouTube: αναζήτηση «${parsed.query}» και αναπαραγωγή του πρώτου αποτελέσματος`:`YouTube: search “${parsed.query}” and play the first result`;
    return{handled:true as const,status:'confirm' as const,
      reply:greek?`Θα το κάνω εγώ στο ${device.name}: ${description}. Εγκρίνεις;`:`I’ll do it myself on ${device.name}: ${description}. Approve?`,
      action:{deviceId:device.id,deviceName:device.name,kind:'browser_task' as const,params:parsed.params,description}};
  }catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw error;return{handled:true as const,status:'failed' as const,reply:greek?'Δεν μπόρεσα να ελέγξω το Mac.':'I could not check the Mac.'}}
}
export async function executePreparedLaptopAction(action:PreparedLaptopAction,lang:string,signal?:AbortSignal,deps?:{queue?:(d:string,k:JobRow['kind'],p:Record<string,unknown>,c?:boolean)=>Promise<{job_id:string}>;loadJobs?:(o:string,d:string)=>Promise<JobRow[]>;orgId?:string;now?:()=>number;sleep?:(m:number,s?:AbortSignal)=>Promise<void>}){
  const greek=lang==='el',queue=deps?.queue??giveJob,loadJobs=deps?.loadJobs??listJobs,now=deps?.now??Date.now,sleep=deps?.sleep??delay,orgId=deps?.orgId??'';
  try{
    const job=await queue(action.deviceId,action.kind,action.params,true),deadline=now()+45000;
    while(now()<deadline&&!signal?.aborted){
      const row=(await loadJobs(orgId,action.deviceId)).find(x=>x.id===job.job_id);
      if(row?.status==='done')return{status:'done' as const,job_id:job.job_id,reply:greek?`Έγινε στο ${action.deviceName}: ${action.description}.`:`Done on ${action.deviceName}: ${action.description}.`};
      if(row&&['error','cancelled'].includes(row.status)){
        const code=typeof row.error==='string'&&row.error?/ · '+row.error:'';
        return{status:'failed' as const,job_id:job.job_id,reply:greek?`Η ενέργεια σταμάτησε στο ${action.deviceName}${code}.`:`The action stopped on ${action.deviceName}${code}.`};
      }
      await sleep(650,signal);
    }
    return{status:'queued' as const,job_id:job.job_id,reply:greek?`Η εντολή στάλθηκε στο ${action.deviceName} και περιμένω το τελικό receipt.`:`The command was sent to ${action.deviceName}; I’m waiting for the final receipt.`};
  }catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw error;return{status:'failed' as const,reply:greek?'Δεν μπόρεσα να εκτελέσω την ενέργεια στο Mac.':'I could not execute the action on the Mac.'}}
}
export const browserReadyDevices=(rows:DeviceRow[],now=Date.now())=>rows.filter(d=>canOpenBrowser(d)&&isOnline(d,now));
export function chooseVoiceLaptop(rows:DeviceRow[],selected:string|null,now=Date.now()){const ready=browserReadyDevices(rows,now);return ready.find(d=>d.id===selected)??(ready.length===1?ready[0]:null)}
function safeUrl(raw:string){let value=raw.trim().replace(/[),.;!?]+$/,'');if(!value)return null;if(!/^https:\/\//i.test(value))value='https://'+value;try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!u.hostname||u.hostname==='localhost'||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname)||u.hostname.includes(':'))return null;return u.href}catch{return null}}
export function parseLaptopBrowserCommand(input:string){if(typeof input!=='string'||!input.trim()||input.length>500)return null;const text=input.trim(),plain=text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();const action=/(open|launch|browse|search|ανοιξ|ψαξ|αναζητ)/iu.test(plain);const youtube=/\byoutube\b/i.test(plain);const target=/(browser|chrome|laptop|computer|φυλλομετρητ|λαπτοπ|υπολογιστ)/iu.test(plain);const direct=text.match(/https:\/\/[^\s]+/i)?.[0]??text.match(/(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}(?:\/[^\s]*)?/i)?.[0]??'';if(!action||(!target&&!direct&&!youtube))return null;const url=direct?safeUrl(direct):youtube?'https://www.youtube.com/':'https://www.google.com/';return url?{url,host:new URL(url).hostname}:null}
const delay=(ms:number,signal?:AbortSignal)=>new Promise<void>(resolve=>{if(signal?.aborted)return resolve();const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true})});
export async function dispatchLaptopBrowserCommand(orgId:string,input:string,lang:string,signal?:AbortSignal,deps?:{loadDevices?:(o:string)=>Promise<DeviceRow[]>;queue?:(d:string,k:JobRow['kind'],p:Record<string,unknown>,c?:boolean)=>Promise<{job_id:string}>;loadJobs?:(o:string,d:string)=>Promise<JobRow[]>;storage?:StorageLike|null;now?:()=>number;sleep?:(m:number,s?:AbortSignal)=>Promise<void>}){
 const intent=parseLaptopBrowserCommand(input);if(!intent)return{handled:false};const greek=lang==='el';
 const load=deps?.loadDevices??listDevices,queue=deps?.queue??giveJob,loadJobs=deps?.loadJobs??listJobs,now=deps?.now??Date.now,s=deps?.storage===undefined?storage():deps.storage,sleep=deps?.sleep??delay;
 try{const rows=await load(orgId);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');const selected=getVoiceLaptop(orgId,s),ready=browserReadyDevices(rows,now()),device=chooseVoiceLaptop(rows,selected,now());if(!device)return{handled:true,status:'failed',reply:ready.length>1?(greek?'Διάλεξε Voice laptop στους Υπολογιστές.':'Choose your Voice laptop in Computers.'):(greek?'Δεν υπάρχει online laptop με άδεια browser.':'No browser-ready laptop is online.')};if(device.id!==selected)setVoiceLaptop(orgId,device.id,s);const job=await queue(device.id,'browser_open',{url:intent.url},false),deadline=now()+16000;while(now()<deadline&&!signal?.aborted){const row=(await loadJobs(orgId,device.id)).find(x=>x.id===job.job_id);if(row?.status==='done'&&row.result?.launched===true)return{handled:true,status:'done',job_id:job.job_id,reply:greek?`Άνοιξα το browser στο ${device.name}.`:`Opened the browser on ${device.name}.`};if(row&&['error','cancelled'].includes(row.status))return{handled:true,status:'failed',job_id:job.job_id,reply:greek?'Το laptop δεν μπόρεσε να ανοίξει το browser.':'The laptop could not open the browser.'};await sleep(650,signal)}return{handled:true,status:'queued',job_id:job.job_id,reply:greek?`Έστειλα την εντολή στο ${device.name}, αλλά δεν επιβεβαιώθηκε ακόμη.`:`Browser request sent to ${device.name}; not confirmed yet.`}}catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw error;return{handled:true,status:'failed',reply:greek?'Το laptop δεν μπόρεσε να ανοίξει το browser.':'The laptop could not open the browser.'}}
}
