import { canOpenBrowser, cancelJob, giveJob, isOnline, listDevices, listJobs, policyOf, type DeviceRow, type JobRow } from './computers';

type StorageLike={getItem:(k:string)=>string|null;setItem:(k:string,v:string)=>void;removeItem:(k:string)=>void};
const key=(org:string)=>`firbo.voice-laptop.v1:${org}`;
const storage=():StorageLike|null=>{try{return typeof window==='undefined'?null:window.localStorage}catch{return null}};
export function getVoiceLaptop(org:string,s:StorageLike|null=storage()){if(!org||!s)return null;try{return s.getItem(key(org))}catch{return null}}
export function setVoiceLaptop(org:string,device:string|null,s:StorageLike|null=storage()){if(!org||!s)return;try{device?s.setItem(key(org),device):s.removeItem(key(org))}catch{}}
export const browserReadyDevices=(rows:DeviceRow[],now=Date.now())=>rows.filter(d=>canOpenBrowser(d)&&isOnline(d,now));
export function chooseVoiceLaptop(rows:DeviceRow[],selected:string|null,now=Date.now()){const ready=browserReadyDevices(rows,now);return ready.find(d=>d.id===selected)??(ready.length===1?ready[0]:null)}
function safeUrl(raw:string){let value=raw.trim().replace(/[),.;!?]+$/,'');if(!value)return null;if(!/^https:\/\//i.test(value))value='https://'+value;try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!u.hostname||u.hostname==='localhost'||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname)||u.hostname.includes(':'))return null;return u.href}catch{return null}}
export function parseLaptopBrowserCommand(input:string){
 if(typeof input!=='string'||!input.trim()||input.length>500)return null;
 const tokens=input.trim().split(/\s+/).map(token=>token.replace(/^["'`(\[]+|["'`),.;!?\]]+$/g,''));
 // Paths and URL components are data, never action words (e.g. .openjarvis).
 const isPath=(token:string)=>/^(?:\/|\.\.?\/|~\/|[a-z]:[\\/]|file:)/i.test(token)||(!/^https?:\/\//i.test(token)&&token.includes('\\'));
 const isAddress=(token:string)=>/^https?:\/\//i.test(token)||/^(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}(?:[/?#][^\s]*)?$/i.test(token);
 const words=tokens.filter(token=>!isPath(token)&&!isAddress(token)).join(' ').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
 const action=/(?:^|[^\p{L}\p{N}_])(?:open|launch|browse|search|ανοιξ\p{L}*|ψαξ\p{L}*|αναζητ\p{L}*)(?=$|[^\p{L}\p{N}_])/u.test(words);
 const target=/(?:^|[^\p{L}\p{N}_])(?:browser|chrome|laptop|computer|φυλλομετρητ\p{L}*|λαπτοπ|υπολογιστ\p{L}*)(?=$|[^\p{L}\p{N}_])/u.test(words);
 const direct=tokens.find(token=>!isPath(token)&&isAddress(token)&&(
  /^https?:\/\//i.test(token)||!/\.(?:md|txt|json|py|ts|csv|pdf|docx|xlsx|pptx|log|toml|ya?ml)$/i.test(token)
 ));
 if(!action||(!target&&!direct))return null;
 if(direct&&/^http:\/\//i.test(direct))return null;
 const url=direct?safeUrl(direct):'https://www.google.com/';
 return url?{url,host:new URL(url).hostname}:null;
}

export type DirectComputerProposal={
 kind:'browser_task'|'open_app'|'desktop_task';
 params:Record<string,unknown>;
 description:string;
 deviceId?:string;
};

const plainText=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu,' ').replace(/\s+/g,' ').trim();

/** An incomplete control request stays in the computer lane. It must not become
 * a model-authored AppleScript, delegated task or imaginary queue receipt. */
export function isComputerControlRequest(input:string){
 if(typeof input!=='string'||!input.trim()||input.length>4000)return false;
 const plain=plainText(input);
 const target=/(?:^|\s)(mac|laptop|computer|polis1984|browser|desktop|pc|shell|debian|music|player|μουσικη|safari|chrome|youtube|word|excel|applescript|osascript|υπολογιστη|υπολογιστης|φυλλομετρητη)(?:\s|$)/u.test(plain);
 const action=/(?:^|\s)(?:open|launch|play|run|execute|click|type|scroll|pause|stop|σταματ\p{L}*|browse|search|find|write|save|ψαξ\p{L}*|βρες|γραψ\p{L}*|πατη\p{L}*|anix\p{L}*|anoix\p{L}*|anik\p{L}*|anoik\p{L}*|ανοιξ\p{L}*|βαλ\p{L}*|val\p{L}*|βαλε|vale|παιξ\p{L}*|παιζ\p{L}*|pekse|pezi|trex\p{L}*|τρεξ\p{L}*|εκτελε\p{L}*)(?:\s|$)/u.test(plain);
 // Research and instructions about controlling a computer are ordinary work.
 if(/^(?:how (?:do|can|to)|explain|research|write (?:a |an )?(?:report|guide)|πως|εξηγησε|γραψε (?:οδηγιες|αναφορα))/u.test(plain))return false;
 return target&&action;
}

export function parseOwnerDecision(input:string):'approve'|'reject'|null{
 const plain=plainText(input);
 if(/^(?:stop|pause) (?:youtube|the music|music|playback|the video|video)$/.test(plain))return null;
 // ‘No, do it yourself’ rejects delegation, not the pending computer action.
 const self=/(?:kanto|καντο|κανε το|καν το|do it)\s+(?:esi|εσυ|yourself)/u.test(plain);
 const veto=/(?:^|\s)(cancel|stop|μην|min|do not|dont|don t)(?:\s|$)/u.test(plain);
 if(veto)return'reject';
 if(self)return'approve';
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
 if(typeof input!=='string'||!input.trim()||input.length>4000)return null;
 const text=input.trim(),plain=plainText(text);
 if(/(?:^|\s)(open|launch|start|anoikse|anikse|anixe|anixis|anoixis|ανοιξε|ανοιξ|ανοιξεις)(?:\s|$)/u.test(plain)){
  for(const [app,aliases] of APP_ALIASES)if(aliases.some(a=>plain.endsWith(a)))return{kind:'open_app',description:`Open ${app}`,params:{app}};
 }
 if(isComputerControlRequest(input))return {kind:'desktop_task',description:input.trim(),params:{goal:input.trim()}};
 if(/youtube/u.test(plain)&&/(search|serch|ψαξ|αναζητ|vale|βαλε|play|παιξ|pekse|proto|πρωτ|first)/u.test(plain)){
  const query=youtubeQuery(text);
  if(query){
   const url=`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
   return{kind:'browser_task',description:`YouTube: ${query} → open first result (playback unverified)`,params:{timeout_ms:120000,steps:[
    {action:'open',url},
    {action:'click',selector:'ytd-video-renderer:first-of-type a#video-title'},
   ]}};
  }
 }

 return null;
}
function directReady(d:DeviceRow,kind:DirectComputerProposal['kind'],now:number){
 const p=policyOf(d),k=d.capabilities?.job_kinds??[];
 return d.paired&&!d.revoked_at&&isOnline(d,now)&&p.enabled&&p.control==='full'&&d.capabilities?.full_control===true&&(k.includes(kind)||(kind==='open_app'&&k.includes('desktop_task')));
}
function directSelection(rows:DeviceRow[],kind:DirectComputerProposal['kind'],selected:string|null,now:number,lang:string){
 const greek=lang==='el';
 const eligible=rows.filter(d=>d.paired&&!d.revoked_at);
 // A stored owner selection must never silently turn into another computer.
 const candidates=selected?eligible.filter(d=>d.id===selected):eligible;
 const ready=candidates.filter(d=>directReady(d,kind,now));
 const device=ready.length===1?ready[0]:null;
 if(device)return{ready:true as const,device};
 if(!selected&&eligible.length>1)return{ready:false as const,status:'device_required',reply:greek?'Διάλεξε το Voice laptop στους Υπολογιστές. Δεν μπήκε εργασία στην ουρά.':'Choose the Voice laptop in Computers. No job was queued.'};
 const online=candidates.find(d=>isOnline(d,now));
 if(online){
  const mac=/^(?:darwin|macos|mac)(?:\s|$)/i.test(online.platform??'');
  const compatibility=mac?(greek?' Για browser tasks, έλεγξε τη συμβατότητα macOS: το Catalina 10.15 δεν υποστηρίζεται από τον τρέχοντα browser updater.':' For browser tasks, check macOS compatibility: Catalina 10.15 is unsupported by the current browser updater.') : '';
  return{ready:false as const,status:'upgrade_required',reply:(greek?`Το ${online.name} είναι online, αλλά δεν έχει ενεργό τοπικό Full Control για αυτή την ενέργεια. Δεν μπήκε εργασία στην ουρά. Δες τις δυνατότητες στους Υπολογιστές.`:`${online.name} is online, but local Full Control for this action is unavailable. No job was queued. Check its capabilities in Computers.`)+compatibility};
 }
 return{ready:false as const,status:'failed',reply:greek?'Ο επιλεγμένος υπολογιστής δεν είναι διαθέσιμος με Full Control. Δεν μπήκε εργασία στην ουρά.':'The selected computer is unavailable for Full Control. No job was queued.'};
}

/** Read only, before offering approval. Dispatch rechecks the same selection. */
export async function prepareDirectComputerCommand(orgId:string,kind:DirectComputerProposal['kind'],lang:string,signal?:AbortSignal,deps?:{loadDevices?:(o:string)=>Promise<DeviceRow[]>;storage?:StorageLike|null;now?:()=>number}){
 const rows=await(deps?.loadDevices??listDevices)(orgId);
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const s=deps?.storage===undefined?storage():deps.storage;
 const state=directSelection(rows,kind,getVoiceLaptop(orgId,s),(deps?.now??Date.now)(),lang);
 return state.ready?{ready:true as const,deviceId:state.device.id,deviceName:state.device.name}:state;
}
export const incompleteComputerReply=(lang:string)=>lang==='el'
 ?'Δεν μπήκε εργασία στην ουρά. Δώσε ακριβή εντολή, π.χ. «Άνοιξε Safari» ή «YouTube search Nikos Oikonomopoulos». Το browser plan ανοίγει αποτέλεσμα· δεν επιβεβαιώνει συνεχή αναπαραγωγή, screenshot ή εκτέλεση AppleScript.'
 :'No job was queued. Give an exact command, for example “Open Safari” or “YouTube search Nikos Oikonomopoulos”. The browser plan opens a result; it does not verify sustained playback, a screenshot or AppleScript execution.';
/** Bounded JSON identity: database JSON key order is not approval identity.
 * Reject values JSON.stringify would silently drop or alter. */
function actionJson(value:unknown):string{
 let nodes=0;
 const visit=(v:unknown,depth:number):unknown=>{
  if(++nodes>2048||depth>12)throw new Error('Invalid action JSON');
  if(v===null||typeof v==='boolean'||typeof v==='string')return v;
  if(typeof v==='number'&&Number.isFinite(v))return v;
  if(Array.isArray(v)){
   if(v.length>2048||Object.keys(v).length!==v.length||Object.getOwnPropertySymbols(v).length)throw new Error('Invalid action array');
   return Array.from({length:v.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!('value' in d))throw new Error('Invalid action array');return visit(d.value,depth+1)});
  }
  if(typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype||Object.getOwnPropertySymbols(v).length||Object.getOwnPropertyNames(v).length!==Object.keys(v).length)throw new Error('Invalid action value');
  const result:Record<string,unknown>=Object.create(null);
  for(const k of Object.keys(v).sort()){
   const descriptor=Object.getOwnPropertyDescriptor(v,k)!;
   if(!('value' in descriptor))throw new Error('Invalid action accessor');
   result[k]=visit(descriptor.value,depth+1);
  }
  return result;
 };
 const json=JSON.stringify(visit(value,0));
 if(json.length>65536)throw new Error('Action too large');
 return json;
}
export async function dispatchDirectComputerCommand(orgId:string,proposal:DirectComputerProposal,lang:string,signal?:AbortSignal,deps?:{
 loadDevices?:(o:string)=>Promise<DeviceRow[]>;queue?:(d:string,k:JobRow['kind'],p:Record<string,unknown>,c?:boolean)=>Promise<{job_id:string}>;
 loadJobs?:(o:string,d:string)=>Promise<JobRow[]>;cancel?:(j:string)=>Promise<unknown>;storage?:StorageLike|null;now?:()=>number;sleep?:(m:number,s?:AbortSignal)=>Promise<void>
}){
 const greek=lang==='el',load=deps?.loadDevices??listDevices,queue=deps?.queue??giveJob,loadJobs=deps?.loadJobs??listJobs,cancel=deps?.cancel??cancelJob,now=deps?.now??Date.now,s=deps?.storage===undefined?storage():deps.storage,sleep=deps?.sleep??delay;
 let jobId:string|undefined;
 try{
  // Capture the owner's exact approval and selection before the first await.
  if(!proposal.params||Array.isArray(proposal.params)||Object.getPrototypeOf(proposal.params)!==Object.prototype)throw new Error('Invalid action parameters');
  const approved={kind:proposal.kind,description:proposal.description,selected:proposal.deviceId??getVoiceLaptop(orgId,s),params:actionJson(proposal.params)};
  if(!['browser_task','open_app','desktop_task'].includes(approved.kind)||typeof approved.description!=='string'||approved.description.length>4000|| (approved.selected!==null&&typeof approved.selected!=='string'))throw new Error('Invalid approved action');
  const approvedParams=JSON.parse(approved.params) as Record<string,unknown>;
  const rows=await load(orgId);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const selected=approved.selected,selection=directSelection(rows,approved.kind,selected,now(),lang);
  if(!selection.ready)return{handled:true,status:selection.status,reply:selection.reply};
  const device=selection.device;
  if(approved.kind==='open_app'&&!device.capabilities?.job_kinds?.includes('open_app')&&device.capabilities?.job_kinds?.includes('desktop_task')){approved.kind='desktop_task';approved.params=actionJson({goal:approved.description});}
  if(device.id!==selected)setVoiceLaptop(orgId,device.id,s);
  const job=await queue(device.id,approved.kind,JSON.parse(approved.params),true);jobId=job.job_id;
  const deadline=now()+(approved.kind==='desktop_task'?16*60_000:45_000);
  while(now()<deadline&&!signal?.aborted){
   const row=(await loadJobs(orgId,device.id)).find(x=>x.id===job.job_id);
   if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
   let verified=false;
   try{verified=!!row&&row.kind===approved.kind&&row.device_id===device.id&&!row.cancel_requested_at&&actionJson(row.params)===approved.params&&(['browser_task','desktop_task'].includes(approved.kind)?row.result?.completed===true:row.result?.opened===true&&row.result?.app===approvedParams.app)}catch{/* Malformed evidence cannot confirm execution. */}
   if(row?.status==='done'&&approved.kind==='desktop_task'&&row.kind===approved.kind&&row.device_id===device.id&&actionJson(row.params)===approved.params&&typeof row.result?.summary==='string')return {handled:true,status:verified?'done':'failed',job_id:job.job_id,reply:`${device.name}: ${row.result.summary}`};
   if(row?.status==='done'&&!verified)return{handled:true,status:'failed',job_id:job.job_id,reply:greek?'Ο υπολογιστής επέστρεψε ελλιπή επιβεβαίωση. Δες την εργασία στους Υπολογιστές.':'The computer returned an incomplete confirmation. Check the job in Computers.'};
   if(row?.status==='done'&&verified)return{handled:true,status:'done',job_id:job.job_id,reply:greek?`Έγινε στο ${device.name}: ${approved.description}.`:`Done on ${device.name}: ${approved.description}.`};
   if(row&&['error','cancelled'].includes(row.status))return{handled:true,status:'failed',job_id:job.job_id,reply:greek?`Το ${device.name} δεν ολοκλήρωσε την ενέργεια.`:`${device.name} did not complete the action.`};
   await sleep(650,signal);
  }
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  return{handled:true,status:'queued',job_id:job.job_id,reply:greek?`Η εργασία ${job.job_id} μπήκε στην ουρά για ${device.name}, αλλά η εκτέλεση δεν έχει επιβεβαιωθεί ακόμη.`:`Job ${job.job_id} was queued for ${device.name}; execution is not confirmed yet.`};
 }catch(error){
  if(error instanceof DOMException&&error.name==='AbortError'){if(jobId)await cancel(jobId).catch(()=>{});throw error;}
  return{handled:true,status:'failed',reply:greek?'Ο υπολογιστής δεν μπόρεσε να εκτελέσει την ενέργεια.':'The computer could not execute the action.'};
 }
}
const delay=(ms:number,signal?:AbortSignal)=>new Promise<void>(resolve=>{if(signal?.aborted)return resolve();const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true})});
export async function dispatchLaptopBrowserCommand(orgId:string,input:string,lang:string,signal?:AbortSignal,deps?:{loadDevices?:(o:string)=>Promise<DeviceRow[]>;queue?:(d:string,k:JobRow['kind'],p:Record<string,unknown>,c?:boolean)=>Promise<{job_id:string}>;loadJobs?:(o:string,d:string)=>Promise<JobRow[]>;storage?:StorageLike|null;now?:()=>number;sleep?:(m:number,s?:AbortSignal)=>Promise<void>}){
 const intent=parseLaptopBrowserCommand(input);if(!intent)return{handled:false};const greek=lang==='el';
 const load=deps?.loadDevices??listDevices,queue=deps?.queue??giveJob,loadJobs=deps?.loadJobs??listJobs,now=deps?.now??Date.now,s=deps?.storage===undefined?storage():deps.storage,sleep=deps?.sleep??delay;
 try{const rows=await load(orgId);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');const selected=getVoiceLaptop(orgId,s),ready=browserReadyDevices(rows,now()),device=chooseVoiceLaptop(rows,selected,now());if(!device)return{handled:true,status:'failed',reply:ready.length>1?(greek?'Διάλεξε Voice laptop στους Υπολογιστές.':'Choose your Voice laptop in Computers.'):(greek?'Δεν υπάρχει online laptop με άδεια browser.':'No browser-ready laptop is online.')};if(device.id!==selected)setVoiceLaptop(orgId,device.id,s);const job=await queue(device.id,'browser_open',{url:intent.url},false),deadline=now()+16000;while(now()<deadline&&!signal?.aborted){const row=(await loadJobs(orgId,device.id)).find(x=>x.id===job.job_id);if(row?.status==='done'&&row.result?.launched===true)return{handled:true,status:'done',job_id:job.job_id,reply:greek?`Άνοιξα το browser στο ${device.name}.`:`Opened the browser on ${device.name}.`};if(row&&['error','cancelled'].includes(row.status))return{handled:true,status:'failed',job_id:job.job_id,reply:greek?'Το laptop δεν μπόρεσε να ανοίξει το browser.':'The laptop could not open the browser.'};await sleep(650,signal)}return{handled:true,status:'queued',job_id:job.job_id,reply:greek?`Έστειλα την εντολή στο ${device.name}, αλλά δεν επιβεβαιώθηκε ακόμη.`:`Browser request sent to ${device.name}; not confirmed yet.`}}catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw error;return{handled:true,status:'failed',reply:greek?'Το laptop δεν μπόρεσε να ανοίξει το browser.':'The laptop could not open the browser.'}}
}

