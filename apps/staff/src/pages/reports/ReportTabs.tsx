import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import {
  formatDuration,
  formatMoney,
  type DiscountsVoidsReport,
  type HoursReport,
  type InventoryReport,
  type ItemsReport,
  type PaymentsReport,
  type SalesReport,
  type StaffReport,
} from '@tavolina/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@tavolina/ui';
import { currentLocale } from '../../i18n';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { formatDateTime, formatDay } from '../../lib/format';
import { useSession } from '../../lib/session';
import { formatQty } from '../inventory/inventory-utils';
import { ChartCard, Heatmap, RankBars, ShareDonut, TrendChart } from './charts';
import {
  csvLek,
  csvQty,
  downloadCsv,
  formatBp,
  formatNumber,
  useReport,
  type Range,
} from './report-utils';

interface TabProps {
  range: Range;
  locations: number[];
}

interface Column<T> {
  label: string;
  numeric?: boolean;
  className?: string;
  render: (row: T) => ReactNode;
}

function DataTable<T>({
  columns,
  rows,
  rowKey,
  footer,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string | number;
  footer?: ReactNode;
}) {
  return (
    <Table containerClassName="max-h-[70vh]">
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.label} numeric={c.numeric} className={c.className}>
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={rowKey(r, i)}>
            {columns.map((c) => (
              <TableCell key={c.label} numeric={c.numeric} className={c.className}>
                {c.render(r)}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {footer}
      </TableBody>
    </Table>
  );
}

function Toolbar({
  children,
  onExport,
  hint,
}: {
  children?: ReactNode;
  onExport?: () => void;
  hint?: string;
}) {
  const { t } = useTranslation('reports', { keyPrefix: 'reports' });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {hint ? <p className="text-sm text-foreground-muted">{hint}</p> : null}
      <div className="ml-auto flex gap-2">
        {children}
        {onExport ? (
          <Button variant="outline" onClick={onExport}>
            <Download />
            {t('export')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-sm font-semibold text-foreground-muted">{label}</span>
      <span
        className={`font-mono text-xl font-bold tabular-nums ${tone === 'danger' ? 'text-danger' : ''}`}
      >
        {value}
      </span>
    </Card>
  );
}

const Loading = () => <Skeleton className="h-96" />;
const file = (name: string, r: Range) => `${name}-${r.from}-${r.to}.csv`;

function useEmpty() {
  const { t } = useTranslation('reports', { keyPrefix: 'reports' });
  return <EmptyState title={t('empty')} />;
}

// ---- Sales -------------------------------------------------------------------------------------

export function SalesTab({ range, locations }: TabProps) {
  const { t } = useTranslation('reports', { keyPrefix: 'reports' });
  const { t: to } = useTranslation('orders');
  const report = useReport<SalesReport>('sales', range, locations);
  const empty = useEmpty();
  if (!report.data) return <Loading />;
  const r = report.data;
  if (!r.totals.orders) return empty;
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1 + i)),
    ),
  );
  const exportCsv = () =>
    downloadCsv(
      file('shitjet', range),
      [
        t('sales.date'),
        t('sales.revenue'),
        t('sales.orders'),
        t('sales.covers'),
        t('sales.avgTicket'),
      ],
      r.daily.map((d) => [
        d.date,
        csvLek(d.revenueMinor),
        d.orders,
        d.covers,
        csvLek(d.avgTicketMinor),
      ]),
    );
  return (
    <div className="flex flex-col gap-4">
      <Toolbar onExport={exportCsv} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t('sales.revenue')} value={formatMoney(r.totals.revenueMinor)} />
        <Tile label={t('sales.orders')} value={formatNumber(r.totals.orders)} />
        <Tile label={t('sales.covers')} value={formatNumber(r.totals.covers)} />
        <Tile label={t('sales.avgTicket')} value={formatMoney(r.totals.avgTicketMinor)} />
        <Tile label={t('sales.tax')} value={formatMoney(r.totals.taxMinor)} />
        <Tile label={t('sales.discounts')} value={formatMoney(r.totals.discountMinor)} />
        <Tile
          label={t('sales.refunds')}
          value={formatMoney(r.totals.refundsMinor)}
          tone={r.totals.refundsMinor ? 'danger' : undefined}
        />
        <Tile label={t('sales.net')} value={formatMoney(r.totals.netMinor)} />
      </div>
      {r.daily.length > 1 ? (
        <ChartCard title={t('sales.daily')}>
          <TrendChart
            data={r.daily.map((d) => ({ label: formatDay(d.date), value: d.revenueMinor }))}
            valueLabel={t('sales.revenue')}
          />
        </ChartCard>
      ) : null}
      <ChartCard title={t('sales.heatmap')}>
        <p className="-mt-2 text-xs text-foreground-muted">{t('sales.heatmapHint')}</p>
        <Heatmap cells={r.heatmap} weekdays={weekdays} emptyLabel={t('empty')} />
      </ChartCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t('sales.byCategory')}>
          <RankBars
            data={r.byCategory.map((c) => ({
              label: c.name,
              value: c.revenueMinor,
              detail: `${t('sales.qty')}: ${formatNumber(c.qty)}`,
            }))}
            valueLabel={t('sales.revenue')}
          />
        </ChartCard>
        <ChartCard title={t('sales.byType')}>
          <DataTable
            rows={r.byType}
            rowKey={(x) => x.type}
            columns={[
              { label: t('sales.type'), render: (x) => to(`types.${x.type}`) },
              { label: t('sales.orders'), numeric: true, render: (x) => formatNumber(x.orders) },
              {
                label: t('sales.revenue'),
                numeric: true,
                render: (x) => formatMoney(x.revenueMinor),
              },
              {
                label: '%',
                numeric: true,
                render: (x) =>
                  formatBp(Math.round((x.revenueMinor * 10_000) / r.totals.revenueMinor)),
              },
            ]}
          />
        </ChartCard>
      </div>
    </div>
  );
}

