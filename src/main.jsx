import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './store.jsx';
import { AuthGate } from './auth.jsx';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <AuthGate>
    {(user) => (
      <AppProvider user={user}>
        <App />
      </AppProvider>
    )}
  </AuthGate>
);
