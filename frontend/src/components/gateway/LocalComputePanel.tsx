import { useEffect, useRef, useState } from 'react';
import { Cpu, Download, RefreshCw, Square } from 'lucide-react';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { companyClient } from '../../lib/company/client';
import { getBase } from '../../lib/gateway-api';
import { useI18n } from '../../i18n/I18nProvider';

const WORDS = {
 en: ['Local AI · Ollama','Private, small-model text pilot. No paid fallback. Hosting still costs money.','Check connection','Ready for a local test','The local engine is not installed, not ready, or your account cannot access it.','Short request','Generate locally','Generating locally…','Stop waiting','Download draft','This stops waiting for the reply; it does not certify that server computation stopped.','Local draft only — no browser, device or external action was executed.','Request failed or was stopped. Nothing was sent to a paid fallback.'],
 el: ['Τοπικό AI · Ollama','Ιδιωτική δοκιμή μικρού μοντέλου. Χωρίς πληρωμένο fallback. Η φιλοξενία εξακολουθεί να κοστίζει.','Έλεγχος σύνδεσης','Έτοιμο για τοπική δοκιμή','Το τοπικό μοντέλο δεν εγκαταστάθηκε, δεν είναι έτοιμο ή ο λογαριασμός δεν έχει πρόσβαση.','Σύντομο αίτημα','Τοπική παραγωγή','Τοπική παραγωγή…','Διακοπή αναμονής','Λήψη προσχεδίου','Σταματά η αναμονή της απάντησης· δεν πιστοποιείται διακοπή υπολογισμού στον server.','Μόνο τοπικό προσχέδιο — δεν έγινε ενέργεια σε browser, συσκευή ή εξωτερική υπηρεσία.','Το αίτημα απέτυχε ή σταμάτησε. Δεν χρησιμοποιήθηκε πληρωμένη εναλλακτική.'],
 es: ['IA local · Ollama','Prueba privada de texto con un modelo pequeño. Sin alternativa de pago. El alojamiento tiene coste.','Comprobar conexión','Listo para una prueba local','El motor local no está instalado, no está listo o no tienes acceso.','Solicitud breve','Generar localmente','Generando localmente…','Dejar de esperar','Descargar borrador','Deja de esperar la respuesta; no confirma que el cálculo del servidor se haya detenido.','Solo un borrador local: no se ejecutaron acciones externas ni en dispositivos.','La solicitud falló o se detuvo. No se utilizó una alternativa de pago.'],
 fr: ['IA locale · Ollama','Test privé de texte avec un petit modèle. Aucun recours payant. L’hébergement reste payant.','Vérifier la connexion','Prêt pour un test local','Le moteur local est absent, indisponible ou votre compte n’a pas accès.','Demande courte','Générer localement','Génération locale…','Arrêter l’attente','Télécharger le brouillon','Ceci arrête l’attente, sans certifier l’arrêt du calcul sur le serveur.','Brouillon local uniquement : aucune action externe ou sur un appareil.','La demande a échoué ou a été arrêtée. Aucun recours payant.'],
 de: ['Lokale KI · Ollama','Privater Texttest mit kleinem Modell. Kein kostenpflichtiger Ersatz. Hosting verursacht weiterhin Kosten.','Verbindung prüfen','Bereit für einen lokalen Test','Die lokale Engine fehlt, ist nicht bereit oder dein Konto hat keinen Zugriff.','Kurze Anfrage','Lokal generieren','Lokale Generierung…','Warten beenden','Entwurf herunterladen','Beendet das Warten, bestätigt aber keinen Stopp der Serverberechnung.','Nur lokaler Entwurf: keine Browser-, Geräte- oder externe Aktion.','Anfrage fehlgeschlagen oder gestoppt. Kein kostenpflichtiger Ersatz verwendet.'],
 'pt-BR': ['IA local · Ollama','Teste privado de texto com modelo pequeno. Sem alternativa paga. A hospedagem ainda tem custo.','Verificar conexão','Pronto para teste local','O mecanismo local não está instalado, pronto ou sua conta não tem acesso.','Pedido curto','Gerar localmente','Gerando localmente…','Parar de esperar','Baixar rascunho','Interrompe a espera, sem confirmar que o cálculo no servidor parou.','Apenas rascunho local: nenhuma ação externa ou em dispositivos foi executada.','O pedido falhou ou foi interrompido. Nenhuma alternativa paga foi usada.'],
 'zh-CN': ['本地 AI · Ollama','小模型私有文本测试。不使用付费备用服务，托管仍有成本。','检查连接','可以开始本地测试','本地引擎尚未安装、未就绪或账户没有权限。','简短请求','本地生成','正在本地生成…','停止等待','下载草稿','停止等待回复，不代表服务器计算已经停止。','仅生成本地草稿，没有执行浏览器、设备或外部操作。','请求失败或已停止，没有使用付费备用服务。'],
 ar: ['ذكاء محلي · Ollama','اختبار نصي خاص بنموذج صغير. بلا بديل مدفوع. تبقى للاستضافة تكلفة.','فحص الاتصال','جاهز للاختبار المحلي','المحرك غير مثبت أو غير جاهز أو لا يملك حسابك صلاحية.','طلب قصير','إنشاء محلي','جارٍ الإنشاء محليًا…','إيقاف الانتظار','تنزيل المسودة','يوقف انتظار الرد ولا يؤكد توقف الحساب على الخادم.','مسودة محلية فقط؛ لم تُنفّذ إجراءات خارجية أو على الأجهزة.','فشل الطلب أو توقف. لم يُستخدم بديل مدفوع.'],
};
export async function localJson(path: string, token: string, signal: AbortSignal, body?: unknown): Promise<any> {
  if (!['/v1/firbo/free/status','/v1/firbo/free/chat/completions'].includes(path)) throw new Error('invalid_path');
  const res = await fetch(getBase()+path,{method:body?'POST':'GET',redirect:'error',signal,headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error('local_unavailable');
  const reader=res.body?.getReader(); if(!reader)throw new Error('invalid_response');
  const chunks:Uint8Array[]=[];let length=0;
  try {while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>128000)throw new Error('response_too_large');chunks.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function LocalComputePanel(){
  const {current,user}=useCompanyAuth();
  return <LocalPanel key={`${user?.id}:${current?.organization.id}:${current?.role}`} org={current?.organization.id??''}/>;
}
function LocalPanel({org}:{org:string}){
  const {lang}=useI18n(); const l=WORDS[lang as keyof typeof WORDS]??WORDS.en;
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[checked,setChecked]=useState(false),[error,setError]=useState(false);
  const [text,setText]=useState(''),[answer,setAnswer]=useState(''); const active=useRef<AbortController|null>(null),seq=useRef(0);
  useEffect(()=>()=>{seq.current++;active.current?.abort();},[]);
  async function request(run:boolean){
    const id=++seq.current;active.current?.abort();const control=new AbortController();active.current=control;
    const timer=setTimeout(()=>control.abort(),90000);setBusy(true);setError(false);if(run)setAnswer('');
    try{
      const session=companyClient?(await companyClient.auth.getSession()).data.session:null;
      if(!session||control.signal.aborted)throw new Error('sign_in_required');
      const rid=crypto.randomUUID();
      const data=await localJson(run?'/v1/firbo/free/chat/completions':'/v1/firbo/free/status',session.access_token,control.signal,
        run?{organization_id:org,request_id:rid,messages:[{role:'user',content:text.trim()}]}:undefined);
      if(id!==seq.current||control.signal.aborted)return;
      if(!run){setChecked(true);setReady(data.contract==='firbo-local-status/v1'&&data.ready===true&&data.policy==='no-paid-fallback');}
      else{
        if(data?.firbo?.contract!=='firbo-free-text/v1'||data.firbo.request_id!==rid||data.firbo.policy!=='no-paid-fallback'||data.firbo.provider_fee_usd!==0||data.model!=='ollama:qwen3:1.7b'||typeof data.choices?.[0]?.message?.content!=='string')throw new Error('unverified_response');
        setAnswer(data.choices[0].message.content);
      }
    }catch{if(id===seq.current){setError(true);if(!run){setReady(false);setChecked(true);}}}
    finally{clearTimeout(timer);if(id===seq.current)setBusy(false);}
  }
  function stop(){seq.current++;active.current?.abort();setBusy(false);setError(true);}
  function download(){const url=URL.createObjectURL(new Blob([`# Firbo local draft\n\n${answer}\n\n---\nModel: ollama:qwen3:1.7b. No paid fallback. Human review required.\n`],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='firbo-local-draft.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <section className="fb-glass min-w-0 space-y-3 p-4 [overflow-wrap:anywhere]" data-testid="local-compute-panel">
    <header className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-semibold"><Cpu size={20}/>{l[0]}</h2><button type="button" className="fb-btn fb-btn--ghost min-h-11 whitespace-normal" disabled={busy} onClick={()=>void request(false)}><RefreshCw size={15}/>{l[2]}</button></header>
    <p className="fb-muted text-sm">{l[1]}</p>
    {checked&&<p role="status" className="text-sm">{ready?l[3]:l[4]}</p>}
    {ready&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();if(text.trim()&&!busy)void request(true);}}>
      <label className="block text-sm">{l[5]}<textarea className="fb-input mt-2 min-h-24 w-full min-w-0 !whitespace-pre-wrap text-base" value={text} maxLength={600} onChange={e=>setText(e.target.value)} disabled={busy}/></label>
      <div className="flex flex-wrap gap-2"><button className="fb-btn fb-btn--primary min-h-11 whitespace-normal" disabled={busy||!text.trim()||!org}>{busy?l[7]:l[6]}</button>{busy&&<button type="button" className="fb-btn min-h-11" onClick={stop}><Square size={14}/>{l[8]}</button>}</div>
    </form>}
    {busy&&<p className="fb-dim text-xs">{l[10]}</p>}
    {error&&<p role="alert" className="text-sm">{l[12]}</p>}
    {answer&&<div className="space-y-3"><p className="whitespace-pre-wrap text-sm">{answer}</p><p className="fb-dim text-xs">{l[11]}</p><button type="button" className="fb-btn min-h-11 whitespace-normal" onClick={download}><Download size={15}/>{l[9]}</button></div>}
  </section>;
}