// ---- Items -------------------------------------------------------------------------------------

export function ItemsTab({ range, locations }: TabProps) {
  const { t } = useTranslation('reports', { keyPrefix: 'reports' });
  const report = useReport<ItemsReport>('items', range, locations);
  const empty = useEmpty();
  if (!report.data) return <Loading />;
  const rows = report.data.rows;
  if (!rows.length) return empty;
  const exportCsv = () =>
    downloadCsv(
      file('artikujt', range),
      [
        t('items.name'),
        t('items.category'),
        t('items.qty'),
        t('items.revenue'),
        t('items.net'),
        t('items.cost'),
        t('items.margin'),
        t('items.marginPct'),
        t('items.share'),
      ],
      rows.map((r) => [
        r.name,
        r.category,
        r.qty,
        csvLek(r.revenueMinor),
        csvLek(r.netMinor),
        csvLek(r.costMinor),
        csvLek(r.marginMinor),
        r.marginBp === null ? null : (r.marginBp / 100).toFixed(1),
        (r.shareBp / 100).toFixed(1),
      ]),
    );
  return (
    <div className="flex flex-col gap-4">
      <Toolbar onExport={exportCsv} hint={t('items.hint')} />
      <ChartCard title={t('items.top')}>
        <RankBars
          data={rows.slice(0, 10).map((r) => ({
            label: r.name,
            value: r.revenueMinor,
            detail: `${t('items.qty')}: ${formatNumber(r.qty)}`,
          }))}
          valueLabel={t('items.revenue')}
        />
      </ChartCard>
      <DataTable
        rows={rows}
        rowKey={(r) => `${r.menuItemId}-${r.name}`}
        columns={[
          {
            label: t('items.name'),
            render: (r) => (
              <>
                <span className="font-semibold">{r.name}</span>
                <span className="block text-xs text-foreground-muted">{r.category}</span>
              </>
            ),
          },
          { label: t('items.qty'), numeric: true, render: (r) => formatNumber(r.qty) },
          { label: t('items.revenue'), numeric: true, render: (r) => formatMoney(r.revenueMinor) },
          {
            label: t('items.cost'),
            numeric: true,
            className: 'hidden md:table-cell',
            render: (r) => (r.costMinor === null ? '—' : formatMoney(r.costMinor)),
          },
          {
            label: t('items.margin'),
            numeric: true,
            className: 'hidden sm:table-cell',
            render: (r) => (r.marginMinor === null ? '—' : formatMoney(r.marginMinor)),
          },
          {
            label: t('items.marginPct'),
            numeric: true,
            render: (r) =>
              r.marginBp === null ? (
                <span className="text-xs text-foreground-subtle">{t('items.noRecipe')}</span>
              ) : (
                <Badge
                  tone={r.marginBp < 3_000 ? 'danger' : r.marginBp < 6_000 ? 'warning' : 'success'}
                >
                  {formatBp(r.marginBp)}
                </Badge>
              ),
          },
          {
            label: t('items.share'),
            numeric: true,
            className: 'hidden lg:table-cell',
            render: (r) => formatBp(r.shareBp),
          },
        ]}
      />
    </div>
  );
}

