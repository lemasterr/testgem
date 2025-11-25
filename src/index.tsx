import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ElectronGuard } from './components/ElectronGuard';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ElectronGuard>
      <App />
    </ElectronGuard>
  </React.StrictMode>,
);
