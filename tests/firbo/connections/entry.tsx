// Actual app; data and service responses are isolated test fixtures only.
import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router';
import App from '../../../frontend/src/App';import{I18nProvider}from'../../../frontend/src/i18n/I18nProvider';import{ErrorBoundary}from'../../../frontend/src/components/ErrorBoundary';import './entry.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><I18nProvider><BrowserRouter><App/></BrowserRouter></I18nProvider></ErrorBoundary></React.StrictMode>);
