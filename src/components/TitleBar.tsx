import { useEffect, useState } from 'react';
import { Icons } from './Icons';

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

    return () => {};
  }, []);

  const handleMin = () => (window as any).electronAPI?.window?.minimize?.();
  const handleMax = () => (window as any).electronAPI?.window?.maximize?.();
  const handleClose = () => (window as any).electronAPI?.window?.close?.();

  return (
    <header className="relative titlebar-drag flex h-14 items-center justify-between border-b border-zinc-800 bg-[#09090b] px-4 text-sm shadow-sm z-50">
      <div className="flex items-center gap-3">
        <div className="flex flex-col leading-tight">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Page</span>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-zinc-100">{title}</span>
            {description && <span className="hidden text-xs text-zinc-500 md:inline-block">— {description}</span>}
          </div>
        </div>
      </div>

      <div className="titlebar-no-drag flex items-center gap-3">
        <button
          onClick={onToggleQuickAccess}
          className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
        >
          <Icons.Play className="h-3 w-3 text-emerald-500" />
          Quick Actions
        </button>

        <div className="flex items-center gap-1 pl-2 border-l border-zinc-800">
          <button
            onClick={handleMin}
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
          >
            <Icons.Minimize className="w-3 h-3" />
          </button>
          <button
            onClick={handleMax}
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
          >
            {isMaximized ? (
               <Icons.Restore className="w-3 h-3" />
            ) : (
               <Icons.Maximize className="w-3 h-3" />
            )}
          </button>
          <button
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition hover:bg-rose-900/30 hover:text-rose-200"
          >
            <Icons.Close className="w-3 h-3" />
          </button>
        </div>
      </div>
    </header>
  );
}