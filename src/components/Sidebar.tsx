import { ReactNode } from 'react';
import { AppPage } from '../store';
import { Icons } from './Icons';

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
      className={`relative flex h-full flex-col border-r border-zinc-800 bg-[#09090b] transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="flex h-14 items-center gap-3 border-b border-zinc-800 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 shadow-sm">
          <Icons.Logo className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">Sora Suite</div>
            <div className="text-sm font-bold text-zinc-100">V2.1 Pro</div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-2 py-4">
        {items.map((item) => {
          const active = currentPage === item.key;
          return (
            <button
              key={item.key}
              title={collapsed ? item.label : undefined}
              onClick={() => onNavigate(item.key)}
              className={`group flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                active
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
              } ${collapsed ? 'justify-center px-2' : ''}`}
            >
              <span className={`${active ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300'}`}>
                {item.icon}
              </span>
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-zinc-800 p-2">
        <button
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
        >
          {collapsed ? <Icons.ChevronRight className="h-4 w-4" /> : 'Collapse Sidebar'}
        </button>
      </div>
    </aside>
  );
}