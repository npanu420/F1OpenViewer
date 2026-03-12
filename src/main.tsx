import React from 'react';
import ReactDOM from 'react-dom/client';
import { LocaleProvider } from './i18n/LocaleContext';
import { App } from './ui/App';
import './ui/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <LocaleProvider>
    <App />
  </LocaleProvider>,
);

