import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldOff } from 'lucide-react';
import type { Permission } from '@tavolina/shared';
import { Button, EmptyState, Spinner } from '@tavolina/ui';
import { bootSession } from '../lib/api';
import { useSession } from '../lib/session';
import { homePath } from '../nav';
import { Logo } from './Logo';

let bootStarted = false;

/** Restores the session once per page load (StrictMode-safe). */
export function SessionBoot() {
  useEffect(() => {
    if (bootStarted) return;
    bootStarted = true;
    void bootSession();
  }, []);
  return <Outlet />;
}

export function Splash() {
  const { t } = useTranslation('app');
  const unreachable = useSession((s) => s.status === 'unreachable');
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
      role="status"
    >
      <Logo className="size-12" />
      <Spinner className="size-5 text-foreground-muted" />
      {unreachable ? (
        <p className="max-w-xs text-sm text-foreground-muted">{t('unreachable')}</p>
      ) : (
        <span className="sr-only">{t('loading')}</span>
      )}
    </div>
  );
}

const waiting = (status: string) => status === 'booting' || status === 'unreachable';

/** Only for signed-in staff. Sends others to /login or the PIN screen. */
export function RequireSession() {
  const status = useSession((s) => s.status);
  const location = useLocation();
  if (waiting(status)) return <Splash />;
  if (status === 'locked') return <Navigate to="/lock" replace />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/** Login and lock screens: skip them when a session is already active. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const can = useSession((s) => s.can);
  if (waiting(status)) return <Splash />;
  if (status === 'authenticated') return <Navigate to={homePath(can)} replace />;
  return children;
}

export function HomeRedirect() {
  const can = useSession((s) => s.can);
  return <Navigate to={homePath(can)} replace />;
}

export function NoAccess() {
  const { t } = useTranslation('app');
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        icon={<ShieldOff />}
        title={t('noAccess.title')}
        description={t('noAccess.description')}
        action={
          <Button asChild variant="outline">
            <Link to="/">{t('noAccess.back')}</Link>
          </Button>
        }
      />
    </div>
  );
}

/** Renders children only with the permission; the API enforces it again server-side. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const allowed = useSession((s) => s.permissions.has(permission));
  return allowed ? children : <NoAccess />;
}

/** The PIN screen is only for a locked device; otherwise go home or to sign-in. */
export function RequireLocked({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status);
  const can = useSession((s) => s.can);
  if (waiting(status)) return <Splash />;
  if (status === 'authenticated') return <Navigate to={homePath(can)} replace />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return children;
}
