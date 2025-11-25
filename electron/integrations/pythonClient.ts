// lemasterr/testgem/testgem-2/electron/integrations/pythonClient.ts
import axios from 'axios';
import { spawn, ChildProcess, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logInfo, logError } from '../logging/logger';
import { getConfig } from '../config/config';

const PYTHON_PORT = 8000;
const BASE_URL = `http://127.0.0.1:${PYTHON_PORT}`;

let pythonProcess: ChildProcess | null = null;

/**
 * Убивает любой процесс, занимающий порт 8000, перед запуском нового.
 * Это предотвращает ошибку "Address already in use".
 */
function killProcessOnPort(port: number) {
  try {
    if (process.platform === 'win32') {
      // Находим PID процесса, занимающего порт
      const output = execSync(`netstat -ano | findstr :${port}`).toString();
      const lines = output.split('\n').filter(line => line.trim().length > 0);

      lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && parseInt(pid) > 0) {
          try {
            execSync(`taskkill /PID ${pid} /F`);
            logInfo('Python', `Killed stale process on port ${port} (PID: ${pid})`);
          } catch { /* ignore */ }
        }
      });
    } else {
      // macOS / Linux
      try {
        // lsof -t -i:8000 возвращает PID
        const pid = execSync(`lsof -t -i:${port}`).toString().trim();
        if (pid) {
          process.kill(parseInt(pid), 'SIGKILL');
          logInfo('Python', `Killed stale process on port ${port} (PID: ${pid})`);
        }
      } catch { /* ignore if no process found */ }
    }
  } catch (e) {
    // Игнорируем ошибки, если процесса нет или нет прав
  }
}

/**
 * Определяет путь к интерпретатору Python.
 * Ищет venv в папке python-core, созданный через start.sh.
 */
function getPythonPath(): string {
  const rootDir = process.cwd();
  const isWin = process.platform === 'win32';

  // Пути к venv
  const venvPython = isWin
    ? path.join(rootDir, 'python-core', 'venv', 'Scripts', 'python.exe')
    : path.join(rootDir, 'python-core', 'venv', 'bin', 'python');

  if (fs.existsSync(venvPython)) {
    logInfo('Python', `Using venv python: ${venvPython}`);
    return venvPython;
  }

  // Фолбек на системный
  const systemPython = isWin ? 'python' : 'python3';
  logInfo('Python', `Venv not found at ${venvPython}. Falling back to system: ${systemPython}`);
  return systemPython;
}

export async function startPythonServer(): Promise<void> {
  if (pythonProcess) {
    logInfo('Python', 'Server already running, restarting...');
    stopPythonServer();
  }

  // 1. Очистка порта перед запуском
  killProcessOnPort(PYTHON_PORT);

  const config = await getConfig();
  const ffmpegPath = config.ffmpegPath || '';
  const pythonExec = getPythonPath();
  const scriptPath = path.join(process.cwd(), 'python-core', 'main.py');

  logInfo('Python', `Spawning core server...`);

  return new Promise((resolve, reject) => {
    try {
      pythonProcess = spawn(pythonExec, [scriptPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHON_CORE_PORT: String(PYTHON_PORT),
          FFMPEG_BINARY: ffmpegPath,
          PYTHONUNBUFFERED: '1' // Важно: отключает буферизацию вывода Python
        }
      });
    } catch (err) {
      const message = (err as Error).message;
      logError('Python', `Failed to spawn: ${message}`);
      reject(new Error(`Failed to spawn Python: ${message}`));
      return;
    }

    // Логирование stdout
    pythonProcess.stdout?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) logInfo('PythonCore', msg);
    });

    // Логирование stderr (FastAPI пишет логи сюда)
    pythonProcess.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (!msg) return;
      // Фильтруем обычные инфо-логи uvicorn, чтобы они не выглядели как ошибки Electron
      if (msg.toLowerCase().includes('error') || msg.toLowerCase().includes('exception')) {
        logError('PythonCore', msg);
      } else {
        logInfo('PythonCore', msg);
      }
    });

    pythonProcess.on('error', (err) => {
      logError('Python', `Process error: ${err.message}`);
      pythonProcess = null;
      reject(err);
    });

    pythonProcess.on('close', (code) => {
      logInfo('Python', `Core server exited with code ${code}`);
      pythonProcess = null;
    });

    // Health check loop
    const healthCheckPromise = (async () => {
      const maxRetries = 20; // 20 * 500ms = 10 секунд на старт
      for (let i = 0; i < maxRetries; i++) {
        try {
          await axios.get(`${BASE_URL}/health`, { timeout: 500 });
          logInfo('Python', 'Core server is healthy via HTTP');
          return resolve();
        } catch (e) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      const msg = 'Python startup timed out. Check logs for missing dependencies.';
      logError('Python', msg);
      stopPythonServer();
      reject(new Error(msg));
    })();

    healthCheckPromise.catch(reject);
  });
}

