import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bike, ChefHat, ClipboardList, Plus, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import {
  createOrderSchema,
  formatMoney,
  type Order,
  type OrderSummary,
  type OrderType,
} from '@tavolina/shared';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Skeleton,
  toast,
} from '@tavolina/ui';
import { PageHeader } from '../../components/AppLayout';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { useElapsed, useNow } from '../floor/floor-utils';
import { ChipToggle } from '../menu/fields';

const TYPE_ICON = { dine_in: UtensilsCrossed, takeaway: ShoppingBag, delivery: Bike } as const;

/** Open orders of the location; new takeaway and delivery orders start here. */
export function OrdersPage() {
  const { t } = useTranslation('orders');
  const navigate = useNavigate();
  const locationId = useSession((s) => s.locationId);
  const locationName = useSession((s) => s.locationName);
  const now = useNow();
  const elapsed = useElapsed();
  const [creating, setCreating] = useState(false);
  const orders = useQuery({
    queryKey: ['orders', locationId],
    queryFn: () => api<OrderSummary[]>('GET', '/orders'),
    refetchInterval: 60_000,
  });

  const open = (o: OrderSummary) =>
    navigate(o.tableSessionId ? `/floor/sessions/${o.tableSessionId}` : `/orders/${o.id}`);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={t('list.title')}
        subtitle={t('list.subtitle', { location: locationName ?? '' })}
        actions={
          <Button size="lg" onClick={() => setCreating(true)}>
            <Plus />
            {t('list.new')}
          </Button>
        }
      />

      {orders.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : !orders.data?.length ? (
        <EmptyState
          icon={<ClipboardList />}
          title={t('list.emptyTitle')}
          description={t('list.emptyDescription')}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orders.data.map((o) => {
            const Icon = TYPE_ICON[o.type];
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => open(o)}
                  className="flex w-full flex-col gap-3 rounded-card border border-border bg-surface p-4 text-left shadow-raised transition-transform hover:border-border-strong active:scale-[0.99]"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex flex-col">
                      <span className="text-lg font-extrabold">
                        {o.tableNames.length
                          ? t('screen.table', { names: o.tableNames.join(' + ') })
                          : (o.customerName ?? t(`types.${o.type}`))}
                      </span>
                      <span className="text-sm text-foreground-muted">
                        {t('screen.number', { number: o.number })} · {o.waiterName} ·{' '}
                        {elapsed(o.createdAt, now)}
                      </span>
                    </span>
                    <Badge icon={<Icon />}>{t(`types.${o.type}`)}</Badge>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex gap-2">
                      <Badge>{t('list.items', { count: o.itemCount })}</Badge>
                      {o.readyCount ? (
                        <Badge tone="success" icon={<ChefHat />}>
                          {t('list.ready', { count: o.readyCount })}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="font-mono text-lg font-bold tabular-nums">
                      {formatMoney(o.totalMinor)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <NewOrderDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(o) => navigate(`/orders/${o.id}`)}
      />
    </div>
  );
}

function NewOrderDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (order: Order) => void;
}) {
  const { t } = useTranslation('orders');
  const { t: tc } = useTranslation();
  const { message, fieldErrors, validate } = useErrorMessages();
  const [type, setType] = useState<Exclude<OrderType, 'dine_in'>>('takeaway');
  const [form, setForm] = useState({ customerName: '', customerPhone: '', deliveryAddress: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (body: unknown) => api<Order>('POST', '/orders', { body }),
    onSuccess: (order) => {
      toast.success(t('list.created', { number: order.number }));
      onOpenChange(false);
      onCreated(order);
    },
    onError: (err) => {
      const fields = fieldErrors(err);
      if (Object.keys(fields).length) setErrors(fields);
      else toast.error(message(err));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      uuid: crypto.randomUUID(),
      type,
      customerName: form.customerName || null,
      customerPhone: form.customerPhone || null,
      deliveryAddress: type === 'delivery' ? form.deliveryAddress || null : null,
    };
    const result = validate(createOrderSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    create.mutate(body);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('list.newTitle')}</DialogTitle>
            <DialogDescription>{t('list.newDescription')}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <ChipToggle
              pressed={type === 'takeaway'}
              onToggle={() => setType('takeaway')}
              icon={<ShoppingBag />}
            >
              {t('types.takeaway')}
            </ChipToggle>
            <ChipToggle
              pressed={type === 'delivery'}
              onToggle={() => setType('delivery')}
              icon={<Bike />}
            >
              {t('types.delivery')}
            </ChipToggle>
          </div>
          <Field label={t('list.customerName')} error={errors.customerName}>
            <Input
              value={form.customerName}
              maxLength={100}
              onChange={(e) => setForm({ ...form, customerName: e.target.value })}
            />
          </Field>
          <Field label={t('list.customerPhone')} error={errors.customerPhone}>
            <Input
              type="tel"
              value={form.customerPhone}
              maxLength={30}
              onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
            />
          </Field>
          {type === 'delivery' ? (
            <Field label={t('list.deliveryAddress')} error={errors.deliveryAddress}>
              <Input
                value={form.deliveryAddress}
                maxLength={255}
                onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
              />
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {t('list.start')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
