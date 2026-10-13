import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ban, PackageCheck, Plus, Send, X } from 'lucide-react';
import {
  formatMoney,
  purchaseOrderSchema,
  stockValue,
  toMilli,
  type PurchaseOrder,
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
  Textarea,
  toast,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { MoneyInput } from '../menu/fields';
import { formatQty, qtyToInput, useIngredients, useSuppliers } from './inventory-utils';
import { QtyInput } from './QtyInput';

export function PurchaseOrderDialog({
  order,
  canManage,
  onClose,
}: {
  order: PurchaseOrder | 'new' | null;
  canManage: boolean;
  onClose: () => void;
}) {
  const editable = order === 'new' || (order?.status === 'draft' && canManage);
  return (
    <Dialog open={order !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        {order === null ? null : editable ? (
          <DraftForm
            key={order === 'new' ? 'new' : order.id}
            order={order === 'new' ? null : order}
            onClose={onClose}
          />
        ) : (
          <OrderView key={order.id} order={order} canManage={canManage} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['menu'] });
  };
}

interface DraftLine {
  key: number;
  ingredientId: number | null;
  qty: string;
  unitCostMinor: number | null;
}
let nextKey = 1;

function DraftForm({ order, onClose }: { order: PurchaseOrder | null; onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const { message, fieldErrors, validate } = useErrorMessages();
  const invalidate = useInvalidate();
  const suppliers = (useSuppliers().data ?? []).filter(
    (s) => s.active || s.id === order?.supplierId,
  );
  const ingredients = useIngredients().data ?? [];
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const [supplierId, setSupplierId] = useState<number | null>(order?.supplierId ?? null);
  const [expectedAt, setExpectedAt] = useState(order?.expectedAt ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() =>
    order
      ? order.lines.map((l) => ({
          key: nextKey++,
          ingredientId: l.ingredientId,
          qty: qtyToInput(l.orderedMilli),
          unitCostMinor: l.unitCostMinor,
        }))
      : [{ key: nextKey++, ingredientId: null, qty: '', unitCostMinor: null }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = (key: number, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => {
    const q = toMilli(l.qty || '0');
    return s + (Number.isFinite(q) ? stockValue(q, l.unitCostMinor ?? 0) : 0);
  }, 0);

  const body = () => ({
    supplierId: supplierId ?? 0,
    expectedAt: expectedAt || null,
    notes: notes || null,
    lines: lines.map((l) => ({
      ingredientId: l.ingredientId ?? 0,
      qty: l.qty,
      unitCostMinor: l.unitCostMinor ?? 0,
    })),
  });
  const save = useMutation({
    mutationFn: async (send: boolean) => {
      const saved = order
        ? await api<PurchaseOrder>('PATCH', `/purchase-orders/${order.id}`, { body: body() })
        : await api<PurchaseOrder>('POST', '/purchase-orders', { body: body() });
      if (send) await api('POST', `/purchase-orders/${saved.id}/send`);
    },
    onSuccess: () => {
      invalidate();
      toast.success(t('purchases.saved'));
      onClose();
    },
    onError: (err) => {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else toast.error(message(err));
    },
  });
  const cancel = useMutation({
    mutationFn: () => api('POST', `/purchase-orders/${order!.id}/cancel`),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => toast.error(message(err)),
  });
  const submit = (send: boolean) => {
    const result = validate(purchaseOrderSchema, body());
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(send);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {order ? t('purchases.number', { number: order.number }) : t('purchases.new')}
        </DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <Field label={t('purchases.supplier')} error={errors.supplierId}>
            <Select
              value={supplierId ? String(supplierId) : undefined}
              placeholder={t('purchases.supplier')}
              onValueChange={(v) => {
                const id = Number(v);
                setSupplierId(id);
                // Suggest this supplier's ingredients when starting from an empty order.
                if (!order && lines.every((l) => l.ingredientId === null)) {
                  const theirs = ingredients.filter(
                    (i) => i.active && i.supplierId === id && i.low,
                  );
                  if (theirs.length) {
                    setLines(
                      theirs.map((i) => ({
                        key: nextKey++,
                        ingredientId: i.id,
                        qty: qtyToInput(Math.max(i.minMilli * 2 - i.stockMilli, 1000)),
                        unitCostMinor: i.costPerUnitMinor,
                      })),
                    );
                  }
                }
              }}
              options={suppliers.map((s) => ({ value: String(s.id), label: s.name }))}
            />
          </Field>
          <Field label={t('purchases.expected')} error={errors.expectedAt}>
            <Input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{t('purchases.lines')}</legend>
          {lines.map((l, index) => {
            const ing = l.ingredientId ? byId.get(l.ingredientId) : undefined;
            const error =
              errors[`lines.${index}.ingredientId`] ??
              errors[`lines.${index}.qty`] ??
              errors[`lines.${index}.unitCostMinor`];
            return (
              <div key={l.key} className="flex flex-col gap-1">
                <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_120px_140px_auto]">
                  <Select
                    aria-label={t('purchases.ingredient')}
                    placeholder={t('purchases.ingredient')}
                    value={l.ingredientId ? String(l.ingredientId) : undefined}
                    onValueChange={(v) => {
                      const i = byId.get(Number(v));
                      update(l.key, {
                        ingredientId: Number(v),
                        unitCostMinor: l.unitCostMinor ?? i?.costPerUnitMinor ?? null,
                      });
                    }}
                    options={ingredients
                      .filter((i) => i.active)
                      .map((i) => ({ value: String(i.id), label: i.name }))}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="sm:order-last"
                    aria-label={t('purchases.removeLine')}
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    <X />
                  </Button>
                  <QtyInput
                    aria-label={t('purchases.qty')}
                    value={l.qty}
                    unit={ing?.unit ?? null}
                    onChange={(v) => update(l.key, { qty: v })}
                  />
                  <MoneyInput
                    aria-label={t('purchases.unitCost')}
                    value={l.unitCostMinor}
                    onChange={(v) => update(l.key, { unitCostMinor: v })}
                  />
                </div>
                {error ? <p className="text-sm text-danger">{error}</p> : null}
              </div>
            );
          })}
          {errors.lines ? <p className="text-sm text-danger">{errors.lines}</p> : null}
          <Button
            variant="outline"
            className="self-start"
            onClick={() =>
              setLines((ls) => [
                ...ls,
                { key: nextKey++, ingredientId: null, qty: '', unitCostMinor: null },
              ])
            }
          >
            <Plus />
            {t('purchases.addLine')}
          </Button>
        </fieldset>
        <Field label={t('purchases.notes')} error={errors.notes}>
          <Textarea
            value={notes}
            maxLength={500}
            rows={2}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <p className="flex justify-between text-lg font-bold">
          <span>{t('purchases.total')}</span>
          <span className="font-mono tabular-nums">{formatMoney(total)}</span>
        </p>
      </div>
      <DialogFooter>
        {order ? (
          <Button
            variant="ghost"
            className="mr-auto text-danger"
            loading={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            <Ban />
            {t('purchases.cancel')}
          </Button>
        ) : null}
        <Button
          variant="outline"
          loading={save.isPending && save.variables === false}
          onClick={() => submit(false)}
        >
          {t('purchases.save')}
        </Button>
        <Button loading={save.isPending && save.variables === true} onClick={() => submit(true)}>
          <Send />
          {t('purchases.send')}
        </Button>
      </DialogFooter>
    </>
  );
}

/** A sent order: receive what arrived (all or part), or cancel it. Closed orders are read-only. */
function OrderView({
  order,
  canManage,
  onClose,
}: {
  order: PurchaseOrder;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('inventory');
  const { message } = useErrorMessages();
  const invalidate = useInvalidate();
  const receivable = canManage && ['sent', 'partially_received'].includes(order.status);
  const [arrived, setArrived] = useState<Record<number, { qty: string; cost: number | null }>>(() =>
    Object.fromEntries(
      order.lines.map((l) => [
        l.id,
        { qty: qtyToInput(Math.max(0, l.orderedMilli - l.receivedMilli)), cost: l.unitCostMinor },
      ]),
    ),
  );
  const receive = useMutation({
    mutationFn: (body: unknown) => api('POST', `/purchase-orders/${order.id}/receive`, { body }),
    onSuccess: () => {
      invalidate();
      toast.success(t('purchases.receivedToast'));
      onClose();
    },
    onError: (err) => toast.error(message(err)),
  });
  const cancel = useMutation({
    mutationFn: () => api('POST', `/purchase-orders/${order.id}/cancel`),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => toast.error(message(err)),
  });
  const submit = () => {
    const lines = order.lines
      .map((l) => ({
        lineId: l.id,
        qty: arrived[l.id]!.qty,
        unitCostMinor: arrived[l.id]!.cost ?? undefined,
      }))
      .filter((l) => toMilli(l.qty || '0') > 0);
    if (!lines.length) return toast.error(t('purchases.nothingToReceive'));
    receive.mutate({ lines });
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {receivable
            ? t('purchases.receiveTitle', { number: order.number })
            : t('purchases.number', { number: order.number })}
        </DialogTitle>
        <DialogDescription>
          {order.supplierName} · {t(`purchases.status.${order.status}`)} ·{' '}
          {t('purchases.created', { date: formatDateTime(order.createdAt) })}
          {receivable ? <span className="mt-1 block">{t('purchases.receiveHint')}</span> : null}
        </DialogDescription>
      </DialogHeader>
      <ul className="flex flex-col divide-y divide-border">
        {order.lines.map((l) => {
          const open = l.orderedMilli - l.receivedMilli;
          return (
            <li key={l.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <span className="flex-1">
                <span className="font-semibold">{l.ingredientName}</span>
                <span className="block text-sm text-foreground-muted">
                  {t('purchases.received', {
                    received: formatQty(l.receivedMilli, l.unit),
                    ordered: formatQty(l.orderedMilli, l.unit),
                  })}{' '}
                  · {formatMoney(l.unitCostMinor, { showDecimals: true })} / {t(`units.${l.unit}`)}
                </span>
              </span>
              {receivable && open > 0 ? (
                <span className="grid grid-cols-2 gap-2 sm:w-72">
                  <QtyInput
                    aria-label={`${t('purchases.receiveNow')} · ${l.ingredientName}`}
                    value={arrived[l.id]!.qty}
                    unit={l.unit}
                    onChange={(v) =>
                      setArrived({ ...arrived, [l.id]: { ...arrived[l.id]!, qty: v } })
                    }
                  />
                  <MoneyInput
                    aria-label={`${t('purchases.paidPrice')} · ${l.ingredientName}`}
                    value={arrived[l.id]!.cost}
                    onChange={(v) =>
                      setArrived({ ...arrived, [l.id]: { ...arrived[l.id]!, cost: v } })
                    }
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {order.notes ? <p className="text-sm text-foreground-muted">{order.notes}</p> : null}
      <p className="flex justify-between text-lg font-bold">
        <span>{t('purchases.total')}</span>
        <span className="font-mono tabular-nums">{formatMoney(order.totalMinor)}</span>
      </p>
      <DialogFooter>
        {receivable ? (
          <>
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              loading={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              <Ban />
              {t('purchases.cancel')}
            </Button>
            <Button variant="outline" onClick={onClose}>
              {t('cancelAction')}
            </Button>
            <Button loading={receive.isPending} onClick={submit}>
              <PackageCheck />
              {t('purchases.confirmReceive')}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onClose}>
            {t('close')}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
