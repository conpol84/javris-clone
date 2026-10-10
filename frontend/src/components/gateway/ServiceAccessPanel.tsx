import { Link } from 'react-router';
import { useI18n } from '../../i18n/I18nProvider';
import { dashboardUrl, JARVIS_DASHBOARD } from '../../lib/company/service-dashboards';

/** Intentional owner-local SSH forwarding destination; never the VPS's public port.
 * Browser navigation only: this component NEVER sends requests or credentials.
 */
export const FREELLMAPI_OWNER_TUNNEL = 'http://127.0.0.1:13001/';
export const FREELLMAPI_OWNER_TUNNEL_COMMAND = 'ssh -N -L 13001:127.0.0.1:3001 root@YOUR_VPS_PUBLIC_IP';

const gateway = dashboardUrl(import.meta.env.VITE_OMNIROUTE_URL) || 'https://gateway.firboai.app/';
const remoteFree = dashboardUrl(import.meta.env.VITE_FREELLMAPI_DASHBOARD_URL);
const freeDashboard = remoteFree ?? FREELLMAPI_OWNER_TUNNEL;

const en = {
  title: 'Your services',
  intro: 'Open a separate management login; FIRBO never forwards your login or provider keys.',
  gateway: 'Providers, models, usage and model routing.',
  openGateway: 'OmniRoute login',
  jarvis: 'Chat, tools and execution checks.',
  manage: 'Manage',
  openJarvis: 'Open Jarvis',
  freePrivate: 'Private dashboard on your VPS. Open it on the SAME computer where the SSH tunnel is active.',
  freeRemote: 'Separate FreeLLMAPI login. Its provider keys stay on the gateway server.',
  openFree: 'FreeLLMAPI login',
  tunnel: 'SSH tunnel required — only for the private FreeLLMAPI dashboard',
  tunnelHelp: 'Run this in your own computer terminal and replace YOUR_VPS_PUBLIC_IP. Keep that terminal open, then select FreeLLMAPI login above. Do not expose port 3001 publicly.',
  freeModels: 'Gateway free models',
};
type Copy = typeof en;
const translations: Record<string, Copy> = {
  en,
  el: {
    title: 'Οι υπηρεσίες σου',
    intro: 'Άνοιξε ξεχωριστή σύνδεση διαχείρισης. Το FIRBO δεν μεταφέρει κωδικούς ή provider keys.',
    gateway: 'Πάροχοι, μοντέλα, χρήση και διαδρομές.',
    openGateway: 'Σύνδεση OmniRoute',
    jarvis: 'Συνομιλία, εργαλεία και έλεγχος εκτέλεσης.',
    manage: 'Διαχείριση',
    openJarvis: 'Άνοιγμα Jarvis',
    freePrivate: 'Ιδιωτικό dashboard στον VPS. Άνοιξέ το στον ΙΔΙΟ υπολογιστή όπου τρέχει το SSH tunnel.',
    freeRemote: 'Ξεχωριστή σύνδεση FreeLLMAPI. Τα provider keys παραμένουν στον server.',
    openFree: 'Σύνδεση FreeLLMAPI',
    tunnel: 'Απαιτείται SSH tunnel — μόνο για το ιδιωτικό FreeLLMAPI',
    tunnelHelp: 'Εκτέλεσέ το στο Terminal του υπολογιστή σου, αντικατάστησε το YOUR_VPS_PUBLIC_IP και κράτησέ το ανοιχτό. Μετά άνοιξε τη σύνδεση FreeLLMAPI. Μην ανοίξεις δημόσια τη θύρα 3001.',
    freeModels: 'Δωρεάν μοντέλα Gateway',
  },
  es: {
    title: 'Tus servicios',
    intro: 'Abre una sesión de administración independiente. FIRBO no reenvía claves ni contraseñas.',
    gateway: 'Proveedores, modelos, uso y rutas.',
    openGateway: 'Entrar en OmniRoute',
    jarvis: 'Chat, herramientas y ejecución.',
    manage: 'Gestionar',
    openJarvis: 'Abrir Jarvis',
    freePrivate: 'Panel privado en tu VPS. Ábrelo en el MISMO equipo que mantiene el túnel SSH.',
    freeRemote: 'Acceso independiente a FreeLLMAPI; las claves siguen en el servidor.',
    openFree: 'Entrar en FreeLLMAPI',
    tunnel: 'Se requiere túnel SSH para el panel privado',
    tunnelHelp: 'Ejecuta esto en tu ordenador, cambia YOUR_VPS_PUBLIC_IP y deja la terminal abierta. No expongas públicamente el puerto 3001.',
    freeModels: 'Modelos gratuitos de Gateway',
  },
  'pt-BR': {
    title: 'Seus serviços',
    intro: 'Abra um login administrativo separado. O FIRBO não encaminha senhas nem chaves.',
    gateway: 'Provedores, modelos, uso e rotas.',
    openGateway: 'Entrar no OmniRoute',
    jarvis: 'Chat, ferramentas e execução.',
    manage: 'Gerenciar',
    openJarvis: 'Abrir Jarvis',
    freePrivate: 'Painel privado no VPS. Abra no MESMO computador com o túnel SSH ativo.',
    freeRemote: 'Login separado do FreeLLMAPI; as chaves ficam no servidor.',
    openFree: 'Entrar no FreeLLMAPI',
    tunnel: 'Túnel SSH necessário para o painel privado',
    tunnelHelp: 'Execute no seu computador, substitua YOUR_VPS_PUBLIC_IP e mantenha o terminal aberto. Não exponha publicamente a porta 3001.',
    freeModels: 'Modelos gratuitos do Gateway',
  },
  fr: {
    title: 'Vos services',
    intro: 'Ouvrez une connexion de gestion séparée. FIRBO ne transmet ni mots de passe ni clés.',
    gateway: 'Fournisseurs, modèles, utilisation et routage.',
    openGateway: 'Connexion OmniRoute',
    jarvis: 'Chat, outils et exécution.',
    manage: 'Gérer',
    openJarvis: 'Ouvrir Jarvis',
    freePrivate: 'Tableau de bord privé du VPS. Ouvrez-le sur le MÊME ordinateur que le tunnel SSH.',
    freeRemote: 'Connexion FreeLLMAPI distincte ; les clés restent sur le serveur.',
    openFree: 'Connexion FreeLLMAPI',
    tunnel: 'Tunnel SSH nécessaire pour le tableau de bord privé',
    tunnelHelp: 'Exécutez sur votre ordinateur, remplacez YOUR_VPS_PUBLIC_IP et gardez le terminal ouvert. Ne publiez pas le port 3001.',
    freeModels: 'Modèles gratuits du Gateway',
  },
  de: {
    title: 'Deine Dienste',
    intro: 'Öffne die separate Admin-Anmeldung. FIRBO gibt keine Passwörter oder Schlüssel weiter.',
    gateway: 'Anbieter, Modelle, Nutzung und Routing.',
    openGateway: 'OmniRoute-Anmeldung',
    jarvis: 'Chat, Werkzeuge und Ausführung.',
    manage: 'Verwalten',
    openJarvis: 'Jarvis öffnen',
    freePrivate: 'Privates VPS-Dashboard. Öffne es auf DEMSELBEN Rechner mit aktivem SSH-Tunnel.',
    freeRemote: 'Separater FreeLLMAPI-Login; Provider-Schlüssel bleiben auf dem Server.',
    openFree: 'FreeLLMAPI-Anmeldung',
    tunnel: 'SSH-Tunnel für das private Dashboard erforderlich',
    tunnelHelp: 'Auf dem eigenen Rechner ausführen, YOUR_VPS_PUBLIC_IP ersetzen und Terminal geöffnet lassen. Port 3001 nicht öffentlich freigeben.',
    freeModels: 'Kostenlose Gateway-Modelle',
  },
  'zh-CN': {
    title: '你的服务',
    intro: '分别登录管理后台。FIRBO 不传递密码或服务商密钥。',
    gateway: '服务商、模型、用量和路由。',
    openGateway: '登录 OmniRoute',
    jarvis: '聊天、工具与执行检查。',
    manage: '管理',
    openJarvis: '打开 Jarvis',
    freePrivate: 'VPS 私有控制台。必须在运行 SSH 隧道的同一台电脑上打开。',
    freeRemote: '独立登录 FreeLLMAPI；服务商密钥留在服务器上。',
    openFree: '登录 FreeLLMAPI',
    tunnel: '私有控制台需要 SSH 隧道',
    tunnelHelp: '在你的电脑上运行，把 YOUR_VPS_PUBLIC_IP 换成 VPS IP，保持终端开启。不要公开 3001 端口。',
    freeModels: 'Gateway 免费模型',
  },
  ar: {
    title: 'خدماتك',
    intro: 'افتح تسجيل دخول إداريًا منفصلًا. لا ينقل FIRBO كلمات المرور أو مفاتيح المزودين.',
    gateway: 'المزودون والنماذج والاستخدام والتوجيه.',
    openGateway: 'تسجيل دخول OmniRoute',
    jarvis: 'المحادثة والأدوات والتحقق من التنفيذ.',
    manage: 'إدارة',
    openJarvis: 'فتح Jarvis',
    freePrivate: 'لوحة خاصة على VPS. افتحها على نفس الحاسوب الذي يشغّل نفق SSH.',
    freeRemote: 'دخول منفصل إلى FreeLLMAPI؛ تبقى المفاتيح على الخادم.',
    openFree: 'تسجيل دخول FreeLLMAPI',
    tunnel: 'يلزم نفق SSH للوصول إلى اللوحة الخاصة',
    tunnelHelp: 'نفّذ الأمر على حاسوبك واستبدل YOUR_VPS_PUBLIC_IP وأبقِ الطرفية مفتوحة. لا تعرض المنفذ 3001 للعامة.',
    freeModels: 'نماذج Gateway المجانية',
  },
};

