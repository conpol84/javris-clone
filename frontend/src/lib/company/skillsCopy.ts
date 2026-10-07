// Page-specific skill controls, in the same eight languages as the workspace.
const en = {
  edit: 'Edit', save: 'Save changes', cancel: 'Cancel', saved: 'Skill updated.', removed: 'Skill removed.',
  enabled: 'Skill enabled.', disabled: 'Skill disabled.', duplicate: 'This skill is already installed for that team or employee.',
  denied: 'Only owners, admins and managers can change skills.',
  unchanged: 'The skill was not changed. Check your permissions and refresh the page.',
  invalid: 'Enter a name and at least 10 characters of instructions.',
  help: 'Skills guide the AI team. They use only the tools and connections the employee is allowed to use.',
  editTitle: 'Edit skill', name: 'Skill name', instructions: 'Skill instructions', loadError: 'Skills could not be loaded. Refresh to try again.',
};
type Copy = typeof en;
export const SKILLS_COPY: Record<string, Copy> = {
  en,
  el: {
    edit: 'Επεξεργασία', save: 'Αποθήκευση αλλαγών', cancel: 'Άκυρο', saved: 'Η δεξιότητα ενημερώθηκε.', removed: 'Η δεξιότητα αφαιρέθηκε.',
    enabled: 'Η δεξιότητα ενεργοποιήθηκε.', disabled: 'Η δεξιότητα απενεργοποιήθηκε.', duplicate: 'Η δεξιότητα είναι ήδη εγκατεστημένη για αυτή την ομάδα ή τον υπάλληλο.',
    denied: 'Μόνο ιδιοκτήτες, διαχειριστές και managers αλλάζουν δεξιότητες.', unchanged: 'Η δεξιότητα δεν άλλαξε. Ελέγξτε τα δικαιώματά σας και ανανεώστε τη σελίδα.',
    invalid: 'Δώστε όνομα και οδηγίες με τουλάχιστον 10 χαρακτήρες.', help: 'Οι δεξιότητες καθοδηγούν την ομάδα AI. Χρησιμοποιούν μόνο τα εργαλεία και τις συνδέσεις που επιτρέπονται στον υπάλληλο.',
    editTitle: 'Επεξεργασία δεξιότητας', name: 'Όνομα δεξιότητας', instructions: 'Οδηγίες δεξιότητας', loadError: 'Οι δεξιότητες δεν φορτώθηκαν. Ανανεώστε τη σελίδα για νέα προσπάθεια.',
  },
  es: {
    edit: 'Editar', save: 'Guardar cambios', cancel: 'Cancelar', saved: 'Habilidad actualizada.', removed: 'Habilidad eliminada.',
    enabled: 'Habilidad activada.', disabled: 'Habilidad desactivada.', duplicate: 'Esta habilidad ya está instalada para ese equipo o empleado.',
    denied: 'Solo propietarios, administradores y managers pueden cambiar habilidades.', unchanged: 'La habilidad no cambió. Revisa tus permisos y actualiza la página.',
    invalid: 'Introduce un nombre y al menos 10 caracteres de instrucciones.', help: 'Las habilidades guían al equipo de IA. Solo usan las herramientas y conexiones permitidas al empleado.',
    editTitle: 'Editar habilidad', name: 'Nombre de la habilidad', instructions: 'Instrucciones de la habilidad', loadError: 'No se pudieron cargar las habilidades. Actualiza para reintentar.',
  },
  'pt-BR': {
    edit: 'Editar', save: 'Salvar alterações', cancel: 'Cancelar', saved: 'Habilidade atualizada.', removed: 'Habilidade removida.',
    enabled: 'Habilidade ativada.', disabled: 'Habilidade desativada.', duplicate: 'Esta habilidade já está instalada para essa equipe ou funcionário.',
    denied: 'Só proprietários, administradores e managers podem alterar habilidades.', unchanged: 'A habilidade não foi alterada. Verifique suas permissões e atualize a página.',
    invalid: 'Insira um nome e instruções com pelo menos 10 caracteres.', help: 'As habilidades orientam a equipe de IA. Usam apenas as ferramentas e conexões permitidas ao funcionário.',
    editTitle: 'Editar habilidade', name: 'Nome da habilidade', instructions: 'Instruções da habilidade', loadError: 'Não foi possível carregar as habilidades. Atualize para tentar novamente.',
  },
  de: {
    edit: 'Bearbeiten', save: 'Änderungen speichern', cancel: 'Abbrechen', saved: 'Fähigkeit aktualisiert.', removed: 'Fähigkeit entfernt.',
    enabled: 'Fähigkeit aktiviert.', disabled: 'Fähigkeit deaktiviert.', duplicate: 'Diese Fähigkeit ist für dieses Team oder diesen Mitarbeiter bereits installiert.',
    denied: 'Nur Eigentümer, Administratoren und Manager können Fähigkeiten ändern.', unchanged: 'Die Fähigkeit wurde nicht geändert. Prüfen Sie Ihre Berechtigungen und laden Sie die Seite neu.',
    invalid: 'Geben Sie einen Namen und mindestens 10 Zeichen Anweisungen ein.', help: 'Fähigkeiten leiten das KI-Team an. Sie verwenden nur die Werkzeuge und Verbindungen, die der Mitarbeiter nutzen darf.',
    editTitle: 'Fähigkeit bearbeiten', name: 'Name der Fähigkeit', instructions: 'Anweisungen der Fähigkeit', loadError: 'Fähigkeiten konnten nicht geladen werden. Laden Sie die Seite erneut.',
  },
  fr: {
    edit: 'Modifier', save: 'Enregistrer les modifications', cancel: 'Annuler', saved: 'Compétence mise à jour.', removed: 'Compétence supprimée.',
    enabled: 'Compétence activée.', disabled: 'Compétence désactivée.', duplicate: 'Cette compétence est déjà installée pour cette équipe ou cet employé.',
    denied: 'Seuls les propriétaires, administrateurs et managers peuvent modifier les compétences.', unchanged: 'La compétence n’a pas changé. Vérifiez vos droits et actualisez la page.',
    invalid: 'Saisissez un nom et au moins 10 caractères d’instructions.', help: 'Les compétences guident l’équipe IA. Elles utilisent uniquement les outils et connexions autorisés pour l’employé.',
    editTitle: 'Modifier la compétence', name: 'Nom de la compétence', instructions: 'Instructions de la compétence', loadError: 'Impossible de charger les compétences. Actualisez pour réessayer.',
  },
  'zh-CN': {
    edit: '编辑', save: '保存更改', cancel: '取消', saved: '技能已更新。', removed: '技能已移除。',
    enabled: '技能已启用。', disabled: '技能已停用。', duplicate: '此团队或员工已安装该技能。',
    denied: '只有所有者、管理员和经理可以更改技能。', unchanged: '技能未更改。请检查权限并刷新页面。',
    invalid: '请输入名称及至少 10 个字符的说明。', help: '技能指导 AI 团队工作，只使用该员工获准使用的工具和连接。',
    editTitle: '编辑技能', name: '技能名称', instructions: '技能说明', loadError: '无法加载技能。请刷新后重试。',
  },
  ar: {
    edit: 'تعديل', save: 'حفظ التغييرات', cancel: 'إلغاء', saved: 'تم تحديث المهارة.', removed: 'تمت إزالة المهارة.',
    enabled: 'تم تفعيل المهارة.', disabled: 'تم تعطيل المهارة.', duplicate: 'هذه المهارة مثبتة بالفعل لهذا الفريق أو الموظف.',
    denied: 'يمكن للمالكين والمسؤولين والمديرين فقط تغيير المهارات.', unchanged: 'لم تتغير المهارة. تحقق من صلاحياتك وحدّث الصفحة.',
    invalid: 'أدخل اسماً وتعليمات من 10 أحرف على الأقل.', help: 'توجّه المهارات فريق الذكاء الاصطناعي وتستخدم فقط الأدوات والاتصالات المسموح بها للموظف.',
    editTitle: 'تعديل المهارة', name: 'اسم المهارة', instructions: 'تعليمات المهارة', loadError: 'تعذّر تحميل المهارات. حدّث الصفحة للمحاولة مجدداً.',
  },
};
export const skillsCopy = (lang: string): Copy => SKILLS_COPY[lang] ?? en;
