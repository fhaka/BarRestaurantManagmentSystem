import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import {
  consumption,
  formatMoney,
  margin,
  recipeCost,
  recipeSchema,
  toMilli,
  type ItemCosting,
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
  Select,
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { formatPct, marginTone, qtyToInput, useIngredients } from './inventory-utils';
import { QtyInput } from './QtyInput';

interface Line {
  key: number;
  ingredientId: number | null;
  qty: string;
  variantId: number | null;
}

export function RecipeDialog({
  costing,
  onClose,
}: {
  costing: ItemCosting | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={costing !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {costing ? (
          <RecipeForm key={`${costing.kind}-${costing.id}`} costing={costing} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

let nextKey = 1;

function RecipeForm({ costing, onClose }: { costing: ItemCosting; onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const { message, fieldErrors, validate } = useErrorMessages();
  const queryClient = useQueryClient();
  const ingredients = useIngredients().data ?? [];
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const [lines, setLines] = useState<Line[]>(() =>
    costing.lines.map((l) => ({
      key: nextKey++,
      ingredientId: l.ingredientId,
      qty: qtyToInput(l.qtyMilli),
      variantId: l.variantId,
    })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Live cost with the current ingredient costs, for the standard portion and each size.
  const parsed = lines
    .filter((l) => l.ingredientId !== null && toMilli(l.qty || '0') > 0)
    .map((l) => ({
      ingredientId: l.ingredientId!,
      qtyMilli: toMilli(l.qty),
      variantId: l.variantId,
    }));
  const costFor = (variantId: number | null) =>
    recipeCost(
      [...consumption(1, parsed, variantId, [])].map(([id, q]) => ({
        qtyMilli: q,
        costPerUnitMinor: byId.get(id)?.costPerUnitMinor ?? 0,
      })),
    );
  const prices = costing.variants.length
    ? costing.variants.map((v) => ({
        key: v.id as number | null,
        name: v.name,
        price: v.priceMinor,
      }))
    : [{ key: null as number | null, name: null as string | null, price: costing.priceMinor }];

  const save = useMutation({
    mutationFn: (body: unknown) =>
      api('PUT', `/menu/${costing.kind === 'item' ? 'items' : 'modifiers'}/${costing.id}/recipe`, {
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['menu'] });
      toast.success(t('recipes.saved'));
      onClose();
    },
    onError: (err) => {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else toast.error(message(err));
    },
  });
  const submit = () => {
    const body = {
      lines: lines
        .filter((l) => l.ingredientId !== null || l.qty)
        .map((l) => ({ ingredientId: l.ingredientId ?? 0, qty: l.qty, variantId: l.variantId })),
    };
    const result = validate(recipeSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(body);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('recipes.title', { name: costing.name })}</DialogTitle>
        <DialogDescription>{t('recipes.description')}</DialogDescription>
      </DialogHeader>
      {!ingredients.length ? (
        <p className="text-sm text-foreground-muted">{t('recipes.noIngredients')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {lines.map((l, index) => {
              const ing = l.ingredientId ? byId.get(l.ingredientId) : undefined;
              const error = errors[`lines.${index}.qty`] ?? errors[`lines.${index}.ingredientId`];
              return (
                <li key={l.key} className="flex flex-col gap-1">
                  <div className="grid grid-cols-[1fr_120px_auto] items-center gap-2 sm:grid-cols-[1fr_130px_160px_auto]">
                    <Select
                      aria-label={t('recipes.ingredient')}
                      placeholder={t('recipes.ingredient')}
                      value={l.ingredientId ? String(l.ingredientId) : undefined}
                      onValueChange={(v) => update(l.key, { ingredientId: Number(v) })}
                      options={ingredients
                        .filter((i) => i.active || i.id === l.ingredientId)
                        .map((i) => ({ value: String(i.id), label: i.name }))}
                    />
                    <QtyInput
                      aria-label={t('recipes.qty')}
                      aria-invalid={Boolean(error)}
                      value={l.qty}
                      unit={ing?.unit ?? null}
                      onChange={(v) => update(l.key, { qty: v })}
                    />
                    {costing.variants.length ? (
                      <Select
                        aria-label={t('recipes.size')}
                        className="col-span-2 sm:col-span-1"
                        value={l.variantId ? String(l.variantId) : 'all'}
                        onValueChange={(v) =>
                          update(l.key, { variantId: v === 'all' ? null : Number(v) })
                        }
                        options={[
                          { value: 'all', label: t('recipes.allSizes') },
                          ...costing.variants.map((v) => ({ value: String(v.id), label: v.name })),
                        ]}
                      />
                    ) : (
                      <span className="hidden sm:block" />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('recipes.removeLine')}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    >
                      <X />
                    </Button>
                  </div>
                  {error ? <p className="text-sm text-danger">{error}</p> : null}
                </li>
              );
            })}
          </ul>
          <Button
            variant="outline"
            className="self-start"
            onClick={() =>
              setLines((ls) => [
                ...ls,
                { key: nextKey++, ingredientId: null, qty: '', variantId: null },
              ])
            }
          >
            <Plus />
            {t('recipes.addLine')}
          </Button>
          {costing.variants.length ? (
            <p className="text-xs text-foreground-muted">{t('recipes.sizeHint')}</p>
          ) : null}
          <ul className="flex flex-col gap-1 rounded-card bg-surface-sunken p-3 text-sm">
            {prices.map((p) => {
              const cost = costFor(p.key);
              const m = margin(p.price, costing.taxRateBp, cost);
              return (
                <li
                  key={p.key ?? 'std'}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="font-semibold">{p.name ?? costing.name}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-foreground-muted">
                      {t('recipes.foodCost')}{' '}
                      <span className="font-mono tabular-nums text-foreground">
                        {formatMoney(cost, { showDecimals: true })}
                      </span>{' '}
                      / {formatMoney(p.price)}
                    </span>
                    <Badge tone={marginTone(m.marginBp)}>
                      {t('recipes.marginLabel')} {formatPct(m.marginBp)}
                    </Badge>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('cancelAction')}
        </Button>
        <Button loading={save.isPending} disabled={!ingredients.length} onClick={submit}>
          {t('recipes.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
