import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, UtensilsCrossed, X } from 'lucide-react';
import {
  comboInputSchema,
  formatMoney,
  type AdminMenu,
  type MenuCombo,
  type Translations,
} from '@tavolina/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SwitchField,
  Textarea,
} from '@tavolina/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { MoneyInput, SectionTitle, TranslationFields } from './fields';
import { useMenuLanguages, useMenuMutation } from './useMenu';

/** Fixed-price menus such as "Menu dreke": one choice per part, each routed to its own station. */
export function CombosTab({ menu }: { menu: AdminMenu }) {
  const { t } = useTranslation('menu');
  const [sheet, setSheet] = useState<{ open: boolean; combo: MenuCombo | null }>({
    open: false,
    combo: null,
  });
  const itemName = (id: number) => menu.items.find((i) => i.id === id)?.name ?? '?';
  const add = (
    <Button
      onClick={() => setSheet({ open: true, combo: null })}
      disabled={!menu.categories.length}
    >
      <Plus />
      {t('combos.add')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{add}</div>
      {menu.combos.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed />}
          title={t('combos.emptyTitle')}
          description={t('combos.empty')}
          action={add}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {menu.combos.map((c) => (
            <li key={c.id}>
              <Card className="flex h-full flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold tracking-tight">{c.name}</h3>
                    <p className="font-mono text-sm tabular-nums text-foreground-muted">
                      {formatMoney(c.priceMinor)}
                    </p>
                  </div>
                  {!c.active ? (
                    <Badge tone="danger" size="sm">
                      {t('combos.inactive')}
                    </Badge>
                  ) : null}
                </div>
                <ul className="flex flex-col gap-1 text-sm">
                  {c.slots.map((s) => (
                    <li key={s.id}>
                      <span className="font-semibold">{s.name}:</span>{' '}
                      <span className="text-foreground-muted">
                        {s.items.map((i) => itemName(i.menuItemId)).join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-auto self-start"
                  onClick={() => setSheet({ open: true, combo: c })}
                >
                  {t('common.edit')}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={sheet.open} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}>
        <SheetContent side="right" closeLabel={t('combos.close')} className="w-[min(100vw,40rem)]">
          <ComboForm
            key={sheet.combo?.id ?? 'new'}
            menu={menu}
            combo={sheet.combo}
            onClose={() => setSheet((s) => ({ ...s, open: false }))}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface SlotRow {
  key: string;
  id?: number;
  name: string;
  translations: Translations;
  items: { menuItemId: number; priceDeltaMinor: number | null }[];
}
let rowKey = 0;

function ComboForm({
  menu,
  combo,
  onClose,
}: {
  menu: AdminMenu;
  combo: MenuCombo | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('menu');
  const { t: tc } = useTranslation();
  const { validate } = useErrorMessages();
  const { others } = useMenuLanguages();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({
    name: combo?.name ?? '',
    description: combo?.description ?? '',
    priceMinor: combo?.priceMinor ?? (null as number | null),
    categoryId: combo?.categoryId ?? menu.categories[0]?.id ?? 0,
    active: combo?.active ?? true,
    guestVisible: combo?.guestVisible ?? true,
    translations: combo?.translations ?? ({} as Translations),
    slots: (combo?.slots ?? [{ name: '', translations: {}, items: [] }]).map((s) => ({
      ...s,
      key: `slot-${++rowKey}`,
    })) as SlotRow[],
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setSlot = (key: string, patch: Partial<SlotRow>) =>
    set(
      'slots',
      form.slots.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    );

  const save = useMenuMutation(
    (body: unknown) =>
      combo
        ? api('PATCH', `/menu/combos/${combo.id}`, { body })
        : api('POST', '/menu/combos', { body }),
    { success: t('combos.saved'), onSuccess: onClose, onFieldErrors: setErrors },
  );
  const remove = useMenuMutation(() => api('DELETE', `/menu/combos/${combo!.id}`), {
    success: t('combos.deleted'),
    onSuccess: onClose,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = {
      name: form.name,
      description: form.description,
      priceMinor: form.priceMinor,
      categoryId: form.categoryId,
      active: form.active,
      guestVisible: form.guestVisible,
      translations: form.translations,
      slots: form.slots.map(({ id, name, translations, items }) => ({
        ...(id ? { id } : {}),
        name,
        translations,
        items: items.map((i) => ({
          menuItemId: i.menuItemId,
          priceDeltaMinor: i.priceDeltaMinor ?? 0,
        })),
      })),
    };
    const result = validate(comboInputSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(body);
  }

  const itemOptions = menu.items
    .filter((i) => i.active)
    .map((i) => ({ value: String(i.id), label: i.name }));

  return (
    <>
      <SheetHeader>
        <SheetTitle className="text-xl font-bold tracking-tight">
          {combo ? t('combos.editTitle', { name: combo.name }) : t('combos.createTitle')}
        </SheetTitle>
      </SheetHeader>
      <form id="combo-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-6 pb-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
          <Field label={t('combos.name')} error={errors.name}>
            <Input
              value={form.name}
              placeholder={t('combos.namePlaceholder')}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label={t('combos.price')} error={errors.priceMinor}>
            <MoneyInput value={form.priceMinor} onChange={(v) => set('priceMinor', v)} />
          </Field>
        </div>
        <Field label={t('combos.description')} error={errors.description}>
          <Textarea
            rows={2}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
        <TranslationFields
          langs={others}
          value={form.translations}
          onChange={(v) => set('translations', v)}
          withDescription
        />
        <Field label={t('combos.category')} error={errors.categoryId}>
          <Select
            value={String(form.categoryId)}
            onValueChange={(v) => set('categoryId', Number(v))}
            options={menu.categories.map((c) => ({ value: String(c.id), label: c.name }))}
          />
        </Field>
        <SwitchField
          label={t('combos.active')}
          checked={form.active}
          onCheckedChange={(v) => set('active', v)}
        />
        <SwitchField
          label={t('combos.guestVisible')}
          checked={form.guestVisible}
          onCheckedChange={(v) => set('guestVisible', v)}
        />

        <section className="flex flex-col gap-3">
          <SectionTitle hint={t('combos.slotsHint')}>{t('combos.slots')}</SectionTitle>
          {errors.slots ? <p className="text-sm text-danger">{errors.slots}</p> : null}
          {form.slots.map((slot, index) => (
            <div
              key={slot.key}
              className="flex flex-col gap-3 rounded-card border border-border p-3"
            >
              <div className="flex items-start gap-2">
                <Field
                  label={t('combos.slotName')}
                  error={errors[`slots.${index}.name`]}
                  className="flex-1"
                >
                  <Input
                    value={slot.name}
                    placeholder={t('combos.slotPlaceholder')}
                    onChange={(e) => setSlot(slot.key, { name: e.target.value })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-7"
                  aria-label={t('combos.removeSlot')}
                  disabled={form.slots.length === 1}
                  onClick={() =>
                    set(
                      'slots',
                      form.slots.filter((s) => s.key !== slot.key),
                    )
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {others.map((lang) => (
                  <Input
                    key={lang}
                    aria-label={t('translations.name', { lang: tc(`language.${lang}`) })}
                    placeholder={tc(`language.${lang}`)}
                    value={slot.translations[lang]?.name ?? ''}
                    onChange={(e) =>
                      setSlot(slot.key, {
                        translations: { ...slot.translations, [lang]: { name: e.target.value } },
                      })
                    }
                  />
                ))}
              </div>
              {errors[`slots.${index}.items`] ? (
                <p className="text-sm text-danger">{errors[`slots.${index}.items`]}</p>
              ) : null}
              <ul className="flex flex-col gap-2">
                {slot.items.map((item) => (
                  <li key={item.menuItemId} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {menu.items.find((i) => i.id === item.menuItemId)?.name ?? '?'}
                    </span>
                    <div className="w-32">
                      <MoneyInput
                        aria-label={t('combos.surcharge')}
                        value={item.priceDeltaMinor}
                        onChange={(v) =>
                          setSlot(slot.key, {
                            items: slot.items.map((x) =>
                              x.menuItemId === item.menuItemId ? { ...x, priceDeltaMinor: v } : x,
                            ),
                          })
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('combos.removeItem')}
                      onClick={() =>
                        setSlot(slot.key, {
                          items: slot.items.filter((x) => x.menuItemId !== item.menuItemId),
                        })
                      }
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
              <Select
                aria-label={t('combos.addItem')}
                placeholder={t('combos.addItem')}
                value=""
                onValueChange={(v) =>
                  setSlot(slot.key, {
                    items: [...slot.items, { menuItemId: Number(v), priceDeltaMinor: 0 }],
                  })
                }
                options={itemOptions.filter(
                  (o) => !slot.items.some((i) => String(i.menuItemId) === o.value),
                )}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              set('slots', [
                ...form.slots,
                { key: `slot-${++rowKey}`, name: '', translations: {}, items: [] },
              ])
            }
          >
            <Plus />
            {t('combos.addSlot')}
          </Button>
        </section>
      </form>
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-surface-raised py-4">
        {combo ? (
          <Button
            type="button"
            variant="ghost"
            className="text-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 />
            {t('combos.delete')}
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {tc('actions.cancel')}
          </Button>
          <Button type="submit" form="combo-form" loading={save.isPending}>
            {t('combos.save')}
          </Button>
        </div>
      </div>
      {combo ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('combos.deleteConfirm', { name: combo.name })}
          description={t('combos.deleteDescription')}
          confirmLabel={t('combos.delete')}
          loading={remove.isPending}
          onConfirm={() => remove.mutate(undefined)}
        />
      ) : null}
    </>
  );
}
