import React from 'react';
import ReactDOM from 'react-dom/client';
import { LocaleProvider } from './i18n/LocaleContext';
import { App } from './ui/App';
import { seedDurableSettings } from './services/durableStorage';
import './ui/styles.css';

seedDurableSettings().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
});