/** Mount only inside platform-admin surfaces; the links never imply a live login. */
export function ServiceAccessPanel() {
  const { lang } = useI18n();
  const copy = translations[lang] ?? en;
  const external = (href: string, label: string, id: string) =>
    <a className="fb-btn fb-btn--ghost" href={href} target="_blank" rel="noopener noreferrer"
      referrerPolicy="no-referrer" data-service-login={id}>{label} ↗</a>;
  return <section className="fb-glass p-4" aria-label={copy.title}>
    <h2 className="text-base font-semibold">{copy.title}</h2>
    <p className="fb-muted mt-1 text-sm">{copy.intro}</p>
    <div className="mt-4 grid gap-3 lg:grid-cols-3">
      <div className="rounded-xl border border-white/10 p-3">
        <h3 className="font-semibold">OmniRoute Gateway</h3>
        <p className="fb-muted mt-1 text-sm">{copy.gateway}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="fb-btn fb-btn--primary" to="/admin?tab=console">{copy.manage}</Link>
          {external(gateway, copy.openGateway, 'omniroute')}
        </div>
      </div>
      <div className="rounded-xl border border-white/10 p-3">
        <h3 className="font-semibold">Jarvis</h3>
        <p className="fb-muted mt-1 text-sm">{copy.jarvis}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="fb-btn fb-btn--primary" to="/admin?tab=jarvis">{copy.openJarvis}</Link>
          {external(JARVIS_DASHBOARD, 'Dashboard', 'jarvis')}
        </div>
      </div>
      <div className="rounded-xl border border-white/10 p-3">
        <h3 className="font-semibold">FreeLLMAPI</h3>
        <p className="fb-muted mt-1 text-sm">{remoteFree ? copy.freeRemote : copy.freePrivate}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {external(freeDashboard, copy.openFree, 'freellmapi')}
          <Link className="fb-btn fb-btn--ghost" to="/gateway?tab=free">{copy.freeModels}</Link>
        </div>
        {!remoteFree && <details className="mt-3 text-xs" data-free-ssh-tunnel="true">
          <summary className="cursor-pointer font-semibold">{copy.tunnel}</summary>
          <p className="fb-muted mt-2">{copy.tunnelHelp}</p>
          <code dir="ltr" className="mt-2 block break-all rounded-lg border border-white/10 p-2 select-text">{FREELLMAPI_OWNER_TUNNEL_COMMAND}</code>
        </details>}
      </div>
    </div>
  </section>;
}
