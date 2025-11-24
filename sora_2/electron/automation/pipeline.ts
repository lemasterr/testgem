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
import { blurVideosInDir } from '../video/ffmpegBlur';
import { mergeVideosInDir } from '../video/ffmpegMerge';
import { stripMetadataInDir } from '../video/ffmpegMetadata';
import { logInfo } from '../logging/logger';
import { logError as logFileError } from '../../core/utils/log';

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

async function runBlurVideos(targetSessions: Session[]): Promise<void> {
  for (const session of targetSessions) {
    const paths = await getSessionPaths(session);
    const sourceDir = paths.cleanDir || paths.downloadDir;
    const targetDir = path.join(paths.cleanDir, 'blurred');
    await blurVideosInDir(sourceDir, targetDir, 'default');
  }
}

async function runMergeVideos(targetSessions: Session[]): Promise<void> {
  for (const session of targetSessions) {
    const paths = await getSessionPaths(session);
    const sourceDir = path.join(paths.cleanDir, 'blurred');
    const outputFile = path.join(paths.cleanDir, 'merged.mp4');
    await mergeVideosInDir(sourceDir, outputFile);
  }
}

async function runCleanMetadata(targetSessions: Session[]): Promise<void> {
  for (const session of targetSessions) {
    const paths = await getSessionPaths(session);
    await stripMetadataInDir(paths.cleanDir);
  }
}

async function runOpenSessions(targetSessions: Session[]): Promise<void> {
  for (const session of targetSessions) {
    await ensureBrowserForSession(session);
  }
}

function normalizeClientSteps(
  steps: unknown,
  availableSessions: ManagedSession[],
  selectedSessionIds?: string[]
): { normalized: WorkflowClientStep[]; activeSessionIds: string[] } {
  const defaultSteps = buildDynamicWorkflow(availableSessions, selectedSessionIds);
  const allowedIds = new Set<WorkflowStepId>(defaultSteps.map((step) => step.id));
  const defaultsById = new Map<WorkflowStepId, WorkflowClientStep>(defaultSteps.map((step) => [step.id, step]));
  const validSessionIds = new Set(availableSessions.map((session) => session.id));

  if (!Array.isArray(steps)) {
    const active = defaultSteps.filter((step) => step.id.toString().startsWith('downloadSession') && step.sessionId?.length);
    return { normalized: defaultSteps, activeSessionIds: active.map((step) => step.sessionId!).filter(Boolean) };
  }

  const normalized: WorkflowClientStep[] = [];

  for (const raw of steps as WorkflowClientStep[]) {
    const id = raw?.id as WorkflowStepId;
    if (!id || (!allowedIds.has(id) && !/^downloadSession\d+$/.test(String(id)))) {
      continue;
    }

    const fallback = defaultsById.get(id);
    const dependsOn = Array.isArray(raw?.dependsOn)
      ? (raw.dependsOn as WorkflowStepId[]).filter((dep) => allowedIds.has(dep) || /^downloadSession\d+$/.test(String(dep)))
      : fallback?.dependsOn;

    const sessionId = raw?.sessionId ?? fallback?.sessionId;
    const cleanSessionId = sessionId && validSessionIds.has(sessionId) ? sessionId : undefined;

    normalized.push({
      id,
      label:
        typeof raw?.label === 'string' && raw.label.length > 0
          ? raw.label
          : fallback?.label || (typeof id === 'string' ? id : ''),
      enabled: raw?.enabled !== false,
      dependsOn,
      sessionId: cleanSessionId,
    });
  }

  const stepsToUse = normalized.length > 0 ? normalized : defaultSteps;
  const activeSessionIds = Array.from(
    new Set(
      stepsToUse
        .filter((step) => typeof step.id === 'string' && String(step.id).startsWith('downloadSession') && step.sessionId)
        .map((step) => step.sessionId!)
    )
  );

  return { normalized: stepsToUse, activeSessionIds };
}

function buildWorkflowSteps(
  selection: WorkflowClientStep[],
  sessionLookup: Map<string, Session>,
  activeSessionIds: string[],
  allSessions: Session[]
): WorkflowStep[] {
  const targetSessions = activeSessionIds.length > 0 ? activeSessionIds : Array.from(sessionLookup.keys());

  const resolveSessionForDownload = (step: WorkflowClientStep): Session => {
    if (step.sessionId && sessionLookup.has(step.sessionId)) {
      return sessionLookup.get(step.sessionId)!;
    }

    const fallbackIndexMatch = typeof step.id === 'string' ? step.id.match(/^downloadSession(\d+)$/) : null;
    if (fallbackIndexMatch) {
      const index = Number(fallbackIndexMatch[1]) - 1;
      if (Number.isInteger(index) && allSessions[index]) {
        return allSessions[index];
      }
    }

    throw new Error(`Session for ${step.id} is not available`);
  };

  return selection.map((step) => {
    if (step.id === 'openSessions') {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => runOpenSessions(targetSessions.map((id) => sessionLookup.get(id)).filter(Boolean) as Session[]),
      } satisfies WorkflowStep;
    }

    if (typeof step.id === 'string' && step.id.startsWith('downloadSession')) {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: async () => {
          const session = resolveSessionForDownload(step);
          return runDownloadForSession(session);
        },
        sessionId: step.sessionId ?? resolveSessionForDownload(step).id,
      } satisfies WorkflowStep;
    }

    if (step.id === 'blurVideos') {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => runBlurVideos(targetSessions.map((id) => sessionLookup.get(id)).filter(Boolean) as Session[]),
      } satisfies WorkflowStep;
    }

    if (step.id === 'mergeVideos') {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => runMergeVideos(targetSessions.map((id) => sessionLookup.get(id)).filter(Boolean) as Session[]),
      } satisfies WorkflowStep;
    }

    if (step.id === 'cleanMetadata') {
      return {
        id: step.id,
        label: step.label,
        enabled: step.enabled,
        dependsOn: step.dependsOn,
        run: () => runCleanMetadata(targetSessions.map((id) => sessionLookup.get(id)).filter(Boolean) as Session[]),
      } satisfies WorkflowStep;
    }

    throw new Error(`Unknown workflow step: ${String(step.id)}`);
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

  const { normalized, activeSessionIds } = normalizeClientSteps(steps, managedSessions);

  emitProgress(onProgress, {
    stepId: 'workflow',
    label: 'Workflow',
    status: 'running',
    message: 'Workflow starting',
    timestamp: Date.now(),
  });

  try {
    const workflowSteps = buildWorkflowSteps(normalized, sessionLookup, activeSessionIds, sessionList);
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
