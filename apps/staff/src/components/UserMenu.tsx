import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronsUpDown, Clock, LogOut, UserRoundCog } from 'lucide-react';
import { formatDuration, type ClockResult, type ClockStatus } from '@tavolina/shared';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
  toast,
} from '@tavolina/ui';
import { api, logout } from '../lib/api';
import { useErrorMessages } from '../lib/errors';
import { formatTime } from '../lib/format';
import { useSession } from '../lib/session';

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('app');
  const user = useSession((s) => s.user);
  const roleKey = useSession((s) => s.roleKey);
  const lock = useSession((s) => s.lock);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useSession((s) => s.can);
  const locationId = useSession((s) => s.locationId);
  const { message } = useErrorMessages();
  const clockable = Boolean(user && locationId && can('time.clock'));
  // Clock in/out for whoever is signed in (plan §5.8).
  const clock = useQuery({
    queryKey: ['time', 'me', locationId, user?.id],
    queryFn: () => api<ClockStatus>('GET', '/me/clock'),
    enabled: clockable,
  });
  const toggle = useMutation({
    mutationFn: (action: 'in' | 'out') => api<ClockResult>('POST', `/time-entries/clock-${action}`),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['time'] });
      toast.success(
        r.action === 'in'
          ? t('userMenu.clockedIn', { time: formatTime(r.entry.clockIn) })
          : t('userMenu.clockedOut', { hours: formatDuration(r.entry.minutes) }),
      );
    },
    onError: (err) => toast.error(message(err)),
  });
  if (!user) return null;
  const clockedIn = clock.data?.clockedIn ?? false;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('userMenu.label')}
        className={cn(
          'flex items-center gap-3 rounded-control text-left transition-colors hover:bg-surface-sunken',
          compact ? 'p-1' : 'w-full p-2',
        )}
      >
        <Avatar name={user.name} size={compact ? 'sm' : 'md'} />
        {compact ? null : (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold">{user.name}</span>
              <span className="truncate text-xs text-foreground-muted">
                {roleKey ? t(`roles.${roleKey}`) : ''}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-foreground-muted" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? 'end' : 'start'} side={compact ? 'bottom' : 'top'}>
        <DropdownMenuLabel>
          <span className="block text-sm text-foreground">{user.name}</span>
          {user.email ? <span className="block font-normal">{user.email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {clockable && clock.data ? (
          <>
            <DropdownMenuItem onSelect={() => toggle.mutate(clockedIn ? 'out' : 'in')}>
              <Clock />
              <span className="flex flex-col">
                {clockedIn ? t('userMenu.clockOut') : t('userMenu.clockIn')}
                {clockedIn && clock.data.entry ? (
                  <span className="text-xs font-normal text-foreground-muted">
                    {t('userMenu.since', { time: formatTime(clock.data.entry.clockIn) })}
                  </span>
                ) : clock.data.shift ? (
                  <span className="text-xs font-normal text-foreground-muted">
                    {t('userMenu.shift', {
                      from: formatTime(clock.data.shift.startsAt),
                      to: formatTime(clock.data.shift.endsAt),
                    })}
                  </span>
                ) : null}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          onSelect={() => {
            queryClient.removeQueries();
            lock();
            navigate('/lock');
          }}
        >
          <UserRoundCog />
          {t('userMenu.switchUser')}
        </DropdownMenuItem>
        <DropdownMenuItem
          destructive
          onSelect={async () => {
            await logout();
            queryClient.removeQueries();
            navigate('/login');
          }}
        >
          <LogOut />
          {t('userMenu.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
