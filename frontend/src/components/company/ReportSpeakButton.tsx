import { useId } from 'react';
import { Square, Volume2 } from 'lucide-react';
import { useTts } from '../../hooks/useTts';
import { useI18n } from '../../i18n/I18nProvider';

const labels: Record<string,{read:string;stop:string;unavailable:string}> = {
  en:{read:'Read report aloud',stop:'Stop reading',unavailable:'Voice output is unavailable'},
  el:{read:'Ανάγνωση αναφοράς',stop:'Διακοπή ανάγνωσης',unavailable:'Η φωνητική έξοδος δεν είναι διαθέσιμη'},
  es:{read:'Leer informe en voz alta',stop:'Detener lectura',unavailable:'La salida de voz no está disponible'},
  'pt-BR':{read:'Ler relatório em voz alta',stop:'Parar leitura',unavailable:'A saída de voz não está disponível'},
  de:{read:'Bericht vorlesen',stop:'Vorlesen stoppen',unavailable:'Sprachausgabe ist nicht verfügbar'},
  fr:{read:'Lire le rapport à voix haute',stop:'Arrêter la lecture',unavailable:'La sortie vocale est indisponible'},
  'zh-CN':{read:'朗读报告',stop:'停止朗读',unavailable:'语音输出不可用'},
  ar:{read:'قراءة التقرير بصوت عالٍ',stop:'إيقاف القراءة',unavailable:'الإخراج الصوتي غير متاح'},
};

export function reportSpeechText(markdown:string):string {
  return markdown
    .replace(/https?:\/\/\S+/g,' ')
    .replace(/```[\s\S]*?```/g,' ')
    .replace(/[`*_>#|~-]+/g,' ')
    .replace(/\[(.*?)\]\([^)]*\)/g,'$1')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,12000);
}

/** Explicit read-aloud for completed work products. It uses the app-wide TTS
 * resource, so starting a report stops any other Firbo utterance. */
export function ReportSpeakButton({report}:{report:string}) {
  const {lang}=useI18n();
  const l=labels[lang]??labels.en;
  const id=useId();
  const {speak,stop,speakingId,state,available}=useTts();
  const speech=reportSpeechText(report);
  const mine=speakingId===id;
  const busy=mine&&(state==='loading'||state==='speaking');
  return <button
    type="button"
    className="fb-btn fb-btn--ghost self-start"
    disabled={!speech||(!available&&!busy)}
    title={!available&&!busy?l.unavailable:busy?l.stop:l.read}
    aria-label={busy?l.stop:l.read}
    onClick={()=>busy?stop():void speak(id,speech)}
  >
    {busy?<Square size={14}/>:<Volume2 size={14}/>}
    {busy?l.stop:l.read}
  </button>;
}
