# Multi-session downloads

The application now coordinates multiple Chrome sessions entirely through the
workflow pipeline. Each download step is generated dynamically for the selected
sessions and runs sequentially with isolated Chrome instances and CDP ports.

## How it works
1. The renderer lets you choose which sessions participate; the workflow builder
   (`buildDynamicWorkflow`) creates `downloadSession<N>` steps for each
   selection.
2. Each download step resolves its session object (id, profile, CDP port,
   limits) and invokes `runDownloadForSession` inside `electron/automation/pipeline.ts`.
3. `runDownloadForSession` delegates to `runDownloads`, which launches or
   reuses a Chrome clone for that session via `ensureBrowserForSession`, runs
   the shared download loop, and reports the number of files saved.
4. Workflow progress events carry `sessionId` and `downloadedCount` so the UI
   can display per-session status, errors, and totals.

## Notes
- There is no separate multi-session runner; the workflow pipeline orchestrates
  open → download → post-processing across any number of sessions.
- Each session uses its own Chrome clone and CDP port, preventing collisions.
- If a step fails, the workflow logs the error but continues to the next step
  so other sessions can finish.