// ---- Staff and tips ----------------------------------------------------------------------------

export function StaffTab({ range, locations }: TabProps) {
  const { t } = useTranslation('reports', { keyPrefix: 'reports' });
  const report = useReport<StaffReport>('staff', range, locations);
  const empty = useEmpty();
  if (!report.data) return <Loading />;
  const rows = report.data.rows;
  if (!rows.length) return empty;
  const exportCsv = () =>
    downloadCsv(
      file('stafi', range),
      [
        t('staff.name'),
        t('staff.orders'),
        t('staff.covers'),
        t('staff.revenue'),
        t('staff.avgTicket'),
        t('staff.tips'),
        t('staff.voids'),
      ],
      rows.map((r) => [
        r.name,
        r.orders,
        r.covers,
        csvLek(r.revenueMinor),
        csvLek(r.avgTicketMinor),
        csvLek(r.tipsMinor),
        r.voids,
      ]),
    );
  const waiters = rows.filter((r) => r.orders > 0);
  return (
    <div className="flex flex-col gap-4">
      <Toolbar onExport={exportCsv} hint={t('staff.hint')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t('staff.revenue')}>
          <RankBars
            data={waiters.map((r) => ({ label: r.name, value: r.revenueMinor }))}
            valueLabel={t('staff.revenue')}
          />
        </ChartCard>
        <ChartCard title={t('staff.tips')}>
          <RankBars
            data={[...rows]
              .sort((a, b) => b.tipsMinor - a.tipsMinor)
              .filter((r) => r.tipsMinor > 0)
              .map((r) => ({ label: r.name, value: r.tipsMinor }))}
            valueLabel={t('staff.tips')}
          />
        </ChartCard>
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => r.userId}
        columns={[
          {
            label: t('staff.name'),
            render: (r) => <span className="font-semibold">{r.name}</span>,
          },
          { label: t('staff.orders'), numeric: true, render: (r) => formatNumber(r.orders) },
          {
            label: t('staff.covers'),
            numeric: true,
            className: 'hidden md:table-cell',
            render: (r) => formatNumber(r.covers),
          },
          { label: t('staff.revenue'), numeric: true, render: (r) => formatMoney(r.revenueMinor) },
          {
            label: t('staff.avgTicket'),
            numeric: true,
            className: 'hidden sm:table-cell',
            render: (r) => formatMoney(r.avgTicketMinor),
          },
          { label: t('staff.tips'), numeric: true, render: (r) => formatMoney(r.tipsMinor) },
          {
            label: t('staff.voids'),
            numeric: true,
            className: 'hidden sm:table-cell',
            render: (r) => formatNumber(r.voids),
          },
        ]}
      />
    </div>
  );
}

