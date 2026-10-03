import { useSyncExternalStore } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { defaultVoiceProfile, getVoiceProfile, setVoiceProfile, subscribeVoiceProfile, type VoiceProfile } from '../../lib/company/voiceProfile';
const copy: Record<string, [string,string,string]> = {
  en:['Voice style','Natural','AI-generated voice · applies to the next reply'],
  el:['Ύφος φωνής','Φυσική','Φωνή AI · εφαρμόζεται στην επόμενη απάντηση'],
  es:['Estilo de voz','Natural','Voz generada por IA · se aplica a la próxima respuesta'],
  'pt-BR':['Estilo de voz','Natural','Voz gerada por IA · aplicada à próxima resposta'],
  fr:['Style de voix','Naturelle','Voix générée par IA · appliquée à la prochaine réponse'],
  de:['Stimmstil','Natürlich','KI-generierte Stimme · gilt ab der nächsten Antwort'],
  ar:['نمط الصوت','طبيعي','صوت مولد بالذكاء الاصطناعي · يطبق على الرد التالي'],
  'zh-CN':['声音风格','自然','AI 合成语音 · 从下一条回复生效'],
};
export function VoiceProfileControl() {
  const { lang } = useI18n();
  const value = useSyncExternalStore(subscribeVoiceProfile, getVoiceProfile, defaultVoiceProfile);
  const [label,natural,disclosure] = copy[lang] ?? copy.en;
  return <div data-testid="voice-profile-control" className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
    <label className="flex min-w-0 max-w-full flex-wrap items-center gap-2"><span className="fb-dim">{label}</span>
      <select className="fb-input" value={value} onChange={e=>setVoiceProfile(e.target.value as VoiceProfile)} style={{minHeight:44,maxWidth:'100%',width:'auto',fontSize:16}}>
        <option value="firbo-dark-v1">Firbo Dark</option><option value="natural-v1">{natural}</option>
      </select>
    </label>
    <small className="fb-dim" style={{overflowWrap:'anywhere'}}>{disclosure}</small>
  </div>;
}
