import { ReactNode, useMemo, useState } from 'react';
import { AppPage } from '../store';
import { QuickAccessPanel } from './QuickAccessPanel';
import { Sidebar, NavItem } from './Sidebar';
import { TitleBar } from './TitleBar';

const iconClass = 'h-5 w-5 text-zinc-400';

const DashboardIcon = () => (
  <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M4 13h6V4H4v9Z" />
    <path d="M14 20h6v-9h-6v9Z" />
    <path d="M14 4v4h6V4h-6Z" />
    <path d="M4 20h6v-4H4v4Z" />
  </svg>
);

const FolderIcon = () => (
  <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M3.5 18.5v-13h6l2 2h9v11h-17Z" />
  </svg>
);

const RobotIcon = () => (
  <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="5" y="7" width="14" height="11" rx="2" />
    <path d="M9 4v3m6-3v3M9 12h6M8 15h1m6 0h1" />
  </svg>
);

const DownloadIcon = () => (
  <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 4v10" />
    <path d="m7 11 5 5 5-5" />
    <path d="M4 20h16" />
  </svg>
);

const EditIcon = () => (
  <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M5 19h14" />
    <path d="M7 15 16 6l3 3-9 9H7v-3Z" />
  </svg>
);

const WatermarkIcon = () => (
  <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M5 12a7 7 0 0 1 14 0 7 7 0 0 1-14 0Z" />
    <path d="M9 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z" />
  </svg>
);

const TelegramIcon = () => (
  <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="m4 12 15-7-2.5 14L11 13l-2.5 3L8 11l11-6" />
  </svg>
);

const LogIcon = () => (
  <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M6 4h9a3 3 0 0 1 3 3v13H9a3 3 0 0 1-3-3V4Z" />
    <path d="M9 4v4h9" />
  </svg>
);

const SettingsIcon = () => (
  <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
    <path d="m19.4 15.5-.6 1.1a2 2 0 0 1-1.7 1l-.7-.1a2 2 0 0 0-1.5.4l-.5.5a2 2 0 0 1-2.8 0l-.5-.5a2 2 0 0 0-1.5-.4l-.7.1a2 2 0 0 1-1.7-1l-.6-1.1a2 2 0 0 1 .2-2.2l.4-.5a2 2 0 0 0 .4-1.6l-.1-.7a2 2 0 0 1 1-1.7l1.1-.6a2 2 0 0 1 2.2.2l.5.4a2 2 0 0 0 1.6.4l.7-.1a2 2 0 0 1 1.7 1l.6 1.1a2 2 0 0 1-.2 2.2l-.4.5a2 2 0 0 0-.4 1.6l.1.7a2 2 0 0 1-1 1.7Z" />
  </svg>
);

interface LayoutProps {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
  pageTitle: string;
  pageDescription?: string;
  showOverlay?: boolean;
  overlay?: ReactNode;
  quickAccessOpen?: boolean;
  onToggleQuickAccess?: () => void;
  children: ReactNode;
}

export function Layout({
  currentPage,
  onNavigate,
  pageTitle,
  pageDescription,
  showOverlay,
  overlay,
  quickAccessOpen,
  onToggleQuickAccess,
  children,
}: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);

  const navItems: NavItem[] = useMemo(
    () => [
      { key: 'dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
      { key: 'sessions', label: 'Sessions', icon: <FolderIcon /> },
      { key: 'automator', label: 'Automator', icon: <RobotIcon /> },
      { key: 'downloader', label: 'Downloader', icon: <DownloadIcon /> },
      { key: 'content', label: 'Content', icon: <EditIcon /> },
      { key: 'watermark', label: 'Watermark', icon: <WatermarkIcon /> },
      { key: 'telegram', label: 'Telegram', icon: <TelegramIcon /> },
      { key: 'logs', label: 'Logs', icon: <LogIcon /> },
      { key: 'settings', label: 'Settings', icon: <SettingsIcon /> }
    ],
    []
  );

  return (
    <div className="relative flex h-screen flex-col bg-gradient-to-br from-[#05060b] via-[#0b0f1a] to-[#05060b] text-zinc-100">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.08),transparent_32%)]" />
      <TitleBar
        title={pageTitle}
        description={pageDescription}
        onToggleQuickAccess={onToggleQuickAccess}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          items={navItems}
          currentPage={currentPage}
          collapsed={collapsed}
          onNavigate={onNavigate}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
        <div className="flex min-w-0 flex-1 overflow-hidden">
          <main className="flex h-full w-full justify-center overflow-y-auto p-6 animate-fade-in">
            <div className="relative flex h-full w-full max-w-6xl flex-col gap-4">
              {children}
            </div>
          </main>
        </div>
      </div>
      <QuickAccessPanel />
      {showOverlay && overlay}
    </div>
  );
}
