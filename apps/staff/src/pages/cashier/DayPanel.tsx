import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarCheck } from 'lucide-react';
import { formatMoney, type ZReport } from '@tavolina/shared';
import { Badge, Button, Card, Skeleton, toast } from '@tavolina/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';

/** X report while the day is open; closing stores and prints the Z report and locks the day. */
export function DayPanel() {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const queryClient = useQueryClient();
  const locationId = useSession((s) => s.locationId);
  const can = useSession((s) => s.can);
  const [confirm, setConfirm] = useState(false);
  const report = useQuery({
    queryKey: ['cash', 'report', locationId],
    queryFn: () => api<ZReport>('GET', '/business-days/current/report'),
  });
  const close = useMutation({
    mutationFn: () => api<ZReport>('POST', '/business-days/close'),
    onSuccess: (z) => {
      queryClient.setQueryData(['cash', 'report', locationId], z);
      toast.success(t('day.closed'));
      setConfirm(false);
    },
    onError: (err) => {
      toast.error(message(err));
      setConfirm(false);
    },
  });
  if (!report.data) return <Skeleton className="h-96" />;
  const z = report.data;
  const m = (v: number) => formatMoney(v);

  const section = (title: string, rows: [string, string][]) => (
    <Card className="flex flex-col gap-2 p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground-muted">{title}</h3>
      <dl className="flex flex-col gap-1 text-sm">
        {rows.map(([a, b], i) => (
          <div key={i} className="flex justify-between gap-3">
            <dt>{a}</dt>
            <dd className="font-mono tabular-nums">{b}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">
            {z.closed
              ? t('day.zTitle', { date: z.businessDate })
              : t('day.xTitle', { date: z.businessDate })}
          </h2>
          <Badge tone={z.closed ? 'success' : 'info'}>
            {z.closed ? t('day.locked') : t('day.open')}
          </Badge>
        </div>
        {!z.closed && can('cash.approve') ? (
          <Button variant="highlight" onClick={() => setConfirm(true)}>
            <CalendarCheck />
            {t('day.close')}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {section(t('day.sales'), [
          [t('day.orders'), String(z.orders)],
          [t('day.gross'), m(z.grossSalesMinor)],
          [t('day.discounts'), `−${m(z.discountsMinor)}`],
          [t('day.service'), m(z.serviceMinor)],
          [t('day.net'), m(z.netSalesMinor)],
          ...z.tax.map((tx): [string, string] => [
            t('day.vat', { rate: tx.rateBp / 100 }),
            m(tx.taxMinor),
          ]),
        ])}
        {section(t('day.payments'), [
          ...z.payments.map((p): [string, string] => [
            `${t(`methods.${p.method}`)} (${p.count})`,
            m(p.amountMinor),
          ]),
          [t('day.paymentsTotal'), m(z.paymentsTotalMinor)],
          [t('day.tips'), m(z.tipsMinor)],
          [t('day.refunds', { count: z.refunds.count }), `−${m(z.refunds.amountMinor)}`],
          [t('day.voids', { count: z.voids.count }), m(z.voids.amountMinor)],
        ])}
        {section(t('day.cash'), [
          [t('drawer.float'), m(z.cash.floatMinor)],
          [t('drawer.types.sale'), m(z.cash.salesMinor)],
          [t('drawer.types.pay_in'), m(z.cash.payInsMinor)],
          [t('drawer.types.pay_out'), `−${m(z.cash.payOutsMinor)}`],
          [t('drawer.types.refund'), `−${m(z.cash.refundsMinor)}`],
          [t('drawer.expected'), m(z.cash.expectedMinor)],
          [t('drawer.counted'), z.cash.countedMinor === null ? '—' : m(z.cash.countedMinor)],
        ])}
        {section(
          t('day.staff'),
          z.waiters.map((w): [string, string] => [
            `${w.name} (${w.orders})`,
            `${m(w.salesMinor)} · ${t('day.tipsShort', { amount: m(w.tipsMinor) })}`,
          ]),
        )}
        {section(
          t('day.items'),
          z.items
            .slice(0, 15)
            .map((i): [string, string] => [`${i.qty}× ${i.name}`, m(i.amountMinor)]),
        )}
        {section(t('day.fiscal'), [
          [t('fiscal.registered'), String(z.fiscal.registered)],
          [t('fiscal.pending'), String(z.fiscal.pending)],
          [t('fiscal.failed'), String(z.fiscal.failed)],
        ])}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('day.confirmTitle', { date: z.businessDate })}
        description={t('day.confirmBody')}
        confirmLabel={t('day.close')}
        loading={close.isPending}
        onConfirm={() => close.mutate()}
      />
    </div>
  );
}
