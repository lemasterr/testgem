import { ReactNode, useMemo, useState } from 'react';
import { useAppStore } from '../store';
import { buildDynamicWorkflow } from '../../shared/types';

type ShortcutResult = { ok?: boolean; error?: string } | unknown;

export function QuickAccessPanel() {
  const { quickAccessOpen, closeQuickAccess, config, setCurrentPage, sessions } = useAppStore();
  const api = useMemo(() => window.electronAPI, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const defaultWorkflow = useMemo(() => buildDynamicWorkflow(sessions), [sessions]);

  const run = async (label: string, fn?: () => Promise<ShortcutResult>) => {
    if (!fn) return;
    setBusy(label);
    setResult(null);
    try {
      const res = await fn();
      const ok = typeof res === 'object' && res !== null && 'ok' in (res as any) ? (res as any).ok !== false : true;
      setResult(ok ? `${label} completed` : (res as any)?.error || `${label} failed`);
    } catch (error) {
      setResult((error as Error)?.message || `${label} failed`);
    } finally {
      setBusy(null);
    }
  };

  const openPath = (target?: string | null) => {
    if (!target) return;
    api?.system?.openPath?.(target);
  };

  return (
    <div
      className={`pointer-events-auto fixed right-0 top-14 z-30 h-[calc(100%-56px)] w-[320px] transform overflow-y-auto border-l border-zinc-800 bg-zinc-900/95 p-4 shadow-xl transition-transform duration-200 ${quickAccessOpen ? 'translate-x-0' : 'translate-x-full'}`}
    >
      <div className="flex items-center justify-between pb-3">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-blue-400">Quick Access</div>
          <div className="text-base font-semibold text-white">Shortcuts & Tools</div>
        </div>
        <button
          onClick={closeQuickAccess}
          className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Close
        </button>
      </div>

      <div className="space-y-3 text-sm">
        <ShortcutGroup title="Folders">
          <ShortcutButton label="Open Sessions Folder" onClick={() => openPath(config?.sessionsRoot)} />
          <ShortcutButton label="Open Downloads Root" onClick={() => openPath(config?.sessionsRoot)} />
          <ShortcutButton label="Open Logs Folder" onClick={() => api?.system?.openLogs?.()} />
        </ShortcutGroup>

        <ShortcutGroup title="Actions">
          <ShortcutButton
            label="Run Default Pipeline"
            loading={busy === 'Run Default Pipeline'}
            onClick={() =>
              run(
                'Run Default Pipeline',
                () => api?.pipeline?.run?.(defaultWorkflow) ?? Promise.resolve({ ok: false, error: 'No pipeline' })
              )
            }
          />
          <ShortcutButton
            label="Run Cleanup (Dry-run)"
            loading={busy === 'Run Cleanup (Dry-run)'}
            onClick={() => run('Run Cleanup (Dry-run)', () => api?.cleanup?.run?.())}
          />
          <ShortcutButton
            label="Test Telegram"
            loading={busy === 'Test Telegram'}
            onClick={() => run('Test Telegram', () => api?.telegram?.test?.())}
          />
          <ShortcutButton
            label="Open Global Logs"
            onClick={() => {
              setCurrentPage('logs');
              closeQuickAccess();
            }}
          />
        </ShortcutGroup>
      </div>

      {result && (
        <div className="mt-4 rounded-md border border-zinc-700 bg-zinc-800 p-3 text-xs text-zinc-200">{result}</div>
      )}
    </div>
  );
}

function ShortcutGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{title}</div>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

function ShortcutButton({ label, onClick, loading }: { label: string; onClick?: () => void; loading?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex w-full items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-left text-sm text-zinc-100 hover:border-blue-500/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span>{label}</span>
      {loading && <span className="text-[10px] text-blue-300">Running…</span>}
    </button>
  );
}
