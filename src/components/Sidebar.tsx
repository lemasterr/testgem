import { ReactNode } from 'react';
import { AppPage } from '../store';

export interface NavItem {
  key: AppPage;
  label: string;
  icon: ReactNode;
}

interface SidebarProps {
  items: NavItem[];
  currentPage: AppPage;
  collapsed: boolean;
  onNavigate: (page: AppPage) => void;
  onToggleCollapse: () => void;
}

export function Sidebar({ items, currentPage, collapsed, onNavigate, onToggleCollapse }: SidebarProps) {
  return (
    <aside
      className={`relative flex h-full flex-col border-r border-white/5 bg-[#0c0f16]/90 backdrop-blur transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="flex items-center gap-2 px-4 py-4 text-sm font-semibold text-white">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/40 to-indigo-500/20 text-lg text-blue-100">
          ⚡
        </div>
        {!collapsed && (
          <div>
            <div className="text-xs uppercase tracking-widest text-blue-200/80">Sora Suite V2</div>
            <div className="text-base text-white">Control Center</div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-2">
        {items.map((item) => {
          const active = currentPage === item.key;
          return (
            <button
              key={item.key}
              title={collapsed ? item.label : undefined}
              onClick={() => onNavigate(item.key)}
              className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                active
                  ? 'bg-gradient-to-r from-blue-600/30 via-blue-500/20 to-transparent text-white shadow-inner shadow-blue-500/20 border border-blue-500/40'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-white'
              } ${collapsed ? 'justify-center px-2' : 'pl-4'}`}
            >
              <span className="text-lg">{item.icon}</span>
              {!collapsed && <span className="font-medium">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-white/5 px-2 py-3">
        <button
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 transition hover:border-blue-500/50 hover:text-white"
        >
          {collapsed ? '›' : '‹'} Collapse
        </button>
      </div>
    </aside>
  );
}
