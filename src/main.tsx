import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// Handle for automated tests and power users (inspect the catalog from the console).
(window as any).__abyss = { store: () => import('./catalog/store').then((m) => m.store) };

// Offline support for the built app (the service worker precaches every built file).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // When a new version takes over, reload once so the update shows right away.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support unavailable */ }));
}
