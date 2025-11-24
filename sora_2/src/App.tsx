import { useEffect, useMemo, useState } from 'react';
import { AutomatorPage } from './components/AutomatorPage';
import { ContentPage } from './components/ContentPage';
import { DashboardPage } from './components/DashboardPage';
import { LogsPage } from './components/LogsPage';
import { SessionsPage } from './components/SessionsPage';
import { SettingsPage } from './components/SettingsPage';
import { TelegramPage } from './components/TelegramPage';
import { WatermarkPage } from './components/WatermarkPage';
import { Layout } from './components/Layout';
import { DownloaderPage } from './components/DownloaderPage';
import { ErrorBoundary, PageBoundary } from './components/ErrorBoundary';
import { useAppStore, AppPage } from './store';

const pageTitles: Record<AppPage, { title: string; description: string }> = {
  dashboard: { title: 'Dashboard', description: 'Operational overview and quick stats.' },
  sessions: { title: 'Sessions', description: 'Manage per-profile workspaces and run flows.' },
  automator: { title: 'Automator', description: 'Run prompt generation and download pipelines.' },
  downloader: { title: 'Downloader', description: 'Scan drafts and download videos with titles.' },
  content: { title: 'Content Editor', description: 'Edit prompts, image prompts, and titles in one place.' },
  watermark: { title: 'Watermark Check', description: 'Generate preview frames to inspect outputs.' },
  logs: { title: 'Logs', description: 'Review automation logs and events.' },
  settings: { title: 'Settings', description: 'Paths, executables, timings, and limits.' },
  telegram: { title: 'Telegram', description: 'Configure bot tokens and notifications.' }
};

function PageView({ currentPage }: { currentPage: AppPage }) {
  switch (currentPage) {
    case 'dashboard':
      return (
        <PageBoundary title="Dashboard">
          <DashboardPage />
        </PageBoundary>
      );
    case 'sessions':
      return (
        <PageBoundary title="Sessions">
          <SessionsPage />
        </PageBoundary>
      );
    case 'content':
      return (
        <PageBoundary title="Content Editor">
          <ContentPage />
        </PageBoundary>
      );
    case 'automator':
      return (
        <PageBoundary title="Automator">
          <AutomatorPage />
        </PageBoundary>
      );
    case 'downloader':
      return (
        <PageBoundary title="Downloader">
          <DownloaderPage />
        </PageBoundary>
      );
    case 'watermark':
      return (
        <PageBoundary title="Watermark">
          <WatermarkPage />
        </PageBoundary>
      );
    case 'telegram':
      return (
        <PageBoundary title="Telegram">
          <TelegramPage />
        </PageBoundary>
      );
    case 'settings':
      return (
        <PageBoundary title="Settings">
          <SettingsPage />
        </PageBoundary>
      );
    case 'logs':
      return (
        <PageBoundary title="Logs">
          <LogsPage />
        </PageBoundary>
      );
    default:
      return null;
  }
}

const LoadingOverlay = ({ progress, message }: { progress: number; message?: string }) => (
  <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-[#050507]/90 backdrop-blur">
    <div className="w-[320px] rounded-2xl border border-blue-500/40 bg-zinc-900/80 p-6 shadow-2xl">
      <div className="text-sm uppercase tracking-wide text-blue-200">Starting Sora Lab</div>
      <div className="mt-2 text-3xl font-semibold text-white">{progress}%</div>
      <div className="mt-4 h-2 rounded-full bg-zinc-800">
        <div
          className="h-2 rounded-full bg-blue-500 transition-all"
          style={{ width: `${Math.min(100, Math.max(progress, 0))}%` }}
        />
      </div>
      <div className="mt-3 text-xs text-zinc-400">{message || 'Loading workspaces and settings...'}</div>
    </div>
  </div>
);

function App() {
  const { currentPage, setCurrentPage, setSessions, setConfig, setSelectedSessionName, quickAccessOpen, toggleQuickAccess } =
    useAppStore();
  const { title, description } = pageTitles[currentPage];
  const [progress, setProgress] = useState(8);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Preparing UI');

  const api = useMemo(() => window.electronAPI ?? null, []);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!api) {
        setLoading(false);
        return;
      }

      try {
        setProgress(15);
        setLoadingMessage('Loading configuration');
        const fetchConfig = api.config?.get ?? api.getConfig;
        const config = fetchConfig ? await fetchConfig() : null;
        if (!mounted) return;
        if (config && !(config as any).ok) {
          console.warn('Config load failed', config);
        } else if (config) {
          setConfig(config as any);
        }

        setProgress(55);
        setLoadingMessage('Fetching sessions');
        const fetchSessions = api.sessions?.list ?? api.getSessions;
        const sessions = fetchSessions ? await fetchSessions() : [];
        if (!mounted) return;
        if (Array.isArray(sessions)) {
          setSessions(sessions ?? []);
          setSelectedSessionName((sessions?.[0]?.name as string) ?? null);
        }

        setProgress(90);
        setLoadingMessage('Finalizing UI');
      } catch (err) {
        console.error('Initial load failed', err);
      } finally {
        if (!mounted) return;
        setProgress(100);
        setTimeout(() => setLoading(false), 250);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [api, setConfig, setSessions, setSelectedSessionName]);

  return (
    <ErrorBoundary title="App crashed" description="The UI crashed but the shell is still running.">
      <Layout
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        pageTitle={title}
        pageDescription={description}
        showOverlay={loading}
        overlay={loading ? <LoadingOverlay progress={progress} message={loadingMessage} /> : null}
        quickAccessOpen={quickAccessOpen}
        onToggleQuickAccess={toggleQuickAccess}
      >
        <PageView currentPage={currentPage} />
      </Layout>
    </ErrorBoundary>
  );
}

export default App;
