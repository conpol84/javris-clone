import type { Lang } from '../../i18n/core';

type AgentAccessLabels = {
  control: string;
  guarded: string;
  full: string;
  fullHelp: string;
  localFull: string;
};

export const agentAccessLabels: Record<Lang, AgentAccessLabels> = {
  en: {
    control: 'Control mode',
    guarded: 'Guarded — use Inbox approvals for higher-risk steps',
    full: 'Full Control — owner-authorized hands-free work on this Mac',
    fullHelp: 'Full Control removes duplicate Firbo approvals for owner-allowed file, app and browser work. Passwords, banking, keychain/system settings and destructive commands remain blocked.',
    localFull: 'Enable the matching local Full Control mode on this Mac, then restart the Connector:',
  },
  el: {
    control: 'Λειτουργία ελέγχου',
    guarded: 'Προστατευμένη — Inbox approval για πιο ριψοκίνδυνα βήματα',
    full: 'Full Control — owner-authorized αυτόνομη εργασία σε αυτόν τον Mac',
    fullHelp: 'Το Full Control αφαιρεί τα διπλά FIRBO approvals για αρχεία, εφαρμογές και browser που έχει επιτρέψει ο owner. Κωδικοί, τράπεζες, Keychain/ρυθμίσεις συστήματος και καταστροφικές εντολές παραμένουν μπλοκαρισμένα.',
    localFull: 'Ενεργοποίησε και το αντίστοιχο τοπικό Full Control σε αυτόν τον Mac και μετά ξανατρέξε τον Connector:',
  },
  es: {
    control: 'Modo de control',
    guarded: 'Protegido — aprobaciones en Inbox para pasos de mayor riesgo',
    full: 'Control total — trabajo autónomo autorizado por el propietario en este Mac',
    fullHelp: 'El Control total elimina aprobaciones duplicadas de Firbo para archivos, apps y navegador permitidos por el propietario. Contraseñas, banca, llavero/ajustes del sistema y comandos destructivos siguen bloqueados.',
    localFull: 'Activa también el Control total local en este Mac y reinicia el Connector:',
  },
  'pt-BR': {
    control: 'Modo de controle',
    guarded: 'Protegido — aprovações no Inbox para passos de maior risco',
    full: 'Controle total — trabalho autônomo autorizado pelo proprietário neste Mac',
    fullHelp: 'O Controle total remove aprovações duplicadas do Firbo para arquivos, apps e navegador permitidos pelo proprietário. Senhas, banco, chaveiro/ajustes do sistema e comandos destrutivos continuam bloqueados.',
    localFull: 'Ative também o Controle total local neste Mac e reinicie o Connector:',
  },
  de: {
    control: 'Steuerungsmodus',
    guarded: 'Geschützt — Inbox-Freigaben für riskantere Schritte',
    full: 'Vollzugriff — vom Eigentümer autorisierte automatische Arbeit auf diesem Mac',
    fullHelp: 'Vollzugriff entfernt doppelte Firbo-Freigaben für vom Eigentümer erlaubte Datei-, App- und Browserarbeit. Passwörter, Banking, Schlüsselbund/Systemeinstellungen und destruktive Befehle bleiben gesperrt.',
    localFull: 'Aktiviere auch den lokalen Vollzugriff auf diesem Mac und starte den Connector neu:',
  },
  fr: {
    control: 'Mode de contrôle',
    guarded: 'Protégé — validations Inbox pour les étapes plus risquées',
    full: 'Contrôle total — travail autonome autorisé par le propriétaire sur ce Mac',
    fullHelp: 'Le Contrôle total supprime les validations Firbo en double pour les fichiers, apps et le navigateur autorisés par le propriétaire. Mots de passe, banque, trousseau/réglages système et commandes destructives restent bloqués.',
    localFull: 'Activez aussi le Contrôle total local sur ce Mac puis redémarrez le Connector :',
  },
  'zh-CN': {
    control: '控制模式',
    guarded: '受保护 — 高风险步骤需在 Inbox 中批准',
    full: '完全控制 — 由所有者授权在此 Mac 上自动执行工作',
    fullHelp: '完全控制会移除对所有者已允许的文件、应用和浏览器操作的重复 Firbo 审批。密码、银行、钥匙串/系统设置和破坏性命令仍然禁止。',
    localFull: '同时在此 Mac 上启用本地完全控制，然后重新启动 Connector：',
  },
  ar: {
    control: 'وضع التحكم',
    guarded: 'محمي — موافقات Inbox للخطوات الأعلى خطورة',
    full: 'تحكم كامل — عمل تلقائي مصرح به من المالك على هذا الـ Mac',
    fullHelp: 'يزيل التحكم الكامل موافقات Firbo المكررة لأعمال الملفات والتطبيقات والمتصفح التي سمح بها المالك. تظل كلمات المرور والخدمات المصرفية وKeychain/إعدادات النظام والأوامر التدميرية محظورة.',
    localFull: 'فعّل أيضًا التحكم الكامل المحلي على هذا الـ Mac ثم أعد تشغيل Connector:',
  },
};
