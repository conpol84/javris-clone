import { useMemo, useState } from 'react';
import { ChevronDown, History, MessageSquarePlus, Search } from 'lucide-react';
import type { CeoSessionPreview } from '../../lib/company/ceo-sessions';

const labels:Record<string,{title:string;newChat:string;search:string;empty:string;showAll:string;showLess:string;active:string;loading:string;error:string}>={
 el:{title:'Προηγούμενες συνομιλίες CEO',newChat:'Νέα συνομιλία',search:'Αναζήτηση συνομιλιών',empty:'Δεν υπάρχουν αποθηκευμένες συνομιλίες',showAll:'Όλες οι συνομιλίες',showLess:'Λιγότερες',active:'Τρέχουσα',loading:'Φόρτωση ιστορικού...',error:'Δεν ήταν δυνατή η φόρτωση ιστορικού. Δοκίμασε ξανά.'},
 en:{title:'Previous CEO conversations',newChat:'New conversation',search:'Search conversations',empty:'No saved conversations yet',showAll:'All conversations',showLess:'Show less',active:'Current',loading:'Loading history...',error:'History could not be loaded. Try again.'},
 es:{title:'Conversaciones anteriores del CEO',newChat:'Nueva conversación',search:'Buscar conversaciones',empty:'Aún no hay conversaciones guardadas',showAll:'Todas las conversaciones',showLess:'Mostrar menos',active:'Actual',loading:'Cargando historial...',error:'No se pudo cargar el historial.'},
 pt:{title:'Conversas anteriores do CEO',newChat:'Nova conversa',search:'Pesquisar conversas',empty:'Ainda não há conversas guardadas',showAll:'Todas as conversas',showLess:'Mostrar menos',active:'Atual',loading:'A carregar histórico...',error:'Não foi possível carregar o histórico.'},
 fr:{title:'Conversations précédentes du CEO',newChat:'Nouvelle conversation',search:'Rechercher',empty:'Aucune conversation enregistrée',showAll:'Toutes les conversations',showLess:'Voir moins',active:'Actuelle',loading:'Chargement de l’historique...',error:'Impossible de charger l’historique.'},
 de:{title:'Frühere CEO-Gespräche',newChat:'Neues Gespräch',search:'Gespräche suchen',empty:'Noch keine gespeicherten Gespräche',showAll:'Alle Gespräche',showLess:'Weniger anzeigen',active:'Aktuell',loading:'Verlauf wird geladen...',error:'Verlauf konnte nicht geladen werden.'},
 ar:{title:'محادثات الرئيس التنفيذي السابقة',newChat:'محادثة جديدة',search:'البحث في المحادثات',empty:'لا توجد محادثات محفوظة',showAll:'كل المحادثات',showLess:'عرض أقل',active:'الحالية',loading:'جارٍ تحميل السجل...',error:'تعذر تحميل السجل.'},
 'zh-CN':{title:'以往 CEO 对话',newChat:'新对话',search:'搜索对话',empty:'暂无已保存对话',showAll:'所有对话',showLess:'收起',active:'当前',loading:'正在加载历史...',error:'无法加载历史记录。'},
};
export interface CeoSessionHistoryProps{
 lang:string; sessions:CeoSessionPreview[]; activeId:string|null;
 loading:boolean; error:boolean; disabled:boolean; canCreate:boolean;
 onSelect:(id:string)=>void; onNew:()=>void; onRetry:()=>void;
 compact?:boolean;
}
/** Never includes other users' conversations: caller supplies own-user scoped rows. */
export function CeoSessionHistory({lang,sessions,activeId,loading,error,disabled,canCreate,onSelect,onNew,onRetry,compact=false}:CeoSessionHistoryProps){
 const copy=labels[lang]??labels.en;
 const [query,setQuery]=useState('');
 const [expanded,setExpanded]=useState(false);
 const [open,setOpen]=useState(()=>typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
 const visible=useMemo(()=>{
  const needle=query.trim().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const filtered=needle?sessions.filter(s=>[s.title,s.preview].join(' ').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().includes(needle)):sessions;
  return expanded||needle?filtered:filtered.slice(0,compact?2:3);
 },[sessions,query,expanded,compact]);
 return <section className="fb-glass fb-col gap-2 p-3" aria-label={copy.title} data-ceo-session-history="true">
   <div className="flex flex-wrap items-center justify-between gap-2">
     <button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open} aria-controls="firbo-ceo-history-list" className="inline-flex min-w-0 items-center gap-2 text-start text-sm font-semibold">
       <History size={15} className="shrink-0"/><span className="truncate">{copy.title}</span><span className="fb-dim text-xs">({sessions.length})</span><ChevronDown size={15} className={`shrink-0 transition-transform ${open?'rotate-180':''}`}/>
     </button>
     <button type="button" className="fb-btn fb-btn--ghost" disabled={disabled||loading||!canCreate} onClick={onNew} aria-label={copy.newChat}>
       <MessageSquarePlus size={14}/>{copy.newChat}
     </button>
   </div>
   <div id="firbo-ceo-history-list" hidden={!open} className="fb-col gap-2 min-w-0">
   {loading&&<span role="status" className="fb-dim text-xs">{copy.loading}</span>}
   {error&&<div role="alert" className="text-xs fb-muted">{copy.error} <button type="button" className="underline" onClick={onRetry}>{lang==='el'?'Ξανά':'Retry'}</button></div>}
   {!loading&&!error&&<>
     {sessions.length>3&&<label className="relative block">
       <span className="sr-only">{copy.search}</span>
       <Search size={14} className="absolute start-2 top-2.5 opacity-60" aria-hidden/>
       <input className="fb-input w-full ps-8 text-xs" value={query} onChange={e=>setQuery(e.target.value)} placeholder={copy.search} aria-label={copy.search}/>
     </label>}
     <div className="fb-col gap-1" role="list">
       {visible.length===0&&<span className="fb-dim text-xs">{copy.empty}</span>}
       {visible.map(s=><button key={s.id} type="button" role="listitem" aria-current={activeId===s.id?'true':undefined}
         disabled={disabled} onClick={()=>onSelect(s.id)}
         className="w-full rounded-lg border px-2 py-2 text-start hover:bg-[var(--fb-hover)]"
         style={{borderColor:activeId===s.id?'var(--fb-accent)':'var(--fb-border)'}}>
         <span className="flex items-center justify-between gap-2">
           <span className="truncate text-xs font-semibold">{s.title}</span>
           {activeId===s.id&&<span className="fb-dim shrink-0 text-[10px]">{copy.active}</span>}
         </span>
         {s.preview&&<span className="fb-dim mt-1 block truncate text-[11px]">{s.preview}</span>}
         <time className="fb-dim mt-1 block text-[10px]" dateTime={s.updated_at}>{new Date(s.updated_at).toLocaleString(lang==='el'?'el-GR':lang)}</time>
       </button>)}
     </div>
     {sessions.length>(compact?2:3)&&!query&&<button className="self-start text-xs underline fb-muted" type="button" onClick={()=>setExpanded(v=>!v)}>
       {expanded?copy.showLess:`${copy.showAll} (${sessions.length})`}
     </button>}
   </>}
   </div>
 </section>;
}
