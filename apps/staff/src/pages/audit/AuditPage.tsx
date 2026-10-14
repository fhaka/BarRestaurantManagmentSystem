import { Fragment, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, ScrollText, ShieldCheck } from 'lucide-react';
import {
  TIMEZONE,
  addDays,
  businessDate,
  type AuditLogEntry,
  type AuditLogPage,
} from '@tavolina/shared';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tavolina/ui';
import { PageHeader } from '../../components/AppLayout';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { ChipToggle } from '../menu/fields';
import { ActionLabel, ChangeView } from './audit-parts';

interface Facets {
  actions: string[];
  users: { id: number; name: string }[];
}

/** Plan §5.14: the append-only audit log, read-only, with filters (managers). */
export function AuditPage() {
  const { t } = useTranslation('audit');
  const locationId = useSession((s) => s.locationId);
  const locationName = useSession((s) => s.locationName);
  const today = businessDate(new Date(), TIMEZONE);
  const initial = {
    from: addDays(today, -6),
    to: today,
    group: 'all',
    userId: 'all',
    approved: false,
  };
  const [filters, setFilters] = useState(initial);
  const [open, setOpen] = useState<number | null>(null);

  const facets = useQuery({
    queryKey: ['audit', 'facets', locationId],
    queryFn: () => api<Facets>('GET', '/audit-logs/facets'),
  });
  const groups = [...new Set((facets.data?.actions ?? []).map((a) => a.split('.')[0]!))].sort();

  const log = useInfiniteQuery({
    queryKey: ['audit', 'logs', locationId, filters],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ from: filters.from, to: filters.to, limit: '50' });
      if (filters.group !== 'all') q.set('action', `${filters.group}.`);
      if (filters.userId !== 'all') q.set('userId', filters.userId);
      if (filters.approved) q.set('approved', 'true');
      if (pageParam) q.set('before', String(pageParam));
      return api<AuditLogPage>('GET', `/audit-logs?${q}`);
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: filters.from <= filters.to,
  });
  const rows: AuditLogEntry[] = log.data?.pages.flatMap((p) => p.rows) ?? [];
  const set = (patch: Partial<typeof filters>) => setFilters({ ...filters, ...patch });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <PageHeader title={t('title')} subtitle={t('subtitle', { location: locationName ?? '' })} />

      <div className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-3">
        <Field label={t('from')} className="w-40">
          <Input
            type="date"
            value={filters.from}
            max={filters.to}
            onChange={(e) => e.target.value && set({ from: e.target.value })}
          />
        </Field>
        <Field label={t('to')} className="w-40">
          <Input
            type="date"
            value={filters.to}
            min={filters.from}
            onChange={(e) => e.target.value && set({ to: e.target.value })}
          />
        </Field>
        <Field label={t('group')} className="w-52">
          <Select
            value={filters.group}
            onValueChange={(v) => set({ group: v })}
            options={[
              { value: 'all', label: t('allGroups') },
              ...groups.map((g) => ({
                value: g,
                label: t(`groups.${g}` as 'groups.auth', { defaultValue: g }),
              })),
            ]}
          />
        </Field>
        <Field label={t('person')} className="w-52">
          <Select
            value={filters.userId}
            onValueChange={(v) => set({ userId: v })}
            options={[
              { value: 'all', label: t('everyone') },
              ...(facets.data?.users ?? []).map((u) => ({ value: String(u.id), label: u.name })),
            ]}
          />
        </Field>
        <ChipToggle
          pressed={filters.approved}
          onToggle={() => set({ approved: !filters.approved })}
        >
          <ShieldCheck className="size-4" aria-hidden />
          {t('approvedOnly')}
        </ChipToggle>
        <Button variant="ghost" className="ml-auto" onClick={() => setFilters(initial)}>
          {t('reset')}
        </Button>
      </div>

      {log.isLoading ? (
        <Skeleton className="h-96" />
      ) : !rows.length ? (
        <EmptyState icon={<ScrollText />} title={t('empty')} description={t('emptyDescription')} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-0" />
                <TableHead>{t('when')}</TableHead>
                <TableHead>{t('who')}</TableHead>
                <TableHead>{t('what')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('entity')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const expanded = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <TableRow>
                      <TableCell className="w-0 pr-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-expanded={expanded}
                          aria-label={t('details')}
                          onClick={() => setOpen(expanded ? null : r.id)}
                        >
                          {expanded ? <ChevronDown /> : <ChevronRight />}
                        </Button>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-foreground-muted">
                        {formatDateTime(r.at)}
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold">{r.userName ?? t('system')}</span>
                        {r.approvedByName ? (
                          <span className="mt-0.5 block">
                            <Badge tone="info" size="sm" icon={<ShieldCheck />}>
                              {t('approvedBy', { name: r.approvedByName })}
                            </Badge>
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <ActionLabel action={r.action} />
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-foreground-muted md:table-cell">
                        {r.entityType}
                        {r.entityId ? ` #${r.entityId}` : ''}
                      </TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow className="bg-surface-sunken/50 hover:bg-surface-sunken/50">
                        <TableCell colSpan={5}>
                          <ChangeView entry={r} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
          {log.hasNextPage ? (
            <Button
              variant="outline"
              className="self-center"
              loading={log.isFetchingNextPage}
              onClick={() => void log.fetchNextPage()}
            >
              {t('loadMore')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
