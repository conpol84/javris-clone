import {useState, type FormEvent} from 'react';
import {useI18n} from '../../i18n/I18nProvider';
import {browserTaskLabels} from '../../lib/company/browser-task-labels';

type Action='open'|'read'|'snapshot'|'screenshot'|'click'|'fill'|'scroll'|'upload'|'download';
type Step={action:Action;url?:string;selector?:string;text?:string;pixels?:number;path?:string};
const actions:Action[]=['open','read','snapshot','screenshot','click','fill','scroll','upload','download'];
const initial=(action:Action):Step=>action==='open'?{action,url:'https://example.com'}:['read','snapshot'].includes(action)?{action}:action==='screenshot'?{action,path:''}:action==='scroll'?{action,pixels:400}:action==='fill'?{action,selector:'',text:''}:action==='upload'?{action,selector:'',path:''}:action==='download'?{action,url:'https://example.com',path:''}:{action,selector:''};

export function BrowserTaskComposer({disabled,onSubmit}:{disabled:boolean;onSubmit:(plan:{steps:Step[];timeout_ms:number})=>Promise<void>}){
 const {lang}=useI18n(),l=browserTaskLabels(lang);
 const [steps,setSteps]=useState<Step[]>([initial('open'),initial('read')]);
 const change=(index:number,patch:Partial<Step>)=>setSteps(old=>old.map((s,i)=>i===index?{...s,...patch}:s));
 const submit=(event:FormEvent)=>{event.preventDefault();if(!disabled&&window.confirm(l.confirm))void onSubmit({steps,timeout_ms:120_000});};
 return <form className="fb-col gap-3" onSubmit={submit} data-testid="browser-task-composer">
  <h3 className="font-semibold">{l.title}</h3><p className="fb-dim text-sm">{l.note}</p>
  {steps.map((s,i)=><fieldset key={i} className="fb-col gap-2 rounded-lg border border-white/10 p-3" disabled={disabled}>
   <legend className="text-xs">{i+1}</legend>
   <select className="fb-input" aria-label={`${l.title} ${i+1}`} value={s.action} disabled={i===0} onChange={e=>setSteps(old=>old.map((v,j)=>j===i?initial(e.target.value as Action):v))}>{actions.map(a=><option key={a} value={a}>{l[a]}</option>)}</select>
   {s.url!==undefined&&<label className="fb-col gap-1 text-sm">{l.url}<input className="fb-input" required type="url" maxLength={2048} value={s.url} onChange={e=>change(i,{url:e.target.value})}/></label>}
   {s.selector!==undefined&&<label className="fb-col gap-1 text-sm">{l.selector}<input className="fb-input" required maxLength={200} value={s.selector} onChange={e=>change(i,{selector:e.target.value})}/></label>}
   {s.text!==undefined&&<label className="fb-col gap-1 text-sm">{l.text}<textarea className="fb-input" maxLength={4000} value={s.text} onChange={e=>change(i,{text:e.target.value})}/></label>}
   {s.pixels!==undefined&&<label className="fb-col gap-1 text-sm">{l.pixels}<input className="fb-input" required type="number" min={-4000} max={4000} value={s.pixels} onChange={e=>change(i,{pixels:Number(e.target.value)})}/></label>}
   {s.path!==undefined&&<label className="fb-col gap-1 text-sm">{l.path}<input className="fb-input" required maxLength={500} value={s.path} onChange={e=>change(i,{path:e.target.value})}/></label>}
   {i>0&&<button type="button" className="fb-btn fb-btn--ghost self-start" onClick={()=>setSteps(old=>old.filter((_,j)=>j!==i))}>{l.remove}</button>}
  </fieldset>)}
  <div className="flex flex-wrap gap-2"><button type="button" className="fb-btn fb-btn--ghost" disabled={disabled||steps.length>=20} onClick={()=>setSteps(old=>[...old,initial('read')])}>{l.add}</button><button className="fb-btn fb-btn--primary" disabled={disabled}>{l.send}</button></div>
 </form>;
}
