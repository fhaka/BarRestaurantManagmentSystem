import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChefHat, Search } from 'lucide-react';
import { formatMoney, type ItemCosting } from '@tavolina/shared';
import {
  Badge,
  Button,
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
import { formatPct, marginTone, useCosting } from './inventory-utils';
import { RecipeDialog } from './RecipeDialog';

/** Food cost and margin per item, size and option from recipe × ingredient cost (plan §5.9). */
export function RecipesTab() {
  const { t } = useTranslation('inventory');
  const manage = useSession((s) => s.can)('inventory.manage');
  const costing = useCosting();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ItemCosting | null>(null);
  const all = useMemo(() => costing.data ?? [], [costing.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (c) =>
        !q || c.name.toLowerCase().includes(q) || (c.categoryName ?? '').toLowerCase().includes(q),
    );
  }, [all, search]);

  if (costing.isLoading) return <Skeleton className="h-96" />;
  if (!all.length) return <EmptyState icon={<ChefHat />} title={t('recipes.noRecipe')} />;
  const items = filtered.filter((c) => c.kind === 'item');
  const options = filtered.filter((c) => c.kind === 'modifier');
  const allItems = all.filter((c) => c.kind === 'item');

  const rows = (list: ItemCosting[]) =>
    list.map((c) => {
      // Items with sizes are costed per size; the size with the lowest margin sets the badge.
      const sized = c.lines.length > 0 && c.variants.length > 0;
      const costs = sized ? c.variants.map((v) => v.costMinor) : [c.costMinor];
      const low = Math.min(...costs);
      const high = Math.max(...costs);
      const marginBp = sized ? Math.min(...c.variants.map((v) => v.marginBp)) : c.marginBp;
      return (
        <TableRow key={`${c.kind}-${c.id}`}>
          <TableCell>
            {manage ? (
              <button
                type="button"
                className="text-left font-semibold hover:underline"
                onClick={() => setEditing(c)}
              >
                {c.name}
              </button>
            ) : (
              <span className="font-semibold">{c.name}</span>
            )}
            <span className="block text-xs text-foreground-muted">
              {c.categoryName}
              {c.lines.length
                ? ` · ${[...new Set(c.lines.map((l) => l.ingredientName))].join(', ')}`
                : ''}
            </span>
          </TableCell>
          <TableCell numeric>{formatMoney(c.priceMinor)}</TableCell>
          <TableCell numeric>
            {!c.lines.length
              ? '—'
              : low === high
                ? formatMoney(low, { showDecimals: true })
                : `${formatMoney(low, { showDecimals: true })} – ${formatMoney(high, { showDecimals: true })}`}
          </TableCell>
          <TableCell numeric>
            {c.lines.length ? (
              <span className="inline-flex flex-col items-end gap-1">
                <Badge tone={marginTone(marginBp)}>{formatPct(marginBp)}</Badge>
                {sized ? (
                  <span className="text-xs text-foreground-muted">
                    {c.variants.map((v) => `${v.name} ${formatPct(v.marginBp)}`).join(' · ')}
                  </span>
                ) : null}
              </span>
            ) : (
              <Badge size="sm">{t('recipes.noRecipe')}</Badge>
            )}
          </TableCell>
          {manage ? (
            <TableCell className="w-0">
              <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                {t('recipes.edit')}
              </Button>
            </TableCell>
          ) : null}
        </TableRow>
      );
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
            aria-hidden
          />
          <Input
            className="pl-9"
            value={search}
            placeholder={t('recipes.search')}
            aria-label={t('recipes.search')}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="text-sm text-foreground-muted">
          {t('recipes.withRecipe', {
            count: allItems.filter((c) => c.lines.length).length,
            total: allItems.length,
          })}
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('recipes.item')}</TableHead>
            <TableHead numeric>{t('recipes.price')}</TableHead>
            <TableHead numeric>{t('recipes.cost')}</TableHead>
            <TableHead numeric>{t('recipes.margin')}</TableHead>
            {manage ? <TableHead className="w-0" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows(items)}
          {options.length ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={manage ? 5 : 4}
                className="bg-surface-sunken text-xs font-semibold uppercase tracking-wide text-foreground-muted"
              >
                {t('recipes.options')}
              </TableCell>
            </TableRow>
          ) : null}
          {rows(options)}
        </TableBody>
      </Table>
      <RecipeDialog costing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
