import { TriangleAlertIcon } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/utils';

interface State {
  error: unknown;
}

interface Props {
  children: ReactNode;
  /** A change (the route) clears the error. */
  resetKey?: string | undefined;
  /** What to show instead of the reload message; `reset` draws the children again. */
  fallback?: ((error: unknown, reset: () => void) => ReactNode) | undefined;
}

/** Shows a page's crash as a message with a reload button, instead of a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error !== undefined) this.setState({ error: undefined });
  }

  private readonly reset = (): void => {
    this.setState({ error: undefined });
  };

  override render(): ReactNode {
    if (this.state.error === undefined) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback(this.state.error, this.reset);
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>This page couldn&apos;t be shown</AlertTitle>
        <AlertDescription>
          {errorMessage(this.state.error)}
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
}
