import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  DoorClosed,
  ExternalLink,
  Percent,
  Printer,
  RotateCcw,
  Split,
  Wallet,
  X,
} from 'lucide-react';
import { formatMoney, type Bill, type BillView, type Payment } from '@tavolina/shared';
import { Badge, Button, Card, EmptyState, Skeleton, cn, toast } from '@tavolina/ui';
import { useApproval } from '../../lib/useApproval';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { DiscountDialog, RefundDialog, type DiscountTarget } from './AdjustDialogs';
import { METHOD_ICON, useBillLabel, useBillQuery } from './billing-utils';
import { FiscalBadge } from './FiscalBadge';
import { PaymentDialog, type PayTarget } from './PaymentDialog';
import { SplitDialog } from './SplitDialog';

/** The bill of one order (plan §5.7): lines, discounts, service, VAT, splits, payments, receipts. */
export function BillPage() {
  const { orderRef } = useParams();
  const { t } = useTranslation('billing');
  const query = useBillQuery(orderRef!);
  if (query.isLoading) {
    return (
      <div className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-2">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!query.data) return <EmptyState icon={<Wallet />} title={t('notFound')} />;
  return <BillScreen view={query.data} />;
}

function BillScreen({ view }: { view: BillView }) {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const locationId = useSession((s) => s.locationId);
  const can = useSession((s) => s.can);
  const billLabel = useBillLabel();
  const { approve, dialog: approvalDialog } = useApproval();
  const [paying, setPaying] = useState<PayTarget | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [discount, setDiscount] = useState<DiscountTarget | null>(null);
  const [refunding, setRefunding] = useState<Payment | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { order, totals } = view;
  const hasPayments = view.paidMinor > 0;
  const open = order.status === 'open';
  const editable = open && !hasPayments;

  const update = (next: BillView) => {
    queryClient.setQueryData(['bill', locationId, String(order.id)], next);
    void queryClient.invalidateQueries({ queryKey: ['bill'] });
    void queryClient.invalidateQueries({ queryKey: ['floor'] });
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(null);
    }
  };

  const back = order.tableSessionId
    ? `/floor/sessions/${order.tableSessionId}`
    : `/orders/${order.id}`;
  const title = order.tableNames.length
    ? t('titleTable', { tables: order.tableNames.join(' + ') })
    : t('titleOrder', { number: order.number, name: order.customerName ?? '' });
  const lines = order.items.filter(
    (i) =>
      i.parentItemId === null && !['voided', 'draft', 'pending_confirmation'].includes(i.status),
  );
  const itemDiscount = (id: number) => view.discounts.find((d) => d.orderItemId === id);
  const orderDiscount = view.discounts.find((d) => d.orderItemId === null);
  const totalLine = (id: number) => totals.lines.find((l) => l.id === id);
  const lineGross = (id: number) =>
    (totalLine(id)?.grossMinor ?? 0) +
    order.items
      .filter((c) => c.parentItemId === id)
      .reduce((s, c) => s + (totalLine(c.id)?.grossMinor ?? 0), 0);

  const removeDiscount = (id: number) =>
    run(`d${id}`, async () => update(await api<BillView>('DELETE', `/discounts/${id}`)));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild aria-label={t('back')}>
          <Link to={back}>
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="text-sm text-foreground-muted">
            {t('orderNo', { number: order.number })}
            {order.waiterName ? ` · ${order.waiterName}` : ''}
          </p>
        </div>
        {view.balanceMinor <= 0 && totals.totalMinor > 0 ? (
          <Badge tone="success" size="lg">
            {t('paidInFull')}
          </Badge>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* The order with its discounts and the totals. */}
        <Card className="flex flex-col gap-4 p-4 sm:p-5">
          <ul className="flex flex-col divide-y divide-border">
            {lines.map((item) => {
              const d = itemDiscount(item.id);
              return (
                <li key={item.id} className="flex items-start gap-3 py-2.5">
                  <span className="w-8 shrink-0 font-mono font-bold tabular-nums">{item.qty}×</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {item.name}
                      {item.variantName ? (
                        <span className="font-normal text-foreground-muted">
                          {' '}
                          · {item.variantName}
                        </span>
                      ) : null}
                    </p>
                    {item.modifiers.length ? (
                      <p className="text-xs text-foreground-muted">
                        {item.modifiers.map((m) => m.name).join(', ')}
                      </p>
                    ) : null}
                    {d ? (
                      <p className="flex items-center gap-1 text-xs font-semibold text-success">
                        {t('discount.line', {
                          amount: formatMoney(d.amountMinor),
                          reason: d.reason,
                        })}
                        {editable && can('order.discount') ? (
                          <button
                            type="button"
                            aria-label={t('discount.remove')}
                            className="rounded-sm p-0.5 hover:bg-surface-sunken"
                            onClick={() => void removeDiscount(d.id)}
                          >
                            <X className="size-3.5" />
                          </button>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                  <span className="font-mono text-sm tabular-nums">
                    {formatMoney(lineGross(item.id))}
                  </span>
                  {editable && can('order.discount') ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('discount.onLine', { name: item.name })}
                      onClick={() =>
                        setDiscount({
                          orderItemId: item.id,
                          name: item.name,
                          baseMinor: totalLine(item.id)?.grossMinor ?? 0,
                        })
                      }
                    >
                      <Percent />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <dl className="flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
            <Row label={t('totals.subtotal')} value={formatMoney(totals.subtotalMinor)} />
            {totals.itemDiscountMinor ? (
              <Row
                label={t('totals.itemDiscounts')}
                value={`−${formatMoney(totals.itemDiscountMinor)}`}
                tone="success"
              />
            ) : null}
            {orderDiscount ? (
              <Row
                label={
                  <span className="flex items-center gap-1">
                    {t('totals.billDiscount', { reason: orderDiscount.reason })}
                    {editable && can('order.discount') ? (
                      <button
                        type="button"
                        aria-label={t('discount.remove')}
                        className="rounded-sm p-0.5 hover:bg-surface-sunken"
                        onClick={() => void removeDiscount(orderDiscount.id)}
                      >
                        <X className="size-3.5" />
                      </button>
                    ) : null}
                  </span>
                }
                value={`−${formatMoney(totals.orderDiscountMinor)}`}
                tone="success"
              />
            ) : null}
            {totals.serviceMinor ? (
              <Row
                label={t('totals.service', { pct: view.serviceChargeBp / 100 })}
                value={formatMoney(totals.serviceMinor)}
              />
            ) : null}
            <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2">
              <dt className="text-lg font-bold">{t('totals.total')}</dt>
              <dd className="font-mono text-2xl font-extrabold tabular-nums">
                {formatMoney(totals.totalMinor)}
              </dd>
            </div>
            {totals.tax.map((tx) => (
              <Row
                key={tx.rateBp}
                label={t('totals.vat', { rate: tx.rateBp / 100, net: formatMoney(tx.netMinor) })}
                value={formatMoney(tx.taxMinor)}
                muted
              />
            ))}
            {view.paidMinor ? (
              <Row label={t('totals.paid')} value={formatMoney(view.paidMinor)} />
            ) : null}
            <div className="flex items-baseline justify-between">
              <dt className="font-bold">{t('totals.balance')}</dt>
              <dd
                className={cn(
                  'font-mono text-xl font-bold tabular-nums',
                  view.balanceMinor > 0 ? 'text-danger' : 'text-success',
                )}
              >
                {formatMoney(Math.max(0, view.balanceMinor))}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            {editable && can('order.discount') ? (
              <Button
                variant="outline"
                onClick={() =>
                  setDiscount({
                    orderItemId: null,
                    name: t('discount.wholeBill'),
                    baseMinor: totals.subtotalMinor - totals.itemDiscountMinor,
                  })
                }
              >
                <Percent />
                {t('discount.billButton')}
              </Button>
            ) : null}
            {editable && can('bill.split') && totals.totalMinor > 0 ? (
              <Button variant="outline" onClick={() => setSplitting(true)}>
                <Split />
                {t('split.button')}
              </Button>
            ) : null}
          </div>
          {hasPayments && open ? (
            <p className="text-xs text-foreground-muted">{t('lockedAfterPayment')}</p>
          ) : null}
        </Card>

        {/* Bills and payments. */}
        <div className="flex flex-col gap-3">
          {view.bills.length === 0 ? (
            <Card className="flex flex-col gap-3 p-5">
              <p className="text-sm text-foreground-muted">{t('bill.notSplit')}</p>
              <Button
                size="xl"
                block
                disabled={!open || totals.totalMinor <= 0}
                onClick={() =>
                  setPaying({ billId: null, label: t('bill.whole'), dueMinor: view.balanceMinor })
                }
              >
                <Wallet />
                {t('pay.button', { amount: formatMoney(view.balanceMinor) })}
              </Button>
            </Card>
          ) : (
            view.bills.map((bill) => (
              <BillCard
                key={bill.id}
                bill={bill}
                label={billLabel(bill)}
                busy={busy}
                canRefund={can('payment.take')}
                onPay={() =>
                  setPaying({
                    billId: bill.id,
                    label: billLabel(bill),
                    dueMinor: bill.balanceMinor,
                  })
                }
                onPrint={() =>
                  void run(`p${bill.id}`, async () => {
                    const res = await api<{ jobId: number | null }>(
                      'POST',
                      `/bills/${bill.id}/print`,
                    );
                    toast({
                      tone: res.jobId ? 'success' : 'info',
                      title: res.jobId ? t('receipt.printing') : t('receipt.noPrinter'),
                    });
                  })
                }
                onRefund={setRefunding}
              />
            ))
          )}

          {view.balanceMinor <= 0 && order.tableSessionId && open && can('table.close') ? (
            <Button
              size="xl"
              variant="highlight"
              loading={busy === 'close'}
              onClick={() =>
                void run('close', async () => {
                  await api('POST', `/table-sessions/${order.tableSessionId}/close`);
                  toast.success(t('tableClosed'));
                  void queryClient.invalidateQueries({ queryKey: ['floor'] });
                  navigate('/floor');
                })
              }
            >
              <DoorClosed />
              {t('closeTable')}
            </Button>
          ) : null}
        </div>
      </div>

      <PaymentDialog view={view} target={paying} onClose={() => setPaying(null)} onPaid={update} />
      <SplitDialog
        view={view}
        open={splitting}
        onClose={() => setSplitting(false)}
        onSplit={update}
      />
      <DiscountDialog
        view={view}
        target={discount}
        approve={approve}
        onClose={() => setDiscount(null)}
        onDone={update}
      />
      <RefundDialog
        payment={refunding}
        approve={approve}
        onClose={() => setRefunding(null)}
        onDone={update}
      />
      {approvalDialog}
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  muted,
}: {
  label: React.ReactNode;
  value: string;
  tone?: 'success';
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3',
        muted && 'text-xs text-foreground-muted',
      )}
    >
      <dt>{label}</dt>
      <dd className={cn('font-mono tabular-nums', tone === 'success' && 'text-success')}>
        {value}
      </dd>
    </div>
  );
}

function BillCard({
  bill,
  label,
  busy,
  canRefund,
  onPay,
  onPrint,
  onRefund,
}: {
  bill: Bill;
  label: string;
  busy: string | null;
  canRefund: boolean;
  onPay: () => void;
  onPrint: () => void;
  onRefund: (p: Payment) => void;
}) {
  const { t } = useTranslation('billing');
  return (
    <Card className={cn('flex flex-col gap-3 p-4', bill.status !== 'open' && 'border-success')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">{label}</h2>
          <p className="font-mono text-xl font-extrabold tabular-nums">
            {formatMoney(bill.totalMinor)}
          </p>
        </div>
        <Badge
          tone={bill.status === 'open' ? 'warning' : bill.status === 'paid' ? 'success' : 'danger'}
        >
          {t(`bill.status.${bill.status}`)}
        </Badge>
      </div>
      {bill.payments.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {bill.payments.map((p) => {
            const Icon = METHOD_ICON[p.method];
            return (
              <li key={p.id} className="flex items-center gap-2">
                <Icon className="size-4 text-foreground-muted" aria-hidden />
                <span className="flex-1">
                  {t(`methods.${p.method}`)}
                  {p.reference ? (
                    <span className="text-foreground-muted"> · {p.reference}</span>
                  ) : null}
                  {p.tipMinor ? (
                    <span className="text-foreground-muted">
                      {' '}
                      · {t('pay.tipShort', { amount: formatMoney(p.tipMinor) })}
                    </span>
                  ) : null}
                  {p.changeMinor ? (
                    <span className="text-foreground-muted">
                      {' '}
                      · {t('pay.changeShort', { amount: formatMoney(p.changeMinor) })}
                    </span>
                  ) : null}
                  {p.refundedMinor ? (
                    <span className="text-danger">
                      {' '}
                      · {t('refund.refunded', { amount: formatMoney(p.refundedMinor) })}
                    </span>
                  ) : null}
                </span>
                <span className="font-mono tabular-nums">{formatMoney(p.amountMinor)}</span>
                {canRefund && p.refundedMinor < p.amountMinor ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('refund.title')}
                    onClick={() => onRefund(p)}
                  >
                    <RotateCcw />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {bill.status === 'open' ? (
        <Button size="lg" onClick={onPay}>
          <Wallet />
          {bill.paidMinor
            ? t('pay.rest', { amount: formatMoney(bill.balanceMinor) })
            : t('pay.button', { amount: formatMoney(bill.balanceMinor) })}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <FiscalBadge fiscal={bill.fiscal} />
          <Button variant="outline" size="sm" loading={busy === `p${bill.id}`} onClick={onPrint}>
            <Printer />
            {t('receipt.print')}
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={bill.receiptUrl} target="_blank" rel="noreferrer">
              <ExternalLink />
              {t('receipt.digital')}
            </a>
          </Button>
        </div>
      )}
    </Card>
  );
}

/** /floor/sessions/:sessionId/bill — opens the bill of the table's order. */
export function SessionBill() {
  const { sessionId } = useParams();
  const { t } = useTranslation('billing');
  const locationId = useSession((s) => s.locationId);
  const order = useQuery({
    queryKey: ['order', locationId, `s:${sessionId}`],
    queryFn: async () =>
      (await api<{ order: { id: number } | null }>('GET', `/table-sessions/${sessionId}/order`))
        .order,
  });
  if (order.isLoading) return <Skeleton className="m-6 h-64" />;
  if (!order.data) return <EmptyState icon={<Wallet />} title={t('notFound')} />;
  return <Navigate to={`/orders/${order.data.id}/bill`} replace />;
}
