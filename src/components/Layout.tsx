import { ReactNode, useMemo, useState } from 'react';
import { AppPage } from '../store';
import { QuickAccessPanel } from './QuickAccessPanel';
import { Sidebar, NavItem } from './Sidebar';
import { TitleBar } from './TitleBar';
import { Icons } from './Icons';

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
      { key: 'dashboard', label: 'Dashboard', icon: <Icons.Dashboard className="w-5 h-5" /> },
      { key: 'sessions', label: 'Sessions', icon: <Icons.Sessions className="w-5 h-5" /> },
      { key: 'automator', label: 'Automator', icon: <Icons.Automator className="w-5 h-5" /> },
      { key: 'downloader', label: 'Downloader', icon: <Icons.Downloader className="w-5 h-5" /> },
      { key: 'content', label: 'Content', icon: <Icons.Content className="w-5 h-5" /> },
      { key: 'watermark', label: 'Watermark', icon: <Icons.Watermark className="w-5 h-5" /> },
      { key: 'telegram', label: 'Telegram', icon: <Icons.Telegram className="w-5 h-5" /> },
      { key: 'logs', label: 'Logs', icon: <Icons.Logs className="w-5 h-5" /> },
      { key: 'settings', label: 'Settings', icon: <Icons.Settings className="w-5 h-5" /> }
    ],
    []
  );

  return (
    <div className="relative flex h-screen flex-col bg-[#09090b] text-zinc-100 font-inter overflow-hidden">
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
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#0c0c0e]">
          <main className="flex-1 overflow-y-auto p-6 animate-fade-in scrollbar-thin">
            <div className="mx-auto max-w-7xl space-y-6">
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