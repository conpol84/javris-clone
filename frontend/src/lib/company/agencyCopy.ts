import type { Lang } from '../../i18n/core';

const en = {
  "method": "Specialist working method",
  "source": "Adapted from Agency Agents · MIT",
  "scope": "Works with this employee’s enabled tools and company permissions.",
  "research": "Research report with primary sources, conflicting evidence, confidence and next steps.",
  "developer": "Scoped code change or patch, verification results and remaining risks.",
  "qa": "Requirement-by-requirement checks with evidence and explicit untested areas.",
  "operations": "Incident or release runbook with health checks, rollback and observed results.",
  "content": "Channel-specific drafts with verified claims, company voice and an editorial plan."
};
export type AgencyCopy = Record<keyof typeof en, string>;
export const AGENCY_COPY: Record<Lang, AgencyCopy> = {
  "en": {
    "method": "Specialist working method",
    "source": "Adapted from Agency Agents · MIT",
    "scope": "Works with this employee’s enabled tools and company permissions.",
    "research": "Research report with primary sources, conflicting evidence, confidence and next steps.",
    "developer": "Scoped code change or patch, verification results and remaining risks.",
    "qa": "Requirement-by-requirement checks with evidence and explicit untested areas.",
    "operations": "Incident or release runbook with health checks, rollback and observed results.",
    "content": "Channel-specific drafts with verified claims, company voice and an editorial plan."
  },
  "el": {
    "method": "Μέθοδος εργασίας ειδικού",
    "source": "Προσαρμογή από Agency Agents · MIT",
    "scope": "Χρησιμοποιεί τα ενεργά εργαλεία και τα εταιρικά δικαιώματα αυτού του υπαλλήλου.",
    "research": "Έρευνα με πρωτογενείς πηγές, αντικρουόμενα στοιχεία, βαθμό βεβαιότητας και επόμενα βήματα.",
    "developer": "Στοχευμένη αλλαγή κώδικα ή patch, αποτελέσματα ελέγχων και εκκρεμείς κίνδυνοι.",
    "qa": "Έλεγχος ανά απαίτηση με αποδείξεις και σαφή αναφορά όσων δεν δοκιμάστηκαν.",
    "operations": "Οδηγός αντιμετώπισης συμβάντος ή έκδοσης, με ελέγχους λειτουργίας, επαναφορά και πραγματικά αποτελέσματα.",
    "content": "Κείμενα ανά κανάλι, με επαληθευμένα στοιχεία, εταιρικό ύφος και πλάνο περιεχομένου."
  },
  "es": {
    "method": "Método de trabajo especializado",
    "source": "Adaptado de Agency Agents · MIT",
    "scope": "Utiliza las herramientas habilitadas y los permisos de empresa de este empleado.",
    "research": "Informe con fuentes primarias, pruebas contradictorias, confianza y próximos pasos.",
    "developer": "Cambio de código o parche acotado, resultados de verificación y riesgos pendientes.",
    "qa": "Comprobaciones por requisito con pruebas y áreas no verificadas explícitas.",
    "operations": "Guía de incidentes o lanzamientos con comprobaciones, reversión y resultados observados.",
    "content": "Borradores por canal con datos verificados, voz de marca y plan editorial."
  },
  "pt-BR": {
    "method": "Método de trabalho especializado",
    "source": "Adaptado de Agency Agents · MIT",
    "scope": "Usa as ferramentas habilitadas e as permissões da empresa deste funcionário.",
    "research": "Relatório com fontes primárias, evidências conflitantes, confiança e próximos passos.",
    "developer": "Alteração de código ou patch delimitado, resultados dos testes e riscos restantes.",
    "qa": "Verificações por requisito com evidências e áreas não testadas explícitas.",
    "operations": "Roteiro de incidentes ou releases com verificações, reversão e resultados observados.",
    "content": "Rascunhos por canal com fatos verificados, voz da empresa e plano editorial."
  },
  "de": {
    "method": "Spezialisierte Arbeitsweise",
    "source": "Adaptiert von Agency Agents · MIT",
    "scope": "Nutzt die freigeschalteten Werkzeuge und Unternehmensrechte dieses Mitarbeiters.",
    "research": "Recherchebericht mit Primärquellen, widersprüchlichen Belegen, Sicherheit der Aussagen und nächsten Schritten.",
    "developer": "Gezielte Codeänderung oder Patch, Prüfergebnisse und verbleibende Risiken.",
    "qa": "Prüfung jeder Anforderung mit Belegen und klar benannten ungeprüften Bereichen.",
    "operations": "Leitfaden für Vorfälle oder Releases mit Zustandsprüfungen, Rücknahme und beobachteten Ergebnissen.",
    "content": "Kanalspezifische Entwürfe mit geprüften Fakten, Unternehmenssprache und Redaktionsplan."
  },
  "fr": {
    "method": "Méthode de travail spécialisée",
    "source": "Adapté d’Agency Agents · MIT",
    "scope": "Utilise les outils activés et les autorisations d’entreprise de cet employé.",
    "research": "Rapport avec sources primaires, éléments contradictoires, niveau de confiance et prochaines étapes.",
    "developer": "Modification ciblée ou correctif, résultats de vérification et risques restants.",
    "qa": "Vérification de chaque exigence avec preuves et zones non testées explicites.",
    "operations": "Procédure d’incident ou de livraison avec contrôles, retour arrière et résultats observés.",
    "content": "Brouillons par canal avec faits vérifiés, ton de l’entreprise et calendrier éditorial."
  },
  "zh-CN": {
    "method": "专业工作方法",
    "source": "改编自 Agency Agents · MIT",
    "scope": "使用该员工已启用的工具和公司权限。",
    "research": "包含一手来源、矛盾证据、可信程度和后续步骤的研究报告。",
    "developer": "范围明确的代码变更或补丁、验证结果及剩余风险。",
    "qa": "逐项需求检查，附带证据并明确标注未测试的范围。",
    "operations": "包含健康检查、回滚和实际观察结果的事件处理或发布指南。",
    "content": "针对各渠道的草稿，包含已核实的事实、公司风格和内容计划。"
  },
  "ar": {
    "method": "منهج العمل المتخصص",
    "source": "مقتبس من Agency Agents · MIT",
    "scope": "يستخدم الأدوات المفعّلة وصلاحيات الشركة الخاصة بهذا الموظف.",
    "research": "تقرير بحث بمصادر أولية وأدلة متعارضة ومستوى ثقة وخطوات تالية.",
    "developer": "تعديل محدد للكود أو تصحيح مع نتائج التحقق والمخاطر المتبقية.",
    "qa": "فحص لكل متطلب مع الأدلة وتحديد صريح للنطاق الذي لم يُختبر.",
    "operations": "دليل للحوادث أو الإصدارات مع فحوصات التشغيل والتراجع والنتائج المرصودة.",
    "content": "مسودات مخصصة لكل قناة مع حقائق موثقة وأسلوب الشركة وخطة تحريرية."
  }
};

export const AGENCY_DELIVERABLE = {
  'deep-research': 'research',
  'autonomous-coder': 'developer',
  'qa-engineer': 'qa',
  'devops-engineer': 'operations',
  'content-writer': 'content',
} as const;

