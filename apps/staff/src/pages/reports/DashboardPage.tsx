import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ChefHat,
  CircleSlash,
  Package,
} from 'lucide-react';
import { changeBp, formatMoney, type DashboardData } from '@tavolina/shared';
import { Badge, Button, Card, EmptyState, Skeleton, cn } from '@tavolina/ui';
import { PageHeader } from '../../components/AppLayout';
import { currentLocale } from '../../i18n';
import { api } from '../../lib/api';
import { formatTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { formatQty } from '../inventory/inventory-utils';
import { ChartCard, RankBars, TrendChart } from './charts';
import { formatBp, formatNumber } from './report-utils';

/** Plan §5.13: the owner/manager dashboard for today, live. */
export function DashboardPage() {
  const { t } = useTranslation('reports');
  const locationId = useSession((s) => s.locationId);
  const locationName = useSession((s) => s.locationName);
  const can = useSession((s) => s.can);
  const dash = useQuery({
    queryKey: ['dashboard', locationId],
    queryFn: () => api<DashboardData>('GET', '/reports/dashboard'),
    // Sales events refresh it straight away (lib/realtime); this is the safety net.
    refetchInterval: 60_000,
  });

  const d = dash.data;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle', { location: locationName ?? '' })}
        actions={
          <>
            {d ? (
              <span className="self-center text-xs text-foreground-muted">
                {t('dashboard.updated', { time: formatTime(d.generatedAt) })}
              </span>
            ) : null}
            {can('report.view') ? (
              <Button variant="outline" asChild>
                <Link to="/reports">
                  <BarChart3 />
                  {t('dashboard.openReports')}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {dash.isLoading || !d ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <Content d={d} />
      )}
    </div>
  );
}

function Content({ d }: { d: DashboardData }) {
  const { t } = useTranslation('reports');
  const change = changeBp(d.revenueMinor, d.revenueLastWeekMinor);
  const weekday = new Intl.DateTimeFormat(currentLocale(), {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${d.businessDate}T00:00:00Z`));
  // Today's line stops at the current hour; last week's runs the whole day for comparison.
  const nowSlot = d.hourly.findIndex(
    (h) => h.hour === Number(formatTime(d.generatedAt).slice(0, 2)),
  );
  const hourly = d.hourly.map((h, i) => ({
    label: `${String(h.hour).padStart(2, '0')}`,
    value: i <= nowSlot ? h.todayMinor : null,
    compare: h.lastWeekMinor,
  }));
  // Trim the quiet hours before opening and after closing.
  const used = hourly.map((h) => (h.value ?? 0) + h.compare > 0);
  const first = Math.max(0, used.indexOf(true) - 1);
  const last = Math.min(hourly.length - 1, used.lastIndexOf(true) + 1);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="flex flex-col gap-2 p-5 sm:col-span-2 lg:col-span-1 lg:row-span-2">
          <span className="text-sm font-semibold text-foreground-muted">
            {t('dashboard.revenue')}
          </span>
          <span className="whitespace-nowrap font-mono text-3xl font-extrabold tabular-nums tracking-tight lg:text-2xl xl:text-3xl">
            {formatMoney(d.revenueMinor)}
          </span>
          {change === null ? (
            <span className="text-sm text-foreground-muted">{t('dashboard.noCompare')}</span>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
              <Badge
                tone={change >= 0 ? 'success' : 'danger'}
                icon={change >= 0 ? <ArrowUpRight /> : <ArrowDownRight />}
              >
                {change >= 0 ? '+' : ''}
                {formatBp(change)}
              </Badge>
              {t('dashboard.vsLastWeek', { day: weekday })}
            </span>
          )}
          <span className="mt-auto text-sm text-foreground-muted">
            {t('dashboard.lastWeek')}:{' '}
            <span className="font-mono tabular-nums">{formatMoney(d.revenueLastWeekMinor)}</span>
          </span>
        </Card>
        <Kpi label={t('dashboard.orders')} value={formatNumber(d.orders)} />
        <Kpi label={t('dashboard.avgTicket')} value={formatMoney(d.avgTicketMinor)} />
        <Kpi label={t('dashboard.covers')} value={formatNumber(d.covers)} />
        <Kpi
          label={t('dashboard.openTables')}
          value={formatNumber(d.openTables)}
          detail={
            d.openOrdersMinor
              ? t('dashboard.openAmount', { amount: formatMoney(d.openOrdersMinor) })
              : undefined
          }
        />
        <Kpi
          label={t('dashboard.voids')}
          value={formatNumber(d.voids.count)}
          detail={
            d.voids.count
              ? t('dashboard.voidsAmount', { amount: formatMoney(d.voids.amountMinor) })
              : undefined
          }
          icon={<CircleSlash className="size-4" aria-hidden />}
          tone={d.voids.count ? 'warning' : undefined}
        />
        <Kpi
          label={t('dashboard.lowStock')}
          value={formatNumber(d.lowStock.length)}
          icon={<Package className="size-4" aria-hidden />}
          tone={d.lowStock.length ? 'warning' : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title={t('dashboard.hourly')}
          legend={[
            { label: t('dashboard.today'), color: 'rgb(var(--primary))' },
            {
              label: t('dashboard.lastWeek'),
              color: 'rgb(var(--foreground-subtle))',
              dashed: true,
            },
          ]}
        >
          <TrendChart
            data={hourly.slice(first, last + 1)}
            valueLabel={t('dashboard.today')}
            compareLabel={t('dashboard.lastWeek')}
          />
        </ChartCard>
        <ChartCard title={t('dashboard.topItems')}>
          {d.topItems.length ? (
            <RankBars
              data={d.topItems.map((i) => ({
                label: i.name,
                value: i.qty,
                detail: formatMoney(i.revenueMinor),
              }))}
              format={(v) => formatNumber(v)}
              valueLabel={t('dashboard.qty')}
            />
          ) : (
            <EmptyState title={t('dashboard.empty')} />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="flex items-center gap-2 font-bold">
            <ChefHat className="size-4" aria-hidden />
            {t('dashboard.prep')}
          </h2>
          {d.prepTimes.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {d.prepTimes.map((p) => (
                <li key={p.stationId} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-xs text-foreground-muted">
                    {t('dashboard.prepItems', { count: p.items })}
                  </span>
                  <span className="ml-auto font-mono text-xl font-bold tabular-nums">
                    {t('dashboard.minutes', { n: formatNumber(p.avgMinutes, 1) })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground-muted">{t('dashboard.noPrep')}</p>
          )}
        </Card>
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="flex items-center gap-2 font-bold">
            <AlertTriangle className="size-4" aria-hidden />
            {t('dashboard.lowStock')}
          </h2>
          {d.lowStock.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {d.lowStock.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <Link to="/inventory?tab=stock" className="font-semibold hover:underline">
                    {i.name}
                  </Link>
                  <span className="font-mono text-sm tabular-nums">
                    <span className="font-bold text-danger">{formatQty(i.stockMilli, i.unit)}</span>
                    <span className="text-foreground-muted">
                      {' '}
                      / {formatQty(i.minMilli, i.unit)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-foreground-muted">{t('dashboard.lowStockEmpty')}</p>
          )}
        </Card>
      </div>
    </>
  );
}

function Kpi({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  icon?: ReactNode;
  tone?: 'warning';
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span
        className={cn(
          'flex items-center gap-1.5 text-sm font-semibold text-foreground-muted',
          tone === 'warning' && 'text-warning-soft-fg',
        )}
      >
        {icon}
        {label}
      </span>
      <span className="font-mono text-2xl font-bold tabular-nums">{value}</span>
      {detail ? <span className="text-xs text-foreground-muted">{detail}</span> : null}
    </Card>
  );
}
