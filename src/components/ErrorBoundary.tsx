import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Unhandled render error", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <h1 className="font-display text-3xl">Something broke.</h1>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          The screen failed to render. Your recorded meetings are stored on this
          device and are unaffected.
        </p>
        <pre className="max-w-full overflow-x-auto rounded-xl bg-muted p-4 text-left text-xs text-muted-foreground">
          {error.message}
        </pre>
        <button
          type="button"
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}
