import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bike,
  CalendarCheck,
  ClipboardList,
  ShoppingBag,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import { formatMoney, type OrderSummary } from '@tavolina/shared';
import {
  Badge,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@tavolina/ui';
import { PageHeader } from '../../components/AppLayout';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useElapsed, useNow } from '../floor/floor-utils';
import { DayPanel } from './DayPanel';
import { DrawerPanel } from './DrawerPanel';

const TYPE_ICON = { dine_in: UtensilsCrossed, takeaway: ShoppingBag, delivery: Bike } as const;

/** The till (plan §5.7–5.8): what is waiting to be paid, the cash drawer, and closing the day. */
export function CashierPage() {
  const { t } = useTranslation('billing');
  const can = useSession((s) => s.can);
  const locationName = useSession((s) => s.locationName);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'orders';
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={t('cashier.title')}
        subtitle={t('cashier.subtitle', { location: locationName ?? '' })}
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="orders">
            <ClipboardList aria-hidden />
            {t('cashier.tabs.orders')}
          </TabsTrigger>
          {can('cash.drawer') ? (
            <TabsTrigger value="drawer">
              <Wallet aria-hidden />
              {t('cashier.tabs.drawer')}
            </TabsTrigger>
          ) : null}
          {can('cash.drawer') ? (
            <TabsTrigger value="day">
              <CalendarCheck aria-hidden />
              {t('cashier.tabs.day')}
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="orders" className="pt-4">
          <OrdersToPay />
        </TabsContent>
        <TabsContent value="drawer" className="pt-4">
          <DrawerPanel />
        </TabsContent>
        <TabsContent value="day" className="pt-4">
          <DayPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OrdersToPay() {
  const { t } = useTranslation('billing');
  const { t: to } = useTranslation('orders');
  const navigate = useNavigate();
  const locationId = useSession((s) => s.locationId);
  const now = useNow();
  const elapsed = useElapsed();
  const orders = useQuery({
    queryKey: ['orders', locationId],
    queryFn: () => api<OrderSummary[]>('GET', '/orders'),
    refetchInterval: 30_000,
  });
  if (orders.isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  const list = (orders.data ?? []).filter((o) => o.totalMinor > 0);
  if (!list.length) {
    return (
      <EmptyState
        icon={<Wallet />}
        title={t('cashier.emptyTitle')}
        description={t('cashier.emptyDescription')}
      />
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((o) => {
        const Icon = TYPE_ICON[o.type];
        return (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => navigate(`/orders/${o.id}/bill`)}
              className="flex w-full flex-col gap-2 rounded-card border border-border bg-surface p-4 text-left shadow-raised hover:border-border-strong"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="text-lg font-extrabold">
                  {o.tableNames.length
                    ? to('screen.table', { names: o.tableNames.join(' + ') })
                    : (o.customerName ?? to(`types.${o.type}`))}
                </span>
                <Badge icon={<Icon />}>{to(`types.${o.type}`)}</Badge>
              </span>
              <span className="text-sm text-foreground-muted">
                {to('screen.number', { number: o.number })} · {o.waiterName ?? '—'} ·{' '}
                {elapsed(o.createdAt, now)}
              </span>
              <span className="font-mono text-xl font-bold tabular-nums">
                {formatMoney(o.totalMinor)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
