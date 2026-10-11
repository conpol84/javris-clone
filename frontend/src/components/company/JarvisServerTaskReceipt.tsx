import {useEffect,useState} from 'react';
import {Link} from 'react-router';
import {useI18n} from '../../i18n/I18nProvider';
import {requireClient} from '../../lib/company/client';
import {trustedJarvisTaskView} from '../../lib/company/jarvis-server-status';

type Detail={status:string;reportAvailable:boolean}|null;
const words:Record<string,{checking:string;missing:string;unavailable:string;pending:string;running:string;awaiting_approval:string;completed:string;failed:string;blocked:string;cancelled:string;report:string;tasks:string}>={
 en:{checking:'Checking server task…',missing:'No autonomous task was saved.',unavailable:'Task status cannot be verified.',pending:'Task queued on server.',running:'Task running on server.',awaiting_approval:'Task requires action in Inbox.',completed:'Task reports completed. Review its evidence.',failed:'Task failed. Review its error.',blocked:'Task blocked or needs reconciliation.',cancelled:'Task cancelled.',report:'Report is available.',tasks:'View Tasks'},
 el:{checking:'Έλεγχος εργασίας στον server…',missing:'Δεν αποθηκεύτηκε αυτόνομη εργασία.',unavailable:'Δεν επιβεβαιώθηκε η κατάσταση της εργασίας.',pending:'Η εργασία βρίσκεται στην ουρά του server.',running:'Η εργασία εκτελείται στον server.',awaiting_approval:'Χρειάζεται ενέργεια στο Inbox.',completed:'Η εργασία αναφέρει ολοκλήρωση. Έλεγξε τα στοιχεία.',failed:'Η εργασία απέτυχε. Έλεγξε το σφάλμα.',blocked:'Η εργασία μπλοκαρίστηκε ή χρειάζεται συμφωνία.',cancelled:'Η εργασία ακυρώθηκε.',report:'Υπάρχει αποθηκευμένη αναφορά.',tasks:'Άνοιγμα Tasks'},
 es:{checking:'Comprobando tarea…',missing:'No se guardó ninguna tarea autónoma.',unavailable:'No se puede verificar el estado.',pending:'Tarea en cola.',running:'Tarea en ejecución.',awaiting_approval:'Se requiere acción en Inbox.',completed:'La tarea informa finalización; comprueba la evidencia.',failed:'La tarea falló.',blocked:'Tarea bloqueada o pendiente de revisión.',cancelled:'Tarea cancelada.',report:'Informe disponible.',tasks:'Ver tareas'},
 'pt-BR':{checking:'Verificando tarefa…',missing:'Nenhuma tarefa autônoma foi salva.',unavailable:'Estado não verificável.',pending:'Tarefa na fila.',running:'Tarefa em execução.',awaiting_approval:'Ação necessária na caixa de entrada.',completed:'Tarefa relatou conclusão; confira evidências.',failed:'A tarefa falhou.',blocked:'Tarefa bloqueada ou precisa de revisão.',cancelled:'Tarefa cancelada.',report:'Relatório disponível.',tasks:'Ver tarefas'},
 fr:{checking:'Vérification de la tâche…',missing:'Aucune tâche autonome enregistrée.',unavailable:'État non vérifiable.',pending:'Tâche en attente.',running:'Tâche en cours.',awaiting_approval:'Action requise dans Inbox.',completed:'Tâche déclarée terminée ; vérifiez les preuves.',failed:'Échec de la tâche.',blocked:'Tâche bloquée ou à vérifier.',cancelled:'Tâche annulée.',report:'Rapport disponible.',tasks:'Voir les tâches'},
 de:{checking:'Server-Aufgabe wird geprüft…',missing:'Keine autonome Aufgabe gespeichert.',unavailable:'Status nicht überprüfbar.',pending:'Aufgabe in Warteschlange.',running:'Aufgabe läuft.',awaiting_approval:'Aktion im Posteingang erforderlich.',completed:'Abschluss gemeldet; Belege prüfen.',failed:'Aufgabe fehlgeschlagen.',blocked:'Aufgabe blockiert oder zu prüfen.',cancelled:'Aufgabe abgebrochen.',report:'Bericht verfügbar.',tasks:'Aufgaben ansehen'},
 'zh-CN':{checking:'正在检查任务…',missing:'未保存自动任务。',unavailable:'无法验证任务状态。',pending:'任务已入队。',running:'任务正在运行。',awaiting_approval:'收件箱中需要操作。',completed:'任务报告完成；请核实证据。',failed:'任务失败。',blocked:'任务阻止或需核实。',cancelled:'任务已取消。',report:'报告可用。',tasks:'查看任务'},
 ar:{checking:'جارٍ فحص المهمة…',missing:'لم تُحفظ مهمة تلقائية.',unavailable:'تعذر التحقق من الحالة.',pending:'المهمة في قائمة الانتظار.',running:'المهمة قيد التنفيذ.',awaiting_approval:'يلزم إجراء في صندوق الوارد.',completed:'أُبلغ عن اكتمال المهمة؛ تحقق من الدليل.',failed:'فشلت المهمة.',blocked:'المهمة محظورة أو تحتاج مراجعة.',cancelled:'أُلغيت المهمة.',report:'التقرير متاح.',tasks:'عرض المهام'},
};

/** Read-only receipt; does not create, enqueue, resume or cancel any task. */
export function JarvisServerTaskReceipt({orgId,userId,conversationId,messageId}:{
 orgId:string;userId:string;conversationId:string;messageId:string;
}){
 const {lang}=useI18n();
 const text=words[lang]??words.en;
 const [state,setState]=useState<{key:string;phase:'checking'|'found'|'missing'|'unavailable';detail:Detail}>({key:'',phase:'checking',detail:null});
 const key=[orgId,userId,conversationId,messageId].join(':');
 useEffect(()=>{
  let live=true;
  let current=0;
  const load=async()=>{
   const run=++current;
   try{
    const {data,error}=await requireClient().from('tasks')
      .select('id,organization_id,created_by,status,result,metadata')
      .eq('id',messageId).eq('organization_id',orgId).eq('created_by',userId).maybeSingle();
    if(!live||run!==current)return;
    if(error){setState({key,phase:'unavailable',detail:null});return;}
    if(!data){setState({key,phase:'missing',detail:null});return;}
    const checked=trustedJarvisTaskView(data,orgId,userId,conversationId,messageId);
    setState({key,phase:checked?'found':'unavailable',detail:checked});
   }catch{if(live&&run===current)setState({key,phase:'unavailable',detail:null});}
  };
  setState({key,phase:'checking',detail:null});
  void load();
  const interval=setInterval(()=>{if(typeof document==='undefined'||document.visibilityState!=='hidden')void load();},7000);
  return()=>{live=false;current++;clearInterval(interval);};
 },[key,orgId,userId,conversationId,messageId]);
 const effective=state.key===key?state:{key,phase:'checking' as const,detail:null};
 const label=effective.phase==='found'&&effective.detail
  ? text[effective.detail.status as keyof typeof text]??text.unavailable
  : effective.phase==='checking'?text.checking
    :effective.phase==='missing'?text.missing:text.unavailable;
 return <div role="status" aria-live="polite" className="fb-dim mt-2 text-xs" data-jarvis-task-receipt>
   {label}{' '}
   {effective.detail?.reportAvailable?text.report+' ':''}
   <Link to="/tasks" className="underline">{text.tasks}</Link>
 </div>;
}
