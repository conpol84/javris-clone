import { canOpenBrowser, cancelJob, giveJob, isOnline, listJobs, policyOf, ComputerError, type DeviceRow, type JobRow } from './computers';
import { dispatchJson as actionJson, dispatchWorkerRequest, workerDispatchReceipt, WorkerDispatchError, type WorkerDispatchRequest } from './worker-dispatch';

type StorageLike={getItem:(k:string)=>string|null;setItem:(k:string,v:string)=>void;removeItem:(k:string)=>void};
const key=(org:string)=>`firbo.voice-laptop.v1:${org}`;
const storage=():StorageLike|null=>{try{return typeof window==='undefined'?null:window.localStorage}catch{return null}};
export function getVoiceLaptop(org:string,s:StorageLike|null=storage()){if(!org||!s)return null;try{return s.getItem(key(org))}catch{return null}}
export function setVoiceLaptop(org:string,device:string|null,s:StorageLike|null=storage()){if(!org||!s)return;try{device?s.setItem(key(org),device):s.removeItem(key(org))}catch{}}
export const browserReadyDevices=(rows:DeviceRow[],now=Date.now())=>rows.filter(d=>canOpenBrowser(d)&&isOnline(d,now));
export function chooseVoiceLaptop(rows:DeviceRow[],selected:string|null,now=Date.now()){const ready=browserReadyDevices(rows,now);return selected?(ready.find(d=>d.id===selected)??null):(ready.length===1?ready[0]:null)}
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
 kind:'browser_task'|'open_app'|'desktop_task'|'browser_open';
 params:Record<string,unknown>;
 description:string;
 deviceId?:string;
 target?:string;
 requestId?:string;
 ownerFullControlRequired?:true;
};

const plainText=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu,' ').replace(/\s+/g,' ').trim();

// Only a leading/trailing device clause is routing intent. Mentions inside
// page searches or text to type must not redirect an action to another device.
function deviceClause(plain:string){
 // A device named in the leading *owner command* is binding even when the
 // sentence starts with "execute this task exclusively on ...". Never infer
 // device targets from page text, quoted content, URLs or trailing restrictions.
 const scoped=plain.match(/^(?:execute|run|εκτελε\p{L}*)\s+(?:.{1,110}?\s+)?(?:exclusively|only|αποκλειστικα)\s+(?:on|στον|στο|ston|sto)\s+(?:(?:the|τον|το)\s+)?(?:computer|υπολογιστη|υπολογιστης)\s+(my shell|polis1984|mac mini|macbook|mac|debian|linux|windows)(?=\s|$)/u);
 if(scoped)return{target:scoped[1],action:plain};
 // Natural owner Greeklish "re to shell einai unlock, pexe ..." refers to the
 // owner's named machine. Only accept this prefix, never device names within
 // a web page search, quoted text, path or trailing safety restriction.
 const shell=plain.match(/^(?:(?:re|ρε)\s+)?(?:to|sto|ston|το|στο|στον)\s+(?:(?:my|το)\s+)?shell(?=\s|$)/u);
 if(shell)return{target:'my shell',action:plain.slice(shell[0].length).trim()};
 const label='(mac mini|macbook|mac|debian|linux|windows|polis1984|my shell)';
 const clause='(?:from|on|using|apo|sto|ston|απο|στο|στον)\\s+(?:(?:my|the|το|τον)\\s+)?'+label;
 const prefix=plain.match(new RegExp('^'+clause+'\\s+','u'));
 const suffix=plain.match(new RegExp('\\s+'+clause+'$','u'));
 const match=prefix??suffix;
 return match?{target:match[1],action:plain.replace(match[0],' ').trim()}:{action:plain};
}
function targetMatches(d:DeviceRow,target:string){
 if(['mac','mac mini','macbook'].includes(target))return /^(?:darwin|macos|mac)(?:\s|$)/i.test(d.platform??'');
 if(['debian','linux'].includes(target))return /^linux(?:\s|$)/i.test(d.platform??'');
 if(target==='windows')return /^(?:win32|windows)(?:\s|$)/i.test(d.platform??'');
 return plainText(d.name)===target;
}

/** An incomplete control request stays in the computer lane. It must not become
 * a model-authored AppleScript, delegated task or imaginary queue receipt. */
