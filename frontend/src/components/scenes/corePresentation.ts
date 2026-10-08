import type { VoicePhase } from '../../lib/company/voiceActivity';

/** Presentation only: these settings never mutate microphone, jobs or policy. */
export function corePresentation(paused: boolean, reduced: boolean, lightweight: boolean) {
  return {
    static: paused || reduced,
    pointCount: lightweight ? 4000 : 16000,
    dpr: lightweight ? 1 : 1.75,
    bloom: !lightweight && !paused && !reduced,
  };
}

type Labels = { pause: string; resume: string; lightweight: string; scope: string; reduced: string; idle: string; error: string };
export const coreLabels: Record<string, Labels> = {
  en: { pause: 'Pause animation', resume: 'Resume animation', lightweight: 'Lightweight graphics', scope: 'Visual controls only. Microphone and tasks are unchanged.', reduced: 'Reduced motion is enabled on your device.', idle: 'Voice idle', error: 'Voice error' },
  el: { pause: 'Παύση κίνησης', resume: 'Συνέχιση κίνησης', lightweight: 'Ελαφριά γραφικά', scope: 'Μόνο οπτικοί έλεγχοι. Μικρόφωνο και εργασίες δεν αλλάζουν.', reduced: 'Η μειωμένη κίνηση είναι ενεργή στη συσκευή σου.', idle: 'Φωνή σε αναμονή', error: 'Σφάλμα φωνής' },
  es: { pause: 'Pausar animación', resume: 'Reanudar animación', lightweight: 'Gráficos ligeros', scope: 'Solo controles visuales. El micrófono y las tareas no cambian.', reduced: 'Tu dispositivo tiene activado el movimiento reducido.', idle: 'Voz en espera', error: 'Error de voz' },
  'pt-BR': { pause: 'Pausar animação', resume: 'Retomar animação', lightweight: 'Gráficos leves', scope: 'Apenas controles visuais. Microfone e tarefas não mudam.', reduced: 'Movimento reduzido está ativo no dispositivo.', idle: 'Voz em espera', error: 'Erro de voz' },
  fr: { pause: 'Suspendre l’animation', resume: 'Reprendre l’animation', lightweight: 'Graphismes légers', scope: 'Contrôles visuels uniquement. Microphone et tâches inchangés.', reduced: 'Les animations réduites sont activées sur votre appareil.', idle: 'Voix en attente', error: 'Erreur vocale' },
  de: { pause: 'Animation pausieren', resume: 'Animation fortsetzen', lightweight: 'Leichte Grafik', scope: 'Nur visuelle Steuerung. Mikrofon und Aufgaben bleiben unverändert.', reduced: 'Reduzierte Bewegung ist auf deinem Gerät aktiviert.', idle: 'Sprache im Leerlauf', error: 'Sprachfehler' },
  'zh-CN': { pause: '暂停动画', resume: '恢复动画', lightweight: '轻量图形', scope: '仅控制视觉效果。麦克风和任务保持不变。', reduced: '设备已启用减少动态效果。', idle: '语音待机', error: '语音错误' },
  ar: { pause: 'إيقاف الحركة مؤقتًا', resume: 'استئناف الحركة', lightweight: 'رسومات خفيفة', scope: 'عناصر تحكم مرئية فقط. لا يتغير الميكروفون أو المهام.', reduced: 'تقليل الحركة مفعّل على جهازك.', idle: 'الصوت في وضع الانتظار', error: 'خطأ صوتي' },
};

export function coreVoiceLabel(phase: VoicePhase, labels: Labels, voice: Record<string, string>): string {
  if (phase === 'idle') return labels.idle;
  if (phase === 'error') return labels.error;
  return voice[phase] ?? labels.idle;
}
