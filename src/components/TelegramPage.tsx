import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store';

export const TelegramPage: React.FC = () => {
  const { config, refreshConfig, setConfig } = useAppStore();
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (config) {
      setBotToken(config.telegram?.botToken ?? '');
      setChatId(config.telegram?.chatId ?? '');
      setEnabled(config.telegram?.enabled ?? false);
    }
  }, [config]);

  const save = async () => {
    const updated = await window.electronAPI.updateConfig({
      telegram: {
        enabled,
        botToken: botToken || null,
        chatId: chatId || null,
      },
    });
    setConfig(updated as any);
    setStatus('Saved');
  };

  const sendTest = async () => {
    setStatus('Sending test…');
    const result = await window.electronAPI.telegramTest();
    setStatus(result.ok ? result.details || 'Sent' : result.error || 'Failed');
    await refreshConfig();
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-white">Telegram Configuration</h3>
        <p className="text-sm text-slate-400">Manage bot credentials and optional auto-send.</p>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div>
          <label className="text-sm text-slate-300">Bot Token</label>
          <input
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            placeholder="123456:ABCDEF"
          />
        </div>
        <div>
          <label className="text-sm text-slate-300">Chat ID</label>
          <input
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            placeholder="@channel or chat id"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable Telegram notifications
        </label>
        <div className="flex gap-2">
          <button
            onClick={save}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-500"
          >
            Save
          </button>
          <button
            onClick={sendTest}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-indigo-500 hover:text-indigo-200"
          >
            Send test message
          </button>
        </div>
        {status && <div className="text-xs text-slate-400">{status}</div>}
      </div>
    </div>
  );
};
