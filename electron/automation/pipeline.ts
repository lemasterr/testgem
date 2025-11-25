// sora_2/electron/automation/pipeline.ts
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
// REMOVED: import { runPrompts } from './promptsRunner';
// ADDED: New worker import
import { runPromptsForSessionOldStyle } from './soraPromptWorker';

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

async function runDownloadForSession(session: Session, maxOverride?: number): Promise<{ message: string; downloadedCount: number }> {
  const sessionLimit = Number.isFinite(session.maxVideos) && session.maxVideos > 0 ? session.maxVideos : 0;
  const effectiveLimit = (Number.isFinite(maxOverride || 0) && (maxOverride || 0) > 0)
    ? (sessionLimit > 0 ? Math.min(sessionLimit, maxOverride as number) : (maxOverride as number))
    : sessionLimit;

  const result = await runDownloads(session, effectiveLimit ?? 0);
  if (!result.ok) {
    throw new Error(result.error ?? 'Download failed');
  }

  const downloaded = typeof result.downloaded === 'number' ? result.downloaded : 0;
  const label = session.name || session.id;
  return { message: `Downloaded ${downloaded} for ${label}`, downloadedCount: downloaded };
}

async function runPromptsForSession(session: Session): Promise<{ message: string }> {
  // CHANGED: Use the new "Old Style" worker that handles the full loop (Prompt -> Gen -> Download)
  const limit = Number.isFinite(session.maxVideos) && session.maxVideos > 0 ? session.maxVideos : 0;
  const result = await runPromptsForSessionOldStyle(session, limit);

  if (!result.ok) {
    throw new Error(result.message ?? 'Prompts/Generation loop failed');
  }
  // The new worker returns a message string in 'result.message'
  return { message: result.message };
}