export function stopPythonServer() {
  if (pythonProcess) {
    logInfo('Python', 'Stopping server process...');

    // На Windows kill() убивает только wrapper, используем taskkill
    if (process.platform === 'win32') {
        try {
            if (pythonProcess.pid) execSync(`taskkill /pid ${pythonProcess.pid} /f /t`);
        } catch (e) { /* ignore */ }
    }

    pythonProcess.kill();
    pythonProcess = null;
  }
}

// --- Video API ---

export async function pythonBlur(inputDir: string, outputDir: string, config: any = {}): Promise<{ ok: boolean; details?: string; error?: string }> {
  try {
    const res = await axios.post(`${BASE_URL}/video/blur`, { input_dir: inputDir, output_dir: outputDir, config });
    return res.data;
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function pythonMerge(inputDir: string, outputFile: string, mode = 'concat'): Promise<{ ok: boolean; details?: string; error?: string }> {
  try {
    const res = await axios.post(`${BASE_URL}/video/merge`, { input_dir: inputDir, output_file: outputFile, mode });
    return res.data;
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function pythonCleanMetadata(inputDir: string): Promise<{ ok: boolean; details?: string; error?: string }> {
  try {
    const res = await axios.post(`${BASE_URL}/video/clean-metadata`, { input_dir: inputDir });
    return res.data;
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function pythonQA(inputDir: string): Promise<{ ok: boolean; report?: any; error?: string }> {
  try {
    const res = await axios.post(`${BASE_URL}/video/qa`, { input_dir: inputDir });
    return res.data;
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// --- Analytics API ---

export async function pythonRecordEvent(eventType: string, sessionId: string, payload: any = {}): Promise<void> {
  try {
    axios.post(`${BASE_URL}/analytics/record`, { event_type: eventType, session_id: sessionId, payload }).catch(() => {});
  } catch (e) {
    // ignore
  }
}

export async function pythonGetStats(days: number = 7): Promise<any> {
  try {
    const res = await axios.get(`${BASE_URL}/analytics/stats?days=${days}`);
    return res.data.stats;
  } catch (e) {
    return {};
  }
}

export async function pythonGetTopSessions(limit: number = 5): Promise<any[]> {
  try {
    const res = await axios.get(`${BASE_URL}/analytics/top-sessions?limit=${limit}`);
    return res.data.sessions || [];
  } catch (e) {
    return [];
  }
}

// --- Notify API ---

export async function pythonSendTelegram(token: string, chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await axios.post(`${BASE_URL}/notify/send`, { token, chat_id: chatId, text });
    return res.data;
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// --- Files API ---

export async function pythonCleanup(rootDir: string, maxAgeDays: number, dryRun: boolean = false): Promise<any> {
  try {
    const res = await axios.post(`${BASE_URL}/files/cleanup`, { root_dir: rootDir, max_age_days: maxAgeDays, dry_run: dryRun });
    return res.data;
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}