// ---- Payments ----------------------------------------------------------------------------------

export function PaymentsTab({ range, locations }: TabProps) {
  const { t } = useTranslation('reports', { keyPrefix: 'reports' });
  const { t: tb } = useTranslation('billing');
  const report = useReport<PaymentsReport>('payments', range, locations);
  const empty = useEmpty();
  if (!report.data) return <Loading />;
  const r = report.data;
  if (!r.rows.length) return empty;
  const exportCsv = () =>
    downloadCsv(
      file('pagesat', range),
      [t('payments.method'), t('payments.count'), t('payments.amount'), t('payments.tips')],
      [
        ...r.rows.map((x) => [
          tb(`methods.${x.method}`),
          x.count,
          csvLek(x.amountMinor),
          csvLek(x.tipsMinor),
        ]),
        [t('payments.refunds'), r.refunds.count, csvLek(-r.refunds.amountMinor), null],
      ],
    );
  return (
    <div className="flex flex-col gap-4">
      <Toolbar onExport={exportCsv} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t('payments.share')}>
          <ShareDonut
            data={r.rows.map((x) => ({
              key: x.method,
              label: tb(`methods.${x.method}`),
              value: x.amountMinor,
            }))}
          />
        </ChartCard>
        <div className="grid content-start gap-3 sm:grid-cols-2">
          <Tile label={t('payments.total')} value={formatMoney(r.totalMinor)} />
          <Tile
            label={t('payments.tips')}
            value={formatMoney(r.rows.reduce((s, x) => s + x.tipsMinor, 0))}
          />
          <Tile
            label={`${t('payments.refunds')} (${formatNumber(r.refunds.count)})`}
            value={formatMoney(r.refunds.amountMinor)}
            tone={r.refunds.amountMinor ? 'danger' : undefined}
          />
        </div>
      </div>
      <DataTable
        rows={r.rows}
        rowKey={(x) => x.method}
        columns={[
          { label: t('payments.method'), render: (x) => tb(`methods.${x.method}`) },
          { label: t('payments.count'), numeric: true, render: (x) => formatNumber(x.count) },
          { label: t('payments.amount'), numeric: true, render: (x) => formatMoney(x.amountMinor) },
          { label: t('payments.tips'), numeric: true, render: (x) => formatMoney(x.tipsMinor) },
        ]}
      />
    </div>
  );
}

// ---- Discounts, voids, refunds -----------------------------------------------------------------

