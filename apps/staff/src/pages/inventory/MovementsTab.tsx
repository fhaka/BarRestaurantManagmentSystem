import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight } from 'lucide-react';
import { STOCK_MOVEMENT_TYPES, type StockMovement, type StockMovementType } from '@tavolina/shared';
import {
  EmptyState,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { formatQty, useIngredients } from './inventory-utils';

/** The stock ledger: every change to every ingredient, newest first. */
export function MovementsTab() {
  const { t } = useTranslation('inventory');
  const locationId = useSession((s) => s.locationId);
  const ingredients = useIngredients().data ?? [];
  const [type, setType] = useState<StockMovementType | 'all'>('all');
  const [ingredientId, setIngredientId] = useState('all');
  const movements = useQuery({
    queryKey: ['inventory', 'movements', locationId, type, ingredientId],
    queryFn: () => {
      const q = new URLSearchParams({ limit: '300' });
      if (type !== 'all') q.set('type', type);
      if (ingredientId !== 'all') q.set('ingredientId', ingredientId);
      return api<StockMovement[]>('GET', `/stock-movements?${q}`);
    },
  });
  const ref = (m: StockMovement) => {
    switch (m.refType) {
      case 'order_item':
        return t('movements.order', { id: m.refId });
      case 'stock_count':
        return t('movements.count', { id: m.refId });
      case 'purchase_order':
        return t('movements.po');
      case 'opening':
        return t('movements.opening');
      default:
        return null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Select
          className="w-56"
          aria-label={t('movements.reason')}
          value={type}
          onValueChange={(v) => setType(v as StockMovementType | 'all')}
          options={[
            { value: 'all', label: t('movements.all') },
            ...STOCK_MOVEMENT_TYPES.filter((m) => m !== 'transfer').map((m) => ({
              value: m,
              label: t(`movements.types.${m}`),
            })),
          ]}
        />
        <Select
          className="w-64"
          aria-label={t('movements.ingredient')}
          value={ingredientId}
          onValueChange={setIngredientId}
          options={[
            { value: 'all', label: t('movements.all') },
            ...ingredients.map((i) => ({ value: String(i.id), label: i.name })),
          ]}
        />
      </div>
      {movements.isLoading ? (
        <Skeleton className="h-96" />
      ) : !movements.data?.length ? (
        <EmptyState icon={<ArrowLeftRight />} title={t('movements.empty')} />
      ) : (
        <Table containerClassName="max-h-[70vh]">
          <TableHeader>
            <TableRow>
              <TableHead>{t('movements.when')}</TableHead>
              <TableHead>{t('movements.ingredient')}</TableHead>
              <TableHead numeric>{t('movements.qty')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('movements.reason')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('movements.by')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movements.data.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap text-foreground-muted">
                  {formatDateTime(m.createdAt)}
                </TableCell>
                <TableCell>
                  <span className="font-semibold">{m.ingredientName}</span>
                  <span className="block text-xs text-foreground-muted">
                    {t(`movements.types.${m.type}`)}
                  </span>
                </TableCell>
                <TableCell numeric className={m.qtyMilli < 0 ? 'text-danger' : 'text-success'}>
                  {m.qtyMilli > 0 ? '+' : ''}
                  {formatQty(m.qtyMilli, m.unit)}
                </TableCell>
                <TableCell className="hidden text-foreground-muted md:table-cell">
                  {[m.reason, ref(m)].filter(Boolean).join(' · ') || '—'}
                </TableCell>
                <TableCell className="hidden text-foreground-muted sm:table-cell">
                  {m.userName ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
