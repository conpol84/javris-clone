/**
 * FIRBO Jarvis Autopilot is an optional, revocable USER preference, not an
 * authorization token. It never replaces agent tool grants, subscription
 * checks, RLS, durable execution receipts, or the emergency Stop control.
 *
 * Opt-in removes repetitive "Give to agent" clicks for newly generated
 * specialist handoffs. Old messages, unverified source messages, unknown
 * identities and suggestion-only agents never auto-run.
 */
export interface JarvisPreferenceStorage {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
  removeItem(key:string):void;
}
function valid(value:string):boolean {
  return typeof value==='string'&&value.length>0&&value.length<=128
    &&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);
}
export function jarvisPreferenceKey(orgId:string,userId:string):string|null {
  return valid(orgId)&&valid(userId)
    ? 'firbo.jarvis.autopilot.v1:'+encodeURIComponent(orgId)+':'+encodeURIComponent(userId)
    : null;
}
export function browserPreferenceStorage():JarvisPreferenceStorage|null {
  try{return typeof window==='undefined'?null:window.localStorage;}catch{return null;}
}
export function readJarvisAutopilot(orgId:string,userId:string,storage:JarvisPreferenceStorage|null=browserPreferenceStorage()):boolean {
  const key=jarvisPreferenceKey(orgId,userId);
  if(!key||!storage)return false;
  try{return storage.getItem(key)==='on';}catch{return false;}
}
export function writeJarvisAutopilot(orgId:string,userId:string,enabled:boolean,storage:JarvisPreferenceStorage|null=browserPreferenceStorage()):boolean {
  const key=jarvisPreferenceKey(orgId,userId);
  if(!key||!storage||typeof enabled!=='boolean')return false;
  try{enabled?storage.setItem(key,'on'):storage.removeItem(key);return true;}catch{return false;}
}
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export interface JarvisAutoEligibility {
  modeEnabled:boolean;freshResponse:boolean;messageId:string|null|undefined;
  role:string;companyPlanReady:boolean;
  agent:{id:string;enabled:boolean;autonomy:string}|null|undefined;
}
/** Local UI readiness only. The server still decides every real power. */
export function canAutostartJarvisDelegation(i:JarvisAutoEligibility):boolean {
  return i.modeEnabled===true&&i.freshResponse===true&&i.companyPlanReady===true
    &&UUID.test(i.messageId??'')&&['owner','admin','manager','member'].includes(i.role)
    &&!!i.agent&&UUID.test(i.agent.id)&&i.agent.enabled===true
    &&i.agent.autonomy==='auto';
}
