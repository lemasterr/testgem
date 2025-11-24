// Path: sora_2/electron/automation/pipeline.ts
import path from 'path';

import { runWorkflow, type WorkflowStep } from '../../core/workflow/workflow';
import {
  buildDynamicWorkflow,
  type ManagedSession,
  type WorkflowClientStep,
  type WorkflowProgress,
  type WorkflowStepId,
} from '../../shared/types';
import { getSessionPaths, listSessions } from '../sessions/repo';
import type { Session } from '../sessions/types';
import { ensureBrowserForSession } from './sessionChrome';
import { runDownloads } from './downloader';
import { runPrompts } from './promptsRunner';
import { logInfo } from '../logging/logger';
import { logError as logFileError } from '../../core/utils/log';
import { getConfig } from '../config/config';

// Use Python Client
import { pythonBlur, pythonMerge, pythonCleanMetadata, pythonQA } from '../integrations/pythonClient';

let cancelled = false;

function emitProgress(onProgress: (status: WorkflowProgress) => void, progress: WorkflowProgress): void {
  try {
    onProgress({ ...progress, timestamp: Date.now() });
  } catch (error) {
    logFileError('Workflow progress emit failed', error);
  }
}

function toSession(managed: ManagedSession): Session {
  const { status: _status, promptCount: _promptCount, titleCount: _titleCount, hasFiles: _hasFiles, ...rest } = managed;
  return rest;
}

function ensureUniqueCdpPorts(sessions: Session[]): void {
  const seen = new Set<number>();
  for (const session of sessions) {
    const port = session.cdpPort ?? undefined;
    if (!port || !Number.isFinite(port)) continue;
    if (seen.has(port)) {
      throw new Error(`Duplicate CDP port detected across sessions: ${port}`);
    }
    seen.add(port);
  }
}

// --- Step Executors ---

async function runDownloadForSession(session: Session): Promise<{ message: string; downloadedCount: number }> {
  const limit = Number.isFinite(session.maxVideos) && session.maxVideos > 0 ? session.maxVideos : 0;
  const result = await runDownloads(session, limit ?? 0);
  if (!result.ok) {
    throw new Error(result.error ?? 'Download failed');
  }

  const downloaded = typeof result.downloaded === 'number' ? result.downloaded : 0;
  const label = session.name || session.id;
  return { message: `Downloaded ${downloaded} for ${label}`, downloadedCount: downloaded };
}

async function runPromptsForSession(session: Session): Promise<{ message: string }> {
  const result = await runPrompts(session);
  if (!result.ok) {
    throw new Error(result.error ?? 'Prompts failed');
  }
  return { message: `Submitted ${result.submitted} prompts, Failed: ${result.failed}` };
}

async function runProcessForSession(session: Session): Promise<{ message: string }> {
  const paths = await getSessionPaths(session);
  const config = await getConfig();

  // 1. QA Check (Optional but recommended)
  // We check the download folder before processing
  const qaRes = await pythonQA(paths.downloadDir);
  if (qaRes.ok && qaRes.report && qaRes.report.failed.length > 0) {
    logInfo('Pipeline', `QA Warning for ${session.name}: ${qaRes.report.failed.length} bad files detected`);
    // Optional: we could throw error here to stop processing, but usually we want to process valid files
  }

  // 2. Blur (Python) with active mask
  const sourceDir = paths.cleanDir || paths.downloadDir;
  const targetDir = path.join(paths.cleanDir, 'blurred');

  // Find active mask from global config
  const masks = config.watermarkMasks ?? [];
  const activeMaskId = config.activeWatermarkMaskId;
  const activeMask = masks.find(m => m.id === activeMaskId);

  // Construct Python-compatible blur config
  // We pass activeMask.rects as 'zones'
  const blurConfig = activeMask ? { zones: activeMask.rects } : { zones: [] };

  if (activeMask) {
      logInfo('Pipeline', `Applying blur mask: ${activeMask.name} (${activeMask.rects.length} zones)`);
  } else {
      logInfo('Pipeline', `No active blur mask found, performing copy only.`);
  }

  const blurRes = await pythonBlur(sourceDir, targetDir, blurConfig);
  if (!blurRes.ok && blurRes.error) throw new Error(`Blur error: ${blurRes.error}`);

  // 3. Merge (Python)
  const mergedFile = path.join(paths.cleanDir, 'merged.mp4');
  // Use session setting for merge mode if available (not yet in session type, defaulting to concat)
  const mergeRes = await pythonMerge(targetDir, mergedFile);
  if (!mergeRes.ok && mergeRes.error) {
     // Merge might fail if 0 files, log as warning
     logInfo('Pipeline', `Merge warning for ${session.name}: ${mergeRes.error}`);
  }

  // 4. Clean Metadata (Python)
  const cleanRes = await pythonCleanMetadata(paths.cleanDir);
  if (!cleanRes.ok && cleanRes.error) throw new Error(`Metadata clean error: ${cleanRes.error}`);

  return { message: 'Processed via Python Core: QA, Blur, Merge, Clean Metadata complete' };
}

// --- Legacy / Phase Executors (Parallel Mode) ---

async function runBlurVideos(targetSessions: Session[]): Promise<void> {
  const config = await getConfig();
  const masks = config.watermarkMasks ?? [];
  const activeMask = masks.find(m => m.id === config.activeWatermarkMaskId);
  const blurConfig = activeMask ? { zones: activeMask.rects } : { zones: [] };

  for (const session of targetSessions) {
    const paths = await getSessionPaths(session);
    const sourceDir = paths.cleanDir || paths.downloadDir;
    const targetDir = path.join(paths.cleanDir, 'blurred');
    await pythonBlur(sourceDir, targetDir, blurConfig);
  }
}