async function runProcessForSession(session: Session): Promise<{ message: string }> {
  const paths = await getSessionPaths(session);
  const config = await getConfig();

  // 1. QA Check (Optional but recommended)
  const qaRes = await pythonQA(paths.downloadDir);
  if (qaRes.ok && qaRes.report && qaRes.report.failed.length > 0) {
    logInfo('Pipeline', `QA Warning for ${session.name}: ${qaRes.report.failed.length} bad files detected`);
  }

  // 2. Blur (Python) with active mask or defaults
  const sourceDir = paths.cleanDir || paths.downloadDir;
  const targetDir = path.join(paths.cleanDir, 'blurred');

  const masks = config.watermarkMasks ?? [];
  const activeMaskId = config.activeWatermarkMaskId;
  const activeMask = masks.find(m => m.id === activeMaskId);

  const dfl = (config as any).watermarkDefaults as (undefined | {
    watermark_mode?: 'blur' | 'delogo' | 'hybrid' | null,
    x?: number, y?: number, w?: number, h?: number,
    blur_strength?: number, band?: number,
  });

  let blurConfig: any = { zones: [] as any[] };
  if (activeMask) {
    const mode = dfl?.watermark_mode ?? 'blur';
    const blurStrength = dfl?.blur_strength ?? 20;
    const band = dfl?.band ?? 4;
    blurConfig.zones = (activeMask.rects || []).map((r) => ({
      mode,
      x: (r as any).x,
      y: (r as any).y,
      w: (r as any).width ?? (r as any).w,
      h: (r as any).height ?? (r as any).h,
      blur_strength: blurStrength,
      band,
    }));
  } else if (dfl?.watermark_mode && (dfl.w ?? 0) > 0 && (dfl.h ?? 0) > 0) {
    blurConfig.zones = [{
      mode: dfl.watermark_mode,
      x: dfl.x ?? 0,
      y: dfl.y ?? 0,
      w: dfl.w ?? 0,
      h: dfl.h ?? 0,
      blur_strength: dfl.blur_strength ?? 20,
      band: dfl.band ?? 4,
    }];
  }

  if (activeMask) {
      logInfo('Pipeline', `Applying blur mask: ${activeMask.name} (${activeMask.rects.length} zones)`);
  } else if (blurConfig.zones.length > 0) {
      logInfo('Pipeline', `Applying defaults watermark zone (${blurConfig.zones.length} zone)`);
  } else {
      logInfo('Pipeline', `No watermark zones provided, performing copy only.`);
  }

  const blurRes = await pythonBlur(sourceDir, targetDir, blurConfig);
  if (!blurRes.ok && blurRes.error) throw new Error(`Blur error: ${blurRes.error}`);

  // 3. Merge (Python)
  const mergedFile = path.join(paths.cleanDir, 'merged.mp4');
  const mergeRes = await pythonMerge(targetDir, mergedFile);
  if (!mergeRes.ok && mergeRes.error) {
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
  const dfl = (config as any).watermarkDefaults as any;
  let blurConfig: any = { zones: [] as any[] };
  if (activeMask) {
    const mode = dfl?.watermark_mode ?? 'blur';
    const blurStrength = dfl?.blur_strength ?? 20;
    const band = dfl?.band ?? 4;
    blurConfig.zones = (activeMask.rects || []).map((r) => ({
      mode,
      x: (r as any).x,
      y: (r as any).y,
      w: (r as any).width ?? (r as any).w,
      h: (r as any).height ?? (r as any).h,
      blur_strength: blurStrength,
      band,
    }));
  } else if (dfl?.watermark_mode && (dfl?.w ?? 0) > 0 && (dfl?.h ?? 0) > 0) {
    blurConfig.zones = [{
      mode: dfl.watermark_mode,
      x: dfl.x ?? 0,
      y: dfl.y ?? 0,
      w: dfl.w ?? 0,
      h: dfl.h ?? 0,
      blur_strength: dfl.blur_strength ?? 20,
      band: dfl.band ?? 4,
    }];
  }

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
  sessionLookup: Map<string, Session>,
  opts?: { dryRun?: boolean; scenarioDownloadLimit?: number | null }
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

  let remainingDownload = (opts?.scenarioDownloadLimit && opts.scenarioDownloadLimit > 0)
    ? opts.scenarioDownloadLimit
    : Number.POSITIVE_INFINITY;

  const isDry = !!opts?.dryRun;

  return selection.map((step) => {
    const sid = String(step.id);

    // --- Global/Phase Steps ---
    if (sid === 'openSessions') {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => isDry ? Promise.resolve({ message: 'DRY-RUN: would open all sessions' }) : runOpenSessions(allSessions),
      };
    }
    if (sid === 'blurVideos') {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => isDry ? Promise.resolve({ message: 'DRY-RUN: would blur all sessions videos' }) : runBlurVideos(allSessions),
      };
    }
    if (sid === 'mergeVideos') {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => isDry ? Promise.resolve({ message: 'DRY-RUN: would merge videos for all sessions' }) : runMergeVideos(allSessions),
      };
    }
    if (sid === 'cleanMetadata') {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => isDry ? Promise.resolve({ message: 'DRY-RUN: would clean metadata for all sessions' }) : runCleanMetadata(allSessions),
      };
    }

    // --- Session Specific Steps ---
    if (sid.startsWith('downloadSession')) {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: async () => {
          const s = resolveSession(step);
          if (isDry) {
            const sessionLimit = Number.isFinite(s.maxVideos) && s.maxVideos > 0 ? s.maxVideos : 0;
            const eff = !Number.isFinite(remainingDownload) ? sessionLimit : (sessionLimit > 0 ? Math.min(sessionLimit, remainingDownload) : remainingDownload);
            return { message: `DRY-RUN: would download up to ${eff || 0} for ${s.name}`, downloadedCount: 0 };
          }
          const maxForThis = Number.isFinite(remainingDownload) ? Math.max(0, remainingDownload) : undefined;
          const res = await runDownloadForSession(s, maxForThis);
          if (Number.isFinite(remainingDownload)) {
            remainingDownload = Math.max(0, (remainingDownload as number) - (res.downloadedCount || 0));
          }
          return res;
        },
        sessionId: step.sessionId,
      };
    }

    if (sid.startsWith('promptsSession')) {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        // Mapped to new worker (or dry-run)
        run: () => isDry ? Promise.resolve({ message: `DRY-RUN: would run prompts for ${(resolveSession(step)).name}` }) : runPromptsForSession(resolveSession(step)),
        sessionId: step.sessionId,
      };
    }

    if (sid.startsWith('processSession')) {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => isDry ? Promise.resolve({ message: `DRY-RUN: would process video for ${(resolveSession(step)).name}` }) : runProcessForSession(resolveSession(step)),
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
  const config = await getConfig();
  const dryRun = !!(config.automator?.dryRun);
  const scenarioLimit = (config.automator?.downloadLimit ?? (config as any).downloadLimit) ?? null;

  emitProgress(onProgress, {
    stepId: 'workflow',
    label: 'Workflow',
    status: 'running',
    message: 'Workflow starting',
    timestamp: Date.now(),
  });

  try {
    const workflowSteps = buildWorkflowSteps(normalized, sessionLookup, { dryRun, scenarioDownloadLimit: scenarioLimit as any });
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