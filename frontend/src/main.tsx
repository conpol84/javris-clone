import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ErrorBoundary, reloadOnStaleBuild } from './components/ErrorBoundary';
import App from './App';
import { I18nProvider } from './i18n/I18nProvider';
import { initApiBase } from './lib/api';
import { initAnalytics } from './lib/analytics';
import './index.css';

function applyTheme() {
  try {
    const raw = localStorage.getItem('openjarvis-settings');
    const settings = raw ? JSON.parse(raw) : {};
    const theme = settings.theme || 'system';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  } catch { /* use system default */ }
}

applyTheme();

// After a new deploy, an already-open tab can't find its old lazy chunks: refresh into the new build.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadOnStaleBuild(new Error('preload'))) e.preventDefault();
});
window.addEventListener('load', () => {
  try { window.setTimeout(() => sessionStorage.removeItem('firbo-stale-reload'), 10_000); } catch { /* ignore */ }
});

// Fetch the API base URL from the Tauri backend before rendering.
// This ensures JARVIS_PORT is defined in one place (the Rust backend).
// In non-Tauri environments this is a no-op.
initApiBase().finally(() => {
  // Kick off analytics init in the background — it's never awaited so
  // a slow/failed identity fetch never delays UI render.
  void initAnalytics();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <I18nProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </I18nProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
});
