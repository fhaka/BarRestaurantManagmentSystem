import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@tavolina/ui';

/** A lazily loaded page whose file is gone (a new version was deployed) cannot be retried. */
const isChunkError = (error: unknown) =>
  error instanceof Error &&
  /dynamically imported module|Importing a module script failed|Loading chunk/i.test(error.message);

function PageError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const stale = isChunkError(error);
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        icon={<TriangleAlert />}
        title={t('pageError.title')}
        description={stale ? t('pageError.updated') : t('pageError.description')}
        action={
          stale ? (
            <Button onClick={() => window.location.reload()}>
              <RefreshCw />
              {t('pageError.reload')}
            </Button>
          ) : (
            <Button onClick={onRetry}>
              <RefreshCw />
              {t('pageError.retry')}
            </Button>
          )
        }
      />
    </div>
  );
}

class Boundary extends Component<
  { children: ReactNode; onReset: () => void; resetKey: string },
  { error: unknown }
> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidUpdate(previous: { resetKey: string }) {
    // Navigating elsewhere clears the error.
    if (previous.resetKey !== this.props.resetKey && this.state.error)
      this.setState({ error: null });
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Page failed', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <PageError
          error={this.state.error}
          onRetry={() => {
            this.props.onReset();
            this.setState({ error: null });
          }}
        />
      );
    }
    return this.props.children;
  }
}

/** A page placeholder while its code loads. */
export function PageLoading() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-96 max-w-full" />
      <Skeleton className="h-80" />
    </div>
  );
}

/**
 * Around every page: a failed first load (queries throw then, see main.tsx) or a crash shows a
 * friendly error with "try again" instead of a blank screen; the menu stays usable.
 */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <Boundary onReset={reset} resetKey={location.pathname}>
          <Suspense fallback={<PageLoading />}>{children}</Suspense>
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  );
}

/** Last resort for errors outside any page (router errorElement). */
export function RootError() {
  return <PageError error={null} onRetry={() => window.location.reload()} />;
}
