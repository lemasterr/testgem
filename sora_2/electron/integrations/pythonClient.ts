// Path: sora_2/electron/integrations/pythonClient.ts
import axios from 'axios';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { logInfo, logError } from '../logging/logger';

const PYTHON_PORT = 8000;
const BASE_URL = `http://127.0.0.1:${PYTHON_PORT}`;

let pythonProcess: ChildProcess | null = null;

export async function startPythonServer(): Promise<void> {
  if (pythonProcess) return;

  const scriptPath = path.join(process.cwd(), 'python-core', 'main.py');

  logInfo('Python', `Starting core server at ${scriptPath}`);

  pythonProcess = spawn('python', [scriptPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHON_CORE_PORT: String(PYTHON_PORT) }
  });

  pythonProcess.stdout?.on('data', (data) => {
    logInfo('PythonCore', data.toString().trim());
  });

  pythonProcess.stderr?.on('data', (data) => {
    logError('PythonCore', data.toString().trim());
  });

  pythonProcess.on('close', (code) => {
    logInfo('Python', `Core server exited with code ${code}`);
    pythonProcess = null;
  });

  for (let i = 0; i < 15; i++) {
    try {
      await axios.get(`${BASE_URL}/health`);
      logInfo('Python', 'Core server is ready and healthy');
      return;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  logError('Python', 'Failed to connect to Python core after 15s');
}

export function stopPythonServer() {
  if (pythonProcess) {
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