import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ban, CheckCheck, ClipboardCheck, Save } from 'lucide-react';
import { countVariance, formatMoney, toMilli, type StockCount } from '@tavolina/shared';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { formatQty, qtyToInput, useIngredients } from './inventory-utils';
import { QtyInput } from './QtyInput';

const signedMoney = (minor: number) =>
  (minor > 0 ? '+' : '') + formatMoney(minor, { showDecimals: true });

/** Stock counts (plan §5.9): freeze what the system expects, count the shelf, apply the variance. */
export function CountsTab() {
  const { t } = useTranslation('inventory');
  const locationId = useSession((s) => s.locationId);
  const manage = useSession((s) => s.can)('inventory.manage');
  const counts = useQuery({
    queryKey: ['inventory', 'stock-counts', locationId],
    queryFn: () => api<StockCount[]>('GET', '/stock-counts'),
  });
  const [viewing, setViewing] = useState<StockCount | null>(null);
  if (counts.isLoading) return <Skeleton className="h-64" />;
  const open = counts.data?.find((c) => c.status === 'open');
  const history = (counts.data ?? []).filter((c) => c.status !== 'open');
  return (
    <div className="flex flex-col gap-6">
      {open ? (
        <OpenCount key={open.id} count={open} canManage={manage} />
      ) : manage ? (
        <StartCount />
      ) : null}
      {history.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">{t('counts.history')}</h2>
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
            {history.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-surface-sunken/60"
                  onClick={() => setViewing(c)}
                >
                  <span className="flex-1">
                    <span className="font-semibold">{c.category || t('counts.allCategories')}</span>
                    <span className="block text-sm text-foreground-muted">
                      {formatDateTime(c.appliedAt ?? c.createdAt)} ·{' '}
                      {t('counts.by', { name: c.createdBy })}
                    </span>
                  </span>
                  <Badge tone={c.status === 'applied' ? 'success' : 'neutral'}>
                    {t(`counts.status.${c.status}`)}
                  </Badge>
                  {c.status === 'applied' ? (
                    <span
                      className={`font-mono font-bold tabular-nums ${c.varianceMinor < 0 ? 'text-danger' : ''}`}
                    >
                      {signedMoney(c.varianceMinor)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : !open && !manage ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title={t('counts.empty')}
          description={t('counts.emptyDescription')}
        />
      ) : null}
      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-3xl">
          {viewing ? (
            <>
              <DialogHeader>
                <DialogTitle>{viewing.category || t('counts.allCategories')}</DialogTitle>
                <DialogDescription>
                  {formatDateTime(viewing.appliedAt ?? viewing.createdAt)} ·{' '}
                  {t(`counts.status.${viewing.status}`)}
                </DialogDescription>
              </DialogHeader>
              <VarianceTable count={viewing} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StartCount() {
  const { t } = useTranslation('inventory');
  const { message } = useErrorMessages();
  const queryClient = useQueryClient();
  const categories = [
    ...new Set((useIngredients().data ?? []).map((i) => i.category).filter(Boolean)),
  ].sort();
  const [category, setCategory] = useState('all');
  const start = useMutation({
    mutationFn: () =>
      api('POST', '/stock-counts', { body: { category: category === 'all' ? null : category } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    onError: (err) => toast.error(message(err)),
  });
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-lg font-bold">{t('counts.start')}</h2>
        <p className="text-sm text-foreground-muted">{t('counts.emptyDescription')}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('counts.category')} className="min-w-56">
          <Select
            value={category}
            onValueChange={setCategory}
            options={[
              { value: 'all', label: t('counts.allCategories') },
              ...categories.map((c) => ({ value: c, label: c })),
            ]}
          />
        </Field>
        <Button loading={start.isPending} onClick={() => start.mutate()}>
          <ClipboardCheck />
          {t('counts.start')}
        </Button>
      </div>
    </Card>
  );
}

function OpenCount({ count, canManage }: { count: StockCount; canManage: boolean }) {
  const { t } = useTranslation('inventory');
  const { message } = useErrorMessages();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(count.lines.map((l) => [l.ingredientId, qtyToInput(l.countedMilli)])),
  );
  const [confirming, setConfirming] = useState(false);
  const dirty = count.lines.some((l) => values[l.ingredientId] !== qtyToInput(l.countedMilli));
  // Live variance while counting, with the cost frozen at the start of the count.
  const live: StockCount = {
    ...count,
    lines: count.lines.map((l) => {
      const text = values[l.ingredientId] ?? '';
      const counted = text ? toMilli(text) : null;
      const ok = counted !== null && Number.isFinite(counted);
      const v = ok ? countVariance(l.expectedMilli, counted, l.costPerUnitMinor) : null;
      return {
        ...l,
        countedMilli: ok ? counted : null,
        varianceMilli: v?.varianceMilli ?? null,
        varianceMinor: v?.varianceMinor ?? null,
      };
    }),
  };
  live.varianceMinor = live.lines.reduce((s, l) => s + (l.varianceMinor ?? 0), 0);
  const countedCount = live.lines.filter((l) => l.countedMilli !== null).length;

  const done = () => void queryClient.invalidateQueries({ queryKey: ['inventory'] });
  const body = () => ({
    lines: count.lines.map((l) => ({
      ingredientId: l.ingredientId,
      counted: values[l.ingredientId] || null,
    })),
  });
  const save = useMutation({
    mutationFn: () => api('PATCH', `/stock-counts/${count.id}`, { body: body() }),
    onSuccess: () => {
      done();
      toast.success(t('counts.savedProgress'));
    },
    onError: (err) => toast.error(message(err)),
  });
  const apply = useMutation({
    mutationFn: async () => {
      await api('PATCH', `/stock-counts/${count.id}`, { body: body() });
      return api('POST', `/stock-counts/${count.id}/apply`);
    },
    onSuccess: () => {
      done();
      setConfirming(false);
      toast.success(t('counts.applied'));
    },
    onError: (err) => toast.error(message(err)),
  });
  const cancel = useMutation({
    mutationFn: () => api('POST', `/stock-counts/${count.id}/cancel`),
    onSuccess: done,
    onError: (err) => toast.error(message(err)),
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            {t('counts.open')}
            <Badge tone="info">{count.category || t('counts.allCategories')}</Badge>
          </h2>
          <p className="text-sm text-foreground-muted">
            {formatDateTime(count.createdAt)} · {t('counts.by', { name: count.createdBy })} ·{' '}
            {t('counts.hint')}
          </p>
        </div>
        <span className="text-sm text-foreground-muted">
          {t('counts.progress', { counted: countedCount, total: count.lines.length })}
        </span>
      </div>
      <VarianceTable
        count={live}
        input={
          canManage
            ? (id, unit, name) => (
                <QtyInput
                  className="h-10 w-32"
                  aria-label={`${t('counts.counted')} · ${name}`}
                  value={values[id] ?? ''}
                  unit={unit}
                  onChange={(v) => setValues({ ...values, [id]: v })}
                />
              )
            : undefined
        }
      />
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            className="mr-auto text-danger"
            loading={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            <Ban />
            {t('counts.cancel')}
          </Button>
          <Button
            variant="outline"
            disabled={!dirty}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            <Save />
            {t('counts.save')}
          </Button>
          <Button disabled={!countedCount} onClick={() => setConfirming(true)}>
            <CheckCheck />
            {t('counts.apply')}
          </Button>
        </div>
      ) : null}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('counts.apply')}</DialogTitle>
            <DialogDescription>{t('counts.applyConfirm')}</DialogDescription>
          </DialogHeader>
          <p className="flex justify-between text-lg font-bold">
            <span>{t('counts.totalVariance')}</span>
            <span
              className={`font-mono tabular-nums ${live.varianceMinor < 0 ? 'text-danger' : ''}`}
            >
              {signedMoney(live.varianceMinor)}
            </span>
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t('cancelAction')}
            </Button>
            <Button loading={apply.isPending} onClick={() => apply.mutate()}>
              {t('counts.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function VarianceTable({
  count,
  input,
}: {
  count: StockCount;
  input?: (
    ingredientId: number,
    unit: StockCount['lines'][number]['unit'],
    name: string,
  ) => ReactNode;
}) {
  const { t } = useTranslation('inventory');
  return (
    <Table containerClassName="max-h-[60vh]">
      <TableHeader>
        <TableRow>
          <TableHead>{t('stock.name')}</TableHead>
          <TableHead numeric>{t('counts.expected')}</TableHead>
          <TableHead numeric>{t('counts.counted')}</TableHead>
          <TableHead numeric>{t('counts.variance')}</TableHead>
          <TableHead numeric>{t('counts.varianceValue')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {count.lines.map((l) => (
          <TableRow key={l.ingredientId}>
            <TableCell className="font-semibold">{l.ingredientName}</TableCell>
            <TableCell numeric className="text-foreground-muted">
              {formatQty(l.expectedMilli, l.unit)}
            </TableCell>
            <TableCell numeric>
              {input ? (
                <span className="inline-block">
                  {input(l.ingredientId, l.unit, l.ingredientName)}
                </span>
              ) : l.countedMilli === null ? (
                <span className="text-foreground-subtle">—</span>
              ) : (
                formatQty(l.countedMilli, l.unit)
              )}
            </TableCell>
            <TableCell
              numeric
              className={l.varianceMilli && l.varianceMilli < 0 ? 'text-danger' : undefined}
            >
              {l.varianceMilli === null
                ? ''
                : `${l.varianceMilli > 0 ? '+' : ''}${formatQty(l.varianceMilli, l.unit)}`}
            </TableCell>
            <TableCell
              numeric
              className={l.varianceMinor && l.varianceMinor < 0 ? 'text-danger' : undefined}
            >
              {l.varianceMinor === null ? '' : signedMoney(l.varianceMinor)}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="text-right font-bold">
            {t('counts.totalVariance')}
          </TableCell>
          <TableCell
            numeric
            className={`font-bold ${count.varianceMinor < 0 ? 'text-danger' : ''}`}
          >
            {signedMoney(count.varianceMinor)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
