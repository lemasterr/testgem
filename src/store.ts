import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Config, ManagedSession, WorkflowClientStep, PipelineMode } from '../shared/types';

export type AppPage =
  | 'dashboard'
  | 'sessions'
  | 'automator'
  | 'downloader'
  | 'content'
  | 'logs'
  | 'watermark'
  | 'telegram'
  | 'settings';

interface AutomatorState {
  selectedSessionIds: string[];
  mode: PipelineMode;
  steps: WorkflowClientStep[];
}

interface AppState {
  currentPage: AppPage;
  sessions: ManagedSession[];
  selectedSessionName: string | null;
  config: Config | null;
  quickAccessOpen: boolean;

  // Automator Persistence
  automator: AutomatorState;

  setCurrentPage: (page: AppPage) => void;
  setSessions: (sessions: ManagedSession[]) => void;
  setSelectedSessionName: (name: string | null) => void;
  setConfig: (config: Config | null) => void;
  toggleQuickAccess: () => void;
  openQuickAccess: () => void;
  closeQuickAccess: () => void;

  // Automator Actions
  setAutomatorState: (partial: Partial<AutomatorState>) => void;

  loadInitialData: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshConfig: () => Promise<void>;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentPage: 'dashboard',
      sessions: [],
      selectedSessionName: null,
      config: null,
      quickAccessOpen: false,

      // Default Automator State
      automator: {
        selectedSessionIds: [],
        mode: 'parallel-phases',
        steps: []
      },

      setCurrentPage: (page: AppPage) => set({ currentPage: page }),
      setSessions: (sessions: ManagedSession[]) => set({ sessions }),
      setSelectedSessionName: (name: string | null) => set({ selectedSessionName: name }),
      setConfig: (config: Config | null) => set({ config }),
      toggleQuickAccess: () => set((state) => ({ quickAccessOpen: !state.quickAccessOpen })),
      openQuickAccess: () => set({ quickAccessOpen: true }),
      closeQuickAccess: () => set({ quickAccessOpen: false }),

      setAutomatorState: (partial) =>
        set((state) => ({ automator: { ...state.automator, ...partial } })),

      loadInitialData: async () => {
        const api = window.electronAPI;
        if (!api) return;

        try {
            const [sessions, config] = await Promise.all([
                api.sessions?.list ? api.sessions.list() : Promise.resolve([]),
                api.config?.get ? api.config.get() : Promise.resolve(null),
            ]);

            set({
                sessions: Array.isArray(sessions) ? sessions : [],
                config: config ?? null,
            });

            // Restore selected session if valid, otherwise default
            const currentSelected = get().selectedSessionName;
            if (!currentSelected && Array.isArray(sessions) && sessions.length > 0) {
                 set({ selectedSessionName: sessions[0].name });
            }
        } catch (e) {
            console.error("Failed to load initial data", e);
        }
      },
      refreshSessions: async () => {
        const api = window.electronAPI;
        if (!api?.sessions?.list) return;
        const sessions = await api.sessions.list();
        set((state) => ({
          sessions,
          // Keep selection if valid, else pick first
          selectedSessionName: sessions.find(s => s.name === state.selectedSessionName)
            ? state.selectedSessionName
            : (sessions[0]?.name ?? null)
        }));
      },
      refreshConfig: async () => {
        const api = window.electronAPI;
        if (!api?.config?.get) return;
        const config = await api.config.get();
        set({ config: config ?? null });
      }
    }),
    {
      name: 'sora-app-storage', // unique name
      storage: createJSONStorage(() => localStorage), // persist to localStorage
      partialize: (state) => ({
        // Only persist these fields to avoid stale data issues
        currentPage: state.currentPage,
        selectedSessionName: state.selectedSessionName,
        automator: state.automator
      }),
    }
  )
);