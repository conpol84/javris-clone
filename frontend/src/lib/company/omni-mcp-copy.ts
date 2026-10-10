/** FIRBO's existing Integrations page, not a second OmniRoute workspace.
 * Values are deliberately copied in every supported locale.
 */
const COPY = {
  en: {
    title: 'Connect the existing OmniRoute gateway',
    description: 'Use FIRBO Integrations and its existing MCP audit. Platform admins only. Only read-only health, quota, usage, models and combos tools are permitted. Use a separate, narrow mcp:connect key with matching read scopes, never your inference or management key.',
    existing: 'OmniRoute already connected via FIRBO MCP',
    notReady: 'The central OmniRoute connection is not enabled yet. The operator must verify Streamable HTTP and per-tool scopes before activating this pilot.',
  },
  el: {
    title: 'Σύνδεση του υπάρχοντος OmniRoute gateway',
    description: 'Από τα Integrations του FIRBO, με το υπάρχον MCP audit. Μόνο platform admins. Επιτρέπονται μόνο αναγνώσεις για health, quota, usage, models και combos. Χρησιμοποίησε ξεχωριστό περιορισμένο κλειδί mcp:connect με read scopes, ποτέ inference ή management key.',
    existing: 'Το OmniRoute είναι ήδη συνδεδεμένο μέσω FIRBO MCP',
    notReady: 'Η σύνδεση του κεντρικού OmniRoute δεν έχει ενεργοποιηθεί. Πρέπει πρώτα να επαληθευτούν το Streamable HTTP και τα δικαιώματα ανά εργαλείο.',
  },
  es: {
    title: 'Conectar la pasarela OmniRoute existente',
    description: 'Usa Integrations y la auditoría MCP de FIRBO. Solo administradores de plataforma. Solo lectura de salud, cuotas, uso, modelos y combos. Utiliza una clave mcp:connect separada y limitada, nunca la de inferencia o gestión.',
    existing: 'OmniRoute ya está conectado mediante FIRBO MCP',
    notReady: 'La conexión central de OmniRoute aún no está habilitada. Primero hay que verificar Streamable HTTP y los permisos de cada herramienta.',
  },
  'pt-BR': {
    title: 'Conectar o gateway OmniRoute existente',
    description: 'Use Integrations e a auditoria MCP do FIRBO. Somente administradores da plataforma. Apenas leitura de saúde, cotas, uso, modelos e combos. Use uma chave mcp:connect separada e restrita, nunca a chave de inferência ou gerenciamento.',
    existing: 'OmniRoute já conectado pelo FIRBO MCP',
    notReady: 'A conexão central do OmniRoute ainda não foi ativada. É preciso verificar o Streamable HTTP e as permissões por ferramenta antes do piloto.',
  },
  de: {
    title: 'Vorhandenes OmniRoute-Gateway verbinden',
    description: 'Über FIRBO Integrations mit dem vorhandenen MCP-Audit. Nur Plattformadministratoren. Nur lesender Zugriff auf Health, Quotas, Nutzung, Modelle und Combos. Verwende einen separaten eingeschränkten mcp:connect-Schlüssel, keinen Inferenz- oder Verwaltungsschlüssel.',
    existing: 'OmniRoute ist bereits über FIRBO MCP verbunden',
    notReady: 'Die zentrale OmniRoute-Verbindung ist noch nicht aktiviert. Streamable HTTP und die Rechte pro Werkzeug müssen vorher geprüft werden.',
  },
  fr: {
    title: 'Connecter la passerelle OmniRoute existante',
    description: 'Utilise Integrations et l’audit MCP existant de FIRBO. Réservé aux administrateurs de plateforme. Lecture seule pour santé, quotas, utilisation, modèles et combos. Utilise une clé mcp:connect distincte et limitée, jamais une clé d’inférence ou de gestion.',
    existing: 'OmniRoute est déjà connecté via FIRBO MCP',
    notReady: 'La connexion centrale OmniRoute n’est pas encore activée. Il faut d’abord vérifier Streamable HTTP et les autorisations par outil.',
  },
  'zh-CN': {
    title: '连接现有 OmniRoute 网关',
    description: '通过 FIRBO 的现有 Integrations 和 MCP 审计连接。仅平台管理员。只读健康状态、配额、用量、模型和组合。使用独立且受限的 mcp:connect 密钥，不得使用推理或管理密钥。',
    existing: 'OmniRoute 已通过 FIRBO MCP 连接',
    notReady: '中央 OmniRoute 连接尚未启用。启动试点前必须验证 Streamable HTTP 和逐工具权限。',
  },
  ar: {
    title: 'ربط بوابة OmniRoute الحالية',
    description: 'باستخدام Integrations وسجل تدقيق MCP الموجود في FIRBO. لمسؤولي المنصة فقط. قراءة الصحة والحصص والاستخدام والنماذج والمجموعات فقط. استخدم مفتاح mcp:connect منفصلًا ومحدودًا، وليس مفتاح الاستدلال أو الإدارة.',
    existing: 'OmniRoute متصل بالفعل عبر FIRBO MCP',
    notReady: 'لم يتم تفعيل اتصال OmniRoute المركزي بعد. يجب التحقق من Streamable HTTP وصلاحيات كل أداة قبل التشغيل التجريبي.',
  },
} as const;

export function omniMcpCopy(lang: string): typeof COPY.en {
  return (COPY[lang as keyof typeof COPY] ?? COPY.en) as typeof COPY.en;
}
