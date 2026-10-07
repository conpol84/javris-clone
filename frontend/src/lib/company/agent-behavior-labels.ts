import type { Lang } from '../../i18n/core';

type AgentBehaviorLabels = {
  title: string;
  help: string;
  placeholder: string;
  save: string;
  saved: string;
};

export const agentBehaviorLabels: Record<Lang, AgentBehaviorLabels> = {
  en: {
    title: 'Personal instructions & working style',
    help: 'These instructions change how this employee works, writes reports and communicates across Tasks, Chat and Meetings. They do not replace the employee’s core role or safety rules.',
    placeholder: 'Example: Be concise. Start reports with an executive summary. Prefer tables for comparisons. State uncertainty clearly. Avoid repeating the same point.',
    save: 'Save instructions',
    saved: 'Personal instructions saved.',
  },
  el: {
    title: 'Προσωπικές οδηγίες & τρόπος εργασίας',
    help: 'Αυτές οι οδηγίες αλλάζουν το πώς δουλεύει, γράφει αναφορές και επικοινωνεί ο συγκεκριμένος υπάλληλος σε Tasks, Chat και Meetings. Δεν αντικαθιστούν τον βασικό ρόλο ή τους κανόνες ασφαλείας.',
    placeholder: 'Παράδειγμα: Να είσαι σύντομος. Ξεκίνα τις αναφορές με executive summary. Χρησιμοποίησε πίνακες στις συγκρίσεις. Δήλωνε καθαρά την αβεβαιότητα. Μην επαναλαμβάνεις τα ίδια.',
    save: 'Αποθήκευση οδηγιών',
    saved: 'Οι προσωπικές οδηγίες αποθηκεύτηκαν.',
  },
  es: {
    title: 'Instrucciones personales y estilo de trabajo',
    help: 'Cambian cómo trabaja, redacta informes y se comunica este empleado en Tareas, Chat y Reuniones, sin sustituir su función principal ni las reglas de seguridad.',
    placeholder: 'Ejemplo: Sé conciso. Empieza los informes con un resumen ejecutivo. Usa tablas para comparar. Indica claramente la incertidumbre. Evita repetir puntos.',
    save: 'Guardar instrucciones',
    saved: 'Instrucciones personales guardadas.',
  },
  'pt-BR': {
    title: 'Instruções pessoais e estilo de trabalho',
    help: 'Mudam como este funcionário trabalha, escreve relatórios e se comunica em Tarefas, Chat e Reuniões, sem substituir sua função principal nem as regras de segurança.',
    placeholder: 'Exemplo: Seja conciso. Comece relatórios com um resumo executivo. Prefira tabelas para comparações. Indique incertezas claramente. Evite repetições.',
    save: 'Salvar instruções',
    saved: 'Instruções pessoais salvas.',
  },
  de: {
    title: 'Persönliche Anweisungen & Arbeitsstil',
    help: 'Diese Anweisungen ändern, wie dieser Mitarbeiter in Aufgaben, Chat und Meetings arbeitet, Berichte schreibt und kommuniziert. Kernrolle und Sicherheitsregeln bleiben bestehen.',
    placeholder: 'Beispiel: Sei prägnant. Beginne Berichte mit einer Executive Summary. Nutze Tabellen für Vergleiche. Kennzeichne Unsicherheit klar. Vermeide Wiederholungen.',
    save: 'Anweisungen speichern',
    saved: 'Persönliche Anweisungen gespeichert.',
  },
  fr: {
    title: 'Instructions personnelles et style de travail',
    help: 'Elles modifient la façon dont cet employé travaille, rédige ses rapports et communique dans Tâches, Chat et Réunions, sans remplacer son rôle principal ni les règles de sécurité.',
    placeholder: 'Exemple : soyez concis. Commencez les rapports par un résumé exécutif. Utilisez des tableaux pour les comparaisons. Signalez clairement les incertitudes. Évitez les répétitions.',
    save: 'Enregistrer les instructions',
    saved: 'Instructions personnelles enregistrées.',
  },
  'zh-CN': {
    title: '个人指令与工作风格',
    help: '这些指令会改变该员工在任务、聊天和会议中的工作、报告和沟通方式，但不会替代其核心职责或安全规则。',
    placeholder: '例如：保持简洁；报告先写执行摘要；比较时优先使用表格；明确说明不确定性；避免重复。',
    save: '保存指令',
    saved: '个人指令已保存。',
  },
  ar: {
    title: 'التعليمات الشخصية وأسلوب العمل',
    help: 'تغيّر هذه التعليمات طريقة عمل هذا الموظف وكتابة التقارير والتواصل في المهام والدردشة والاجتماعات، من دون استبدال دوره الأساسي أو قواعد السلامة.',
    placeholder: 'مثال: كن مختصرًا. ابدأ التقارير بملخص تنفيذي. استخدم الجداول للمقارنات. وضّح عدم اليقين. تجنب التكرار.',
    save: 'حفظ التعليمات',
    saved: 'تم حفظ التعليمات الشخصية.',
  },
};
