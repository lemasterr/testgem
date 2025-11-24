import React from 'react';

function detectElectron(): boolean {
  const w = window as any;

  // 1) Стандартный путь — есть bridge от preload
  const hasBridge = typeof w.electronAPI !== 'undefined' && w.electronAPI !== null;

  // 2) Доп. проверка — по userAgent
  const ua = (navigator?.userAgent || '').toLowerCase();
  const hasElectronUA = ua.includes('electron');

  // 3) На всякий случай — если вдруг process прокинут
  const hasProcessElectron = !!(w.process && w.process.versions && w.process.versions.electron);

  return hasBridge || hasElectronUA || hasProcessElectron;
}

export const ElectronGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isElectron = detectElectron();

  if (!isElectron) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-900 text-slate-100">
        <div className="max-w-lg rounded-2xl border border-slate-700 bg-slate-800/80 p-6 shadow-xl">
          <h1 className="mb-3 text-xl font-semibold">Electron backend is not available</h1>
          <p className="text-sm text-slate-300">
            This interface is designed to run inside the Sora desktop app (Electron). Please start it via the provided
            start script or packaged app, instead of opening the Vite dev URL directly in your browser.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

