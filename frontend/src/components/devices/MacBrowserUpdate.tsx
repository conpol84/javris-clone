import type { Lang } from '../../i18n/core';
import type { DeviceRow } from '../../lib/company/computers';

const copy: Record<Lang, [string, string, string, string]> = {
  en: ['Enable full browser tasks on this Mac', 'Download the updater on this paired Mac. Stop the old Connector with Ctrl+C, then run the command below in Terminal. Existing pairing and permissions are kept.', 'Download Mac updater', 'The updater installs Chromium and asks before starting. The first browser test is limited to firboai.app; browser plans still require local approval.'],
  el: ['Πλήρεις εργασίες browser σε αυτόν τον Mac', 'Κατέβασε το updater στον ήδη συνδεδεμένο Mac. Σταμάτησε τον παλιό Connector με Ctrl+C και τρέξε την παρακάτω εντολή στο Terminal. Διατηρούνται η σύνδεση και οι άδειες.', 'Λήψη Mac updater', 'Το updater εγκαθιστά Chromium και ζητά επιβεβαίωση πριν ξεκινήσει. Η πρώτη δοκιμή περιορίζεται στο firboai.app· τα σχέδια browser χρειάζονται τοπική έγκριση.'],
  es: ['Activar tareas completas del navegador en este Mac', 'Descarga el actualizador en este Mac vinculado. Detén el Connector anterior con Ctrl+C y ejecuta el comando en Terminal. Se conservan la vinculación y los permisos.', 'Descargar actualizador para Mac', 'Instala Chromium y pide confirmación antes de iniciar. La primera prueba se limita a firboai.app; los planes del navegador requieren aprobación local.'],
  'pt-BR': ['Ativar tarefas completas do navegador neste Mac', 'Baixe o atualizador neste Mac pareado. Pare o Connector anterior com Ctrl+C e execute o comando no Terminal. O pareamento e as permissões são mantidos.', 'Baixar atualizador para Mac', 'Instala o Chromium e pede confirmação antes de iniciar. O primeiro teste se limita a firboai.app; os planos do navegador exigem aprovação local.'],
  de: ['Vollständige Browseraufgaben auf diesem Mac aktivieren', 'Lade das Update auf diesen gekoppelten Mac. Stoppe den alten Connector mit Ctrl+C und führe den Befehl im Terminal aus. Kopplung und Berechtigungen bleiben erhalten.', 'Mac-Update herunterladen', 'Installiert Chromium und fragt vor dem Start nach. Der erste Test ist auf firboai.app beschränkt; Browserpläne erfordern weiterhin lokale Zustimmung.'],
  fr: ['Activer les tâches complètes du navigateur sur ce Mac', 'Téléchargez la mise à jour sur ce Mac associé. Arrêtez l’ancien Connector avec Ctrl+C, puis lancez la commande dans Terminal. L’association et les autorisations sont conservées.', 'Télécharger la mise à jour Mac', 'Installe Chromium et demande confirmation avant de démarrer. Le premier test se limite à firboai.app ; les plans du navigateur nécessitent une approbation locale.'],
  'zh-CN': ['在此 Mac 上启用完整浏览器任务', '请在已配对的 Mac 上下载更新程序。按 Ctrl+C 停止旧 Connector，然后在终端运行以下命令。现有配对和权限会保留。', '下载 Mac 更新程序', '更新程序会安装 Chromium，并在启动前请求确认。首次测试仅限 firboai.app；浏览器计划仍需本地批准。'],
  ar: ['تفعيل مهام المتصفح الكاملة على هذا Mac', 'نزّل أداة التحديث على جهاز Mac المقترن. أوقف Connector القديم باستخدام Ctrl+C ثم شغّل الأمر في Terminal. يبقى الاقتران والأذونات الحالية محفوظة.', 'تنزيل أداة تحديث Mac', 'تثبّت Chromium وتطلب التأكيد قبل البدء. يقتصر الاختبار الأول على firboai.app؛ وتبقى خطط المتصفح بحاجة إلى موافقة محلية.'],
};

/** Download only: never pairs a device, grants consent or dispatches a job. */
export function MacBrowserUpdate({ device, lang }: { device: Pick<DeviceRow, 'paired' | 'revoked_at' | 'platform' | 'capabilities'>; lang: Lang }) {
  if (!device.paired || device.revoked_at || !/^darwin(?:\s|$)/i.test(device.platform ?? '') || device.capabilities?.job_kinds?.includes('browser_task')) return null;
  const [title, steps, download, consent] = copy[lang];
  return <aside className="rounded-xl border border-white/10 p-3" data-testid="mac-browser-update">
    <h3 className="text-sm font-semibold">{title}</h3>
    <p className="fb-muted mt-2 text-sm">{steps}</p>
    <a className="fb-btn fb-btn--ghost mt-3" href="/FIRBO-Mac-Browser-Update.command" download="FIRBO-Mac-Browser-Update.command">{download}</a>
    <pre className="fb-input mt-3 whitespace-pre-wrap break-all p-3 font-mono text-xs" dir="ltr">{'bash "$HOME/Downloads/FIRBO-Mac-Browser-Update.command"'}</pre>
    <p className="fb-dim mt-2 text-xs">{consent}</p>
  </aside>;
}
