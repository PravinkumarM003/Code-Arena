import { Component, ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-surface-950 text-white text-center p-8">
          <div>
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-2xl font-bold mb-2">Something went wrong</h2>
            <p className="text-white/50 mb-4">Please refresh the page to continue.</p>
            <button onClick={() => window.location.reload()} className="btn-primary">Refresh</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
