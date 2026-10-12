import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from 'lucide-react';
import {
  checkModifierSelection,
  formatMoney,
  type AdminMenu,
  type MenuCombo,
  type MenuItem,
} from '@tavolina/shared';
import { Button, Input, Sheet, SheetContent, SheetHeader, SheetTitle, cn } from '@tavolina/ui';
import { ChipToggle } from '../menu/fields';
import { describeLine, isOutOfStock, type CartLine } from './order-utils';

export type OptionsSubject = { kind: 'item'; item: MenuItem } | { kind: 'combo'; combo: MenuCombo };

const NOTE_KEYS = [
  'noSalt',
  'noOnion',
  'noIce',
  'rare',
  'wellDone',
  'spicy',
  'forKids',
  'separate',
] as const;

function groupsFor(menu: AdminMenu, item: MenuItem) {
  return item.modifierGroupIds
    .map((id) => menu.modifierGroups.find((g) => g.id === id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g))
    .map((g) => ({ ...g, modifiers: g.modifiers.filter((m) => m.active) }));
}

/** True when the size and every required option group are chosen. */
function isComplete(
  menu: AdminMenu,
  item: MenuItem,
  variantId: number | null,
  modifierIds: number[],
): boolean {
  if (item.variants.length && !variantId) return false;
  const groups = groupsFor(menu, item).map((g) => ({
    ...g,
    modifierIds: g.modifiers.map((m) => m.id),
  }));
  return checkModifierSelection(groups, modifierIds).length === 0;
}

