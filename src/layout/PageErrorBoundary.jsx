import { Component } from 'react';

// Stops one broken page from blanking the whole app. The sidebar stays up,
// the error is shown in place, and moving to another page resets it.
export default class PageErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-xl py-10">
        <h1 className="page-title text-[2rem] text-ink">This page hit an error</h1>
        <p className="mt-2 text-sm text-slate-600">
          Nothing was lost on other pages. Reload to try again. If it keeps happening, send this
          message to whoever maintains the app:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-red-200 bg-red-50 p-3 text-[0.8rem] text-red-800 whitespace-pre-wrap">
          {String(this.state.error?.message || this.state.error)}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer"
        >
          Reload page
        </button>
      </div>
    );
  }
}
