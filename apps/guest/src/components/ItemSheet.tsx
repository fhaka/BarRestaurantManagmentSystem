import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from 'lucide-react';
import { checkModifierSelection, formatMoney } from '@tavolina/shared/client';
import type { GuestCombo, GuestMenu, GuestMenuItem } from '@tavolina/shared';
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Textarea,
  cn,
} from '@tavolina/ui';
import { allItems, describe, type ComboChoice, type GuestCartLine } from '../lib/cart';
import { AllergenList } from './Allergens';

export type Subject = { kind: 'item'; item: GuestMenuItem } | { kind: 'combo'; combo: GuestCombo };

export function Chip({
  pressed,
  onToggle,
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors',
        pressed
          ? 'border-primary bg-primary-soft text-primary-soft-fg'
          : 'border-border-strong text-foreground hover:bg-surface-sunken',
      )}
    >
      {children}
    </button>
  );
}

function isComplete(item: GuestMenuItem, variantId: number | null, modifierIds: number[]) {
  if (item.variants.length && !variantId) return false;
  const groups = item.modifierGroups.map((g) => ({
    ...g,
    modifierIds: g.modifiers.map((m) => m.id),
  }));
  return checkModifierSelection(groups, modifierIds).length === 0;
}

/** Size and option choices for one dish. */
function Choices({
  item,
  variantId,
  modifierIds,
  currency,
  onChange,
}: {
  item: GuestMenuItem;
  variantId: number | null;
  modifierIds: number[];
  currency: 'L' | 'ALL';
  onChange: (variantId: number | null, modifierIds: number[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-5">
      {item.variants.length ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-bold">
            {t('item.size')}{' '}
            <span className="text-sm font-normal text-foreground-muted">
              · {t('item.required')}
            </span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {item.variants.map((v) => (
              <Chip
                key={v.id}
                pressed={variantId === v.id}
                onToggle={() => onChange(v.id, modifierIds)}
              >
                {v.name}
                <span className="font-mono opacity-80">
                  {formatMoney(v.priceMinor, { currency })}
                </span>
              </Chip>
            ))}
          </div>
        </fieldset>
      ) : null}
      {item.modifierGroups.map((g) => {
        const single = g.maxSelect === 1;
        const chosen = modifierIds.filter((id) => g.modifiers.some((m) => m.id === id));
        return (
          <fieldset key={g.id} className="flex flex-col gap-2">
            <legend className="mb-2 font-bold">
              {g.name}{' '}
              <span className="text-sm font-normal text-foreground-muted">
                · {g.required || g.minSelect > 0 ? t('item.required') : t('item.optional')}
                {single ? '' : ` · ${t('item.upTo', { count: g.maxSelect })}`}
              </span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {g.modifiers.map((m) => {
                const pressed = chosen.includes(m.id);
                const toggle = () => {
                  const others = modifierIds.filter((id) => !g.modifiers.some((x) => x.id === id));
                  if (single) return onChange(variantId, pressed ? others : [...others, m.id]);
                  if (pressed)
                    return onChange(
                      variantId,
                      modifierIds.filter((id) => id !== m.id),
                    );
                  if (chosen.length < g.maxSelect) onChange(variantId, [...modifierIds, m.id]);
                };
                return (
                  <Chip key={m.id} pressed={pressed} onToggle={toggle}>
                    {m.name}
                    {m.priceDeltaMinor ? (
                      <span className="font-mono opacity-80">
                        +{formatMoney(m.priceDeltaMinor, { currency })}
                      </span>
                    ) : null}
                  </Chip>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

export function ItemSheet({
  menu,
  subject,
  initial,
  canOrder,
  onClose,
  onSave,
}: {
  menu: GuestMenu;
  subject: Subject | null;
  initial: GuestCartLine | null;
  /** False when ordering is off or the category is not served now: show details only. */
  canOrder: boolean;
  onClose: () => void;
  onSave: (line: GuestCartLine) => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={subject !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" closeLabel={t('close')} className="max-h-[92dvh] p-0">
        {subject ? (
          <Form
            key={
              initial?.uuid ??
              `${subject.kind}${subject.kind === 'item' ? subject.item.id : subject.combo.id}`
            }
            menu={menu}
            subject={subject}
            initial={initial}
            canOrder={canOrder}
            onSave={onSave}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Form({
  menu,
  subject,
  initial,
  canOrder,
  onSave,
}: {
  menu: GuestMenu;
  subject: Subject;
  initial: GuestCartLine | null;
  canOrder: boolean;
  onSave: (line: GuestCartLine) => void;
}) {
  const { t } = useTranslation();
  const currency = menu.location.currencyDisplay;
  const [line, setLine] = useState<GuestCartLine>(
    () =>
      initial ?? {
        uuid: crypto.randomUUID(),
        ...(subject.kind === 'item' ? { itemId: subject.item.id } : { comboId: subject.combo.id }),
        variantId:
          subject.kind === 'item' && subject.item.variants.length === 1
            ? subject.item.variants[0]!.id
            : null,
        modifierIds: [],
        combo: [],
        qty: 1,
        notes: null,
      },
  );
  const update = (patch: Partial<GuestCartLine>) => setLine((l) => ({ ...l, ...patch }));
  const items = allItems(menu);
  const view = describe(menu, line);

  const complete =
    subject.kind === 'item'
      ? isComplete(subject.item, line.variantId, line.modifierIds)
      : subject.combo.slots.every((slot) => {
          const choice = line.combo.find((c) => c.slotId === slot.id);
          const item = choice && items.find((i) => i.id === choice.itemId);
          return item ? isComplete(item, choice.variantId, choice.modifierIds) : false;
        });

  const setChoice = (slotId: number, choice: ComboChoice) => {
    if (subject.kind !== 'combo') return;
    const order = subject.combo.slots.map((s) => s.id);
    // Keep choices in slot order (the server maps dishes back to parts by position).
    const next = [...line.combo.filter((c) => c.slotId !== slotId), choice].sort(
      (a, b) => order.indexOf(a.slotId) - order.indexOf(b.slotId),
    );
    update({ combo: next });
  };

  const item = subject.kind === 'item' ? subject.item : null;
  const image = item?.imageUrl ?? null;

  return (
    <div className="flex max-h-[92dvh] flex-col">
      <div className="flex-1 overflow-y-auto">
        {image ? <img src={image} alt="" className="aspect-[4/3] w-full object-cover" /> : null}
        <div className="flex flex-col gap-5 p-5">
          <div className="flex flex-col gap-1.5 pr-10">
            <SheetTitle className="text-2xl font-extrabold tracking-tight">
              {item ? item.name : subject.kind === 'combo' ? subject.combo.name : ''}
            </SheetTitle>
            <SheetDescription className="text-foreground-muted">
              {item ? item.description : subject.kind === 'combo' ? subject.combo.description : ''}
            </SheetDescription>
            {item?.prepMinutes ? (
              <p className="text-sm text-foreground-muted">
                {t('item.prep', { count: item.prepMinutes })}
              </p>
            ) : null}
          </div>
          {item && (item.allergens.length || item.tags.length) ? (
            <AllergenList allergens={item.allergens} tags={item.tags} />
          ) : null}

          {canOrder && item ? (
            <Choices
              item={item}
              variantId={line.variantId}
              modifierIds={line.modifierIds}
              currency={currency}
              onChange={(variantId, modifierIds) => update({ variantId, modifierIds })}
            />
          ) : null}

          {canOrder && subject.kind === 'combo'
            ? subject.combo.slots.map((slot) => {
                const choice = line.combo.find((c) => c.slotId === slot.id);
                const chosen = choice ? items.find((i) => i.id === choice.itemId) : undefined;
                return (
                  <fieldset
                    key={slot.id}
                    className="flex flex-col gap-3 rounded-card border border-border p-4"
                  >
                    <legend className="px-1 font-bold">
                      {slot.name}{' '}
                      <span className="text-sm font-normal text-foreground-muted">
                        · {t('item.chooseOne')}
                      </span>
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {slot.options.map((option) => {
                        const optionItem = items.find((i) => i.id === option.itemId);
                        if (!optionItem) return null;
                        return (
                          <Chip
                            key={option.itemId}
                            pressed={choice?.itemId === option.itemId}
                            onToggle={() =>
                              setChoice(slot.id, {
                                slotId: slot.id,
                                itemId: option.itemId,
                                variantId:
                                  optionItem.variants.length === 1
                                    ? optionItem.variants[0]!.id
                                    : null,
                                modifierIds: [],
                              })
                            }
                          >
                            {optionItem.name}
                            {option.priceDeltaMinor ? (
                              <span className="font-mono opacity-80">
                                +{formatMoney(option.priceDeltaMinor, { currency })}
                              </span>
                            ) : null}
                          </Chip>
                        );
                      })}
                    </div>
                    {chosen &&
                    choice &&
                    (chosen.variants.length > 1 || chosen.modifierGroups.length) ? (
                      <Choices
                        item={chosen}
                        variantId={choice.variantId}
                        modifierIds={choice.modifierIds}
                        currency={currency}
                        onChange={(variantId, modifierIds) =>
                          setChoice(slot.id, { ...choice, variantId, modifierIds })
                        }
                      />
                    ) : null}
                  </fieldset>
                );
              })
            : null}

          {canOrder ? (
            <>
              <label className="flex flex-col gap-2">
                <span className="font-bold">{t('item.notes')}</span>
                <Textarea
                  rows={2}
                  maxLength={200}
                  placeholder={t('item.notesPlaceholder')}
                  value={line.notes ?? ''}
                  onChange={(e) => update({ notes: e.target.value || null })}
                />
              </label>
              <div className="flex items-center justify-center gap-5">
                <Button
                  variant="outline"
                  size="icon-lg"
                  aria-label={t('item.less')}
                  disabled={line.qty <= 1}
                  onClick={() => update({ qty: line.qty - 1 })}
                >
                  <Minus />
                </Button>
                <span
                  className="min-w-10 text-center font-mono text-3xl font-bold tabular-nums"
                  aria-live="polite"
                >
                  {line.qty}
                </span>
                <Button
                  variant="outline"
                  size="icon-lg"
                  aria-label={t('item.more')}
                  disabled={line.qty >= 20}
                  onClick={() => update({ qty: line.qty + 1 })}
                >
                  <Plus />
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {canOrder ? (
        <div className="border-t border-border bg-surface-raised p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            size="xl"
            block
            disabled={!complete}
            onClick={() => onSave({ ...line, notes: line.notes?.trim() || null })}
          >
            {initial ? t('item.update') : t('item.add')}
            <span className="ml-auto font-mono tabular-nums">
              {formatMoney(view.totalMinor, { currency })}
            </span>
          </Button>
          {!complete ? (
            <p className="pt-2 text-center text-sm text-foreground-muted">{t('item.incomplete')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
