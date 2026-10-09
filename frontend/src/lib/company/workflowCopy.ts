import type { Lang } from '../../i18n/core';

export const WORKFLOW_MESSAGES = {
  en: { load: 'Workflows could not be loaded. Refresh and try again.', retry: 'Retry', conflict: 'This workflow changed. Refresh before saving again.', running: 'This workflow is running. Wait for it to finish before changing or deleting it.', invalid: 'Check the workflow name, steps and schedule.', failed: 'The change could not be confirmed. Refresh and try again.' },
  el: { load: 'Δεν φορτώθηκαν οι ροές. Ανανεώστε και δοκιμάστε ξανά.', retry: 'Δοκιμή ξανά', conflict: 'Η ροή άλλαξε. Ανανεώστε πριν αποθηκεύσετε ξανά.', running: 'Η ροή εκτελείται. Περιμένετε να ολοκληρωθεί πριν την αλλάξετε ή τη διαγράψετε.', invalid: 'Ελέγξτε το όνομα, τα βήματα και το πρόγραμμα της ροής.', failed: 'Η αλλαγή δεν επιβεβαιώθηκε. Ανανεώστε και δοκιμάστε ξανά.' },
  es: { load: 'No se pudieron cargar los flujos. Actualiza e inténtalo de nuevo.', retry: 'Reintentar', conflict: 'Este flujo cambió. Actualiza antes de guardar de nuevo.', running: 'Este flujo se está ejecutando. Espera a que termine antes de cambiarlo o eliminarlo.', invalid: 'Revisa el nombre, los pasos y la programación del flujo.', failed: 'No se pudo confirmar el cambio. Actualiza e inténtalo de nuevo.' },
  'pt-BR': { load: 'Não foi possível carregar os fluxos. Atualize e tente novamente.', retry: 'Tentar novamente', conflict: 'Este fluxo mudou. Atualize antes de salvar novamente.', running: 'Este fluxo está em execução. Aguarde a conclusão antes de alterar ou excluir.', invalid: 'Confira o nome, as etapas e o agendamento do fluxo.', failed: 'Não foi possível confirmar a alteração. Atualize e tente novamente.' },
  de: { load: 'Workflows konnten nicht geladen werden. Aktualisieren und erneut versuchen.', retry: 'Erneut versuchen', conflict: 'Dieser Workflow wurde geändert. Vor dem Speichern aktualisieren.', running: 'Dieser Workflow läuft. Vor dem Ändern oder Löschen auf den Abschluss warten.', invalid: 'Name, Schritte und Zeitplan des Workflows prüfen.', failed: 'Die Änderung wurde nicht bestätigt. Aktualisieren und erneut versuchen.' },
  fr: { load: 'Impossible de charger les workflows. Actualisez et réessayez.', retry: 'Réessayer', conflict: 'Ce workflow a changé. Actualisez avant de sauvegarder à nouveau.', running: 'Ce workflow est en cours. Attendez sa fin avant de le modifier ou le supprimer.', invalid: 'Vérifiez le nom, les étapes et la planification du workflow.', failed: 'La modification n’a pas été confirmée. Actualisez et réessayez.' },
  'zh-CN': { load: '无法加载工作流，请刷新后重试。', retry: '重试', conflict: '此工作流已更改，请刷新后再次保存。', running: '此工作流正在运行，请等待完成后再修改或删除。', invalid: '请检查工作流名称、步骤和计划。', failed: '无法确认更改，请刷新后重试。' },
  ar: { load: 'تعذر تحميل سير العمل. حدّث الصفحة وحاول مجددًا.', retry: 'إعادة المحاولة', conflict: 'تغيّر سير العمل. حدّث الصفحة قبل الحفظ مجددًا.', running: 'سير العمل قيد التنفيذ. انتظر اكتماله قبل التعديل أو الحذف.', invalid: 'تحقق من الاسم والخطوات والجدول الزمني.', failed: 'تعذر تأكيد التغيير. حدّث الصفحة وحاول مجددًا.' },
} satisfies Record<Lang, { load: string; retry: string; conflict: string; running: string; invalid: string; failed: string }>;

export function workflowFailure(lang: Lang, error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  const copy = WORKFLOW_MESSAGES[lang];
  return text.includes('workflow_conflict') ? copy.conflict : text.includes('workflow_running') ? copy.running
    : text.includes('workflow_invalid') || text.includes('workflow_agent_unavailable') ? copy.invalid : copy.failed;
}
