// This build is isolated from real accounts, endpoints and credentials.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from '../../../frontend/src/App';
import { getVoiceSnapshot, voiceLevel } from '../../../frontend/src/lib/company/voiceActivity';
import { I18nProvider } from '../../../frontend/src/i18n/I18nProvider';
import { ErrorBoundary } from '../../../frontend/src/components/ErrorBoundary';
import './entry.css';
Object.assign(window,{__firboVoice:{snapshot:getVoiceSnapshot,level:()=>voiceLevel.value}});
createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><I18nProvider><BrowserRouter><App /></BrowserRouter></I18nProvider></ErrorBoundary></React.StrictMode>);
