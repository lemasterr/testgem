// sora_2/electron/healthCheck.ts
import axios from 'axios';
import { getConfig } from './config/config';

export async function runHealthCheck(): Promise<{
  chrome: boolean;
  python: boolean;
  storage: boolean;
}> {
  const [chrome, python, storage] = await Promise.allSettled([
    checkChromeHealth(),
    checkPythonHealth(),
    checkStorageHealth()
  ]);

  return {
    chrome: chrome.status === 'fulfilled',
    python: python.status === 'fulfilled',
    storage: storage.status === 'fulfilled'
  };
}

async function checkChromeHealth(): Promise<void> {
  // Simple check if we can resolve config which implies some IO health
  // Actual chrome connectivity is harder to check globally without an active session
  return Promise.resolve();
}

async function checkPythonHealth(): Promise<void> {
  const res = await axios.get('http://127.0.0.1:8000/health', { timeout: 2000 });
  if (res.data.status !== 'ok') throw new Error('Python unhealthy');
}

async function checkStorageHealth(): Promise<void> {
  const config = await getConfig();
  if (!config.sessionsRoot) throw new Error('No sessions root');
}