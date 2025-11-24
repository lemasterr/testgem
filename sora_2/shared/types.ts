import type { Config as BackendConfig } from '../electron/config/config';

export interface ChromeProfile {
  id: string;
  name: string;
  userDataDir: string;
  profileDirectory: string; // canonical profile directory name inside userDataDir
  profileDir?: string; // backward-compat alias for profileDirectory
  isDefault?: boolean;
  lastUsed?: string;
  isActive?: boolean;
}

export interface ManagedSession {
  id: string;
  name: string;
  chromeProfileName: string | null;
  promptProfile: string | null;
  cdpPort: number | null;
  promptsFile: string;
  imagePromptsFile: string;
  titlesFile: string;
  submittedLog: string;
  failedLog: string;
  downloadDir: string;
  cleanDir: string;
  cursorFile: string;
  maxVideos: number;
  openDrafts: boolean;
  autoLaunchChrome: boolean;
  autoLaunchAutogen: boolean;
  notes: string;
  status?: 'idle' | 'running' | 'warning' | 'error';
  promptCount?: number;
  titleCount?: number;
  hasFiles?: boolean;
  downloadedCount?: number;
}

// The Config type mirrors the canonical backend shape from electron/config/config.ts.
// Optional arrays such as chromeProfiles or sessions are convenience fields derived at runtime
// and may not be persisted by the config module itself.
export type Config = BackendConfig & {
  chromeProfiles?: ChromeProfile[];
  sessions?: ManagedSession[];
  watermarkMasks?: WatermarkMask[];
  activeWatermarkMaskId?: string;
};

export type SessionCommandAction =
  | 'startChrome'
  | 'runPrompts'
  | 'runDownloads'
  | 'cleanWatermark'
  | 'stop';

export interface SessionLogEntry {
  timestamp: number;
  scope: 'Chrome' | 'Prompts' | 'Download' | 'Worker' | 'Watermark' | string;
  level: 'info' | 'error';
  message: string;
}

export type LogSource = 'Chrome' | 'Autogen' | 'Downloader' | 'Pipeline' | string;

export interface AppLogEntry {
  timestamp: number;
  source: LogSource;
  level: 'info' | 'error';
  message: string;
  sessionId?: string;
}

export interface SessionFiles {
  prompts: string[];
  imagePrompts: string[];
  titles: string[];
}

export interface RunResult {
  ok: boolean;
  details?: string;
  error?: string;
  submittedCount?: number;
  failedCount?: number;
  downloadedCount?: number;
  skippedCount?: number;
  draftsFound?: number;
  lastDownloadedFile?: string;
}

export interface DownloadedVideo {
  path: string;
  fileName: string;
  sessionName?: string;
  mtime: number;
}

export interface WatermarkFramesResult {
  frames: string[];
  tempDir: string;
}

export interface WatermarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

export interface WatermarkMask {
  id: string;
  name: string;
  rects: WatermarkRect[];
  updatedAt?: number;
}

export interface WatermarkDetectionFrame {
  path: string;
  width: number;
  height: number;
  rects: WatermarkRect[];
}

export interface WatermarkDetectionResult {
  frames: WatermarkDetectionFrame[];
  suggestedMask?: WatermarkMask;
}

export interface WatermarkCleanItemResult {
  video: string;
  output?: string;
  status: 'cleaned' | 'skipped' | 'error';
  message?: string;
}

export interface WatermarkCleanResult {
  ok: boolean;
  items: WatermarkCleanItemResult[];
  error?: string;
}

export type DownloadWorkflowStepId = `downloadSession${number}`;

export type WorkflowStepId =
  | 'openSessions'
  | DownloadWorkflowStepId
  | 'blurVideos'
  | 'mergeVideos'
  | 'cleanMetadata';

export interface WorkflowClientStep {
  id: WorkflowStepId;
  label: string;
  enabled: boolean;
  dependsOn?: WorkflowStepId[];
  sessionId?: string;
}

export interface WorkflowProgress {
  stepId: WorkflowStepId | 'workflow';
  label: string;
  status: 'running' | 'success' | 'error' | 'skipped';
  message: string;
  timestamp: number;
  sessionId?: string;
  downloadedCount?: number;
}

export function buildDynamicWorkflow(
  sessions: ManagedSession[],
  selectedSessionIds?: string[]
): WorkflowClientStep[] {
  const selected =
    selectedSessionIds && selectedSessionIds.length > 0
      ? sessions.filter((session) => selectedSessionIds.includes(session.id))
      : sessions;

  const steps: WorkflowClientStep[] = [];

  steps.push({ id: 'openSessions', label: 'Open all sessions', enabled: true });

  const downloadStepIds: DownloadWorkflowStepId[] = [];
  selected.forEach((session, index) => {
    const id = `downloadSession${index + 1}` as DownloadWorkflowStepId;
    downloadStepIds.push(id);
    steps.push({
      id,
      label: `Download (${session.name})`,
      enabled: true,
      dependsOn: ['openSessions'],
      sessionId: session.id,
    });
  });

  steps.push({ id: 'blurVideos', label: 'Blur videos', enabled: true, dependsOn: downloadStepIds });
  steps.push({ id: 'mergeVideos', label: 'Merge videos', enabled: true, dependsOn: ['blurVideos'] });
  steps.push({ id: 'cleanMetadata', label: 'Clean metadata', enabled: true, dependsOn: ['mergeVideos'] });

  return steps;
}
