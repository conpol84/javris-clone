import { Link } from 'react-router';
import { useI18n } from '../../i18n/I18nProvider';
import { useCompanyAuth } from '../../lib/company/AuthProvider';

const en = {
  title: 'Manage your company',
  scope: 'Company: {company}. Each page uses your current company permissions.',
  missing: 'Choose a company to open its management pages.',
  memory: 'Read, add and upload notes for the AI team.',
  studio: 'Choose employees and manage their tool permissions.',
  integrations: 'Connect accounts and review connected services.',
  activity: 'Review company actions and approval history.',
  computers: 'Manage paired workers, permissions and recent jobs.',
  inbox: 'Review and approve pending actions.',
};
type Copy = typeof en;
export const MANAGEMENT_COPY: Record<string, Copy> = {
  en,
  el: {
    title: 'Διαχείριση εταιρείας', scope: 'Εταιρεία: {company}. Κάθε σελίδα χρησιμοποιεί τα δικαιώματά σου στην επιλεγμένη εταιρεία.', missing: 'Διάλεξε εταιρεία για να ανοίξεις τις σελίδες διαχείρισής της.',
    memory: 'Διάβασε, πρόσθεσε και ανέβασε σημειώσεις για την ομάδα AI.', studio: 'Διάλεξε υπαλλήλους και διαχειρίσου τα δικαιώματα εργαλείων τους.', integrations: 'Σύνδεσε λογαριασμούς και έλεγξε τις συνδεδεμένες υπηρεσίες.', activity: 'Δες τις ενέργειες της εταιρείας και το ιστορικό εγκρίσεων.', computers: 'Διαχειρίσου συνδεδεμένους workers, δικαιώματα και πρόσφατες εργασίες.', inbox: 'Έλεγξε και ενέκρινε ενέργειες που εκκρεμούν.',
  },
  es: {
    title: 'Gestiona tu empresa', scope: 'Empresa: {company}. Cada página usa tus permisos en la empresa actual.', missing: 'Elige una empresa para abrir sus páginas de gestión.',
    memory: 'Lee, añade y carga notas para el equipo de IA.', studio: 'Elige empleados y gestiona sus permisos de herramientas.', integrations: 'Conecta cuentas y revisa los servicios conectados.', activity: 'Revisa las acciones de la empresa y el historial de aprobaciones.', computers: 'Gestiona equipos vinculados, permisos y trabajos recientes.', inbox: 'Revisa y aprueba las acciones pendientes.',
  },
  'pt-BR': {
    title: 'Gerencie sua empresa', scope: 'Empresa: {company}. Cada página usa suas permissões na empresa atual.', missing: 'Escolha uma empresa para abrir suas páginas de gestão.',
    memory: 'Leia, adicione e envie notas para a equipe de IA.', studio: 'Escolha funcionários e gerencie suas permissões de ferramentas.', integrations: 'Conecte contas e confira os serviços conectados.', activity: 'Confira as ações da empresa e o histórico de aprovações.', computers: 'Gerencie computadores vinculados, permissões e trabalhos recentes.', inbox: 'Confira e aprove ações pendentes.',
  },
  de: {
    title: 'Unternehmen verwalten', scope: 'Unternehmen: {company}. Jede Seite verwendet deine Berechtigungen im aktuellen Unternehmen.', missing: 'Wähle ein Unternehmen, um seine Verwaltungsseiten zu öffnen.',
    memory: 'Notizen für das KI-Team lesen, hinzufügen und hochladen.', studio: 'Mitarbeiter auswählen und ihre Werkzeugrechte verwalten.', integrations: 'Konten verbinden und verbundene Dienste prüfen.', activity: 'Unternehmensaktionen und Freigabeverlauf prüfen.', computers: 'Verbundene Computer, Berechtigungen und letzte Aufträge verwalten.', inbox: 'Ausstehende Aktionen prüfen und freigeben.',
  },
  fr: {
    title: 'Gérer votre entreprise', scope: 'Entreprise : {company}. Chaque page utilise vos droits dans l’entreprise actuelle.', missing: 'Choisissez une entreprise pour ouvrir ses pages de gestion.',
    memory: 'Lisez, ajoutez et importez des notes pour l’équipe IA.', studio: 'Choisissez les employés et gérez leurs droits sur les outils.', integrations: 'Connectez des comptes et vérifiez les services connectés.', activity: 'Consultez les actions de l’entreprise et l’historique des approbations.', computers: 'Gérez les ordinateurs associés, les droits et les tâches récentes.', inbox: 'Examinez et approuvez les actions en attente.',
  },
  'zh-CN': {
    title: '管理公司', scope: '公司：{company}。每个页面都使用你在当前公司的权限。', missing: '选择公司以打开其管理页面。',
    memory: '阅读、添加和上传供 AI 团队使用的笔记。', studio: '选择员工并管理其工具权限。', integrations: '连接账户并查看已连接的服务。', activity: '查看公司操作和审批历史。', computers: '管理已配对的计算机、权限和最近的任务。', inbox: '查看并批准待处理的操作。',
  },
  ar: {
    title: 'إدارة شركتك', scope: 'الشركة: {company}. تستخدم كل صفحة صلاحياتك في الشركة الحالية.', missing: 'اختر شركة لفتح صفحات إدارتها.',
    memory: 'اقرأ الملاحظات وأضفها وارفعها لفريق الذكاء الاصطناعي.', studio: 'اختر الموظفين وأدر صلاحيات أدواتهم.', integrations: 'اربط الحسابات وراجع الخدمات المتصلة.', activity: 'راجع إجراءات الشركة وسجل الموافقات.', computers: 'أدر الحواسيب المقترنة والصلاحيات والمهام الأخيرة.', inbox: 'راجع الإجراءات المعلقة ووافق عليها.',
  },
};

/** Company pages retain their own authorization; this exposes no native VPS API. */
export function ServerManagementLinks() {
  const { lang, t } = useI18n();
  const { current } = useCompanyAuth();
  const copy = MANAGEMENT_COPY[lang] ?? en;
  const company = current?.organization;
  const pages = [
    ['/memory', 'nav.memory', copy.memory], ['/studio', 'nav.studio', copy.studio],
    ['/integrations', 'nav.integrations', copy.integrations], ['/activity', 'nav.activity', copy.activity],
    ['/computers', 'nav.computers', copy.computers], ['/inbox', 'nav.inbox', copy.inbox],
  ] as const;
  return <section className="fb-glass p-4" aria-label={copy.title}>
    <h2 className="text-base font-semibold">{copy.title}</h2>
    <p className="fb-muted mt-1 text-sm">{company ? copy.scope.replace('{company}', company.name) : copy.missing}</p>
    {company && <nav className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={copy.title}>
      {pages.map(([to, key, description]) => <Link key={to} to={to} className="rounded-xl border border-white/10 p-3 hover:border-white/30">
        <span className="font-semibold">{t(key)} →</span>
        <span className="fb-muted mt-1 block text-sm">{description}</span>
      </Link>)}
    </nav>}
  </section>;
}
