import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ALL_WEEKDAYS_MASK,
  CATEGORY_ICONS,
  categoryInputSchema,
  type CategoryIcon,
  type MenuCategory,
  type Translations,
} from '@tavolina/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  SwitchField,
  cn,
} from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { TranslationFields, WeekdayPicker } from './fields';
import { CATEGORY_ICON_COMPONENTS } from './menu-utils';
import { useMenuLanguages, useMenuMutation } from './useMenu';

export function CategoryDialog({
  open,
  onOpenChange,
  category,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: MenuCategory | null;
  categories: MenuCategory[];
}) {
  const { t: tc } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('actions.close')} className="max-w-xl">
        <CategoryForm
          category={category}
          categories={categories}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  category,
  categories,
  onClose,
}: {
  category: MenuCategory | null;
  categories: MenuCategory[];
  onClose: () => void;
}) {
  const { t } = useTranslation('menu');
  const { t: tc } = useTranslation();
  const { validate } = useErrorMessages();
  const { others } = useMenuLanguages();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: category?.name ?? '',
    description: category?.description ?? '',
    parentId: category?.parentId ?? null,
    icon: category?.icon ?? null,
    availableFrom: category?.availableFrom ?? '',
    availableTo: category?.availableTo ?? '',
    weekdayMask: category?.weekdayMask ?? ALL_WEEKDAYS_MASK,
    active: category?.active ?? true,
    translations: (category?.translations ?? {}) as Translations,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMenuMutation(
    (body: unknown) =>
      category
        ? api<MenuCategory>('PATCH', `/menu/categories/${category.id}`, { body })
        : api<MenuCategory>('POST', '/menu/categories', { body }),
    { success: t('categories.saved'), onSuccess: onClose, onFieldErrors: setErrors },
  );

  // Only top-level categories without children of their own can be parents (one level deep).
  const parents = categories.filter((c) => c.parentId === null && c.id !== category?.id);
  const hasChildren = categories.some((c) => c.parentId === category?.id);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = {
      ...form,
      availableFrom: form.availableFrom || null,
      availableTo: form.availableTo || null,
    };
    const result = validate(categoryInputSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(body);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{category ? t('categories.edit') : t('categories.createTitle')}</DialogTitle>
      </DialogHeader>
      <form id="category-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Field label={t('categories.name')} error={errors.name}>
          <Input
            value={form.name}
            placeholder={t('categories.namePlaceholder')}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        <Field label={t('categories.description')} error={errors.description}>
          <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <TranslationFields
          langs={others}
          value={form.translations}
          onChange={(v) => set('translations', v)}
          withDescription
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">{t('categories.icon')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_ICONS.map((key: CategoryIcon) => {
              const Icon = CATEGORY_ICON_COMPONENTS[key];
              const on = form.icon === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  aria-label={key}
                  onClick={() => set('icon', on ? null : key)}
                  className={cn(
                    'flex size-11 items-center justify-center rounded-control border transition-colors',
                    on
                      ? 'border-primary bg-primary-soft text-primary-soft-fg'
                      : 'border-border text-foreground-muted hover:bg-surface-sunken',
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </button>
              );
            })}
          </div>
        </fieldset>

        {hasChildren ? null : (
          <Field label={t('categories.parent')} error={errors.parentId}>
            <Select
              value={form.parentId ? String(form.parentId) : 'none'}
              onValueChange={(v) => set('parentId', v === 'none' ? null : Number(v))}
              options={[
                { value: 'none', label: t('categories.noParent') },
                ...parents.map((c) => ({ value: String(c.id), label: c.name })),
              ]}
            />
          </Field>
        )}

        <fieldset className="flex flex-col gap-3 rounded-card border border-border p-4">
          <legend className="px-1 text-sm font-semibold">{t('categories.schedule')}</legend>
          <p className="-mt-1 text-xs text-foreground-muted">{t('categories.scheduleHint')}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('categories.from')} error={errors.availableFrom}>
              <Input
                type="time"
                value={form.availableFrom}
                onChange={(e) => set('availableFrom', e.target.value)}
              />
            </Field>
            <Field label={t('categories.to')} error={errors.availableTo}>
              <Input
                type="time"
                value={form.availableTo}
                onChange={(e) => set('availableTo', e.target.value)}
              />
            </Field>
          </div>
          <WeekdayPicker
            label={t('categories.days')}
            value={form.weekdayMask}
            onChange={(v) => set('weekdayMask', v)}
          />
        </fieldset>

        <SwitchField
          label={t('categories.active')}
          description={t('categories.activeDescription')}
          checked={form.active}
          onCheckedChange={(v) => set('active', v)}
        />
      </form>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" form="category-form" loading={save.isPending}>
          {tc('actions.save')}
        </Button>
      </DialogFooter>
    </>
  );
}
