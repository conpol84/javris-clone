import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from '../../../frontend/src/App';
import { I18nProvider } from '../../../frontend/src/i18n/I18nProvider';
import { ErrorBoundary } from '../../../frontend/src/components/ErrorBoundary';
import './entry.css';
// The actual App, route tree, Layout and page components. Only data is synthetic.
createRoot(document.getElementById('root')!).render(<ErrorBoundary><I18nProvider><BrowserRouter><App /></BrowserRouter></I18nProvider></ErrorBoundary>);
