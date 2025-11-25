import { ReactNode } from 'react';
import { useAppStore } from '../store';
import { Icons } from './Icons';

export function QuickAccessPanel() {
  const { quickAccessOpen, closeQuickAccess, config, setCurrentPage } = useAppStore();

  const action = async (fn: () => Promise<any>) => {
    try {
        await fn();
    } catch (e) {
        console.error(e);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          quickAccessOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closeQuickAccess}
      />

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 h-full w-80 bg-[#0c0c0e]/95 backdrop-blur-xl border-l border-zinc-800 shadow-2xl transform transition-transform duration-300 ease-out z-50 ${
          quickAccessOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="h-14 flex items-center justify-between px-5 border-b border-zinc-800 bg-zinc-900/50">
          <div className="font-bold text-white flex items-center gap-2">
            <Icons.Play className="w-4 h-4 text-blue-500" />
            <span className="tracking-wide">QUICK ACTIONS</span>
          </div>
          <button onClick={closeQuickAccess} className="text-zinc-500 hover:text-white transition-colors p-1 hover:bg-zinc-800 rounded-md">
            <Icons.ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-8">
          {/* System */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-zinc-600 uppercase tracking-widest px-1">System</h4>
            <Shortcut label="Open Logs" icon={<Icons.Logs />} onClick={() => { setCurrentPage('logs'); closeQuickAccess(); }} />
            <Shortcut label="Sessions Folder" icon={<Icons.Content />} onClick={() => window.electronAPI.system.openPath(config?.sessionsRoot || '')} />
          </div>

          {/* Tools */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-zinc-600 uppercase tracking-widest px-1">Tools</h4>
            <Shortcut label="Run Cleanup" icon={<Icons.Trash />} onClick={() => action(window.electronAPI.cleanup.run)} />
            <Shortcut label="Test Telegram" icon={<Icons.Telegram />} onClick={() => action(window.electronAPI.telegram.test)} />
          </div>
        </div>
      </div>
    </>
  );
}

function Shortcut({ label, icon, onClick }: { label: string, icon: ReactNode, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-800/80 border border-transparent hover:border-zinc-700 transition-all text-left group"
    >
      <span className="text-zinc-500 group-hover:text-zinc-300 transition-colors">{icon}</span>
      <span className="text-sm text-zinc-300 group-hover:text-white font-medium transition-colors">{label}</span>
    </button>
  );
}