import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Clock, Lock, LogIn, LogOut, Users } from 'lucide-react';
import {
  formatDuration,
  type AuthResponse,
  type ClockResult,
  type PinUser,
} from '@tavolina/shared';
import { Avatar, Button, EmptyState, Skeleton, Toaster, cn, toast } from '@tavolina/ui';
import { Logo } from '../components/Logo';
import { PinPad } from '../components/PinPad';
import { ApiRequestError, enterSession, logout, publicGet, publicPost } from '../lib/api';
import { useErrorMessages } from '../lib/errors';
import { formatTime } from '../lib/format';
import { useSession } from '../lib/session';
import { homePath } from '../nav';

/**
 * Shared-device screen: staff tap their name and enter a PIN. The device keeps its session
 * (refresh cookie) underneath; only the person using it changes.
 */
export function LockPage() {
  const { t } = useTranslation('auth');
  const { t: ta } = useTranslation('app');
  const { t: tc } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = useErrorMessages();
  const locationId = useSession((s) => s.locationId);
  const [selected, setSelected] = useState<PinUser | null>(null);
  // "signIn" switches who uses the device; "clock" records arriving and leaving work (plan §5.8).
  const [mode, setMode] = useState<'signIn' | 'clock'>('signIn');
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['pin-users', locationId],
    enabled: locationId !== null,
    queryFn: () => publicGet<PinUser[]>(`/auth/pin-users?locationId=${locationId}`),
    retry: false,
    // Handled here: an expired device session sends the device back to sign-in.
    throwOnError: false,
  });

  // Without a valid device session there is nobody to switch to: back to sign-in
  // (the /lock route guard redirects once the session is cleared).
  const sessionGone =
    locationId === null || (users.error instanceof ApiRequestError && users.error.status === 401);
  useEffect(() => {
    if (sessionGone) useSession.getState().clear();
  }, [sessionGone]);

  async function onPin(pin: string) {
    if (!selected || !locationId) return;
    if (mode === 'clock') return onClock(pin);
    try {
      const auth = await publicPost<AuthResponse>('/auth/pin', {
        userId: selected.id,
        pin,
        locationId,
      });
      queryClient.removeQueries();
      await enterSession(auth, locationId);
      navigate(homePath(useSession.getState().can), { replace: true });
    } catch (err) {
      setError(message(err));
      if (err instanceof ApiRequestError && err.code === 'PIN_LOCKED') {
        void users.refetch();
      }
      throw err;
    }
  }

  async function onClock(pin: string) {
    if (!selected || !locationId) return;
    try {
      const result = await publicPost<ClockResult>('/auth/pin-clock', {
        userId: selected.id,
        pin,
        locationId,
      });
      const first = result.userName.split(' ')[0];
      toast.success(
        result.action === 'in'
          ? t('lock.clockedIn', { name: first, time: formatTime(result.entry.clockIn) })
          : t('lock.clockedOut', {
              name: first,
              time: formatTime(result.entry.clockOut!),
              hours: formatDuration(result.entry.minutes),
            }),
      );
      setSelected(null);
      setError(null);
      void users.refetch();
    } catch (err) {
      setError(message(err));
      if (err instanceof ApiRequestError && err.code === 'PIN_LOCKED') void users.refetch();
      throw err;
    }
  }

  async function signOutDevice() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-dvh flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo className="size-8" />
          <span className="text-lg font-extrabold tracking-tight">{tc('appName')}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={signOutDevice}>
          <LogOut />
          {t('lock.signOutDevice')}
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 py-8">
        {selected ? (
          <>
            <div className="flex flex-col items-center gap-3 text-center">
              <Avatar name={selected.name} size="lg" />
              <h1 className="text-2xl font-extrabold tracking-tight">
                {mode === 'clock'
                  ? t(selected.clockedIn ? 'lock.clockOutPin' : 'lock.clockInPin', {
                      name: selected.name.split(' ')[0],
                    })
                  : t('lock.enterPin', { name: selected.name.split(' ')[0] })}
              </h1>
              <p className="text-sm text-foreground-muted">{ta(`roles.${selected.roleKey}`)}</p>
            </div>
            <PinPad onComplete={onPin} error={error} disabled={selected.locked} />
            <Button
              variant="ghost"
              onClick={() => {
                setSelected(null);
                setError(null);
              }}
            >
              <ArrowLeft />
              {t('lock.back')}
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-4 text-center">
              <div
                role="radiogroup"
                aria-label={t('lock.mode')}
                className="flex rounded-full border border-border bg-surface p-1 shadow-raised"
              >
                {(['signIn', 'clock'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={cn(
                      'flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors',
                      mode === m
                        ? 'bg-primary text-primary-fg'
                        : 'text-foreground-muted hover:text-foreground',
                    )}
                  >
                    {m === 'signIn' ? (
                      <LogIn className="size-4" aria-hidden />
                    ) : (
                      <Clock className="size-4" aria-hidden />
                    )}
                    {t(`lock.modes.${m}`)}
                  </button>
                ))}
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight">
                {mode === 'clock' ? t('lock.clockTitle') : t('lock.title')}
              </h1>
              <p className="text-foreground-muted">
                {mode === 'clock' ? t('lock.clockSubtitle') : t('lock.subtitle')}
              </p>
            </div>
            {users.isPending ? (
              <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-36 rounded-card" />
                ))}
              </div>
            ) : users.data?.length ? (
              <ul className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {users.data.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(user);
                        setError(user.locked ? message(lockedError()) : null);
                      }}
                      className={cn(
                        'flex h-36 w-full flex-col items-center justify-center gap-3 rounded-card border border-border bg-surface p-3 text-center shadow-raised transition-[transform,border-color]',
                        'hover:border-primary/50 active:scale-[0.98]',
                      )}
                    >
                      <Avatar name={user.name} size="lg" />
                      <span className="flex flex-col">
                        <span className="line-clamp-1 text-sm font-semibold">{user.name}</span>
                        <span className="flex items-center justify-center gap-1 text-xs text-foreground-muted">
                          {user.locked ? (
                            <>
                              <Lock className="size-3" aria-hidden />
                              {t('lock.locked')}
                            </>
                          ) : mode === 'clock' && user.clockedIn ? (
                            <>
                              <span className="size-2 rounded-full bg-success" aria-hidden />
                              {t('lock.atWork')}
                            </>
                          ) : (
                            ta(`roles.${user.roleKey}`)
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Users />} title={t('lock.title')} description={t('lock.empty')} />
            )}
          </>
        )}
      </main>
      <Toaster closeLabel={tc('actions.close')} />
    </div>
  );
}

function lockedError() {
  return new ApiRequestError(423, { code: 'PIN_LOCKED', message: 'Locked', details: {} });
}