export function DiscountsTab({ range, locations }: TabProps) {
  const { t } = useTranslation('reports', { keyPrefix: 'reports' });
  const { t: tb } = useTranslation('billing');
  const report = useReport<DiscountsVoidsReport>('discounts-voids', range, locations);
  const [section, setSection] = useState<'discounts' | 'voids' | 'refunds'>('discounts');
  if (!report.data) return <Loading />;
  const r = report.data;
  const exportCsv = () =>
    downloadCsv(
      file('zbritje-anulime', range),
      [
        t('discounts.kind'),
        t('discounts.when'),
        t('discounts.order'),
        t('discounts.item'),
        t('discounts.reason'),
        t('discounts.amount'),
        t('discounts.by'),
        t('discounts.approvedBy'),
      ],
      [
        ...r.discounts.map((d) => [
          t('discounts.discounts'),
          formatDateTime(d.at),
          `${d.date} #${d.orderNumber}`,
          d.type === 'percent' ? formatBp(d.value) : null,
          d.reason,
          csvLek(d.amountMinor),
          d.createdBy,
          d.approvedBy,
        ]),
        ...r.voids.map((v) => [
          t('discounts.voids'),
          formatDateTime(v.at),
          `${v.date} #${v.orderNumber}`,
          `${v.qty} × ${v.item}`,
          v.reason,
          csvLek(v.amountMinor),
          v.voidedBy,
          v.approvedBy,
        ]),
        ...r.refunds.map((x) => [
          t('discounts.refunds'),
          formatDateTime(x.at),
          `${x.date} #${x.orderNumber}`,
          tb(`methods.${x.method}`),
          x.reason,
          csvLek(x.amountMinor),
          x.createdBy,
          x.approvedBy,
        ]),
      ],
    );
  const sum = (list: { amountMinor: number }[]) =>
    formatMoney(list.reduce((s, x) => s + x.amountMinor, 0));
  const who = (name: string | null) => name ?? <span className="text-foreground-subtle">—</span>;
  const order = (x: { date: string; orderNumber: number }) => (
    <span className="font-mono tabular-nums">
      {formatDay(x.date)} · #{x.orderNumber}
    </span>
  );
  return (
    <div className="flex flex-col gap-4">
      <Toolbar onExport={exportCsv} />
      <div className="grid gap-3 sm:grid-cols-3">
        {(['discounts', 'voids', 'refunds'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={section === k}
            onClick={() => setSection(k)}
            className={`flex flex-col gap-1 rounded-card border p-4 text-left shadow-raised transition-colors ${section === k ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:border-border-strong'}`}
          >
            <span className="text-sm font-semibold text-foreground-muted">
              {t(`discounts.${k}`)} ({formatNumber(r[k].length)})
            </span>
            <span className="font-mono text-xl font-bold tabular-nums">{sum(r[k])}</span>
          </button>
        ))}
      </div>
      {r[section].length === 0 ? (
        <EmptyState title={t('discounts.none')} />
      ) : section === 'discounts' ? (
        <DataTable
          rows={r.discounts}
          rowKey={(_, i) => i}
          columns={[
            { label: t('discounts.when'), render: (d) => formatDateTime(d.at) },
            { label: t('discounts.order'), className: 'hidden md:table-cell', render: order },
            { label: t('discounts.reason'), render: (d) => d.reason },
            {
              label: t('discounts.value'),
              numeric: true,
              render: (d) => (d.type === 'percent' ? formatBp(d.value) : formatMoney(d.value)),
            },
            {
              label: t('discounts.amount'),
              numeric: true,
              render: (d) => formatMoney(d.amountMinor),
            },
            {
              label: t('discounts.by'),
              className: 'hidden sm:table-cell',
              render: (d) => who(d.createdBy),
            },
            { label: t('discounts.approvedBy'), render: (d) => who(d.approvedBy) },
          ]}
        />
      ) : section === 'voids' ? (
        <DataTable
          rows={r.voids}
          rowKey={(_, i) => i}
          columns={[
            { label: t('discounts.when'), render: (v) => formatDateTime(v.at) },
            { label: t('discounts.order'), className: 'hidden md:table-cell', render: order },
            { label: t('discounts.item'), render: (v) => `${v.qty} × ${v.item}` },
            {
              label: t('discounts.reason'),
              className: 'hidden sm:table-cell',
              render: (v) => v.reason ?? '—',
            },
            {
              label: t('discounts.amount'),
              numeric: true,
              render: (v) => formatMoney(v.amountMinor),
            },
            {
              label: t('discounts.by'),
              className: 'hidden sm:table-cell',
              render: (v) => who(v.voidedBy),
            },
            { label: t('discounts.approvedBy'), render: (v) => who(v.approvedBy) },
          ]}
        />
      ) : (
        <DataTable
          rows={r.refunds}
          rowKey={(_, i) => i}
          columns={[
            { label: t('discounts.when'), render: (x) => formatDateTime(x.at) },
            { label: t('discounts.order'), className: 'hidden md:table-cell', render: order },
            { label: t('discounts.method'), render: (x) => tb(`methods.${x.method}`) },
            { label: t('discounts.reason'), render: (x) => x.reason },
            {
              label: t('discounts.amount'),
              numeric: true,
              render: (x) => formatMoney(x.amountMinor),
            },
            {
              label: t('discounts.by'),
              className: 'hidden sm:table-cell',
              render: (x) => who(x.createdBy),
            },
            { label: t('discounts.approvedBy'), render: (x) => who(x.approvedBy) },
          ]}
        />
      )}
    </div>
  );
}

