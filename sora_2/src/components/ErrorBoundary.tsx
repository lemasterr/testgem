import { Component, ReactNode } from 'react';
import { useAppStore } from '../store';

type ErrorBoundaryProps = {
  children: ReactNode;
  title?: string;
  description?: string;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error?: Error;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Log locally and forward to main for diagnostics
    // eslint-disable-next-line no-console
    console.error('Renderer crashed', error, info);
    try {
      window.electronAPI?.logging?.rendererError?.({
        message: error?.message,
        stack: error?.stack,
        info,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Failed to forward renderer error', err);
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, error: undefined });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#0b0b10] p-6 text-center text-zinc-200">
        <div className="rounded-2xl border border-blue-700/40 bg-[#0f1624] px-6 py-5 shadow-lg">
          <div className="text-sm uppercase tracking-[0.24em] text-blue-400">UI Error</div>
          <div className="mt-2 text-2xl font-semibold text-white">
            {this.props.title || 'Something went wrong. The UI crashed.'}
          </div>
          {this.props.description && (
            <p className="mt-2 text-sm text-zinc-400">{this.props.description}</p>
          )}
          {this.state.error?.message && (
            <p className="mt-3 text-xs text-red-300">{this.state.error.message}</p>
          )}
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              onClick={this.handleReload}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-500"
            >
              Reload current view
            </button>
            <DashboardButton />
          </div>
        </div>
      </div>
    );
  }
}

function DashboardButton() {
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  return (
    <button
      onClick={() => setCurrentPage('dashboard')}
      className="rounded-md border border-zinc-600 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
    >
      Go to Dashboard
    </button>
  );
}

export function PageBoundary({ children, title }: { children: ReactNode; title: string }) {
  return (
    <ErrorBoundary
      title={title}
      description="This section hit an error. You can try reloading just this page or navigate elsewhere."
    >
      {children}
    </ErrorBoundary>
  );
}