/** Size and option pickers for one dish (also used for each dish inside a combo). */
function ItemChoices({
  menu,
  item,
  variantId,
  modifierIds,
  onChange,
  showVariantPrices = true,
}: {
  menu: AdminMenu;
  item: MenuItem;
  variantId: number | null;
  modifierIds: number[];
  onChange: (variantId: number | null, modifierIds: number[]) => void;
  showVariantPrices?: boolean;
}) {
  const { t } = useTranslation('orders');
  const groups = groupsFor(menu, item);
  return (
    <div className="flex flex-col gap-4">
      {item.variants.length ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">
            {t('options.size')} <span className="text-danger">*</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {item.variants.map((v) => (
              <ChipToggle
                key={v.id}
                pressed={variantId === v.id}
                onToggle={() => onChange(v.id, modifierIds)}
              >
                {v.name}
                {showVariantPrices ? (
                  <span className="font-mono opacity-80">{formatMoney(v.priceMinor)}</span>
                ) : null}
              </ChipToggle>
            ))}
          </div>
        </fieldset>
      ) : null}
      {groups.map((g) => {
        const single = g.maxSelect === 1;
        const chosen = modifierIds.filter((id) => g.modifiers.some((m) => m.id === id));
        return (
          <fieldset key={g.id} className="flex flex-col gap-2">
            <legend className="mb-2 flex flex-wrap items-baseline gap-2 text-sm font-semibold">
              {g.name}
              {g.required || g.minSelect > 0 ? <span className="text-danger">*</span> : null}
              <span className="text-xs font-normal text-foreground-muted">
                {single ? t('options.pickOne') : t('options.pickUpTo', { count: g.maxSelect })}
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
                  if (chosen.length >= g.maxSelect) return;
                  onChange(variantId, [...modifierIds, m.id]);
                };
                return (
                  <ChipToggle key={m.id} pressed={pressed} onToggle={toggle}>
                    {m.name}
                    {m.priceDeltaMinor ? (
                      <span className="font-mono opacity-80">
                        +{formatMoney(m.priceDeltaMinor)}
                      </span>
                    ) : null}
                  </ChipToggle>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

export function ItemOptionsSheet({
  menu,
  subject,
  initial,
  guestCount,
  timeZone,
  onClose,
  onSave,
}: {
  menu: AdminMenu;
  subject: OptionsSubject | null;
  initial: CartLine | null;
  guestCount: number | null;
  timeZone: string;
  onClose: () => void;
  onSave: (line: CartLine) => void;
}) {
  const { t: tc } = useTranslation();
  const side = typeof window !== 'undefined' && window.innerWidth < 640 ? 'bottom' : 'right';
  return (
    <Sheet open={subject !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side={side} closeLabel={tc('actions.close')} className="flex flex-col">
        {subject ? (
          <OptionsForm
            key={
              initial?.uuid ??
              (subject.kind === 'item' ? `i${subject.item.id}` : `c${subject.combo.id}`)
            }
            menu={menu}
            subject={subject}
            initial={initial}
            guestCount={guestCount}
            timeZone={timeZone}
            onSave={onSave}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function OptionsForm({
  menu,
  subject,
  initial,
  guestCount,
  timeZone,
  onSave,
}: {
  menu: AdminMenu;
  subject: OptionsSubject;
  initial: CartLine | null;
  guestCount: number | null;
  timeZone: string;
  onSave: (line: CartLine) => void;
}) {
  const { t } = useTranslation('orders');
  const [line, setLine] = useState<CartLine>(
    () =>
      initial ?? {
        uuid: crypto.randomUUID(),
        ...(subject.kind === 'item'
          ? { menuItemId: subject.item.id }
          : { comboId: subject.combo.id }),
        variantId:
          subject.kind === 'item' && subject.item.variants.length === 1
            ? subject.item.variants[0]!.id
            : null,
        modifierIds: [],
        comboSelections: [],
        qty: 1,
        seat: null,
        course: null,
        notes: null,
      },
  );
  const update = (patch: Partial<CartLine>) => setLine((l) => ({ ...l, ...patch }));
  const view = describeLine(menu, line, timeZone);
  const noteChips = NOTE_KEYS.map((k) => t(`notes.${k}`));
  const noteParts = (line.notes ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const toggleNote = (note: string) => {
    const next = noteParts.includes(note)
      ? noteParts.filter((n) => n !== note)
      : [...noteParts, note];
    update({ notes: next.join(', ') || null });
  };

  const complete =
    subject.kind === 'item'
      ? isComplete(menu, subject.item, line.variantId, line.modifierIds)
      : subject.combo.slots.every((slot) => {
          const sel = line.comboSelections.find((s) => s.slotId === slot.id);
          const item = sel && menu.items.find((i) => i.id === sel.menuItemId);
          return item ? isComplete(menu, item, sel.variantId, sel.modifierIds) : false;
        });

  const setSelection = (slotId: number, sel: CartLine['comboSelections'][number] | null) => {
    if (subject.kind !== 'combo') return;
    const others = line.comboSelections.filter((s) => s.slotId !== slotId);
    const next = sel ? [...others, sel] : others;
    // Keep selections in slot order: the server maps dishes back to slots by position.
    const order = subject.combo.slots.map((s) => s.id);
    update({
      comboSelections: next.sort((a, b) => order.indexOf(a.slotId) - order.indexOf(b.slotId)),
    });
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle className="text-2xl font-extrabold tracking-tight">
          {subject.kind === 'item' ? subject.item.name : subject.combo.name}
        </SheetTitle>
        {subject.kind === 'item' && subject.item.description ? (
          <p className="text-sm text-foreground-muted">{subject.item.description}</p>
        ) : null}
      </SheetHeader>

      <div className="-mx-1 flex flex-1 flex-col gap-6 overflow-y-auto px-1 pb-4">
        {subject.kind === 'item' ? (
          <ItemChoices
            menu={menu}
            item={subject.item}
            variantId={line.variantId}
            modifierIds={line.modifierIds}
            onChange={(variantId, modifierIds) => update({ variantId, modifierIds })}
          />
        ) : (
          subject.combo.slots.map((slot) => {
            const sel = line.comboSelections.find((s) => s.slotId === slot.id) ?? null;
            const chosen = sel ? menu.items.find((i) => i.id === sel.menuItemId) : undefined;
            return (
              <fieldset
                key={slot.id}
                className="flex flex-col gap-3 rounded-card border border-border p-3"
              >
                <legend className="px-1 text-sm font-bold">
                  {slot.name} <span className="text-danger">*</span>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {slot.items.map((option) => {
                    const item = menu.items.find((i) => i.id === option.menuItemId);
                    if (!item) return null;
                    const out = !item.active || isOutOfStock(item);
                    return (
                      <ChipToggle
                        key={option.menuItemId}
                        pressed={sel?.menuItemId === item.id}
                        onToggle={() =>
                          out
                            ? undefined
                            : setSelection(slot.id, {
                                slotId: slot.id,
                                menuItemId: item.id,
                                variantId: item.variants.length === 1 ? item.variants[0]!.id : null,
                                modifierIds: [],
                              })
                        }
                      >
                        <span className={cn(out && 'line-through opacity-60')}>{item.name}</span>
                        {option.priceDeltaMinor ? (
                          <span className="font-mono opacity-80">
                            +{formatMoney(option.priceDeltaMinor)}
                          </span>
                        ) : null}
                      </ChipToggle>
                    );
                  })}
                </div>
                {chosen && sel && (chosen.variants.length || chosen.modifierGroupIds.length) ? (
                  <ItemChoices
                    menu={menu}
                    item={chosen}
                    variantId={sel.variantId}
                    modifierIds={sel.modifierIds}
                    showVariantPrices={false}
                    onChange={(variantId, modifierIds) =>
                      setSelection(slot.id, { ...sel, variantId, modifierIds })
                    }
                  />
                ) : null}
              </fieldset>
            );
          })
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold">{t('options.qty')}</legend>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon-lg"
                aria-label={t('options.less')}
                disabled={line.qty <= 1}
                onClick={() => update({ qty: line.qty - 1 })}
              >
                <Minus />
              </Button>
              <span
                className="min-w-10 text-center font-mono text-2xl font-bold tabular-nums"
                aria-live="polite"
              >
                {line.qty}
              </span>
              <Button
                variant="outline"
                size="icon-lg"
                aria-label={t('options.more')}
                disabled={line.qty >= 99}
                onClick={() => update({ qty: line.qty + 1 })}
              >
                <Plus />
              </Button>
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold">{t('options.course')}</legend>
            <div className="flex flex-wrap gap-2">
              {([null, 1, 2, 3] as const).map((c) => (
                <ChipToggle
                  key={String(c)}
                  pressed={line.course === c}
                  onToggle={() => update({ course: c })}
                >
                  {c === null ? t('options.noCourse') : t('options.courseN', { n: c })}
                </ChipToggle>
              ))}
            </div>
          </fieldset>
        </div>

        {guestCount && guestCount > 1 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold">{t('options.seat')}</legend>
            <div className="flex flex-wrap gap-2">
              <ChipToggle pressed={line.seat === null} onToggle={() => update({ seat: null })}>
                {t('options.shared')}
              </ChipToggle>
              {Array.from({ length: Math.min(guestCount, 20) }, (_, i) => i + 1).map((n) => (
                <ChipToggle key={n} pressed={line.seat === n} onToggle={() => update({ seat: n })}>
                  {n}
                </ChipToggle>
              ))}
            </div>
          </fieldset>
        ) : null}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">{t('options.notes')}</legend>
          <div className="flex flex-wrap gap-2">
            {noteChips.map((note) => (
              <ChipToggle
                key={note}
                pressed={noteParts.includes(note)}
                onToggle={() => toggleNote(note)}
              >
                {note}
              </ChipToggle>
            ))}
          </div>
          <Input
            aria-label={t('options.notes')}
            placeholder={t('options.notesPlaceholder')}
            maxLength={200}
            value={line.notes ?? ''}
            onChange={(e) => update({ notes: e.target.value || null })}
          />
        </fieldset>
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <span className="font-mono text-xl font-bold tabular-nums">
          {formatMoney(view.totalMinor)}
        </span>
        <Button
          size="xl"
          className="flex-1"
          disabled={!complete}
          onClick={() => onSave({ ...line, notes: line.notes?.trim() || null })}
        >
          {initial ? t('options.update') : t('options.add')}
        </Button>
      </div>
      {!complete ? (
        <p className="pt-2 text-center text-sm text-foreground-muted">{t('options.incomplete')}</p>
      ) : null}
    </>
  );
}
