import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { COMPANY_ENABLED } from '../lib/company/client';
import { ApprovalBell } from './ApprovalBell';
import { Sidebar } from './Sidebar/Sidebar';
import { SystemPulse } from './SystemPulse';
import { useAppStore } from '../lib/store';
import { useI18n } from '../i18n/I18nProvider';
import { checkHealth } from '../lib/api';
import { BottomNav } from './command/BottomNav';
import { WindowControls } from './command/WindowControls';
import { CommandProvider } from './command/CommandHost';
import '../styles/mobile-foundation.css';
import '../styles/mobile-pages.css';
import '../styles/mobile-operations.css';

export function Layout() {
  const { t } = useI18n();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);

  // On phones the sidebar is an overlay: start collapsed so the page itself is visible.
  useEffect(() => {
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, [setSidebarOpen]);

  useEffect(() => {
    if (COMPANY_ENABLED) return; // the hosted workspace reports its own status per page
    const check = () => checkHealth().then(setApiReachable);
    check();
    const interval = setInterval(check, 30000);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Company pages report their own status; the backend banner only matters for chat & legacy pages.
  const ownsStatus = COMPANY_ENABLED && ['/', '/office', '/tasks', '/gateway', '/team', '/inbox', '/activity', '/people'].includes(pathname);

  const shell = (
    <div className="flex flex-col h-full w-full min-w-0 overflow-hidden relative" style={{ paddingTop: '3px' }}>
      <div className="hud-backdrop" aria-hidden="true" />
      {COMPANY_ENABLED && <WindowControls />}
      {COMPANY_ENABLED && <BottomNav />}
      {!COMPANY_ENABLED && <SystemPulse apiReachable={apiReachable} />}
      {!COMPANY_ENABLED && <ApprovalBell />}

      {/* Health check banner */}
      {apiReachable === false && !ownsStatus && (
        <div
          className="flex items-center gap-3 px-4 py-2 text-sm shrink-0"
          style={{
            background: 'color-mix(in srgb, var(--color-error) 8%, transparent)',
            borderBottom: '1px solid color-mix(in srgb, var(--color-error) 15%, transparent)',
            color: 'var(--color-text)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: 'var(--color-error)' }}
          />
          <span>{t('layout.backendDown')}</span>
          <button
            onClick={() => navigate('/settings')}
            className="text-sm underline cursor-pointer ms-auto shrink-0"
            style={{ color: 'var(--color-accent)' }}
          >
            {t('layout.changeUrl')}
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0 min-w-0 relative z-10">
        <Sidebar />
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/40 md:hidden"
            onClick={() => useAppStore.getState().setSidebarOpen(false)}
          />
        )}
        <main data-firbo-route={pathname} className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden" style={{ background: 'transparent' }}>
          <div className={`flex-1 flex flex-col min-w-0 min-h-0 relative z-[2] ${COMPANY_ENABLED ? 'fb-main-pad' : ''}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
  return COMPANY_ENABLED ? <CommandProvider>{shell}</CommandProvider> : shell;
}
