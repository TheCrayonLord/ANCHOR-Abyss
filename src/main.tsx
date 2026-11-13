import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Handle for automated tests and power users (inspect the catalog from the console).
(window as any).__abyss = { store: () => import('./catalog/store').then((m) => m.store) };

// Offline support for the built app (the service worker precaches every built file).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support unavailable */ }));
}
