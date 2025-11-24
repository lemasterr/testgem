import { useEffect, useState } from 'react';

interface TitleBarProps {
  title: string;
  description?: string;
  onToggleQuickAccess?: () => void;
}

export function TitleBar({ title, description, onToggleQuickAccess }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkState = async () => {
      const api = (window as any).electronAPI;
      if (api?.window?.isWindowMaximized) {
        const state = await api.window.isWindowMaximized();
        setIsMaximized(Boolean(state));
      }
    };

    const handler = (_event: unknown, state: unknown) => setIsMaximized(Boolean(state));

    checkState();
    (window as any).electronAPI?.on?.('window:maximized', handler);

    return () => {
      // ipcRenderer removeListener not exposed; relies on single mounting in app lifecycle
    };
  }, []);

  const handleMin = () => (window as any).electronAPI?.window?.minimize?.();
  const handleMax = () => (window as any).electronAPI?.window?.maximize?.();
  const handleClose = () => (window as any).electronAPI?.window?.close?.();

  return (
    <header className="relative titlebar-drag flex h-14 items-center justify-between overflow-hidden border-b border-white/5 bg-gradient-to-r from-[#0b1221] via-[#0b1020] to-[#0d0b19] px-4 text-sm text-zinc-200 shadow-lg shadow-blue-500/10">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_15%_50%,rgba(59,130,246,0.18),transparent_45%),radial-gradient(circle_at_85%_20%,rgba(99,102,241,0.16),transparent_40%)]" />
      <div className="relative flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/30 to-indigo-500/30 text-blue-100">⚙️</div>
        <div className="flex flex-col leading-tight">
          <span className="text-[11px] uppercase tracking-[0.24em] text-blue-200/70">Sora Suite V2</span>
          <span className="text-base text-white">{title}</span>
          {description && <span className="text-[11px] text-zinc-400">{description}</span>}
        </div>
      </div>

      <div className="relative titlebar-no-drag flex items-center gap-2">
        <button
          onClick={onToggleQuickAccess}
          className="titlebar-no-drag flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-semibold text-blue-100 transition hover:border-blue-400/60 hover:text-white"
        >
          <span className="h-2 w-2 rounded-full bg-blue-400" />
          Quick Access
        </button>
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-200">
          <div className={`h-2 w-2 rounded-full ${isMaximized ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          <span>{isMaximized ? 'Maximized' : 'Connected'}</span>
        </div>
        <div className="ml-2 flex h-9 items-center gap-1 rounded-lg border border-white/5 bg-white/5 px-1">
          <button
            onClick={handleMin}
            className="titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-md text-zinc-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Minimize"
          >
            –
          </button>
          <button
            onClick={handleMax}
            className="titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-md text-zinc-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Maximize"
          >
            {isMaximized ? '❒' : '□'}
          </button>
          <button
            onClick={handleClose}
            className="titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-md text-zinc-300 transition hover:bg-rose-600/80 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>
    </header>
  );
}
