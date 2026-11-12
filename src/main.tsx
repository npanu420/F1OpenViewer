import React from 'react';
import { MotionConfig } from 'framer-motion';
import ReactDOM from 'react-dom/client';
import { LocaleProvider } from './i18n/LocaleContext';
import { App } from './ui/App';
import { seedDurableSettings } from './services/durableStorage';
// Bundled fonts (Latin subset covers English + Italian). Weights match what the UI uses.
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import './ui/styles.css';

// The multiview hand-off state is only needed between opening a popout and its first load. Older
// versions also left account tokens in it, so the main window (no hash) drops any leftover copy.
try {
  if (!window.location.hash) {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('f1openviewer-standalone-multiview')) localStorage.removeItem(key);
    }
  }
} catch (_) {}

seedDurableSettings().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <MotionConfig reducedMotion="user"><LocaleProvider>
      <App />
    </LocaleProvider></MotionConfig>,
  );
});

