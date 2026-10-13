import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { WASTE_TYPES, wasteSchema } from '@tavolina/shared';
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
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { ChipToggle } from '../menu/fields';
import { useCosting, useIngredients } from './inventory-utils';
import { QtyInput } from './QtyInput';

/** Spoilage or staff meals (plan §5.9): one ingredient, or whole dishes by their recipe. */
export function WasteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{open ? <WasteForm onClose={onClose} /> : null}</DialogContent>
    </Dialog>
  );
}

function WasteForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const { message, fieldErrors, validate } = useErrorMessages();
  const queryClient = useQueryClient();
  const ingredients = (useIngredients().data ?? []).filter((i) => i.active);
  const dishes = (useCosting().data ?? []).filter((c) => c.kind === 'item' && c.lines.length > 0);
  const [type, setType] = useState<(typeof WASTE_TYPES)[number]>('waste');
  const [mode, setMode] = useState<'ingredient' | 'dish'>('ingredient');
  const [ingredientId, setIngredientId] = useState<number | null>(null);
  const [qty, setQty] = useState('');
  const [menuItemId, setMenuItemId] = useState<number | null>(null);
  const [variantId, setVariantId] = useState<number | null>(null);
  const [count, setCount] = useState('1');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const unit = ingredients.find((i) => i.id === ingredientId)?.unit ?? null;
  const dish = dishes.find((d) => d.id === menuItemId);

  const save = useMutation({
    mutationFn: (body: unknown) => api('POST', '/waste', { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success(t('waste.saved'));
      onClose();
    },
    onError: (err) => {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else toast.error(message(err));
    },
  });
  const submit = () => {
    const body =
      mode === 'ingredient'
        ? { type, ingredientId: ingredientId ?? undefined, qty: qty || undefined, reason }
        : {
            type,
            menuItemId: menuItemId ?? undefined,
            variantId,
            dishes: Number(count) || undefined,
            reason,
          };
    const result = validate(wasteSchema, body);
    if (!result.ok) {
      // "Choose an ingredient or a dish" belongs next to whichever picker is showing.
      const e = { ...result.errors };
      if (mode === 'dish' && e.ingredientId) e.menuItemId = e.ingredientId;
      return setErrors(e);
    }
    setErrors({});
    save.mutate(body);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('waste.title')}</DialogTitle>
        <DialogDescription>{t('waste.description')}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {WASTE_TYPES.map((w) => (
            <ChipToggle key={w} pressed={type === w} onToggle={() => setType(w)}>
              {t(`waste.types.${w}`)}
            </ChipToggle>
          ))}
          <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
          {(['ingredient', 'dish'] as const).map((m) => (
            <ChipToggle key={m} pressed={mode === m} onToggle={() => setMode(m)}>
              {t(m === 'ingredient' ? 'waste.byIngredient' : 'waste.byDish')}
            </ChipToggle>
          ))}
        </div>
        {mode === 'ingredient' ? (
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <Field label={t('waste.ingredient')} error={errors.ingredientId}>
              <Select
                value={ingredientId ? String(ingredientId) : undefined}
                placeholder={t('waste.ingredient')}
                onValueChange={(v) => setIngredientId(Number(v))}
                options={ingredients.map((i) => ({ value: String(i.id), label: i.name }))}
              />
            </Field>
            <Field label={t('waste.qty')} error={errors.qty}>
              <QtyInput value={qty} unit={unit} onChange={setQty} />
            </Field>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label={t('waste.dish')} error={errors.menuItemId}>
              <Select
                value={menuItemId ? String(menuItemId) : undefined}
                placeholder={t('waste.dish')}
                onValueChange={(v) => {
                  setMenuItemId(Number(v));
                  setVariantId(null);
                }}
                options={dishes.map((d) => ({ value: String(d.id), label: d.name }))}
              />
            </Field>
            <Field label={t('waste.dishes')} error={errors.dishes}>
              <Input
                inputMode="numeric"
                className="font-mono tabular-nums"
                value={count}
                onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            {dish?.variants.length ? (
              <Field label={t('waste.size')}>
                <Select
                  value={variantId ? String(variantId) : 'none'}
                  onValueChange={(v) => setVariantId(v === 'none' ? null : Number(v))}
                  options={[
                    { value: 'none', label: t('waste.anySize') },
                    ...dish.variants.map((v) => ({ value: String(v.id), label: v.name })),
                  ]}
                />
              </Field>
            ) : null}
          </div>
        )}
        <Field label={t('waste.reason')} error={errors.reason}>
          <Input
            value={reason}
            maxLength={200}
            placeholder={t('waste.reasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('cancelAction')}
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          {t('waste.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
