import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronsUpDown, LogOut, UserRoundCog } from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@tavolina/ui';
import { logout } from '../lib/api';
import { useSession } from '../lib/session';

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('app');
  const user = useSession((s) => s.user);
  const roleKey = useSession((s) => s.roleKey);
  const lock = useSession((s) => s.lock);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (!user) return null;

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
