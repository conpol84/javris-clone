import { useEffect, useState, useCallback, useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { Layout } from './components/Layout';
import { COMPANY_ENABLED } from './lib/company/client';
import { CompanyAuthProvider } from './lib/company/AuthProvider';
import { LocaleSync } from './components/company/LocaleSync';
import { AuthGate } from './components/company/AuthGate';
import { CommandPalette } from './components/CommandPalette';
import { SetupScreen } from './components/SetupScreen';
import { Toaster } from './components/ui/sonner';
import { useAppStore } from './lib/store';
import { fetchModels, fetchServerInfo, fetchSavings, submitSavings, isTauri } from './lib/api';
import { OptInModal } from './components/OptInModal';
import { UpdateChecker } from './components/Desktop/UpdateChecker';
import { track, hashId } from './lib/analytics';
import { LEADERBOARD_ENABLED } from './lib/supabase';
import { lazyPage } from './lib/lazyPage';

const ChatPage = lazyPage(() => import('./pages/ChatPage'), 'ChatPage');
const DashboardPage = lazyPage(() => import('./pages/DashboardPage'), 'DashboardPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const GetStartedPage = lazyPage(() => import('./pages/GetStartedPage'), 'GetStartedPage');
const AgentsPage = lazyPage(() => import('./pages/AgentsPage'), 'AgentsPage');
const DataSourcesPage = lazyPage(() => import('./pages/DataSourcesPage'), 'DataSourcesPage');
const LogsPage = lazyPage(() => import('./pages/LogsPage'), 'LogsPage');
const TasksPage = lazyPage(() => import('./pages/TasksPage'), 'TasksPage');
const CommandCenterPage = lazyPage(() => import('./pages/CommandCenterPage'), 'CommandCenterPage');
const OfficePage = lazyPage(() => import('./pages/OfficePage'), 'OfficePage');
const GatewayPage = lazyPage(() => import('./pages/GatewayPage'), 'GatewayPage');
const TeamPage = lazyPage(() => import('./pages/TeamPage'), 'TeamPage');
const InboxPage = lazyPage(() => import('./pages/InboxPage'), 'InboxPage');
const ActivityPage = lazyPage(() => import('./pages/ActivityPage'), 'ActivityPage');
const PeoplePage = lazyPage(() => import('./pages/PeoplePage'), 'PeoplePage');
const FirboSettingsPage = lazyPage(() => import('./pages/FirboSettingsPage'), 'FirboSettingsPage');
const AdminPage = lazyPage(() => import('./pages/AdminPage'), 'AdminPage');
const AnalyticsPage = lazyPage(() => import('./pages/AnalyticsPage'), 'AnalyticsPage');
const ShiftsPage = lazyPage(() => import('./pages/ShiftsPage'), 'ShiftsPage');
const MissionsPage = lazyPage(() => import('./pages/MissionsPage'), 'MissionsPage');
const CeoPage = lazyPage(() => import('./pages/CeoPage'), 'CeoPage');
const StorePage = lazyPage(() => import('./pages/StorePage'), 'StorePage');
const ReviewsPage = lazyPage(() => import('./pages/ReviewsPage'), 'ReviewsPage');
const MemoryPage = lazyPage(() => import('./pages/MemoryPage'), 'MemoryPage');
const BillingPage = lazyPage(() => import('./pages/BillingPage'), 'BillingPage');
const HubPage = lazyPage(() => import('./pages/HubPage'), 'HubPage');
const CodingPage = lazyPage(() => import('./pages/CodingPage'), 'CodingPage');
const ComputersPage = lazyPage(() => import('./pages/ComputersPage'), 'ComputersPage');
const StudioPage = lazyPage(() => import('./pages/StudioPage'), 'StudioPage');
const IntegrationsPage = lazyPage(() => import('./pages/IntegrationsPage'), 'IntegrationsPage');
const AgentChatPage = lazyPage(() => import('./pages/AgentChatPage'), 'AgentChatPage');
const CompaniesPage = lazyPage(() => import('./pages/CompaniesPage'), 'CompaniesPage');

function AuthedApp() {
  const [setupDone, setSetupDone] = useState(!isTauri());
  const handleSetupReady = useCallback(() => {
    setSetupDone(true);
    // Only fire once per install — guard against setup screen re-appearing
    // on reinstalls or dev reloads.
    if (!localStorage.getItem('oj-setup-completed')) {
      localStorage.setItem('oj-setup-completed', '1');
      track('setup_completed', { preset: 'default' });
    }
  }, []);
  const prevModelRef = useRef<string>('');
  const setModels = useAppStore((s) => s.setModels);
  const setModelsLoading = useAppStore((s) => s.setModelsLoading);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setServerInfo = useAppStore((s) => s.setServerInfo);
  const setSavings = useAppStore((s) => s.setSavings);
  const settings = useAppStore((s) => s.settings);
  const commandPaletteOpen = useAppStore((s) => s.commandPaletteOpen);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const optInEnabled = useAppStore((s) => s.optInEnabled);
  const optInDisplayName = useAppStore((s) => s.optInDisplayName);
  const optInEmail = useAppStore((s) => s.optInEmail);
  const optInAnonId = useAppStore((s) => s.optInAnonId);
  const optInModalSeen = useAppStore((s) => s.optInModalSeen);
  const optInModalOpen = useAppStore((s) => s.optInModalOpen);
  const setOptInModalOpen = useAppStore((s) => s.setOptInModalOpen);
  const markOptInModalSeen = useAppStore((s) => s.markOptInModalSeen);
  const savings = useAppStore((s) => s.savings);

  // Apply theme class to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    // Firbo is designed dark-first: only an explicit "light" choice leaves it.
    const theme = settings.theme === 'system' && COMPANY_ENABLED ? 'dark' : settings.theme;
    if (theme === 'dark') root.classList.add('dark');
    else if (theme === 'light') root.classList.add('light');
  }, [settings.theme]);

  // Sync overlay conversations into the main app
  const importOverlay = useAppStore((s) => s.importOverlayConversation);
  useEffect(() => {
    if (!isTauri()) return;
    importOverlay();
    const interval = setInterval(importOverlay, 5000);
    return () => clearInterval(interval);
  }, [importOverlay]);

  // Fetch models on mount (legacy local-assistant backend: not used by the hosted workspace)
  useEffect(() => {
    if (COMPANY_ENABLED) return;
    fetchModels()
      .then((m) => {
        setModels(m);
      })
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch server info
  useEffect(() => {
    if (COMPANY_ENABLED) return;
    fetchServerInfo().then(setServerInfo).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll savings and optionally share to Supabase
  useEffect(() => {
    if (COMPANY_ENABLED) return;
    const refresh = () =>
      fetchSavings()
        .then((data) => {
          setSavings(data);
          if (optInEnabled && optInDisplayName && data) {
            const claudeEntry = data.per_provider.find(
              (p) => p.provider === 'claude-fable-5',
            );
            const dollarSavings = claudeEntry ? claudeEntry.total_cost : 0;
            const energySaved = data.per_provider.reduce(
              (sum, p) => sum + (p.energy_wh || 0),
              0,
            );
            const flopsSaved = data.per_provider.reduce(
              (sum, p) => sum + (p.flops || 0),
              0,
            );
            submitSavings({
              anon_id: optInAnonId,
              display_name: optInDisplayName,
              email: optInEmail,
              total_calls: data.total_calls,
              total_tokens: data.total_tokens,
              dollar_savings: dollarSavings,
              energy_wh_saved: energySaved,
              flops_saved: flopsSaved,
              token_counting_version: data.token_counting_version ?? 1,
            });
          }
        })
        .catch(() => {});
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [optInEnabled, optInDisplayName, optInAnonId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show opt-in modal on first visit
  useEffect(() => {
    if (LEADERBOARD_ENABLED && !optInModalSeen) {
      setOptInModalOpen(true);
      markOptInModalSeen();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fire model_changed when the user switches models. First mount is
  // not a "change" — only emit when both prev and current are real and
  // differ.
  useEffect(() => {
    const prev = prevModelRef.current;
    const curr = selectedModel || '';
    prevModelRef.current = curr;
    if (!prev || !curr || prev === curr) return;
    void (async () => {
      const [fromHash, toHash] = await Promise.all([
        hashId(prev),
        hashId(curr),
      ]);
      track('model_changed', {
        from_model_hash: fromHash,
        to_model_hash: toHash,
      });
    })();
  }, [selectedModel]);

  // app_opened — one-shot per app launch, fires after analytics has had
  // a chance to initialize. platform + version are super-properties
  // registered in analytics.ts initAnalytics, so no per-call props needed.
  useEffect(() => {
    const t = setTimeout(() => {
      track('app_opened', {});
    }, 500);
    return () => clearTimeout(t);
  }, []);

  const toggleSystemPanel = useAppStore((s) => s.toggleSystemPanel);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!COMPANY_ENABLED && (e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        toggleSystemPanel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen, toggleSystemPanel]);


  if (!setupDone) {
    return <SetupScreen onReady={handleSetupReady} />;
  }

  return (
    <>
      <UpdateChecker />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={COMPANY_ENABLED ? <CommandCenterPage /> : <ChatPage />} />
          <Route path="chat" element={COMPANY_ENABLED ? <AgentChatPage /> : <ChatPage />} />
          <Route path="office" element={<OfficePage />} />
          <Route path="gateway" element={<GatewayPage />} />
          <Route path="analytics" element={COMPANY_ENABLED ? <AnalyticsPage /> : <Navigate to="/" replace />} />
          <Route path="integrations" element={COMPANY_ENABLED ? <IntegrationsPage /> : <Navigate to="/" replace />} />
          <Route path="admin" element={COMPANY_ENABLED ? <AdminPage /> : <Navigate to="/" replace />} />
          <Route path="studio" element={COMPANY_ENABLED ? <StudioPage /> : <Navigate to="/" replace />} />
          <Route path="computers" element={COMPANY_ENABLED ? <ComputersPage /> : <Navigate to="/" replace />} />
          <Route path="coding" element={COMPANY_ENABLED ? <CodingPage /> : <Navigate to="/" replace />} />
          <Route path="hub" element={COMPANY_ENABLED ? <HubPage /> : <Navigate to="/" replace />} />
          <Route path="billing" element={COMPANY_ENABLED ? <BillingPage /> : <Navigate to="/" replace />} />
          <Route path="memory" element={COMPANY_ENABLED ? <MemoryPage /> : <Navigate to="/" replace />} />
          <Route path="reviews" element={COMPANY_ENABLED ? <ReviewsPage /> : <Navigate to="/" replace />} />
          <Route path="store" element={COMPANY_ENABLED ? <StorePage /> : <Navigate to="/" replace />} />
          <Route path="ceo" element={COMPANY_ENABLED ? <CeoPage /> : <Navigate to="/" replace />} />
          <Route path="missions" element={COMPANY_ENABLED ? <MissionsPage /> : <Navigate to="/" replace />} />
          <Route path="shifts" element={COMPANY_ENABLED ? <ShiftsPage /> : <Navigate to="/" replace />} />
          <Route path="companies" element={COMPANY_ENABLED ? <CompaniesPage /> : <Navigate to="/" replace />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="people" element={<PeoplePage />} />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="signup" element={<Navigate to="/" replace />} />
          {/* The local-assistant pages need the desktop backend; in the hosted workspace they land on the Command Center. */}
          <Route path="dashboard" element={COMPANY_ENABLED ? <Navigate to="/" replace /> : <DashboardPage />} />
          <Route path="settings" element={COMPANY_ENABLED ? <FirboSettingsPage /> : <SettingsPage />} />
          <Route path="get-started" element={COMPANY_ENABLED ? <Navigate to="/" replace /> : <GetStartedPage />} />
          <Route path="data-sources" element={COMPANY_ENABLED ? <Navigate to="/" replace /> : <DataSourcesPage />} />
          <Route path="agents" element={COMPANY_ENABLED ? <Navigate to="/" replace /> : <AgentsPage />} />
          <Route path="logs" element={COMPANY_ENABLED ? <Navigate to="/" replace /> : <LogsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="company" element={<Navigate to="/tasks" replace />} />
        </Route>
      </Routes>
      <Toaster position="bottom-right" />
      {!COMPANY_ENABLED && commandPaletteOpen && <CommandPalette />}
      {optInModalOpen && (
        <OptInModal onClose={() => setOptInModalOpen(false)} />
      )}
    </>
  );
}

/** Public site + login gate first; the app (and its backend calls) only mounts after sign-in. */
export default function App() {
  return (
    <CompanyAuthProvider>
      <LocaleSync />
      <AuthGate>
        <AuthedApp />
      </AuthGate>
    </CompanyAuthProvider>
  );
}
