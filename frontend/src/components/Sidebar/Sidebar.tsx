import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  MessageSquare,
  Plus,
  BarChart3,
  Settings,
  Search,
  PanelLeftClose,
  PanelLeft,
  Cpu,
  Rocket,
  Bot,
  Sun,
  Moon,
  Monitor,
  Loader2,
  ScrollText,
  Database,
  Building2,
  LogOut,
  Sparkles,
  LayoutDashboard,
  Box,
  Waypoints,
  Users,
  Inbox,
  ListChecks,
  History,
} from 'lucide-react';
import { COMPANY_ENABLED } from '../../lib/company/client';
import type { TKey } from '../../i18n/locales/en';
import { LogoMark } from '../brand/Logo';
import { LanguageSwitcher } from '../brand/LanguageSwitcher';
import { useI18n } from '../../i18n/I18nProvider';
import { CHAT_PATH } from '../../lib/company/routes';
import { useCommand } from '../command/CommandHost';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { usePendingCount } from '../../lib/company/usePendingCount';
import { ConversationList } from './ConversationList';
import { useAppStore } from '../../lib/store';

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState('');

  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const { current, user, signOut } = useCompanyAuth();
  const command = useCommand();
  const { t } = useI18n();
  const pending = usePendingCount(current?.organization.id ?? '');
  const createConversation = useAppStore((s) => s.createConversation);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const serverInfo = useAppStore((s) => s.serverInfo);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const modelLoading = useAppStore((s) => s.modelLoading);
  const deepResearch = useAppStore((s) => s.deepResearch);

  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const ThemeIcon = settings.theme === 'light' ? Sun : settings.theme === 'dark' ? Moon : Monitor;
  const nextTheme = settings.theme === 'light' ? 'dark' : settings.theme === 'dark' ? 'system' : 'light';

  const messages = useAppStore((s) => s.messages);
  const handleNewChat = () => {
    // Don't create a new chat if the current one is empty
    if (messages.length === 0) {
      navigate(CHAT_PATH);
      return;
    }
    createConversation(selectedModel);
    navigate(CHAT_PATH);
  };

  type NavItem = { path: string; icon: typeof Bot; label: string; badge?: number };
  const workspace: NavItem[] = COMPANY_ENABLED
    ? [
        { path: '/', icon: LayoutDashboard, label: t('nav.commandCenter') },
        { path: '/office', icon: Box, label: t('nav.office') },
        { path: '/team', icon: Users, label: t('nav.team') },
        { path: '/inbox', icon: Inbox, label: t('nav.inbox'), badge: pending },
        { path: '/tasks', icon: ListChecks, label: t('nav.tasks') },
        { path: '/activity', icon: History, label: t('nav.activity') },
        { path: '/people', icon: Building2, label: t('nav.people') },
        { path: '/gateway', icon: Waypoints, label: t('nav.gateway') },
      ]
    : [];
  // Company workspace: only pages that work in the hosted product. The legacy local-assistant pages stay for the desktop build.
  const navItems: NavItem[] = COMPANY_ENABLED
    ? [...workspace, { path: '/settings', icon: Settings, label: t('nav.settings') }]
    : [
    ...workspace,
    { path: CHAT_PATH, icon: MessageSquare, label: t('nav.chat') },
    { path: '/dashboard', icon: BarChart3, label: COMPANY_ENABLED ? t('nav.analytics') : 'Dashboard' },
    { path: '/data-sources', icon: Database, label: t('nav.dataSources') },
    { path: '/agents', icon: Bot, label: COMPANY_ENABLED ? t('nav.runtime') : 'Agents' },
    { path: '/logs', icon: ScrollText, label: t('nav.logs') },
    { path: '/settings', icon: Settings, label: t('nav.settings') },
    { path: '/get-started', icon: Rocket, label: 'Get Started' },
  ];

  return (
    <>
      {/* Collapse button when sidebar is closed */}
      {!sidebarOpen && (
        <button
          onClick={toggleSidebar}
          className="fixed top-3 start-3 z-30 p-2 rounded-lg transition-colors cursor-pointer"
          style={{ color: 'var(--color-text-secondary)', background: 'var(--color-bg-secondary)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-tertiary)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-bg-secondary)')}
        >
          <PanelLeft size={18} />
        </button>
      )}

      <aside
        className={`
          flex flex-col h-full shrink-0 transition-all duration-200 ease-in-out overflow-hidden
          fixed md:relative z-30
          ${sidebarOpen ? 'w-[260px]' : 'w-0'}
        `}
        style={{
          background: 'var(--color-sidebar)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderInlineEnd: sidebarOpen ? '1px solid var(--color-border)' : 'none',
        }}
      >
        <div className="flex flex-col h-full w-[260px]">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 pt-3.5">
            <LogoMark size={22} />
            <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--color-text)' }}>
              Firbo <span style={{ color: 'var(--color-accent)' }}>AI</span>
            </span>
          </div>
          <div className="flex items-center justify-between px-3 pt-2 pb-2">
            <button
              onClick={toggleSidebar}
              className="p-2 rounded-lg transition-colors cursor-pointer"
              style={{ color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-tertiary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <PanelLeftClose size={18} />
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => updateSettings({ theme: nextTheme })}
                className="p-2 rounded-lg transition-colors cursor-pointer"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-tertiary)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                title={t('settings.themeToggle', { theme: t(`settings.theme.${settings.theme}` as TKey) })}
              >
                <ThemeIcon size={16} />
              </button>
              <button
                onClick={COMPANY_ENABLED ? command.open : handleNewChat}
                className="p-2 rounded-lg transition-colors cursor-pointer"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-tertiary)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                title={COMPANY_ENABLED ? t('nav.newCommand') : 'New chat'}
              >
                <Plus size={18} />
              </button>
            </div>
          </div>

          {COMPANY_ENABLED && (
            <>
              <button
                onClick={command.open}
                className="mx-3 mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer"
                style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              >
                <Sparkles size={15} style={{ color: 'var(--color-accent)' }} />
                <span className="flex-1 truncate text-start">{t('nav.newCommand')}</span>
                <kbd className="rounded px-1.5 py-0.5 font-mono text-[10px]" dir="ltr" style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-tertiary)' }}>
                  ⌘K
                </kbd>
              </button>
              <div className="mx-4 mb-2 truncate text-[11px] uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                {current?.organization.name}
              </div>
            </>
          )}

          {/* Model badge */}
          {!COMPANY_ENABLED && (<button
            onClick={() => setCommandPaletteOpen(true)}
            className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer"
            style={{
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-bg-secondary)')}
          >
            {modelLoading ? (
              <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
            ) : (
              <Cpu size={14} />
            )}
            <div className="flex-1 min-w-0">
              <span
                className="truncate block text-left"
                style={{ color: deepResearch ? 'var(--color-accent)' : 'var(--color-text)' }}
              >
                {deepResearch
                  ? 'Deep Research'
                  : selectedModel || serverInfo?.model || 'Select model'}
              </span>
              {modelLoading && (
                <span className="text-[10px] block text-left" style={{ color: 'var(--color-accent)' }}>
                  Loading model...
                </span>
              )}
            </div>
            {!modelLoading && (
              <kbd
                className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-tertiary)' }}
              >
                ⌘K
              </kbd>
            )}
          </button>)}

          {/* Search */}
          {!COMPANY_ENABLED && (<div className="px-3 mb-2">
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
              style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
            >
              <Search size={14} style={{ color: 'var(--color-text-tertiary)' }} />
              <input
                type="text"
                placeholder="Search chats..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm"
                style={{ color: 'var(--color-text)' }}
              />
            </div>
          </div>)}

          {/* Conversation list */}
          {!COMPANY_ENABLED ? (
            <div className="flex-1 overflow-y-auto px-2">
              <ConversationList searchQuery={searchQuery} />
            </div>
          ) : (
            <div className="flex-1" />
          )}

          {/* Bottom nav */}
          <nav className="px-2 pb-3 pt-2 flex flex-col gap-0.5 overflow-y-auto" style={{ borderTop: '1px solid var(--color-border)', maxHeight: '62%' }}>
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => {
                    navigate(item.path);
                    if (window.innerWidth < 768) setSidebarOpen(false);
                  }}
                  className="relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors w-full text-start cursor-pointer"
                  style={{
                    background: isActive ? 'var(--color-accent-subtle)' : 'transparent',
                    color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)',
                    fontWeight: isActive ? 500 : 400,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'var(--color-bg-secondary)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute start-0 top-1.5 bottom-1.5 w-[2px] rounded-full"
                      style={{
                        background: 'var(--color-accent)',
                        boxShadow: '0 0 8px var(--color-accent-glow)',
                      }}
                    />
                  )}
                  <item.icon size={16} style={isActive ? { color: 'var(--color-accent)' } : undefined} />
                  {item.label}
                  {item.badge ? (
                    <span dir="ltr" className="ms-auto min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-semibold" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          <div className="flex items-center justify-between gap-2 px-3 pb-3">
            <LanguageSwitcher className="min-w-0 flex-1" />
            {COMPANY_ENABLED && (
              <button
                onClick={() => void signOut()}
                className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors cursor-pointer"
                style={{ color: 'var(--color-text-secondary)' }}
                title={user?.email ?? t('common.signOut')}
                aria-label={t('common.signOut')}
              >
                <LogOut size={16} className="rtl:-scale-x-100" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
