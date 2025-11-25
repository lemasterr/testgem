import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ElectronGuard } from './components/ElectronGuard';
import { useAppStore } from './store';
import './index.css';

const InitWrapper = ({ children }: { children: React.ReactNode }) => {
    const loadInitialData = useAppStore(s => s.loadInitialData);
    useEffect(() => {
        loadInitialData();
    }, []);
    return <>{children}</>;
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ElectronGuard>
        <InitWrapper>
            <App />
        </InitWrapper>
    </ElectronGuard>
  </React.StrictMode>,
);