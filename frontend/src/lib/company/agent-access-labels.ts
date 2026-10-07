import type { Lang } from '../../i18n/core';

type AgentAccessLabels = {
  control: string;
  guarded: string;
  full: string;
  fullHelp: string;
  localFull: string;
  takeControl: string;
  takeControlHelp: string;
  takeControlConfirm: string;
  takeControlDone: string;
};

export const agentAccessLabels: Record<Lang, AgentAccessLabels> = {
  en: {
    control: 'Control mode',
    guarded: 'Guarded — use Inbox approvals for higher-risk steps',
    full: 'Full Control — owner-authorized hands-free work on this Mac',
    fullHelp: 'Full Control removes duplicate Firbo approvals for owner-allowed file, app and browser work. Passwords, banking, keychain/system settings and destructive commands remain blocked.',
    localFull: 'Enable the matching local Full Control mode on this Mac, then restart the Connector:',
    takeControl: 'Take Control / Emergency Stop',
    takeControlHelp: 'Stops new AI work on this computer, cancels queued jobs and requests Stop for anything already running. You remain able to use Computer Manager manually.',
    takeControlConfirm: 'Take control of this computer now? New AI work will be disabled and current AI jobs will be stopped.',
    takeControlDone: 'You have control. AI access is off for this computer.',
  },
  el: {
    control: 'Λειτουργία ελέγχου',
    guarded: 'Προστατευμένη — Inbox approval για πιο ριψοκίνδυνα βήματα',
    full: 'Full Control — owner-authorized αυτόνομη εργασία σε αυτόν τον Mac',
    fullHelp: 'Το Full Control αφαιρεί τα διπλά FIRBO approvals για αρχεία, εφαρμογές και browser που έχει επιτρέψει ο owner. Κωδικοί, τράπεζες, Keychain/ρυθμίσεις συστήματος και καταστροφικές εντολές παραμένουν μπλοκαρισμένα.',
    localFull: 'Ενεργοποίησε και το αντίστοιχο τοπικό Full Control σε αυτόν τον Mac και μετά ξανατρέξε τον Connector:',
    takeControl: 'Take Control / Επείγον Stop',
    takeControlHelp: 'Σταματά νέα δουλειά AI σε αυτόν τον υπολογιστή, ακυρώνει ό,τι περιμένει και ζητά Stop για ό,τι ήδη τρέχει. Εσύ συνεχίζεις να χρησιμοποιείς χειροκίνητα το Computer Manager.',
    takeControlConfirm: 'Να πάρεις τώρα τον έλεγχο αυτού του υπολογιστή; Η νέα δουλειά AI θα απενεργοποιηθεί και οι τρέχουσες εργασίες AI θα σταματήσουν.',
    takeControlDone: 'Έχεις τον έλεγχο. Η πρόσβαση AI σε αυτόν τον υπολογιστή είναι κλειστή.',
  },
  es: {
    control: 'Modo de control',
    guarded: 'Protegido — aprobaciones en Inbox para pasos de mayor riesgo',
    full: 'Control total — trabajo autónomo autorizado por el propietario en este Mac',
    fullHelp: 'El Control total elimina aprobaciones duplicadas de Firbo para archivos, apps y navegador permitidos por el propietario. Contraseñas, banca, llavero/ajustes del sistema y comandos destructivos siguen bloqueados.',
    localFull: 'Activa también el Control total local en este Mac y reinicia el Connector:',
    takeControl: 'Tomar control / Parada de emergencia',
    takeControlHelp: 'Detiene nuevo trabajo de IA, cancela lo que está en cola y solicita detener lo que ya se ejecuta. Tú puedes seguir usando Computer Manager manualmente.',
    takeControlConfirm: '¿Tomar el control de este equipo ahora? Se desactivará el nuevo trabajo de IA y se detendrán los trabajos actuales.',
    takeControlDone: 'Tienes el control. El acceso de IA está desactivado para este equipo.',
  },
  'pt-BR': {
    control: 'Modo de controle',
    guarded: 'Protegido — aprovações no Inbox para passos de maior risco',
    full: 'Controle total — trabalho autônomo autorizado pelo proprietário neste Mac',
    fullHelp: 'O Controle total remove aprovações duplicadas do Firbo para arquivos, apps e navegador permitidos pelo proprietário. Senhas, banco, chaveiro/ajustes do sistema e comandos destrutivos continuam bloqueados.',
    localFull: 'Ative também o Controle total local neste Mac e reinicie o Connector:',
    takeControl: 'Assumir controle / Parada de emergência',
    takeControlHelp: 'Interrompe novos trabalhos de IA, cancela a fila e solicita parada do que já está em execução. Você continua podendo usar o Computer Manager manualmente.',
    takeControlConfirm: 'Assumir o controle deste computador agora? Novos trabalhos de IA serão desativados e os atuais serão interrompidos.',
    takeControlDone: 'Você está no controle. O acesso de IA está desativado neste computador.',
  },
  de: {
    control: 'Steuerungsmodus',
    guarded: 'Geschützt — Inbox-Freigaben für riskantere Schritte',
    full: 'Vollzugriff — vom Eigentümer autorisierte automatische Arbeit auf diesem Mac',
    fullHelp: 'Vollzugriff entfernt doppelte Firbo-Freigaben für vom Eigentümer erlaubte Datei-, App- und Browserarbeit. Passwörter, Banking, Schlüsselbund/Systemeinstellungen und destruktive Befehle bleiben gesperrt.',
    localFull: 'Aktiviere auch den lokalen Vollzugriff auf diesem Mac und starte den Connector neu:',
    takeControl: 'Kontrolle übernehmen / Not-Stopp',
    takeControlHelp: 'Stoppt neue KI-Arbeit, bricht wartende Aufträge ab und fordert den Stopp laufender Arbeit an. Du kannst den Computer Manager weiterhin manuell verwenden.',
    takeControlConfirm: 'Jetzt die Kontrolle über diesen Computer übernehmen? Neue KI-Arbeit wird deaktiviert und laufende KI-Aufträge werden gestoppt.',
    takeControlDone: 'Du hast die Kontrolle. KI-Zugriff ist für diesen Computer deaktiviert.',
  },
  fr: {
    control: 'Mode de contrôle',
    guarded: 'Protégé — validations Inbox pour les étapes plus risquées',
    full: 'Contrôle total — travail autonome autorisé par le propriétaire sur ce Mac',
    fullHelp: 'Le Contrôle total supprime les validations Firbo en double pour les fichiers, apps et le navigateur autorisés par le propriétaire. Mots de passe, banque, trousseau/réglages système et commandes destructives restent bloqués.',
    localFull: 'Activez aussi le Contrôle total local sur ce Mac puis redémarrez le Connector :',
    takeControl: 'Prendre le contrôle / Arrêt d’urgence',
    takeControlHelp: 'Bloque tout nouveau travail IA, annule la file et demande l’arrêt des tâches déjà en cours. Vous pouvez toujours utiliser Computer Manager manuellement.',
    takeControlConfirm: 'Prendre le contrôle de cet ordinateur maintenant ? Le nouveau travail IA sera désactivé et les tâches IA en cours seront arrêtées.',
    takeControlDone: 'Vous avez le contrôle. L’accès IA est désactivé pour cet ordinateur.',
  },
  'zh-CN': {
    control: '控制模式',
    guarded: '受保护 — 高风险步骤需在 Inbox 中批准',
    full: '完全控制 — 由所有者授权在此 Mac 上自动执行工作',
    fullHelp: '完全控制会移除对所有者已允许的文件、应用和浏览器操作的重复 Firbo 审批。密码、银行、钥匙串/系统设置和破坏性命令仍然禁止。',
    localFull: '同时在此 Mac 上启用本地完全控制，然后重新启动 Connector：',
    takeControl: '接管控制 / 紧急停止',
    takeControlHelp: '停止新的 AI 工作、取消排队任务，并请求停止正在运行的任务。你仍可手动使用 Computer Manager。',
    takeControlConfirm: '现在接管此计算机吗？新的 AI 工作将被禁用，当前 AI 任务将停止。',
    takeControlDone: '你已接管控制。此计算机的 AI 访问已关闭。',
  },
  ar: {
    control: 'وضع التحكم',
    guarded: 'محمي — موافقات Inbox للخطوات الأعلى خطورة',
    full: 'تحكم كامل — عمل تلقائي مصرح به من المالك على هذا الـ Mac',
    fullHelp: 'يزيل التحكم الكامل موافقات Firbo المكررة لأعمال الملفات والتطبيقات والمتصفح التي سمح بها المالك. تظل كلمات المرور والخدمات المصرفية وKeychain/إعدادات النظام والأوامر التدميرية محظورة.',
    localFull: 'فعّل أيضًا التحكم الكامل المحلي على هذا الـ Mac ثم أعد تشغيل Connector:',
    takeControl: 'استلام التحكم / إيقاف طارئ',
    takeControlHelp: 'يوقف أي عمل جديد للذكاء الاصطناعي ويلغي المهام المنتظرة ويطلب إيقاف المهام الجارية. يمكنك الاستمرار في استخدام Computer Manager يدويًا.',
    takeControlConfirm: 'هل تريد استلام التحكم بهذا الكمبيوتر الآن؟ سيتم تعطيل أعمال الذكاء الاصطناعي الجديدة وإيقاف المهام الجارية.',
    takeControlDone: 'أنت الآن المتحكم. تم تعطيل وصول الذكاء الاصطناعي لهذا الكمبيوتر.',
  },
};