// ---- Inventory ---------------------------------------------------------------------------------

export function InventoryTab({ range, locations }: TabProps) {
  const { t } = useTranslation('reports', { keyPrefix: 'reports' });
  const report = useReport<InventoryReport>('inventory', range, locations);
  const empty = useEmpty();
  if (!report.data) return <Loading />;
  const rows = report.data.rows;
  if (!rows.length) return empty;
  const total = (k: 'valueMinor' | 'consumedMinor' | 'wasteMinor' | 'varianceMinor') =>
    rows.reduce((s, r) => s + r[k], 0);
  const exportCsv = () =>
    downloadCsv(
      file('stoku', range),
      [
        t('inventory.name'),
        t('inventory.category'),
        t('inventory.stock'),
        t('inventory.value'),
        t('inventory.purchased'),
        t('inventory.consumed'),
        t('inventory.consumedValue'),
        t('inventory.waste'),
        t('inventory.wasteValue'),
        t('inventory.variance'),
        t('inventory.varianceValue'),
      ],
      rows.map((r) => [
        `${r.name} (${r.unit})`,
        r.category,
        csvQty(r.stockMilli),
        csvLek(r.valueMinor),
        csvQty(r.purchasedMilli),
        csvQty(r.consumedMilli),
        csvLek(r.consumedMinor),
        csvQty(r.wasteMilli),
        csvLek(r.wasteMinor),
        csvQty(r.varianceMilli),
        csvLek(r.varianceMinor),
      ]),
    );
  return (
    <div className="flex flex-col gap-4">
      <Toolbar onExport={exportCsv} hint={t('inventory.hint')} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t('inventory.value')} value={formatMoney(total('valueMinor'))} />
        <Tile label={t('inventory.consumedValue')} value={formatMoney(total('consumedMinor'))} />
        <Tile label={t('inventory.wasteValue')} value={formatMoney(total('wasteMinor'))} />
        <Tile
          label={t('inventory.varianceValue')}
          value={formatMoney(total('varianceMinor'))}
          tone={total('varianceMinor') < 0 ? 'danger' : undefined}
        />
      </div>
      <ChartCard title={t('inventory.consumedValue')}>
        <RankBars
          data={[...rows]
            .sort((a, b) => b.consumedMinor - a.consumedMinor)
            .slice(0, 10)
            .filter((r) => r.consumedMinor > 0)
            .map((r) => ({
              label: r.name,
              value: r.consumedMinor,
              detail: formatQty(r.consumedMilli, r.unit),
            }))}
          valueLabel={t('inventory.consumedValue')}
        />
      </ChartCard>
      <DataTable
        rows={rows}
        rowKey={(r) => r.ingredientId}
        columns={[
          {
            label: t('inventory.name'),
            render: (r) => (
              <>
                <span className="font-semibold">{r.name}</span>
                <span className="block text-xs text-foreground-muted">{r.category}</span>
              </>
            ),
          },
          {
            label: t('inventory.stock'),
            numeric: true,
            className: 'hidden md:table-cell',
            render: (r) => formatQty(r.stockMilli, r.unit),
          },
          {
            label: t('inventory.value'),
            numeric: true,
            className: 'hidden lg:table-cell',
            render: (r) => formatMoney(r.valueMinor),
          },
          {
            label: t('inventory.consumed'),
            numeric: true,
            render: (r) => formatQty(r.consumedMilli, r.unit),
          },
          {
            label: t('inventory.consumedValue'),
            numeric: true,
            className: 'hidden sm:table-cell',
            render: (r) => formatMoney(r.consumedMinor),
          },
          {
            label: t('inventory.waste'),
            numeric: true,
            className: 'hidden md:table-cell',
            render: (r) => (r.wasteMilli ? formatQty(r.wasteMilli, r.unit) : '—'),
          },
          {
            label: t('inventory.variance'),
            numeric: true,
            render: (r) =>
              r.varianceMilli ? (
                <span className={r.varianceMilli < 0 ? 'text-danger' : undefined}>
                  {r.varianceMilli > 0 ? '+' : ''}
                  {formatQty(r.varianceMilli, r.unit)} · {formatMoney(r.varianceMinor)}
                </span>
              ) : (
                '—'
              ),
          },
        ]}
      />
    </div>
  );
}

