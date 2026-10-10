/** One personal CEO session pointer shared by AI CEO, Talk overlay and Agent Chat.
 * The pointer contains NO transcript and is scoped to org/user/agent.
 * A client storage value is never authority: callers MUST validate it against
 * a freshly fetched, personally scoped conversation list before reading messages.
 * There is no cross-company, admin-impersonation or memory ACL escape here.
 */
export interface CeoSessionCandidate { id: string }
export interface CeoSessionStore {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
  removeItem(key:string):void;
}
export const ceoSessionStorageKey=(org:string,user:string,agent:string)=>
  [org,user,agent].every(x=>typeof x==='string'&&x.length>0&&x.length<=128)
    ? `firbo.ceo.active.v2:${org}:${user}:${agent}` : null;
const browserStore=():CeoSessionStore|null=>{
 try{return typeof window!=='undefined'?window.localStorage:null}catch{return null}
};
/** This must never SELECT a session. A forged/stale pointer is ignored. */
export function chooseCeoSession<T extends CeoSessionCandidate>(
 rows:readonly T[],org:string,user:string,agent:string,store:CeoSessionStore|null=browserStore(),
):T|null{
 if(!rows.length)return null;
 const key=ceoSessionStorageKey(org,user,agent);
 let id:string|null=null;
 if(key&&store){try{id=store.getItem(key)}catch{/* privacy mode */}}
 return rows.find(row=>row.id===id)??rows[0]??null;
}
export function rememberCeoSession(
 org:string,user:string,agent:string,id:string|null,store:CeoSessionStore|null=browserStore(),
):void{
 const key=ceoSessionStorageKey(org,user,agent);
 if(!key||!store)return;
 try{if(id&&id.length<=128)store.setItem(key,id);else store.removeItem(key)}
 catch{/* storage denial must never interrupt a CEO job or expose its content */}
}
