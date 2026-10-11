import { Zap } from 'lucide-react';

const copy={
 en:['Jarvis Autopilot','Ready for autonomous work','Off — review each handoff','New work can start without another click, only with an auto-enabled employee and existing permissions. Stop and audit remain available.'],
 el:['Jarvis Autopilot','Αυτόνομη εκτέλεση ενεργή','Κλειστό — ελέγχεις κάθε ανάθεση','Οι νέες εργασίες ξεκινούν χωρίς άλλο κλικ μόνο για agents με ενεργό Auto και τα ήδη δοσμένα δικαιώματα. Stop και ιστορικό παραμένουν.'],
 es:['Jarvis Autopilot','Ejecución autónoma activa','Apagado — revisas cada tarea','Las nuevas tareas se inician automáticamente solo con agentes Auto y permisos existentes. Stop y auditoría siguen disponibles.'],
 'pt-BR':['Jarvis Autopilot','Execução autônoma ativa','Desligado — revise cada tarefa','Novas tarefas começam automaticamente apenas com agentes Auto e permissões existentes. Stop e auditoria continuam.'],
 de:['Jarvis Autopilot','Autonome Ausführung aktiv','Aus — Aufgaben einzeln prüfen','Neue Aufträge starten nur mit Auto-Agenten und bestehenden Berechtigungen. Stop und Protokolle bleiben aktiv.'],
 fr:['Jarvis Autopilot','Exécution autonome active','Désactivé — vérifiez les tâches','Les nouvelles tâches démarrent uniquement avec des agents Auto et les autorisations existantes. Arrêt et audit restent actifs.'],
 'zh-CN':['Jarvis 自动执行','自动执行已启用','关闭 — 逐项确认任务','仅自动启动已授权的 Auto 智能体的新任务。停止和审计功能仍然有效。'],
 ar:['جارفس التلقائي','التنفيذ المستقل مفعل','متوقف — راجع كل مهمة','تبدأ المهام الجديدة فقط للوكلاء المصرح لهم بالتنفيذ التلقائي. يظل الإيقاف والتدقيق متاحين.'],
} as const;
export type JarvisDisplayLanguage=keyof typeof copy;
export function JarvisModeControl({enabled,onToggle,lang,disabled=false}:{
 enabled:boolean;onToggle:(value:boolean)=>void;lang:string;disabled?:boolean;
}){
 const [name,on,off,detail]=copy[lang as JarvisDisplayLanguage]??copy.en;
 return <button type="button" role="switch" aria-checked={enabled}
  aria-label={name} data-testid="jarvis-autopilot" disabled={disabled}
  onClick={()=>onToggle(!enabled)}
  className="fb-glass--hover flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-start text-xs"
  style={{borderColor:enabled?'var(--fb-accent)':'var(--fb-border)'}}>
   <Zap size={15} aria-hidden style={{color:enabled?'var(--fb-accent)':'var(--fb-dim)'}}/>
   <span className="min-w-0 flex-1">
     <span className="block font-semibold">{name} · {enabled?on:off}</span>
     <span className="fb-dim block leading-snug">{detail}</span>
   </span>
 </button>;
}
