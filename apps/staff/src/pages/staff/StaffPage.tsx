import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  KeyRound,
  Lock,
  Plus,
  Search,
  SearchX,
  ShieldCheck,
  Smartphone,
  Users,
} from 'lucide-react';
import { ROLE_KEYS, canGrantRole, type RoleKey, type StaffMember } from '@tavolina/shared';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@tavolina/ui';
import { PageHeader } from '../../components/AppLayout';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { CredentialsDialog } from './CredentialsDialog';
import { StaffFormSheet } from './StaffFormSheet';

const ROLE_TONE: Record<RoleKey, 'solid' | 'primary' | 'highlight' | 'info' | 'neutral'> = {
  owner: 'solid',
  manager: 'primary',
  cashier: 'highlight',
  waiter: 'info',
  kitchen: 'neutral',
};

export function StaffPage() {
  const { t } = useTranslation('staff');
  const { t: ta } = useTranslation('app');
  const { t: tc } = useTranslation();
  const { message } = useErrorMessages();
  const locationId = useSession((s) => s.locationId);
  const locationName = useSession((s) => s.locationName);
  const permissions = useSession((s) => s.permissions);
  const canManage = permissions.has('staff.manage');

  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'all' | RoleKey>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<StaffMember | null>(null);

  const staff = useQuery({
    queryKey: ['staff', locationId],
    queryFn: () => api<StaffMember[]>('GET', '/staff'),
  });

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return (staff.data ?? []).filter(
      (m) =>
        (role === 'all' || m.roleKey === role) &&
        (!q ||
          m.name.toLocaleLowerCase().includes(q) ||
          (m.email ?? '').toLocaleLowerCase().includes(q)),
    );
  }, [staff.data, search, role]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (member: StaffMember) => {
    setEditing(member);
    setFormOpen(true);
  };
  const manageable = (m: StaffMember) => canManage && canGrantRole(permissions, m.roleKey);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', { location: locationName ?? '' })}
        actions={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus />
              {t('add')}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="pl-9"
          />
        </div>
        <Select
          aria-label={t('filterRole')}
          className="sm:w-52"
          value={role}
          onValueChange={(v) => setRole(v as 'all' | RoleKey)}
          options={[
            { value: 'all', label: t('allRoles') },
            ...ROLE_KEYS.map((r) => ({ value: r, label: ta(`roles.${r}`) })),
          ]}
        />
      </div>

      {staff.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : staff.isError ? (
        <EmptyState
          title={message(staff.error)}
          action={
            <Button variant="outline" onClick={() => void staff.refetch()}>
              {tc('actions.retry')}
            </Button>
          }
        />
      ) : staff.data.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            canManage ? (
              <Button onClick={openCreate}>
                <Plus />
                {t('add')}
              </Button>
            ) : null
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={t('empty.noMatch')}
          description={t('empty.noMatchDescription')}
        />
      ) : (
        <>
          <p className="text-sm text-foreground-muted">{t('count', { count: rows.length })}</p>
          <Table containerClassName="max-h-[70dvh]">
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.name')}</TableHead>
                <TableHead>{t('columns.role')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('columns.signIn')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('columns.lastLogin')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => {
                const editable = manageable(m);
                return (
                  <TableRow
                    key={m.id}
                    className={cn(editable && 'cursor-pointer', !m.active && 'opacity-60')}
                    onClick={editable ? () => openEdit(m) : undefined}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={m.name} size="sm" />
                        <div className="flex min-w-0 flex-col">
                          {editable ? (
                            <button
                              type="button"
                              className="truncate text-left font-semibold hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEdit(m);
                              }}
                            >
                              {m.name}
                            </button>
                          ) : (
                            <span className="truncate font-semibold">{m.name}</span>
                          )}
                          {m.email ? (
                            <span className="truncate text-xs text-foreground-muted">
                              {m.email}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge tone={ROLE_TONE[m.roleKey]}>{ta(`roles.${m.roleKey}`)}</Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1.5">
                        {m.hasPin ? (
                          <Badge size="sm" icon={<Smartphone />}>
                            {t('signIn.pin')}
                          </Badge>
                        ) : null}
                        {m.hasPassword ? (
                          <Badge size="sm" icon={<KeyRound />}>
                            {t('signIn.password')}
                          </Badge>
                        ) : null}
                        {!m.hasPin && !m.hasPassword ? (
                          <span className="text-xs text-foreground-subtle">{t('signIn.none')}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-foreground-muted lg:table-cell">
                      {m.lastLoginAt ? formatDateTime(m.lastLoginAt) : t('never')}
                    </TableCell>
                    <TableCell>
                      {m.pinLocked ? (
                        <Badge tone="warning" icon={<Lock />}>
                          {t('status.pinLocked')}
                        </Badge>
                      ) : m.active ? (
                        <Badge tone="success" icon={<ShieldCheck />}>
                          {t('status.active')}
                        </Badge>
                      ) : (
                        <Badge>{t('status.inactive')}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}

      <StaffFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        member={editing}
        onEditCredentials={(m) => {
          setFormOpen(false);
          setCredentialsFor(m);
        }}
      />
      <CredentialsDialog
        member={credentialsFor}
        onOpenChange={(open) => {
          if (!open) setCredentialsFor(null);
        }}
      />
    </div>
  );
}