// ---- Staff hours -------------------------------------------------------------------------------

export function HoursTab({ range, locations }: TabProps) {
  const { t } = useTranslation('reports', { keyPrefix: 'reports' });
  const { t: ta } = useTranslation('app');
  const { message } = useErrorMessages();
  const can = useSession((s) => s.can);
  const report = useReport<HoursReport>('hours', range, locations);
  const empty = useEmpty();
  if (!report.data) return <Loading />;
  const rows = report.data.rows.filter((r) => r.entries || r.scheduledMinutes);
  if (!rows.length) return empty;
  const exportCsv = () =>
    downloadCsv(
      file('oret', range),
      [
        t('hours.name'),
        t('hours.role'),
        t('hours.worked'),
        t('hours.scheduled'),
        t('hours.entries'),
        t('hours.open'),
      ],
      rows.map((r) => [
        r.name,
        r.roleKey ? ta(`roles.${r.roleKey}`) : null,
        (r.workedMinutes / 60).toFixed(2),
        (r.scheduledMinutes / 60).toFixed(2),
        r.entries,
        r.openEntries,
      ]),
    );
  async function payroll() {
    try {
      const csv = await api<string>(
        'GET',
        `/time-entries/hours.csv?from=${range.from}&to=${range.to}`,
        { responseType: 'text' },
      );
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = file('pagat', range);
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(message(err));
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <Toolbar onExport={exportCsv}>
        {can('shift.manage') ? (
          <Button variant="outline" onClick={payroll}>
            <Download />
            {t('hours.payroll')}
          </Button>
        ) : null}
      </Toolbar>
      <ChartCard title={t('hours.worked')}>
        <RankBars
          data={rows.map((r) => ({
            label: r.name,
            value: r.workedMinutes,
            detail: `${t('hours.scheduled')}: ${formatDuration(r.scheduledMinutes)}`,
          }))}
          format={formatDuration}
          valueLabel={t('hours.worked')}
        />
      </ChartCard>
      <DataTable
        rows={rows}
        rowKey={(r) => r.userId}
        columns={[
          {
            label: t('hours.name'),
            render: (r) => (
              <>
                <span className="font-semibold">{r.name}</span>
                <span className="block text-xs text-foreground-muted">
                  {r.roleKey ? ta(`roles.${r.roleKey}`) : ''}
                </span>
              </>
            ),
          },
          {
            label: t('hours.worked'),
            numeric: true,
            render: (r) => formatDuration(r.workedMinutes),
          },
          {
            label: t('hours.scheduled'),
            numeric: true,
            render: (r) => formatDuration(r.scheduledMinutes),
          },
          {
            label: t('hours.difference'),
            numeric: true,
            render: (r) => {
              const diff = r.workedMinutes - r.scheduledMinutes;
              return `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${formatDuration(Math.abs(diff))}`;
            },
          },
          {
            label: t('hours.entries'),
            numeric: true,
            className: 'hidden sm:table-cell',
            render: (r) => formatNumber(r.entries),
          },
          {
            label: t('hours.open'),
            numeric: true,
            render: (r) => (r.openEntries ? <Badge tone="warning">{r.openEntries}</Badge> : '—'),
          },
        ]}
      />
    </div>
  );
}
