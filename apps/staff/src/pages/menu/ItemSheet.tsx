import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Plus, Trash2, X } from 'lucide-react';
import {
  ALLERGENS,
  DIETARY_TAGS,
  itemInputSchema,
  type AdminMenu,
  type Allergen,
  type DietaryTag,
  type MenuItem,
  type Translations,
} from '@tavolina/shared';
import {
  Button,
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
import { ChipToggle, MoneyInput, SectionTitle, TranslationFields } from './fields';
import { useMenuLanguages, useMenuMutation } from './useMenu';

interface VariantRow {
  key: string;
  id?: number;
  name: string;
  priceMinor: number | null;
  translations: Translations;
}

interface FormState {
  categoryId: number;
  stationId: number | null;
  taxRateId: number | null;
  name: string;
  description: string;
  priceMinor: number | null;
  costMinor: number | null;
  prepMinutes: string;
  isPopular: boolean;
  isNew: boolean;
  guestVisible: boolean;
  active: boolean;
  allergens: Allergen[];
  tags: DietaryTag[];
  modifierGroupIds: number[];
  variants: VariantRow[];
  translations: Translations;
}

let rowKey = 0;
const nextKey = () => `row-${++rowKey}`;

function initialState(item: MenuItem | null, menu: AdminMenu, categoryId: number): FormState {
  const defaultStation = menu.stations.find((s) => s.active)?.id ?? null;
  return {
    categoryId: item?.categoryId ?? categoryId,
    stationId: item ? item.stationId : defaultStation,
    taxRateId: item?.taxRateId ?? menu.taxRates.find((r) => r.isDefault)?.id ?? null,
    name: item?.name ?? '',
    description: item?.description ?? '',
    priceMinor: item?.priceMinor ?? null,
    costMinor: item?.costMinor ?? null,
    prepMinutes: item?.prepMinutes != null ? String(item.prepMinutes) : '',
    isPopular: item?.isPopular ?? false,
    isNew: item?.isNew ?? false,
    guestVisible: item?.guestVisible ?? true,
    active: item?.active ?? true,
    allergens: item?.allergens ?? [],
    tags: item?.tags ?? [],
    modifierGroupIds: item?.modifierGroupIds ?? [],
    variants: (item?.variants ?? []).map((v) => ({ ...v, key: nextKey() })),
    translations: item?.translations ?? {},
  };
}

export interface ItemSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menu: AdminMenu;
  /** Edit this item; null creates one in `categoryId`. */
  item: MenuItem | null;
  categoryId: number;
  /** After creating, the sheet switches to editing the new item (so a photo can be added). */
  onCreated: (item: MenuItem) => void;
}

export function ItemSheet(props: ItemSheetProps) {
  const { t: tc } = useTranslation();
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" closeLabel={tc('actions.close')} className="w-[min(100vw,40rem)]">
        <ItemForm key={props.item?.id ?? 'new'} {...props} />
      </SheetContent>
    </Sheet>
  );
}

