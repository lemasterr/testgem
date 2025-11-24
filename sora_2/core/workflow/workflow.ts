import { performance } from 'perf_hooks';
import { logError, logStep } from '../utils/log';

export interface WorkflowStep {
  id: string;
  label: string;
  enabled: boolean;
  run: () => Promise<void | { message?: string; downloadedCount?: number }>;
  dependsOn?: string[];
  sessionId?: string;
}

export type WorkflowRunStatus = 'running' | 'success' | 'error' | 'skipped';

export interface WorkflowProgressEvent {
  stepId: string;
  label: string;
  status: WorkflowRunStatus;
  message: string;
  timestamp: number;
  sessionId?: string;
  downloadedCount?: number;
}

export interface WorkflowRunResult {
  stepId: string;
  label: string;
  status: WorkflowRunStatus;
  error?: string;
  durationMs: number;
}

export interface WorkflowRunOptions {
  onProgress?: (event: WorkflowProgressEvent) => void;
  logger?: (message: string) => void;
  shouldCancel?: () => boolean;
}

function emitProgress(
  step: Pick<WorkflowStep, 'id' | 'label' | 'sessionId'>,
  status: WorkflowRunStatus,
  message: string,
  options: WorkflowRunOptions,
  downloadedCount?: number
): void {
  options.logger?.(`[workflow] ${step.label}: ${message}`);
  options.onProgress?.({
    stepId: step.id,
    label: step.label,
    status,
    message,
    timestamp: Date.now(),
    sessionId: step.sessionId,
    downloadedCount,
  });
}

export async function runWorkflow(
  steps: WorkflowStep[],
  options: WorkflowRunOptions = {}
): Promise<WorkflowRunResult[]> {
  const results: WorkflowRunResult[] = [];
  const statusById = new Map<string, WorkflowRunStatus>();

  for (const step of steps) {
    if (!step.enabled) {
      statusById.set(step.id, 'skipped');
      results.push({ stepId: step.id, label: step.label, status: 'skipped', durationMs: 0 });
      emitProgress(step, 'skipped', 'Step disabled, skipping', options);
      continue;
    }

    if (options.shouldCancel?.()) {
      statusById.set(step.id, 'skipped');
      results.push({ stepId: step.id, label: step.label, status: 'skipped', durationMs: 0, error: 'Cancelled' });
      emitProgress(step, 'skipped', 'Workflow cancelled, skipping', options);
      continue;
    }

    const dependencies = step.dependsOn ?? [];
    const unmet = dependencies.filter((id) => statusById.get(id) !== 'success');
    if (unmet.length > 0) {
      const reason = `Skipped due to unmet dependencies: ${unmet.join(', ')}`;
      statusById.set(step.id, 'skipped');
      results.push({ stepId: step.id, label: step.label, status: 'skipped', durationMs: 0, error: reason });
      emitProgress(step, 'skipped', reason, options);
      continue;
    }

    const start = performance.now();
    emitProgress(step, 'running', 'Starting', options);
    logStep(`Workflow step start: ${step.label}`);

    try {
      const result = await step.run();
      const downloadedCount = typeof result === 'object' && result?.downloadedCount !== undefined
        ? result.downloadedCount
        : undefined;
      const customMessage =
        typeof result === 'string'
          ? result
          : typeof result === 'object' && result?.message
            ? result.message
            : undefined;
      const durationMs = Math.round(performance.now() - start);
      statusById.set(step.id, 'success');
      results.push({ stepId: step.id, label: step.label, status: 'success', durationMs });
      emitProgress(step, 'success', customMessage ?? `Finished in ${durationMs} ms`, options, downloadedCount);
      logStep(`Workflow step success: ${step.label} in ${durationMs} ms`);
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);
      const message = (error as Error).message ?? 'Unknown workflow error';
      statusById.set(step.id, 'error');
      results.push({ stepId: step.id, label: step.label, status: 'error', durationMs, error: message });
      emitProgress(step, 'error', message, options);
      logError(`Workflow step failed: ${step.label}`, error);
    }
  }

  return results;
}

