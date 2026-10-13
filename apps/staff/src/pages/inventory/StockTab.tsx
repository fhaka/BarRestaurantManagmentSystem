import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Package, Plus, Search, Trash } from 'lucide-react';
import { formatMoney, type Ingredient } from '@tavolina/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tavolina/ui';
import { useSession } from '../../lib/session';
import { ChipToggle } from '../menu/fields';
import { IngredientDialog } from './IngredientDialog';
import { formatQty, useIngredients } from './inventory-utils';
import { WasteDialog } from './WasteDialog';

export function StockTab() {
  const { t } = useTranslation('inventory');
  const can = useSession((s) => s.can);
  const manage = can('inventory.manage');
  const ingredients = useIngredients();
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);
  const [wasteOpen, setWasteOpen] = useState(false);

  const all = useMemo(() => ingredients.data ?? [], [ingredients.data]);
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (i) =>
        (!lowOnly || i.low) &&
        (!q || i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)),
    );
  }, [all, search, lowOnly]);
  const lowCount = all.filter((i) => i.active && i.low).length;
  const totalValue = all.reduce((s, i) => s + i.valueMinor, 0);

  if (ingredients.isLoading) return <Skeleton className="h-96" />;
  if (!all.length) {
    return (
      <>
        <EmptyState
          icon={<Package />}
          title={t('stock.empty')}
          description={t('stock.emptyDescription')}
          action={
            manage ? (
              <Button onClick={() => setEditing('new')}>
                <Plus />
                {t('stock.add')}
              </Button>
            ) : undefined
          }
        />
        <IngredientDialog ingredient={editing} onClose={() => setEditing(null)} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-sm text-foreground-muted">{t('stock.totalValue')}</span>
          <span className="font-mono text-2xl font-bold tabular-nums">
            {formatMoney(totalValue)}
          </span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-sm text-foreground-muted">{t('stock.low')}</span>
          <span className="flex items-center gap-2 text-2xl font-bold">
            {lowCount ? <AlertTriangle className="size-6 text-warning" aria-hidden /> : null}
            {t('stock.lowCount', { count: lowCount })}
          </span>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
            aria-hidden
          />
          <Input
            className="pl-9"
            value={search}
            placeholder={t('stock.search')}
            aria-label={t('stock.search')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ChipToggle pressed={lowOnly} onToggle={() => setLowOnly(!lowOnly)}>
          {t('stock.lowOnly')}
        </ChipToggle>
        {manage ? (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setWasteOpen(true)}>
              <Trash />
              {t('stock.waste')}
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus />
              {t('stock.add')}
            </Button>
          </div>
        ) : null}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('stock.name')}</TableHead>
            <TableHead numeric>{t('stock.stock')}</TableHead>
            <TableHead numeric className="hidden md:table-cell">
              {t('stock.min')}
            </TableHead>
            <TableHead numeric className="hidden sm:table-cell">
              {t('stock.cost')}
            </TableHead>
            <TableHead numeric>{t('stock.value')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('stock.supplier')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((i) => (
            <TableRow key={i.id}>
              <TableCell>
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {manage ? (
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => setEditing(i)}
                    >
                      {i.name}
                    </button>
                  ) : (
                    i.name
                  )}
                  {!i.active ? <Badge size="sm">{t('stock.inactive')}</Badge> : null}
                </span>
                {i.category ? (
                  <span className="text-xs text-foreground-muted">{i.category}</span>
                ) : null}
              </TableCell>
              <TableCell numeric>
                <span className="inline-flex items-center gap-2">
                  {i.low ? (
                    <Badge tone="warning" size="sm" icon={<AlertTriangle />}>
                      {t('stock.low')}
                    </Badge>
                  ) : null}
                  <span className={i.stockMilli < 0 ? 'text-danger' : undefined}>
                    {formatQty(i.stockMilli, i.unit)}
                  </span>
                </span>
              </TableCell>
              <TableCell numeric className="hidden text-foreground-muted md:table-cell">
                {i.minMilli ? formatQty(i.minMilli, i.unit) : '—'}
              </TableCell>
              <TableCell numeric className="hidden sm:table-cell">
                {t('stock.perUnit', {
                  cost: formatMoney(i.costPerUnitMinor, { showDecimals: true }),
                  unit: t(`units.${i.unit}`),
                })}
              </TableCell>
              <TableCell numeric>{formatMoney(i.valueMinor)}</TableCell>
              <TableCell className="hidden text-foreground-muted lg:table-cell">
                {i.supplierName ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <IngredientDialog ingredient={editing} onClose={() => setEditing(null)} />
      <WasteDialog open={wasteOpen} onClose={() => setWasteOpen(false)} />
    </div>
  );
}