export function isComputerControlRequest(input:string){
 if(typeof input!=='string'||!input.trim()||input.length>4000)return false;
 const plain=plainText(input);
 const target=/(?:^|\s)(mac|laptop|computer|polis1984|browser|desktop|pc|shell|debian|music|player|μουσικη|safari|chrome|youtube|word|excel|applescript|osascript|υπολογιστη|υπολογιστης|φυλλομετρητη|website|site|ιστοσελιδα|ιστοσελιδες)(?:\s|$)/u.test(plain);
 const action=/(?:^|\s)(?:open|launch|play|run|execute|click|type|scroll|pause|stop|σταματ\p{L}*|browse|search|find|write|save|ψαξ\p{L}*|βρες|γραψ\p{L}*|πατη\p{L}*|anix\p{L}*|anoix\p{L}*|anik\p{L}*|anoik\p{L}*|ανοιξ\p{L}*|βαλ\p{L}*|val\p{L}*|βαλε|vale|παιξ\p{L}*|παιζ\p{L}*|pekse|pexe|peks|paixe|paikse|pezi|trex\p{L}*|τρεξ\p{L}*|εκτελε\p{L}*|μπεις|μπω|mpis|bis|visit|navigate|access)(?:\s|$)/u.test(plain);
 // Research and instructions about controlling a computer are ordinary work.
 if(/^(?:how (?:do|can|to)|explain|research|write (?:a |an )?(?:report|guide)|πως|εξηγησε|γραψε (?:οδηγιες|αναφορα))/u.test(plain))return false;
 return target&&action;
}

