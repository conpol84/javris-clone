/** Strictly parses a SERVER-saved CEO handoff marker, never free-form prose.
 * Existing taskFrom() creates exactly "[[task:uuid]] title\noptional details".
 * Pure/no side effects: use only AFTER accounting and assistant-message save.
 */
export interface JarvisSavedHandoff {agentId:string;title:string;details:string}
const UUID='[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const TASK=new RegExp('\\[\\[task:('+UUID+')\\]\\] ([^\\r\\n]{3,160})(?:\\n([^\\r\\n]{1,900}))?','gi');
const id=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function savedJarvisHandoff(message:unknown):JarvisSavedHandoff|null {
 if(typeof message!=='string'||message.length>16000)return null;
 const matches=[...message.matchAll(TASK)];
 if(matches.length!==1)return null;
 const [,agentId,titleRaw,detailsRaw='']=matches[0];
 const title=titleRaw.trim(),details=detailsRaw.trim();
 if(!id.test(agentId)||!title||title.length>160||details.length>900
   ||title.includes('[[')||details.includes('[[')||title.includes(']]'))return null;
 return{agentId:agentId.toLowerCase(),title,details};
}
export interface JarvisAdmissionContext {
 serverGate:boolean;isCeo:boolean;ownerAuthenticated:boolean;
 standingGrant:boolean;isChannel:boolean;
}
export function jarvisServerMayAdmit(x:JarvisAdmissionContext):boolean {
 return x.serverGate===true&&x.isCeo===true&&x.ownerAuthenticated===true
  &&x.standingGrant===true&&x.isChannel===false;
}