async function runMergeVideos(targetSessions: Session[]): Promise<void> {
  for (const session of targetSessions) {
    const paths = await getSessionPaths(session);
    const sourceDir = path.join(paths.cleanDir, 'blurred');
    const outputFile = path.join(paths.cleanDir, 'merged.mp4');
    await pythonMerge(sourceDir, outputFile);
  }
}

async function runCleanMetadata(targetSessions: Session[]): Promise<void> {
  for (const session of targetSessions) {
    const paths = await getSessionPaths(session);
    await pythonCleanMetadata(paths.cleanDir);
  }
}

async function runOpenSessions(targetSessions: Session[]): Promise<void> {
  for (const session of targetSessions) {
    await ensureBrowserForSession(session);
  }
}

// --- Pipeline Builder ---

function normalizeClientSteps(
  steps: unknown,
  availableSessions: ManagedSession[]
): { normalized: WorkflowClientStep[]; activeSessionIds: string[] } {
  if (!Array.isArray(steps)) {
    // Fallback for old calls
    const defaultSteps = buildDynamicWorkflow(availableSessions, undefined, 'parallel-phases');
    const active = availableSessions.map(s => s.id);
    return { normalized: defaultSteps, activeSessionIds: active };
  }

  const normalized: WorkflowClientStep[] = steps.map((s: any) => ({
    id: s.id,
    label: s.label,
    enabled: s.enabled,
    dependsOn: s.dependsOn,
    sessionId: s.sessionId
  }));

  const activeSessionIds = Array.from(new Set(
    normalized
      .filter(s => s.sessionId)
      .map(s => s.sessionId!)
  ));

  return { normalized, activeSessionIds };
}

function buildWorkflowSteps(
  selection: WorkflowClientStep[],
  sessionLookup: Map<string, Session>
): WorkflowStep[] {

  const resolveSession = (step: WorkflowClientStep): Session => {
    if (step.sessionId && sessionLookup.has(step.sessionId)) {
      return sessionLookup.get(step.sessionId)!;
    }
    if (typeof step.id === 'string') {
        const match = step.id.match(/^downloadSession(\d+)$/);
        if (match) {
            const idx = parseInt(match[1], 10) - 1;
            const sessions = Array.from(sessionLookup.values());
            if (sessions[idx]) return sessions[idx];
        }
    }
    throw new Error(`Session not found for step ${step.id}`);
  };

  const allSessions = Array.from(sessionLookup.values());

  return selection.map((step) => {
    const sid = String(step.id);

    // --- Global/Phase Steps ---
    if (sid === 'openSessions') {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => runOpenSessions(allSessions),
      };
    }
    if (sid === 'blurVideos') {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => runBlurVideos(allSessions),
      };
    }
    if (sid === 'mergeVideos') {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => runMergeVideos(allSessions),
      };
    }
    if (sid === 'cleanMetadata') {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => runCleanMetadata(allSessions),
      };
    }

    // --- Session Specific Steps (Sequential Mode) ---
    if (sid.startsWith('downloadSession')) {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => runDownloadForSession(resolveSession(step)),
        sessionId: step.sessionId,
      };
    }

    if (sid.startsWith('promptsSession')) {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => runPromptsForSession(resolveSession(step)),
        sessionId: step.sessionId,
      };
    }

    if (sid.startsWith('processSession')) {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => runProcessForSession(resolveSession(step)),
        sessionId: step.sessionId,
      };
    }

    throw new Error(`Unknown workflow step: ${sid}`);
  });
}

export async function runPipeline(
  steps: WorkflowClientStep[],
  onProgress: (status: WorkflowProgress) => void
): Promise<void> {
  cancelled = false;
  const managedSessions = await listSessions();
  const sessionList = managedSessions.map((managed) => toSession(managed));
  const sessionLookup = new Map(sessionList.map((session) => [session.id, session]));

  try {
    ensureUniqueCdpPorts(sessionList);
  } catch (error) {
    const message = (error as Error).message;
    emitProgress(onProgress, {
      stepId: 'workflow',
      label: 'Workflow',
      status: 'error',
      message,
      timestamp: Date.now(),
    });
    return;
  }

  const { normalized } = normalizeClientSteps(steps, managedSessions);

  emitProgress(onProgress, {
    stepId: 'workflow',
    label: 'Workflow',
    status: 'running',
    message: 'Workflow starting',
    timestamp: Date.now(),
  });

  try {
    const workflowSteps = buildWorkflowSteps(normalized, sessionLookup);
    const results = await runWorkflow(workflowSteps, {
      onProgress: (event) => emitProgress(onProgress, { ...event, stepId: event.stepId as WorkflowStepId }),
      logger: (msg) => logInfo('Pipeline', msg),
      shouldCancel: () => cancelled,
    });

    const hadError = results.some((result) => result.status === 'error');
    const finalStatus = cancelled || hadError ? 'error' : 'success';
    emitProgress(onProgress, {
      stepId: 'workflow',
      label: 'Workflow',
      status: finalStatus,
      message: cancelled ? 'Workflow cancelled' : hadError ? 'Workflow finished with errors' : 'Workflow complete',
      timestamp: Date.now(),
    });
  } catch (error) {
    emitProgress(onProgress, {
      stepId: 'workflow',
      label: 'Workflow',
      status: 'error',
      message: (error as Error).message,
      timestamp: Date.now(),
    });
  }
}

export function cancelPipeline(): void {
  cancelled = true;
}