export function parseOwnerDecision(input:string):'approve'|'reject'|null{
 const plain=plainText(input);
 if(!plain)return null;
 if(/^(?:stop|pause) (?:youtube|the music|music|playback|the video|video)$/.test(plain))return null;
 // Only a leading, explicit veto cancels an owner action. A later "μην",
 // "do not" or "don't" is often a *safety constraint* in a positive task:
 // "Open example.com. Don't switch to Mac or claim success without evidence".
 const veto=/^(?:(?:please|σε παρακαλω)\s+)?(?:cancel|stop|μην|μη|min|do not|dont|don t)(?:\s|$)/u.test(plain);
 if(veto)return'reject';
 // "No, do it yourself" rejects delegation, not the pending action. An
 // explicit leading veto always wins over later "κάντο εσύ".
 const self=/(?:kanto|καντο|κανε το|καν το|do it)\s+(?:esi|εσυ|yourself)/u.test(plain);
 if(self)return'approve';
 if(/^(?:no|nope|oxi|οχι)(?:\s|$)/u.test(plain))return'reject';
 if(/^(?:yes|yeah|yep|approve|approved|proceed|go ahead|go nai|go ναι|do it|start|begin|ok|okay|nai|ναι|egkrino|εγκρινω|kanto|καντο|prohora|προχωρα|ksekina|xekina|ksekinise|ξεκινα|ξεκινησε)(?:\s|$)/u.test(plain))return'approve';
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
 const text=input.trim(),routing=deviceClause(plainText(text)),plain=routing.action;
 // Content research about browsers/music is NOT permission to operate a
 // computer; in particular "research" must not match the substring "search".
 if(/^(?:research|explain|how (?:do|can|to)|write (?:a |an )?(?:report|guide)|ερευνα|εξηγησε|γραψε (?:οδηγιες|αναφορα))(?:\s|$)/u.test(plain))return null;
 const target=routing.target?{target:routing.target}:{};
 if(/(?:^|\s)(open|launch|start|anoikse|anikse|anixe|anixis|anoixis|ανοιξε|ανοιξ|ανοιξεις)(?:\s|$)/u.test(plain)){
  for(const [app,aliases] of APP_ALIASES)if(aliases.some(a=>plain.endsWith(a)))return{kind:'open_app',description:`Open ${app}`,params:{app},...target};
 }
 if(/^(?:open|launch|ανοιξε|anoikse|anikse|anixe)\s+(?:(?:the|το|to)\s+)?(?:browser|φυλλομετρητη)(?:\s+(?:here|εδω))?$/u.test(plain))return{kind:'browser_open',description:'Open browser',params:{url:'https://www.google.com/'},...target};
 // An ability question without a destination is *not* authority to queue
 // a vague desktop job. The control lane will probe real worker capabilities
 // and request a specific URL instead of inventing an Operations handoff.
 const websiteQuestion=/^(?:μπορεις|mporis|can you|are you able to)(?:\s+(?:να|na))?\s+(?:μπεις|mpis|bis|visit|open|access)\s+(?:(?:σε|se|sto|to|a|an|the)\s+)*(?:(?:ενα|ena)\s+)?(?:website|site|ιστοσελιδα)(?:\s|$)/u.test(plain);
 if(websiteQuestion&&!/https?:\/\//i.test(text))return null;
 if(isComputerControlRequest(input))return {kind:'desktop_task',description:input.trim(),params:{goal:input.trim()},...target};
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
 if(kind==='browser_open')return canOpenBrowser(d)&&isOnline(d,now);
 const p=policyOf(d),k=d.capabilities?.job_kinds??[];
 return d.paired&&!d.revoked_at&&isOnline(d,now)&&p.enabled&&p.control==='full'&&d.capabilities?.full_control===true&&(k.includes(kind)||(kind==='open_app'&&k.includes('desktop_task')));
}
function directSelection(rows:DeviceRow[],kind:DirectComputerProposal['kind'],selected:string|null,now:number,lang:string,target?:string,app?:unknown){
 const greek=lang==='el';
 const eligible=rows.filter(d=>d.paired&&!d.revoked_at);
 if(target){
  const matches=eligible.filter(d=>targetMatches(d,target));
  if(matches.length!==1||selected&&matches[0]?.id!==selected)return{ready:false as const,status:'device_required',reply:greek?`Δεν βρέθηκε ένας μοναδικός συνδεδεμένος υπολογιστής για «${target}». Διάλεξέ τον στους Υπολογιστές. Δεν μπήκε εργασία στην ουρά.`:`There is no unique paired computer matching “${target}”. Choose it in Computers. No job was queued.`};
  selected=matches[0].id;
 }
 // A stored owner selection must never silently turn into another computer.
 const candidates=selected?eligible.filter(d=>d.id===selected):eligible;
 if(candidates.length===1&&app==='Safari'&&!/^(?:darwin|macos|mac)(?:\s|$)/i.test(candidates[0].platform??''))return{ready:false as const,status:'unsupported_app',reply:greek?`Το ${candidates[0].name} δεν είναι Mac. Το Safari απαιτεί Mac· επίλεξε το Mac ή ζήτησε άλλο browser. Δεν μπήκε εργασία στην ουρά.`:`${candidates[0].name} is not a Mac. Safari requires a Mac; select your Mac or request another browser. No job was queued.`};
 const ready=candidates.filter(d=>directReady(d,kind,now));
 const device=ready.length===1?ready[0]:null;
 if(device)return{ready:true as const,device};
 if(!selected&&eligible.length>1)return{ready:false as const,status:'device_required',reply:greek?'Διάλεξε το Voice laptop στους Υπολογιστές. Δεν μπήκε εργασία στην ουρά.':'Choose the Voice laptop in Computers. No job was queued.'};
 const online=candidates.find(d=>isOnline(d,now));
 if(online){
  const mac=/^(?:darwin|macos|mac)(?:\s|$)/i.test(online.platform??'');
  const compatibility=mac&&['browser_task','desktop_task'].includes(kind)?(greek?' Για browser tasks, έλεγξε τη συμβατότητα macOS: το Catalina 10.15 δεν υποστηρίζεται από τον τρέχοντα browser updater.':' For browser tasks, check macOS compatibility: Catalina 10.15 is unsupported by the current browser updater.') : '';
  if(online.capabilities?.full_control===true)return{ready:false as const,status:'upgrade_required',reply:greek?`Το ${online.name} έχει τοπικό Full Control, αλλά η ζητούμενη λειτουργία δεν είναι διαθέσιμη ακόμη μέσω του Connector/server. Δεν μπήκε εργασία στην ουρά.`:`${online.name} has local Full Control, but the requested capability is not yet available through its Connector/server. No job was queued.`};
  return{ready:false as const,status:'upgrade_required',reply:(greek?`Το ${online.name} είναι online, αλλά δεν έχει ενεργό τοπικό Full Control για αυτή την ενέργεια. Δεν μπήκε εργασία στην ουρά. Δες τις δυνατότητες στους Υπολογιστές.`:`${online.name} is online, but local Full Control for this action is unavailable. No job was queued. Check its capabilities in Computers.`)+compatibility};
 }
 return{ready:false as const,status:'failed',reply:greek?'Ο επιλεγμένος υπολογιστής δεν είναι διαθέσιμος με Full Control. Δεν μπήκε εργασία στην ουρά.':'The selected computer is unavailable for Full Control. No job was queued.'};
}

const dispatchFailure=(lang:string,error:unknown)=>{
 const greek=lang==='el',code=error instanceof WorkerDispatchError?error.code:'dispatch_unavailable';
 const replies:Record<string,[string,string]>={
  forbidden:['Ο έλεγχος υπολογιστή απαιτεί Owner/Admin. Δεν μπήκε εργασία στην ουρά.','Computer control requires Owner/Admin. No job was queued.'],
  business_plan_required:['Ο έλεγχος υπολογιστή απαιτεί ενεργό Business ή Enterprise.','Computer control requires active Business or Enterprise.'],
  desktop_setup_required:['Η υπηρεσία ελέγχου οθόνης δεν έχει ρυθμιστεί ακόμη. Δεν στάλθηκε εργασία.','The screen-control service is not configured yet. No job was sent.'],
  unsupported_app:['Δεν υπάρχει διαθέσιμος worker για τη ζητούμενη εφαρμογή. Δεν μπήκε εργασία στην ουρά.','No available worker supports the requested application. No job was queued.'],
  device_required:['Ο ρητά ζητούμενος υπολογιστής δεν προσδιορίζεται μοναδικά. Δεν μπήκε εργασία στην ουρά.','The explicitly requested computer is not uniquely identified. No job was queued.'],
  device_not_ready:['Δεν υπάρχει διαθέσιμος worker με τις απαιτούμενες δυνατότητες. Δεν μπήκε εργασία στην ουρά.','No available worker has the required capabilities. No job was queued.'],
  no_eligible_worker:['Δεν υπάρχει διαθέσιμος worker με τις απαιτούμενες δυνατότητες. Δεν μπήκε εργασία στην ουρά.','No available worker has the required capabilities. No job was queued.'],
  target_unavailable:['Ο ρητά ζητούμενος υπολογιστής δεν είναι διαθέσιμος για αυτή την εργασία. Δεν επιλέχθηκε άλλος worker.','The explicitly requested computer is unavailable for this task. Another worker was not selected.'],
  target_ambiguous:['Το όνομα που ζήτησες αντιστοιχεί σε περισσότερους από έναν υπολογιστές. Δώσε το ακριβές όνομα· δεν μπήκε εργασία στην ουρά.','The requested target matches more than one computer. Give its exact name; no job was queued.'],
 };
 const reply=replies[code];
 return {ready:false as const,status:code,reply:reply?reply[greek?0:1]:(greek?'Ο κεντρικός dispatcher δεν επιβεβαίωσε την εργασία. Δεν έγινε επανάληψη· έλεγξε τις πρόσφατες εργασίες στους Υπολογιστές.':'The central dispatcher did not confirm the job. It was not retried; check recent jobs in Computers.')};
};
const centralRequest=(orgId:string,proposal:DirectComputerProposal,action:'preview'|'dispatch'):WorkerDispatchRequest=>({
 action,organization_id:orgId,request_id:proposal.requestId??crypto.randomUUID(),kind:proposal.kind,
 params:JSON.parse(actionJson(proposal.params)),goal:proposal.description,
 ...(proposal.target?{target:proposal.target}:{}),...(proposal.deviceId?{device_id:proposal.deviceId}:{}),
 ...(action==='dispatch'?{confirm:true as const}:{}),
 ...(action==='dispatch'&&proposal.ownerFullControlRequired===true?{owner_full_control_required:true as const}:{}),
});

/** Production selection belongs to the VPS dispatcher. Injected discovery is
 * retained only for isolated legacy executor tests, never as a runtime fallback. */
export type DirectComputerReadiness={ready:true;deviceId:string;deviceName:string;nativeDesktop?:true;requestId?:string;ownerFullControl?:boolean}|{ready:false;status:string;reply:string};
export async function prepareDirectComputerCommand(orgId:string,request:DirectComputerProposal['kind']|DirectComputerProposal,lang:string,signal?:AbortSignal,deps?:{loadDevices?:(o:string)=>Promise<DeviceRow[]>;storage?:StorageLike|null;now?:()=>number;dispatcher?:typeof dispatchWorkerRequest}):Promise<DirectComputerReadiness>{
 // The live dispatcher validates action parameters even for preview. A kind
 // without a URL, browser plan or native goal is NOT a valid capability probe:
 // ask for actionable details without a fabricated server/worker receipt.
 if(typeof request==='string'&&!deps?.loadDevices&&!deps?.dispatcher)return{ready:false,status:'details_required',reply:incompleteComputerReply(lang)};
 const kind=typeof request==='string'?request:request.kind,target=typeof request==='string'?undefined:request.target,app=typeof request==='string'?undefined:request.params.app;
 if(deps?.loadDevices&&!deps.dispatcher){
  const selected=typeof request==='object'&&request.deviceId?request.deviceId:null;
  const rows=await deps.loadDevices(orgId);
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const state=directSelection(rows,kind,selected,(deps?.now??Date.now)(),lang,target,app);
  return state.ready?{ready:true as const,deviceId:state.device.id,deviceName:state.device.name,...(kind!=='browser_open'&&state.device.capabilities?.job_kinds?.includes('desktop_task')?{nativeDesktop:true as const}:{})}:state;
 }
 try{
  const proposal=typeof request==='string'?{kind:request,params:{},description:'Computer control readiness'}:request;
  const payload=centralRequest(orgId,proposal,'preview');
  const receipt=workerDispatchReceipt(await(deps?.dispatcher??dispatchWorkerRequest)(JSON.parse(actionJson(payload)),signal),payload);
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  return {ready:true as const,deviceId:receipt.worker.id,deviceName:receipt.worker.name,requestId:receipt.request_id,ownerFullControl:receipt.owner_full_control===true,...(receipt.job.kind==='desktop_task'?{nativeDesktop:true as const}:{})};
 }catch(error){if(signal?.aborted||error instanceof DOMException&&error.name==='AbortError')throw new DOMException('Cancelled','AbortError');return dispatchFailure(lang,error);}
}
export const incompleteComputerReply=(lang:string)=>lang==='el'
 ?'Δεν μπήκε εργασία στην ουρά. Δώσε συγκεκριμένο URL για το website, π.χ. «Άνοιξε https://example.com στον My shell», ή άλλη ακριβή εντολή. Το browser plan δεν αποδεικνύει από μόνο του αναπαραγωγή βίντεο ή screenshot.'
 :'No job was queued. Give the specific website URL, for example “Open https://example.com on My shell”, or another exact instruction. A browser plan alone does not prove video playback or a screenshot.';
export interface DirectComputerProgress {
 jobId:string; deviceName:string;
 stage:'queued'|'running'|'status_unavailable';
 elapsedSeconds:number;
}
export function computerProgressLabel(progress:DirectComputerProgress,lang:string):string {
 const greek=lang==='el',device=progress.deviceName.slice(0,90),id=progress.jobId.slice(0,8);
 if(progress.stage==='running')
  return greek?`${device}: Η εργασία ${id} εκτελείται. Περιμένω επαληθευμένο αποτέλεσμα.`:
   `${device}: Job ${id} is running. Waiting for verified results.`;
 if(progress.stage==='status_unavailable')
  return greek?`${device}: Δεν λαμβάνω κατάσταση για την εργασία ${id}. Μην τη στείλεις ξανά πριν ελέγξεις τους Υπολογιστές.`:
   `${device}: Status unavailable for job ${id}. Do not resend before checking Computers.`;
 return greek?`${device}: Η εργασία ${id} στάλθηκε και περιμένει ανάληψη.`:
  `${device}: Job ${id} was queued; awaiting worker acknowledgement.`;
}
export async function dispatchDirectComputerCommand(orgId:string,proposal:DirectComputerProposal,lang:string,signal?:AbortSignal,deps?:{
 loadDevices?:(o:string)=>Promise<DeviceRow[]>;queue?:(d:string,k:JobRow['kind'],p:Record<string,unknown>,c?:boolean)=>Promise<{job_id:string}>;
 loadJobs?:(o:string,d:string)=>Promise<JobRow[]>;cancel?:(j:string)=>Promise<unknown>;storage?:StorageLike|null;now?:()=>number;sleep?:(m:number,s?:AbortSignal)=>Promise<void>;dispatcher?:typeof dispatchWorkerRequest;
 onProgress?:(state:DirectComputerProgress)=>void
}){
 const greek=lang==='el',loadJobs=deps?.loadJobs??listJobs,cancel=deps?.cancel??cancelJob,now=deps?.now??Date.now,sleep=deps?.sleep??delay;
 let jobId:string|undefined;
 try{
  // Capture the owner's exact approval and selection before the first await.
  if(!proposal.params||Array.isArray(proposal.params)||Object.getPrototypeOf(proposal.params)!==Object.prototype)throw new Error('Invalid action parameters');
  const approved={kind:proposal.kind,description:proposal.description,selected:proposal.deviceId??null,target:proposal.target,params:actionJson(proposal.params),ownerFullControlRequired:proposal.ownerFullControlRequired};
  if(!['browser_task','open_app','desktop_task','browser_open'].includes(approved.kind)||typeof approved.description!=='string'||approved.description.length>4000|| (approved.selected!==null&&typeof approved.selected!=='string')||(approved.target!==undefined&&(typeof approved.target!=='string'||approved.target.length>100)))throw new Error('Invalid approved action');
  const approvedParams=JSON.parse(approved.params) as Record<string,unknown>;
  let device:{id:string;name:string},job:{job_id:string};
  if(deps?.loadDevices&&!deps.dispatcher){
   const rows=await deps.loadDevices(orgId);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
   const selection=directSelection(rows,approved.kind,approved.selected,now(),lang,approved.target,approvedParams.app);
   if(!selection.ready)return{handled:true,status:selection.status,reply:selection.reply};
   device=selection.device;
   if(approved.kind==='open_app'&&!selection.device.capabilities?.job_kinds?.includes('open_app')&&selection.device.capabilities?.job_kinds?.includes('desktop_task')){approved.kind='desktop_task';approved.params=actionJson({goal:approved.description});}
   job=await(deps.queue??giveJob)(device.id,approved.kind,JSON.parse(approved.params),true);
  }else{
   const payload=centralRequest(orgId,{kind:approved.kind,description:approved.description,params:approvedParams,...(approved.selected?{deviceId:approved.selected}:{}),...(approved.target?{target:approved.target}:{}),...(proposal.requestId?{requestId:proposal.requestId}:{}),...(approved.ownerFullControlRequired===true?{ownerFullControlRequired:true as const}:{})},'dispatch');
   // The server queues with this UUID. Even a lost enqueue ACK can request
   // cancellation of the exact operation, without re-dispatching it.
   jobId=payload.request_id;
   const receipt=workerDispatchReceipt(await(deps?.dispatcher??dispatchWorkerRequest)(JSON.parse(actionJson(payload)),signal),payload);
   device=receipt.worker;approved.kind=receipt.job.kind;approved.params=actionJson(receipt.job.params);job={job_id:receipt.job_id!};
  }
  jobId=job.job_id;
  const pollingStarted=now();
  let lastReportedStage:DirectComputerProgress['stage']|null=null;
  const reportStage=(stage:DirectComputerProgress['stage'])=>{
   if(lastReportedStage===stage||signal?.aborted)return;
   lastReportedStage=stage;
   // An observational UI callback must never trigger cancellation, redelivery,
   // or an unsupported claim about the running physical computer.
   try{deps?.onProgress?.({jobId:job.job_id,deviceName:device.name,stage,elapsedSeconds:Math.max(0,Math.floor((now()-pollingStarted)/1000))})}catch{/* UI only */ }
  };
  reportStage('queued');
  // Expose the real correlated job identity and receipt provenance. A device
  // summary alone is not proof; missing/invalid receipt fields remain explicit.
  const terminalEvidence=(row:JobRow)=>{
   const receipt=row.receipt;
   const digest=typeof row.report_sha256==='string'&&/^[a-f0-9]{64}$/i.test(row.report_sha256)?row.report_sha256:null;
   const validReceipt=receipt?.ok===true&&receipt.job_id===job.job_id&&receipt.device_id===device.id&&digest!==null&&receipt.report_sha256===digest;
   return `\nJob ID: ${job.job_id}\nWorker: ${device.name} (${device.id})\nTerminal receipt: ${validReceipt?`matched SHA-256 ${digest}`:'not independently confirmed; inspect Computers'}`;
  };
  const deadline=now()+(approved.kind==='desktop_task'?16*60_000:45_000);
  let consecutiveReadFailures=0;
  while(now()<deadline&&!signal?.aborted){
   let row:JobRow|undefined;
   try{
    row=(await loadJobs(orgId,device.id)).find(x=>x.id===job.job_id);
    consecutiveReadFailures=0;
   }catch{
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    // Retries are read-only. A brief status outage must NOT cancel or
    // re-execute an acknowledged physical action.
    if(++consecutiveReadFailures>=3){
     reportStage('status_unavailable');
     return{handled:true,status:'queued',job_id:job.job_id,reply:greek?
      `Η εργασία ${job.job_id} στάλθηκε στο ${device.name}, αλλά διακόπηκε η ανάκτηση της κατάστασης. Η ολοκλήρωση ΔΕΝ επιβεβαιώθηκε. Έλεγξε τους Υπολογιστές πριν τη στείλεις ξανά.`:
      `Job ${job.job_id} was sent to ${device.name}, but status updates are unavailable. Completion is NOT verified. Check Computers before sending it again.`};
    }
    await sleep(1000,signal);
    continue;
   }
   if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
   if(row&&row.device_id===device.id&&row.kind===approved.kind&&['queued','running'].includes(row.status))
    reportStage(row.status as 'queued'|'running');
   let verified=false;
   try{verified=!!row&&row.kind===approved.kind&&row.device_id===device.id&&!row.cancel_requested_at&&actionJson(row.params)===approved.params&&(['browser_task','desktop_task'].includes(approved.kind)?row.result?.completed===true:approved.kind==='browser_open'?row.result?.launched===true:row.result?.opened===true&&row.result?.app===approvedParams.app)}catch{/* Malformed evidence cannot confirm execution. */}
   if(row?.status==='done'&&approved.kind==='desktop_task'&&row.kind===approved.kind&&row.device_id===device.id&&actionJson(row.params)===approved.params&&typeof row.result?.summary==='string')return {handled:true,status:verified?'done':'failed',job_id:job.job_id,reply:verified?`${device.name}: ${row.result.summary}${terminalEvidence(row)}`:`${device.name}: completion not verified; ${row.result.summary}${terminalEvidence(row)}`};
   if(row?.status==='done'&&!verified)return{handled:true,status:'failed',job_id:job.job_id,reply:greek?'Ο υπολογιστής επέστρεψε ελλιπή επιβεβαίωση. Δες την εργασία στους Υπολογιστές.':'The computer returned an incomplete confirmation. Check the job in Computers.'};
   if(row?.status==='done'&&verified)return{handled:true,status:'done',job_id:job.job_id,reply:(greek?`Έγινε στο ${device.name}: ${approved.description}.`:`Done on ${device.name}: ${approved.description}.`)+terminalEvidence(row)};
   if(row&&['error','cancelled'].includes(row.status)){
    // The connector deliberately stores a bounded error CODE, not device stdout,
    // raw screenshots or secrets. Explain what actually failed; never imply the
    // song played or a browser task succeeded without a positive terminal receipt.
    const reason=typeof row.error==='string'&&/^[a-z][a-z0-9_]{2,63}$/.test(row.error)
      ?row.error:'worker_error_unavailable';
    const cancelled=row.status==='cancelled';
    const detail=cancelled
      ?(greek?'Η εργασία ακυρώθηκε.':'The job was cancelled.')
      :(greek?`Η τοπική εκτέλεση απέτυχε (κωδικός: ${reason}).`
          :`Local execution failed (code: ${reason}).`);
    const verified=greek?'Δεν επιβεβαιώθηκε η ζητούμενη ενέργεια.':'The requested action was not verified.';
    return{handled:true,status:'failed',job_id:job.job_id,reply:`${device.name}: ${detail} ${verified} Job ID: ${job.job_id}. ${greek?'Δες τη συγκεκριμένη εργασία στους Υπολογιστές.':'Open that job in Computers.'}`};
   }
   const elapsed=Math.max(0,now()-pollingStarted);
   // Fast initial acknowledgement, bounded overhead for long desktop tasks.
   // Remote Stop remains independently armed while status is polled.
   await sleep(elapsed<10_000?650:elapsed<30_000?1300:2500,signal);
  }
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  return{handled:true,status:'queued',job_id:job.job_id,reply:greek?`Η εργασία ${job.job_id} μπήκε στην ουρά για ${device.name}, αλλά η εκτέλεση δεν έχει επιβεβαιωθεί ακόμη.`:`Job ${job.job_id} was queued for ${device.name}; execution is not confirmed yet.`};
 }catch(error){
  if(signal?.aborted||error instanceof DOMException&&error.name==='AbortError'){if(jobId)await cancel(jobId).catch(()=>{});throw new DOMException('Cancelled','AbortError');}
  if(jobId&&(!(error instanceof WorkerDispatchError)||['dispatch_unavailable','dispatch_enqueue_uncertain','dispatch_receipt_invalid'].includes(error.code)))await cancel(jobId).catch(()=>{});
  if(error instanceof WorkerDispatchError)return{handled:true,status:'failed',reply:dispatchFailure(lang,error).reply};
  if(error instanceof ComputerError&&error.code==='business_plan_required')return{handled:true,status:'failed',reply:greek?'Ο έλεγχος υπολογιστή απαιτεί ενεργό Business ή Enterprise.':'Computer control requires active Business or Enterprise.'};
  if(error instanceof ComputerError&&error.code==='desktop_setup_required')return{handled:true,status:'failed',reply:greek?'Η σύνδεση του υπολογιστή υπάρχει, αλλά η υπηρεσία ελέγχου οθόνης δεν έχει ρυθμιστεί ακόμη. Δεν στάλθηκε εργασία.':'Your computer is connected, but the screen-control service is not configured yet. No job was sent.'};
  return{handled:true,status:'failed',reply:greek?'Ο υπολογιστής δεν μπόρεσε να εκτελέσει την ενέργεια.':'The computer could not execute the action.'};
 }
}
const delay=(ms:number,signal?:AbortSignal)=>new Promise<void>(resolve=>{if(signal?.aborted)return resolve();const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true})});
export async function dispatchLaptopBrowserCommand(orgId:string,input:string,lang:string,signal?:AbortSignal,deps?:{loadDevices?:(o:string)=>Promise<DeviceRow[]>;queue?:(d:string,k:JobRow['kind'],p:Record<string,unknown>,c?:boolean)=>Promise<{job_id:string}>;loadJobs?:(o:string,d:string)=>Promise<JobRow[]>;storage?:StorageLike|null;now?:()=>number;sleep?:(m:number,s?:AbortSignal)=>Promise<void>}):Promise<{handled:boolean;status?:string;reply?:string;job_id?:string}>{
 const intent=parseLaptopBrowserCommand(input);if(!intent)return{handled:false};const greek=lang==='el';
 if(!deps?.loadDevices){const target=deviceClause(plainText(input)).target;return dispatchDirectComputerCommand(orgId,{kind:'browser_open',description:input.trim(),params:{url:intent.url},...(target?{target}: {})},lang,signal,deps);}
 const load=deps.loadDevices,queue=deps?.queue??giveJob,loadJobs=deps?.loadJobs??listJobs,now=deps?.now??Date.now,s=deps?.storage===undefined?storage():deps.storage,sleep=deps?.sleep??delay;
 try{const rows=await load(orgId);if(signal?.aborted)throw new DOMException('Cancelled','AbortError');const selected=getVoiceLaptop(orgId,s),ready=browserReadyDevices(rows,now()),device=chooseVoiceLaptop(rows,selected,now());if(!device)return{handled:true,status:'failed',reply:ready.length>1?(greek?'Διάλεξε Voice laptop στους Υπολογιστές.':'Choose your Voice laptop in Computers.'):(greek?'Δεν υπάρχει online laptop με άδεια browser.':'No browser-ready laptop is online.')};if(device.id!==selected)setVoiceLaptop(orgId,device.id,s);const job=await queue(device.id,'browser_open',{url:intent.url},false),deadline=now()+16000;while(now()<deadline&&!signal?.aborted){const row=(await loadJobs(orgId,device.id)).find(x=>x.id===job.job_id);if(row?.status==='done'&&row.result?.launched===true)return{handled:true,status:'done',job_id:job.job_id,reply:greek?`Άνοιξα το browser στο ${device.name}.`:`Opened the browser on ${device.name}.`};if(row&&['error','cancelled'].includes(row.status))return{handled:true,status:'failed',job_id:job.job_id,reply:greek?'Το laptop δεν μπόρεσε να ανοίξει το browser.':'The laptop could not open the browser.'};await sleep(650,signal)}return{handled:true,status:'queued',job_id:job.job_id,reply:greek?`Έστειλα την εντολή στο ${device.name}, αλλά δεν επιβεβαιώθηκε ακόμη.`:`Browser request sent to ${device.name}; not confirmed yet.`}}catch(error){if(error instanceof DOMException&&error.name==='AbortError')throw error;return{handled:true,status:'failed',reply:greek?'Το laptop δεν μπόρεσε να ανοίξει το browser.':'The laptop could not open the browser.'}}
}

