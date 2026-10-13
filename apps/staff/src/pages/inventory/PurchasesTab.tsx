import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Truck } from 'lucide-react';
import { formatMoney, type PurchaseOrder, type PurchaseOrderStatus } from '@tavolina/shared';
import { Badge, Button, EmptyState, Skeleton } from '@tavolina/ui';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useSuppliers } from './inventory-utils';
import { PurchaseOrderDialog } from './PurchaseOrderDialog';

const STATUS_TONE: Record<
  PurchaseOrderStatus,
  'neutral' | 'info' | 'warning' | 'success' | 'danger'
> = {
  draft: 'neutral',
  sent: 'info',
  partially_received: 'warning',
  received: 'success',
  cancelled: 'danger',
};

export function PurchasesTab() {
  const { t } = useTranslation('inventory');
  const locationId = useSession((s) => s.locationId);
  const manage = useSession((s) => s.can)('inventory.manage');
  const suppliers = useSuppliers();
  const orders = useQuery({
    queryKey: ['inventory', 'purchase-orders', locationId],
    queryFn: () => api<PurchaseOrder[]>('GET', '/purchase-orders'),
  });
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const current =
    typeof open === 'number' ? (orders.data?.find((o) => o.id === open) ?? null) : null;
  const hasSuppliers = (suppliers.data ?? []).some((s) => s.active);

  if (orders.isLoading) return <Skeleton className="h-64" />;
  const newButton = manage ? (
    <Button
      onClick={() => setOpen('new')}
      disabled={!hasSuppliers}
      title={hasSuppliers ? undefined : t('purchases.needSupplier')}
    >
      <Plus />
      {t('purchases.new')}
    </Button>
  ) : undefined;

  return (
    <div className="flex flex-col gap-4">
      {orders.data?.length ? (
        <>
          <div className="flex items-center justify-end gap-3">
            {!hasSuppliers ? (
              <span className="text-sm text-foreground-muted">{t('purchases.needSupplier')}</span>
            ) : null}
            {newButton}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {orders.data.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setOpen(o.id)}
                  className="flex w-full flex-col gap-2 rounded-card border border-border bg-surface p-4 text-left shadow-raised hover:border-border-strong"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-lg font-extrabold">
                      {t('purchases.number', { number: o.number })}
                    </span>
                    <Badge tone={STATUS_TONE[o.status]}>{t(`purchases.status.${o.status}`)}</Badge>
                  </span>
                  <span className="text-sm font-semibold">{o.supplierName}</span>
                  <span className="text-sm text-foreground-muted">
                    {o.lines.map((l) => l.ingredientName).join(', ')}
                  </span>
                  <span className="flex items-end justify-between gap-2">
                    <span className="text-xs text-foreground-muted">
                      {o.expectedAt
                        ? `${t('purchases.expected')} ${o.expectedAt}`
                        : formatDateTime(o.createdAt)}
                    </span>
                    <span className="font-mono text-lg font-bold tabular-nums">
                      {formatMoney(o.totalMinor)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          icon={<Truck />}
          title={t('purchases.empty')}
          description={hasSuppliers ? t('purchases.emptyDescription') : t('purchases.needSupplier')}
          action={newButton}
        />
      )}
      <PurchaseOrderDialog
        order={open === 'new' ? 'new' : current}
        canManage={manage}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
