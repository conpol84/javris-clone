import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from 'react';
import {ShieldCheck,RotateCcw} from 'lucide-react';
import {toast} from 'sonner';
import {useI18n} from '../../i18n/I18nProvider';
import type {TKey} from '../../i18n/locales/en';
import {loadLegacyProposals,loadApprovedCompanyMemory,publishCompanyMemory,
 revokeCompanyMemory,type LegacyMemoryProposal,type ReviewedCompanyMemory} from '../../lib/company/company-memory-review';

type PublicationType='company'|'project'|'instruction'|'decision'|'fact';
const TYPES:PublicationType[]=['company','project','instruction','decision','fact'];
/** Private proposal review UI. Backend revalidates JWT membership/owner authority
 * on every call. No listing or writing occurs for ordinary team members. */
export function CompanyMemoryReview({orgId}:{orgId:string}){
 const {t}=useI18n();
 const [proposals,setProposals]=useState<LegacyMemoryProposal[]>([]);
 const [approved,setApproved]=useState<ReviewedCompanyMemory[]>([]);
 const [selected,setSelected]=useState<string|null>(null);
 const [content,setContent]=useState('');
 const [kind,setKind]=useState<PublicationType>('fact');
 const [importance,setImportance]=useState(0.7);
 const [confirmed,setConfirmed]=useState(false);
 const [phase,setPhase]=useState<'loading'|'ready'|'error'>('loading');
 const [busy,setBusy]=useState(false);
 const live=useRef(true),version=useRef(0),locked=useRef(false);
 const refresh=useCallback(async()=>{
  if(!orgId)return;
  const id=++version.current;
  setPhase('loading');
  try{
   const [raw,published]=await Promise.all([
    loadLegacyProposals(orgId),loadApprovedCompanyMemory(orgId),
   ]);
   if(!live.current||id!==version.current)return;
   // A connector/cache may reuse a mutable array reference. Snapshot its rows
   // before storing React state so an in-place provider update cannot leave
   // the pending approval count or review controls stale.
   setProposals([...raw]);setApproved([...published]);setPhase('ready');
  }catch{
   if(!live.current||id!==version.current)return;
   setPhase('error');
  }
 },[orgId]);
 useEffect(()=>{
  live.current=true;void refresh();
  return()=>{live.current=false;version.current++;};
 },[refresh]);
 const pending=useMemo(()=>{
  const published=new Set(approved.map(x=>x.source_memory_id).filter(Boolean));
  return proposals.filter(x=>!published.has(x.id));
 },[approved,proposals]);
 const pick=(p:LegacyMemoryProposal)=>{
  if(locked.current)return;
  setSelected(p.id);setContent(p.content.slice(0,1000));
  setKind(TYPES.includes(p.memory_type as PublicationType)?p.memory_type as PublicationType:'fact');
  setImportance(0.7);setConfirmed(false);
 };
 const chooseManual=()=>{
  if(locked.current)return;
  setSelected(null);setContent('');setKind('fact');setImportance(0.7);setConfirmed(false);
 };
 const publish=async(event:FormEvent)=>{
  event.preventDefault();
  if(locked.current||phase!=='ready'||!confirmed||
    content.trim().length<12||content.trim().length>1000)return;
  locked.current=true;setBusy(true);
  try{
   await publishCompanyMemory(orgId,{sourceId:selected??undefined,
    content:content.trim(),memoryType:kind,importance});
   if(!live.current)return;
   chooseManualAfterSuccess();toast.success(t('mem.review.saved'));
   await refresh();
  }catch{
   if(live.current)toast.error(t('mem.review.error'));
  }finally{
   locked.current=false;
   if(live.current)setBusy(false);
  }
 };
 const chooseManualAfterSuccess=()=>{
  setSelected(null);setContent('');setKind('fact');setConfirmed(false);setImportance(0.7);
 };
 const revoke=async(id:string)=>{
  if(locked.current||phase!=='ready')return;
  if(!window.confirm(t('mem.review.revoke')+'?'))return;
  locked.current=true;setBusy(true);
  try{
   await revokeCompanyMemory(orgId,id);
   if(live.current){toast.success(t('mem.review.revoked'));await refresh();}
  }catch{if(live.current)toast.error(t('mem.review.error'));}
  finally{locked.current=false;if(live.current)setBusy(false);}
 };
 return <section data-company-memory-review="true" className="fb-glass fb-col gap-4 p-4 sm:p-6">
   <header className="fb-col gap-2">
    <div className="flex flex-wrap items-center justify-between gap-3">
     <h2 className="flex items-center gap-2 text-lg font-semibold">
      <ShieldCheck size={20}/>{t('mem.review.title')}
     </h2>
     <button type="button" className="fb-btn fb-btn--ghost"
      disabled={busy} onClick={()=>void refresh()}>
      <RotateCcw size={14}/>{t('mem.review.refresh')}
     </button>
    </div>
    <p className="fb-muted text-sm">{t('mem.review.desc')}</p>
    <p className="fb-dim text-xs">{t('mem.review.private')}</p>
   </header>
   {phase==='loading'&&<p role="status" className="fb-dim">{t('common.loading')}</p>}
   {phase==='error'&&<p role="alert" className="fb-muted">{t('mem.review.error')}</p>}
   {phase==='ready'&&<div className="grid gap-4 lg:grid-cols-2">
    <section className="fb-col gap-2">
     <h3 className="text-sm font-semibold">{t('mem.review.proposals')} ({pending.length})</h3>
     {!pending.length&&<p className="fb-dim text-sm">{t('mem.review.empty')}</p>}
     <div className="fb-col max-h-72 gap-2 overflow-y-auto">
      {pending.map(p=><button key={p.id} type="button"
       aria-pressed={selected===p.id}
       disabled={busy} onClick={()=>pick(p)}
       className="fb-btn fb-btn--ghost w-full text-start text-sm"
       style={selected===p.id?{borderColor:'var(--fb-accent)'}:undefined}>
       {p.content.slice(0,160)}{p.content.length>160?'…':''}
      </button>)}
     </div>
    </section>
    <section className="fb-col gap-2">
     <h3 className="text-sm font-semibold">{t('mem.review.published')} ({approved.length})</h3>
     {!approved.length&&<p className="fb-dim text-sm">{t('mem.review.emptyPublished')}</p>}
     <div className="fb-col max-h-72 gap-2 overflow-y-auto">
      {approved.map(p=><div key={p.id} className="fb-row fb-col gap-2 p-3">
       <p className="break-words text-sm">{p.content}</p>
       <button type="button" className="fb-btn fb-btn--ghost self-start"
        disabled={busy} onClick={()=>void revoke(p.id)}>{t('mem.review.revoke')}</button>
      </div>)}
     </div>
    </section>
   </div>}
   {phase==='ready'&&<form onSubmit={publish} className="fb-col gap-3 border-t pt-4"
    style={{borderColor:'var(--fb-border)'}}>
    <div className="flex flex-wrap items-center justify-between gap-2">
     <label className="text-sm font-semibold" htmlFor="company-memory-editor">
      {selected?t('mem.review.edit'):t('mem.review.manual')}
     </label>
     {selected&&<button type="button" className="fb-btn fb-btn--ghost"
       disabled={busy} onClick={chooseManual}>{t('mem.review.cancel')}</button>}
    </div>
    <textarea id="company-memory-editor" className="fb-input w-full"
     aria-label={t('mem.review.edit')} rows={3} maxLength={1000}
     disabled={busy} value={content} onChange={e=>{setContent(e.target.value);setConfirmed(false);}}/>
    <div className="flex flex-wrap items-center gap-3">
     <select className="fb-input" aria-label={t('mem.typeLabel')}
      value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as PublicationType);setConfirmed(false);}}>
      {TYPES.map(k=><option key={k} value={k}>{t(`mem.type.${k}` as TKey)}</option>)}
     </select>
     <label className="fb-muted flex items-center gap-2 text-xs">
      {t('mem.importance')}
      <input type="range" min="0.1" max="1" step="0.1" value={importance}
       disabled={busy} onChange={e=>{setImportance(Number(e.target.value));setConfirmed(false);}}/>
     </label>
    </div>
    <label className="fb-muted flex items-start gap-2 text-sm">
     <input type="checkbox" checked={confirmed} disabled={busy}
      onChange={e=>setConfirmed(e.target.checked)}/>
     {t('mem.review.verify')}
    </label>
    <button type="submit" className="fb-btn fb-btn--primary self-start"
     disabled={busy||!confirmed||content.trim().length<12||content.trim().length>1000}>
     {t('mem.review.publish')}
    </button>
   </form>}
 </section>;
}
