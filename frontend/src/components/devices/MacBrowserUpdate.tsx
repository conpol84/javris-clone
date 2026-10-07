import type { Lang } from '../../i18n/core';
import type { DeviceRow } from '../../lib/company/computers';

const copy: Record<Lang, [string, string, string, string]> = {
  en: ['Enable Full Control on this Mac', 'Download the updater on this paired Mac. Stop the old Connector with Ctrl+C, then run the command below in Terminal. Existing pairing is kept.', 'Download Mac updater', 'The updater can enable owner-authorized Full Control for apps, files and reviewed browser work, while passwords, banking, keychain/system settings and destructive commands remain blocked.'],
  el: ['Ενεργοποίηση Full Control σε αυτόν τον Mac', 'Κατέβασε το updater στον ήδη συνδεδεμένο Mac. Σταμάτησε τον παλιό Connector με Ctrl+C και τρέξε την παρακάτω εντολή στο Terminal. Η υπάρχουσα σύνδεση διατηρείται.', 'Λήψη Mac updater', 'Το updater μπορεί να ενεργοποιήσει owner-authorized Full Control για εφαρμογές, αρχεία και ελεγμένη εργασία browser. Κωδικοί, τράπεζες, Keychain/ρυθμίσεις συστήματος και καταστροφικές εντολές παραμένουν μπλοκαρισμένα.'],
  es: ['Activar Control total en este Mac', 'Descarga el actualizador en este Mac vinculado. Detén el Connector anterior con Ctrl+C y ejecuta el comando en Terminal. Se conserva la vinculación existente.', 'Descargar actualizador para Mac', 'El actualizador puede activar Control total autorizado por el propietario para apps, archivos y trabajo de navegador revisado. Contraseñas, banca, llavero/ajustes del sistema y comandos destructivos siguen bloqueados.'],
  'pt-BR': ['Ativar Controle total neste Mac', 'Baixe o atualizador neste Mac pareado. Pare o Connector anterior com Ctrl+C e execute o comando no Terminal. O pareamento existente é mantido.', 'Baixar atualizador para Mac', 'O atualizador pode ativar Controle total autorizado pelo proprietário para apps, arquivos e trabalho revisado no navegador. Senhas, banco, chaveiro/ajustes do sistema e comandos destrutivos continuam bloqueados.'],
  de: ['Vollzugriff auf diesem Mac aktivieren', 'Lade das Update auf diesen gekoppelten Mac. Stoppe den alten Connector mit Ctrl+C und führe den Befehl im Terminal aus. Die bestehende Kopplung bleibt erhalten.', 'Mac-Update herunterladen', 'Das Update kann vom Eigentümer autorisierten Vollzugriff für Apps, Dateien und geprüfte Browserarbeit aktivieren. Passwörter, Banking, Schlüsselbund/Systemeinstellungen und destruktive Befehle bleiben gesperrt.'],
  fr: ['Activer le Contrôle total sur ce Mac', 'Téléchargez la mise à jour sur ce Mac associé. Arrêtez l’ancien Connector avec Ctrl+C, puis lancez la commande dans Terminal. L’association existante est conservée.', 'Télécharger la mise à jour Mac', 'La mise à jour peut activer un Contrôle total autorisé par le propriétaire pour les apps, fichiers et le travail navigateur contrôlé. Mots de passe, banque, trousseau/réglages système et commandes destructives restent bloqués.'],
  'zh-CN': ['在此 Mac 上启用完全控制', '请在已配对的 Mac 上下载更新程序。按 Ctrl+C 停止旧 Connector，然后在终端运行以下命令。现有配对会保留。', '下载 Mac 更新程序', '更新程序可以启用由所有者授权的完全控制，用于应用、文件和经过审核的浏览器工作。密码、银行、钥匙串/系统设置和破坏性命令仍然禁止。'],
  ar: ['تفعيل التحكم الكامل على هذا Mac', 'نزّل أداة التحديث على جهاز Mac المقترن. أوقف Connector القديم باستخدام Ctrl+C ثم شغّل الأمر في Terminal. يبقى الاقتران الحالي محفوظًا.', 'تنزيل أداة تحديث Mac', 'يمكن لأداة التحديث تفعيل تحكم كامل مصرح به من المالك للتطبيقات والملفات والعمل المتحكم به في المتصفح. تظل كلمات المرور والخدمات المصرفية وKeychain/إعدادات النظام والأوامر التدميرية محظورة.'],
};

/** Download only: never pairs a device, grants consent or dispatches a job. */
export function MacBrowserUpdate({ device, lang }: { device: Pick<DeviceRow, 'paired' | 'revoked_at' | 'platform' | 'capabilities'>; lang: Lang }) {
  if (!device.paired || device.revoked_at || !/^darwin(?:\s|$)/i.test(device.platform ?? '') || (device.capabilities?.job_kinds?.includes('browser_task') && device.capabilities?.full_control === true)) return null;
  const [title, steps, download, consent] = copy[lang];
  return <aside className="rounded-xl border border-white/10 p-3" data-testid="mac-browser-update">
    <h3 className="text-sm font-semibold">{title}</h3>
    <p className="fb-muted mt-2 text-sm">{steps}</p>
    <a className="fb-btn fb-btn--ghost mt-3" href="/FIRBO-Mac-Browser-Update.command" download="FIRBO-Mac-Browser-Update.command">{download}</a>
    <pre className="fb-input mt-3 whitespace-pre-wrap break-all p-3 font-mono text-xs" dir="ltr">{'bash "$HOME/Downloads/FIRBO-Mac-Browser-Update.command"'}</pre>
    <p className="fb-dim mt-2 text-xs">{consent}</p>
  </aside>;
}