function ItemForm({ menu, item, categoryId, onOpenChange, onCreated }: ItemSheetProps) {
  const { t } = useTranslation('menu');
  const { t: tc } = useTranslation();
  const { validate } = useErrorMessages();
  const { others } = useMenuLanguages();
  const [form, setForm] = useState<FormState>(() => initialState(item, menu, categoryId));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const close = () => onOpenChange(false);

  const save = useMenuMutation(
    (body: unknown) =>
      item
        ? api<MenuItem>('PATCH', `/menu/items/${item.id}`, { body })
        : api<MenuItem>('POST', '/menu/items', { body }),
    {
      success: (saved) => (item ? t('item.saved') : t('item.created', { name: saved.name })),
      onSuccess: (saved) => (item ? close() : onCreated(saved)),
      onFieldErrors: setErrors,
    },
  );

  const remove = useMenuMutation(() => api('DELETE', `/menu/items/${item!.id}`), {
    success: t('item.deleted', { name: item?.name ?? '' }),
    onSuccess: () => {
      setConfirmDelete(false);
      close();
    },
  });

  const photo = useMenuMutation(
    (file: File | null) => {
      if (!file) return api<MenuItem>('DELETE', `/menu/items/${item!.id}/image`);
      const body = new FormData();
      body.append('image', file);
      return api<MenuItem>('POST', `/menu/items/${item!.id}/image`, { body });
    },
    { success: t('item.photoSaved') },
  );
  // The photo is saved immediately, so read it from the latest menu data.
  const currentPhoto = menu.items.find((i) => i.id === item?.id)?.thumbUrl ?? null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const prep = form.prepMinutes.trim();
    const body = {
      ...form,
      prepMinutes: prep === '' ? null : Number(prep),
      variants: form.variants.map(({ id, name, priceMinor, translations }) => ({
        ...(id ? { id } : {}),
        name,
        priceMinor,
        translations,
      })),
    };
    const result = validate(itemInputSchema, body);
    if (!result.ok) {
      setErrors(result.errors);
      // The form is long: take the user to the first problem.
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('#item-form [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setErrors({});
    save.mutate(body);
  }

  const margin =
    form.costMinor !== null && form.priceMinor && !Number.isNaN(form.costMinor)
      ? Math.round(((form.priceMinor - form.costMinor) / form.priceMinor) * 100)
      : null;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="text-xl font-bold tracking-tight">
          {item ? t('item.editTitle', { name: item.name }) : t('item.createTitle')}
        </SheetTitle>
      </SheetHeader>

      <form id="item-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-8 pb-4">
        <section className="flex flex-col gap-4">
          <SectionTitle>{t('item.sections.basics')}</SectionTitle>
          <Field label={t('item.name')} error={errors.name}>
            <Input
              value={form.name}
              placeholder={t('item.namePlaceholder')}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label={t('item.description')} error={errors.description}>
            <Textarea
              rows={2}
              value={form.description}
              placeholder={t('item.descriptionPlaceholder')}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('item.price')}
              hint={form.variants.length ? t('item.priceHint') : undefined}
              error={errors.priceMinor}
            >
              <MoneyInput value={form.priceMinor} onChange={(v) => set('priceMinor', v)} />
            </Field>
            <Field label={t('item.category')} error={errors.categoryId}>
              <Select
                value={String(form.categoryId)}
                onValueChange={(v) => set('categoryId', Number(v))}
                options={menu.categories.map((c) => ({ value: String(c.id), label: c.name }))}
              />
            </Field>
            <Field label={t('item.station')} hint={t('item.stationHint')} error={errors.stationId}>
              <Select
                value={form.stationId ? String(form.stationId) : 'none'}
                onValueChange={(v) => set('stationId', v === 'none' ? null : Number(v))}
                options={[
                  { value: 'none', label: t('item.noStation') },
                  ...menu.stations
                    .filter((s) => s.active || s.id === form.stationId)
                    .map((s) => ({ value: String(s.id), label: s.name })),
                ]}
              />
            </Field>
            <Field label={t('item.tax')} error={errors.taxRateId}>
              <Select
                value={form.taxRateId ? String(form.taxRateId) : undefined}
                onValueChange={(v) => set('taxRateId', Number(v))}
                options={menu.taxRates.map((r) => ({ value: String(r.id), label: r.name }))}
              />
            </Field>
            <Field label={t('item.prepMinutes')} error={errors.prepMinutes}>
              <Input
                inputMode="numeric"
                className="font-mono tabular-nums"
                value={form.prepMinutes}
                onChange={(e) => set('prepMinutes', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field
              label={t('item.cost')}
              hint={margin !== null ? t('item.margin', { percent: margin }) : t('item.costHint')}
              error={errors.costMinor}
            >
              <MoneyInput value={form.costMinor} onChange={(v) => set('costMinor', v)} />
            </Field>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <SectionTitle hint={item ? t('item.photoHint') : t('item.photoAfterSave')}>
            {t('item.sections.photo')}
          </SectionTitle>
          {item ? (
            <div className="flex items-center gap-4">
              <div className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-card border border-border bg-surface-sunken">
                {currentPhoto ? (
                  <img src={currentPhoto} alt="" className="size-full object-cover" />
                ) : (
                  <ImagePlus className="size-7 text-foreground-subtle" aria-hidden />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) photo.mutate(file);
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={photo.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus />
                  {currentPhoto ? t('item.replacePhoto') : t('item.uploadPhoto')}
                </Button>
                {currentPhoto ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => photo.mutate(null)}
                  >
                    <X />
                    {t('item.removePhoto')}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-4">
          <SectionTitle>{t('item.sections.translations')}</SectionTitle>
          <TranslationFields
            langs={others}
            value={form.translations}
            onChange={(v) => set('translations', v)}
            withDescription
          />
        </section>

        <section className="flex flex-col gap-4">
          <SectionTitle hint={t('item.variantsHint')}>{t('item.sections.variants')}</SectionTitle>
          {form.variants.map((variant, index) => (
            <div
              key={variant.key}
              className="flex flex-col gap-2 rounded-card border border-border p-3"
            >
              <div className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_140px]">
                  <Field label={t('item.variantName')} error={errors[`variants.${index}.name`]}>
                    <Input
                      value={variant.name}
                      onChange={(e) =>
                        set(
                          'variants',
                          form.variants.map((v) =>
                            v.key === variant.key ? { ...v, name: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field
                    label={t('item.variantPrice')}
                    error={errors[`variants.${index}.priceMinor`]}
                  >
                    <MoneyInput
                      value={variant.priceMinor}
                      onChange={(price) =>
                        set(
                          'variants',
                          form.variants.map((v) =>
                            v.key === variant.key ? { ...v, priceMinor: price } : v,
                          ),
                        )
                      }
                    />
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-7"
                  aria-label={t('item.removeVariant')}
                  onClick={() =>
                    set(
                      'variants',
                      form.variants.filter((v) => v.key !== variant.key),
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
                    placeholder={`${tc(`language.${lang}`)}`}
                    value={variant.translations[lang]?.name ?? ''}
                    onChange={(e) =>
                      set(
                        'variants',
                        form.variants.map((v) =>
                          v.key === variant.key
                            ? {
                                ...v,
                                translations: {
                                  ...v.translations,
                                  [lang]: { name: e.target.value },
                                },
                              }
                            : v,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              set('variants', [
                ...form.variants,
                { key: nextKey(), name: '', priceMinor: form.priceMinor, translations: {} },
              ])
            }
          >
            <Plus />
            {t('item.addVariant')}
          </Button>
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle hint={t('item.modifiersHint')}>{t('item.sections.modifiers')}</SectionTitle>
          {menu.modifierGroups.length ? (
            <div className="flex flex-wrap gap-2">
              {menu.modifierGroups.map((g) => (
                <ChipToggle
                  key={g.id}
                  pressed={form.modifierGroupIds.includes(g.id)}
                  onToggle={() => set('modifierGroupIds', toggle(form.modifierGroupIds, g.id))}
                >
                  {g.name}
                </ChipToggle>
              ))}
            </div>
          ) : (
            <p className="text-sm text-foreground-muted">{t('item.noModifierGroups')}</p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle>{t('item.sections.allergens')}</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {ALLERGENS.map((a) => (
              <ChipToggle
                key={a}
                pressed={form.allergens.includes(a)}
                onToggle={() => set('allergens', toggle(form.allergens, a))}
              >
                {t(`allergens.${a}`)}
              </ChipToggle>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle>{t('item.sections.tags')}</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {DIETARY_TAGS.map((tag) => (
              <ChipToggle
                key={tag}
                pressed={form.tags.includes(tag)}
                onToggle={() => set('tags', toggle(form.tags, tag))}
              >
                {t(`tags.${tag}`)}
              </ChipToggle>
            ))}
          </div>
        </section>

        <section className="flex flex-col">
          <SectionTitle>{t('item.sections.visibility')}</SectionTitle>
          <div className="divide-y divide-border">
            <SwitchField
              label={t('item.popular')}
              description={t('item.popularDescription')}
              checked={form.isPopular}
              onCheckedChange={(v) => set('isPopular', v)}
            />
            <SwitchField
              label={t('item.isNew')}
              description={t('item.isNewDescription')}
              checked={form.isNew}
              onCheckedChange={(v) => set('isNew', v)}
            />
            <SwitchField
              label={t('item.guestVisible')}
              description={t('item.guestVisibleDescription')}
              checked={form.guestVisible}
              onCheckedChange={(v) => set('guestVisible', v)}
            />
            <SwitchField
              label={t('item.active')}
              description={t('item.activeDescription')}
              checked={form.active}
              onCheckedChange={(v) => set('active', v)}
            />
          </div>
        </section>
      </form>

      <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-surface-raised py-4">
        {item ? (
          <Button
            type="button"
            variant="ghost"
            className="text-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 />
            {t('item.delete')}
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            {tc('actions.cancel')}
          </Button>
          <Button type="submit" form="item-form" loading={save.isPending}>
            {item ? t('item.save') : t('item.create')}
          </Button>
        </div>
      </div>

      {item ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('item.deleteConfirm', { name: item.name })}
          description={t('item.deleteDescription')}
          confirmLabel={t('item.delete')}
          loading={remove.isPending}
          onConfirm={() => remove.mutate(undefined)}
        />
      ) : null}
    </>
  );
}
