import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { Icons } from './Icons';

export const TelegramPage: React.FC = () => {
  const { config, refreshConfig } = useAppStore();
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
    await window.electronAPI.config.update({
      telegram: { enabled, botToken: botToken || null, chatId: chatId || null },
    });
    refreshConfig();
    setStatus('Configuration saved');
    setTimeout(() => setStatus(''), 3000);
  };

  const test = async () => {
    setStatus('Sending test message...');
    const res = await window.electronAPI.telegram.test();
    setStatus(res.ok ? 'Test passed!' : `Failed: ${res.error}`);
  };

  return (
    <div className="max-w-2xl mx-auto pt-10">
      <div className="relative card overflow-hidden bg-gradient-to-b from-zinc-900 to-black border-zinc-800 p-8 shadow-2xl">
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>

        <div className="flex items-center gap-5 border-b border-zinc-800/50 pb-6 mb-6 relative z-10">
          <div className="p-4 rounded-2xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-inner">
            <Icons.Telegram className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Telegram Integration</h2>
            <p className="text-sm text-zinc-400">Receive instant notifications about pipeline status directly to your device.</p>
          </div>
        </div>

        <div className="space-y-6 relative z-10">
          <div className="flex items-center justify-between p-4 bg-zinc-800/30 rounded-xl border border-zinc-800">
            <div>
              <div className="font-medium text-zinc-200">Enable Notifications</div>
              <div className="text-xs text-zinc-500">Send messages on finish and errors</div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="sr-only peer" />
              <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Bot Token</label>
              <input
                type="password"
                className="input-field font-mono text-sm bg-black/40 border-zinc-800 focus:border-blue-500/50 transition-all"
                value={botToken}
                onChange={e => setBotToken(e.target.value)}
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Chat ID</label>
              <input
                className="input-field font-mono text-sm bg-black/40 border-zinc-800 focus:border-blue-500/50 transition-all"
                value={chatId}
                onChange={e => setChatId(e.target.value)}
                placeholder="-100123456789"
              />
            </div>
          </div>

          <div className="pt-6 border-t border-zinc-800/50 flex items-center justify-between">
            <span className={`text-sm font-medium transition-colors ${status.includes('Failed') ? 'text-rose-400' : 'text-emerald-400'}`}>
              {status}
            </span>
            <div className="flex gap-3">
              <button onClick={test} disabled={!enabled} className="btn-secondary bg-zinc-800/50 border-zinc-700">
                Send Test
              </button>
              <button onClick={save} className="btn-primary px-6 shadow-lg shadow-blue-900/20">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};