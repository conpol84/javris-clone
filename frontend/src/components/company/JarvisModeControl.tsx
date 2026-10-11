import { Zap } from 'lucide-react';

const copy={
 en:['FIRBO AI Autopilot','Ready for autonomous work','Off — review each handoff','New work can start without another click, only with an auto-enabled employee and existing permissions. Stop and audit remain available.'],
 el:['FIRBO AI Autopilot','Αυτόνομη εκτέλεση ενεργή','Κλειστό — ελέγχεις κάθε ανάθεση','Οι νέες εργασίες ξεκινούν χωρίς άλλο κλικ μόνο για agents με ενεργό Auto και τα ήδη δοσμένα δικαιώματα. Stop και ιστορικό παραμένουν.'],
 es:['FIRBO AI Autopilot','Ejecución autónoma activa','Apagado — revisas cada tarea','Las nuevas tareas se inician automáticamente solo con agentes Auto y permisos existentes. Stop y auditoría siguen disponibles.'],
 'pt-BR':['FIRBO AI Autopilot','Execução autônoma ativa','Desligado — revise cada tarefa','Novas tarefas começam automaticamente apenas com agentes Auto e permissões existentes. Stop e auditoria continuam.'],
 de:['FIRBO AI Autopilot','Autonome Ausführung aktiv','Aus — Aufgaben einzeln prüfen','Neue Aufträge starten nur mit Auto-Agenten und bestehenden Berechtigungen. Stop und Protokolle bleiben aktiv.'],
 fr:['FIRBO AI Autopilot','Exécution autonome active','Désactivé — vérifiez les tâches','Les nouvelles tâches démarrent uniquement avec des agents Auto et les autorisations existantes. Arrêt et audit restent actifs.'],
 'zh-CN':['FIRBO AI 自动执行','自动执行已启用','关闭 — 逐项确认任务','仅自动启动已授权的 Auto 智能体的新任务。停止和审计功能仍然有效。'],
 ar:['FIRBO AI التلقائي','التنفيذ المستقل مفعل','متوقف — راجع كل مهمة','تبدأ المهام الجديدة فقط للوكلاء المصرح لهم بالتنفيذ التلقائي. يظل الإيقاف والتدقيق متاحين.'],
} as const;
const statusUnknown:Record<string,[string,string,string]>={
 en:['Autopilot status not verified. Work may still be active on the server.','Retry verification','Could not confirm the permission change.'],
 el:['Δεν επιβεβαιώθηκε η κατάσταση Autopilot. Μπορεί να παραμένει ενεργό στον server.','Επανάληψη ελέγχου','Δεν επιβεβαιώθηκε η αλλαγή δικαιώματος.'],
 es:['Estado de Autopilot sin confirmar. Puede seguir activo en el servidor.','Reintentar','No se confirmó el cambio de permiso.'],
 'pt-BR':['Estado do Autopilot não confirmado. Pode continuar ativo no servidor.','Tentar novamente','A alteração não foi confirmada.'],
 de:['Autopilot-Status nicht bestätigt. Aufgaben könnten noch auf dem Server laufen.','Erneut prüfen','Berechtigungsänderung nicht bestätigt.'],
 fr:['État Autopilot non vérifié. Il pourrait rester actif sur le serveur.','Revérifier','Modification des droits non confirmée.'],
 'zh-CN':['自动执行状态未验证，服务器端可能仍在运行。','重试验证','权限更改尚未确认。'],
 ar:['لم يتم تأكيد حالة التشغيل التلقائي؛ قد يظل يعمل على الخادم.','إعادة التحقق','لم يتم تأكيد تغيير الإذن.'],
};
export type JarvisDisplayLanguage=keyof typeof copy;
export function JarvisModeControl({enabled,onToggle,lang,disabled=false,unavailable=false,onRetry}:{
 enabled:boolean;onToggle:(value:boolean)=>void;lang:string;disabled?:boolean;
 unavailable?:boolean;onRetry?:()=>void;
}){
 const [name,on,off,detail]=copy[lang as JarvisDisplayLanguage]??copy.en;
 const [unknown,retry,unconfirmed]=statusUnknown[lang]??statusUnknown.en;
 return <>
 <button type="button" role="switch" aria-checked={enabled}
  aria-label={name} data-testid="jarvis-autopilot" disabled={disabled}
  onClick={()=>onToggle(!enabled)}
  className="fb-glass--hover flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-start text-xs"
  style={{borderColor:enabled?'var(--fb-accent)':'var(--fb-border)'}}>
   <Zap size={15} aria-hidden style={{color:enabled?'var(--fb-accent)':'var(--fb-dim)'}}/>
   <span className="min-w-0 flex-1">
     <span className="block font-semibold">{name} · {unavailable?unconfirmed:enabled?on:off}</span>
     <span className="fb-dim block leading-snug">{detail}</span>
   </span>
 </button>
 {unavailable && <div role="alert" className="fb-dim flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{borderColor:'var(--fb-warn)'}}>
   <span>{unknown}</span>
   {onRetry && <button type="button" className="fb-chip min-h-11 cursor-pointer font-semibold" onClick={onRetry}>{retry}</button>}
 </div>}
 </>;
}
