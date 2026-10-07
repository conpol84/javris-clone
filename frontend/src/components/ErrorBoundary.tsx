import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** A tab left open across a deploy asks for chunks that no longer exist: load the new version once. */
export function reloadOnStaleBuild(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  if (!/dynamically imported module|Importing a module script failed|Loading chunk|preload/i.test(msg)) return false;
  try {
    if (sessionStorage.getItem('firbo-stale-reload')) return false;
    sessionStorage.setItem('firbo-stale-reload', '1');
  } catch { /* still reload once below */ }
  window.location.reload();
  return true;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
    reloadOnStaleBuild(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="grid h-full min-h-screen place-items-center p-8" style={{ background: 'radial-gradient(900px 500px at 50% -10%, rgba(34,211,238,.12), transparent 60%), #030812', color: '#e6f1ff' }}>
          <div className="w-full max-w-md rounded-2xl p-8 text-center" style={{ background: 'rgba(9,17,31,.8)', border: '1px solid rgba(148,180,220,.18)', boxShadow: '0 20px 60px -24px rgba(0,0,0,.8)' }}>
            <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl" style={{ background: 'rgba(251,191,36,.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,.3)' }}>
              <AlertTriangle size={22} />
            </div>
            <h2 className="text-lg font-semibold">This page hit a problem</h2>
            <p className="mt-2 text-sm" style={{ color: '#7f9fc4' }}>Your data is safe. Reload the page to continue; if it keeps happening, tell your admin what you were doing.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button onClick={() => window.location.reload()} className="inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold" style={{ background: 'linear-gradient(180deg,#67e8f9,#22d3ee)', color: '#04131c' }}>
                <RotateCcw size={14} /> Reload
              </button>
              <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.assign('/'); }} className="cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold" style={{ border: '1px solid rgba(148,180,220,.25)', color: '#e6f1ff' }}>
                Back to Command Center
              </button>
            </div>
            <details className="mt-5 text-start text-xs" style={{ color: '#5b7494' }}>
              <summary className="cursor-pointer">Technical details</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">{this.state.error?.message || 'Unexpected error'}</pre>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
