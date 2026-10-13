import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import {
  STOCK_UNITS,
  ingredientCreateSchema,
  ingredientInputSchema,
  type Ingredient,
  type StockUnit,
} from '@tavolina/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  SwitchField,
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { MoneyInput } from '../menu/fields';
import { formatQty, qtyToInput, useIngredients, useSuppliers } from './inventory-utils';
import { QtyInput } from './QtyInput';

export function IngredientDialog({
  ingredient,
  onClose,
}: {
  ingredient: Ingredient | 'new' | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={ingredient !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {ingredient ? (
          <IngredientForm
            key={ingredient === 'new' ? 'new' : ingredient.id}
            ingredient={ingredient === 'new' ? null : ingredient}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function IngredientForm({
  ingredient,
  onClose,
}: {
  ingredient: Ingredient | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('inventory');
  const { message, fieldErrors, validate } = useErrorMessages();
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();
  const categories = [
    ...new Set((useIngredients().data ?? []).map((i) => i.category).filter(Boolean)),
  ];
  const [form, setForm] = useState({
    name: ingredient?.name ?? '',
    unit: ingredient?.unit ?? ('kg' as StockUnit),
    category: ingredient?.category ?? '',
    stockQty: '',
    minQty: qtyToInput(ingredient?.minMilli ?? null),
    costPerUnitMinor: ingredient?.costPerUnitMinor ?? (null as number | null),
    supplierId: ingredient?.supplierId ?? null,
    active: ingredient?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['menu'] });
  };
  const save = useMutation({
    mutationFn: (body: unknown) =>
      ingredient
        ? api('PATCH', `/ingredients/${ingredient.id}`, { body })
        : api('POST', '/ingredients', { body }),
    onSuccess: () => {
      done();
      toast.success(t('stock.saved'));
      onClose();
    },
    onError: (err) => {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else toast.error(message(err));
    },
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/ingredients/${ingredient!.id}`),
    onSuccess: () => {
      done();
      toast.success(t('stock.deleted'));
      onClose();
    },
    onError: (err) => toast.error(message(err)),
  });
  const submit = () => {
    const body = {
      name: form.name,
      unit: form.unit,
      category: form.category,
      minQty: form.minQty || '0',
      costPerUnitMinor: form.costPerUnitMinor ?? 0,
      supplierId: form.supplierId,
      active: form.active,
      ...(ingredient ? {} : { stockQty: form.stockQty || '0' }),
    };
    const result = validate(ingredient ? ingredientInputSchema : ingredientCreateSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(body);
  };
  const unitLabel = t(`units.${form.unit}`);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{ingredient ? ingredient.name : t('stock.add')}</DialogTitle>
        {ingredient ? (
          <DialogDescription>
            {t('stock.stock')}: {formatQty(ingredient.stockMilli, ingredient.unit)} ·{' '}
            {t('stock.stockReadOnly')}
          </DialogDescription>
        ) : null}
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <Field label={t('stock.name')} error={errors.name}>
          <Input
            value={form.name}
            maxLength={120}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('stock.unit')} error={errors.unit}>
            <Select
              value={form.unit}
              onValueChange={(v) => setForm({ ...form, unit: v as StockUnit })}
              options={STOCK_UNITS.map((u) => ({
                value: u,
                label: `${t(`unitNames.${u}`)} (${t(`units.${u}`)})`,
              }))}
            />
          </Field>
          <Field label={t('stock.category')} error={errors.category}>
            <Input
              value={form.category}
              list="ingredient-categories"
              maxLength={60}
              placeholder={t('stock.categoryPlaceholder')}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
            <datalist id="ingredient-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {ingredient ? null : (
            <Field
              label={t('stock.openingStock')}
              hint={t('stock.openingStockHint')}
              error={errors.stockQty}
            >
              <QtyInput
                value={form.stockQty}
                unit={form.unit}
                onChange={(v) => setForm({ ...form, stockQty: v })}
              />
            </Field>
          )}
          <Field label={t('stock.min')} hint={t('stock.minHint')} error={errors.minQty}>
            <QtyInput
              value={form.minQty}
              unit={form.unit}
              onChange={(v) => setForm({ ...form, minQty: v })}
            />
          </Field>
          <Field
            label={t('stock.cost')}
            hint={t('stock.costHint', { unit: unitLabel })}
            error={errors.costPerUnitMinor}
          >
            <MoneyInput
              value={form.costPerUnitMinor}
              onChange={(v) => setForm({ ...form, costPerUnitMinor: v })}
            />
          </Field>
          <Field label={t('stock.supplier')}>
            <Select
              value={form.supplierId ? String(form.supplierId) : 'none'}
              onValueChange={(v) =>
                setForm({ ...form, supplierId: v === 'none' ? null : Number(v) })
              }
              options={[
                { value: 'none', label: t('stock.noSupplier') },
                ...(suppliers.data ?? []).map((s) => ({ value: String(s.id), label: s.name })),
              ]}
            />
          </Field>
        </div>
        <SwitchField
          label={t('stock.active')}
          checked={form.active}
          onCheckedChange={(v) => setForm({ ...form, active: v })}
        />
      </div>
      <DialogFooter>
        {ingredient ? (
          <Button
            variant="ghost"
            className="mr-auto text-danger"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <Trash2 />
            {t('stock.delete')}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          {t('cancelAction')}
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          {t('confirm')}
        </Button>
      </DialogFooter>
    </>
  );
}
