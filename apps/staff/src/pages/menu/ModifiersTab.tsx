import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPlus, Plus, Trash2 } from 'lucide-react';
import {
  formatMoney,
  modifierGroupInputSchema,
  type AdminMenu,
  type MenuModifierGroup,
  type Translations,
} from '@tavolina/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Switch,
  SwitchField,
} from '@tavolina/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { MoneyInput, SectionTitle, TranslationFields } from './fields';
import { useMenuLanguages, useMenuMutation } from './useMenu';

export function ModifiersTab({ menu }: { menu: AdminMenu }) {
  const { t } = useTranslation('menu');
  const [sheet, setSheet] = useState<{ open: boolean; group: MenuModifierGroup | null }>({
    open: false,
    group: null,
  });
  const usage = (id: number) => menu.items.filter((i) => i.modifierGroupIds.includes(id)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setSheet({ open: true, group: null })}>
          <Plus />
          {t('modifiers.add')}
        </Button>
      </div>
      {menu.modifierGroups.length === 0 ? (
        <EmptyState
          icon={<ListPlus />}
          title={t('modifiers.emptyTitle')}
          description={t('modifiers.empty')}
          action={
            <Button onClick={() => setSheet({ open: true, group: null })}>
              <Plus />
              {t('modifiers.add')}
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {menu.modifierGroups.map((g) => (
            <li key={g.id}>
              <Card className="flex h-full flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold tracking-tight">{g.name}</h3>
                    <p className="text-xs text-foreground-muted">
                      {t('modifiers.rule', { min: g.minSelect, max: g.maxSelect })} ·{' '}
                      {t('modifiers.usedBy', { count: usage(g.id) })}
                    </p>
                  </div>
                  {g.required ? (
                    <Badge tone="warning" size="sm">
                      {t('modifiers.required')}
                    </Badge>
                  ) : null}
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {g.modifiers.map((m) => (
                    <li key={m.id}>
                      <Badge tone={m.active ? 'neutral' : 'danger'}>
                        {m.name}
                        {m.priceDeltaMinor ? (
                          <span className="font-mono tabular-nums">
                            {m.priceDeltaMinor > 0 ? '+' : ''}
                            {formatMoney(m.priceDeltaMinor)}
                          </span>
                        ) : null}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-auto self-start"
                  onClick={() => setSheet({ open: true, group: g })}
                >
                  {t('common.edit')}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ModifierGroupSheet
        open={sheet.open}
        group={sheet.group}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
      />
    </div>
  );
}

interface OptionRow {
  key: string;
  id?: number;
  name: string;
  priceDeltaMinor: number | null;
  active: boolean;
  translations: Translations;
}
let key = 0;

function ModifierGroupSheet({
  open,
  group,
  onOpenChange,
}: {
  open: boolean;
  group: MenuModifierGroup | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t: tc } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" closeLabel={tc('actions.close')} className="w-[min(100vw,36rem)]">
        <GroupForm key={group?.id ?? 'new'} group={group} onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

function GroupForm({ group, onClose }: { group: MenuModifierGroup | null; onClose: () => void }) {
  const { t } = useTranslation('menu');
  const { t: tc } = useTranslation();
  const { validate } = useErrorMessages();
  const { others } = useMenuLanguages();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({
    name: group?.name ?? '',
    minSelect: String(group?.minSelect ?? 0),
    maxSelect: String(group?.maxSelect ?? 1),
    required: group?.required ?? false,
    translations: group?.translations ?? ({} as Translations),
    modifiers: (
      group?.modifiers ?? [{ name: '', priceDeltaMinor: 0, active: true, translations: {} }]
    ).map((m) => ({ ...m, key: `opt-${++key}` })) as OptionRow[],
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setOption = (rowKey: string, patch: Partial<OptionRow>) =>
    set(
      'modifiers',
      form.modifiers.map((m) => (m.key === rowKey ? { ...m, ...patch } : m)),
    );

  const save = useMenuMutation(
    (body: unknown) =>
      group
        ? api('PATCH', `/menu/modifier-groups/${group.id}`, { body })
        : api('POST', '/menu/modifier-groups', { body }),
    { success: t('modifiers.saved'), onSuccess: onClose, onFieldErrors: setErrors },
  );
  const remove = useMenuMutation(() => api('DELETE', `/menu/modifier-groups/${group!.id}`), {
    success: t('modifiers.deleted'),
    onSuccess: onClose,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = {
      name: form.name,
      minSelect: Number(form.minSelect || 0),
      maxSelect: Number(form.maxSelect || 0),
      // "Required" means at least one choice.
      required: form.required,
      translations: form.translations,
      modifiers: form.modifiers.map(({ id, name, priceDeltaMinor, active, translations }) => ({
        ...(id ? { id } : {}),
        name,
        priceDeltaMinor: priceDeltaMinor ?? 0,
        active,
        translations,
      })),
    };
    if (body.required && body.minSelect === 0) body.minSelect = 1;
    const result = validate(modifierGroupInputSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(body);
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="text-xl font-bold tracking-tight">
          {group ? t('modifiers.editTitle', { name: group.name }) : t('modifiers.createTitle')}
        </SheetTitle>
      </SheetHeader>
      <form id="group-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-6 pb-4">
        <Field label={t('modifiers.name')} error={errors.name}>
          <Input
            value={form.name}
            placeholder={t('modifiers.namePlaceholder')}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        <TranslationFields
          langs={others}
          value={form.translations}
          onChange={(v) => set('translations', v)}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('modifiers.min')} error={errors.minSelect}>
            <Input
              inputMode="numeric"
              value={form.minSelect}
              onChange={(e) => set('minSelect', e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label={t('modifiers.max')} error={errors.maxSelect}>
            <Input
              inputMode="numeric"
              value={form.maxSelect}
              onChange={(e) => set('maxSelect', e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </div>
        <SwitchField
          label={t('modifiers.required')}
          description={t('modifiers.requiredDescription')}
          checked={form.required}
          onCheckedChange={(v) => set('required', v)}
        />

        <section className="flex flex-col gap-3">
          <SectionTitle>{t('modifiers.options')}</SectionTitle>
          {errors.modifiers ? <p className="text-sm text-danger">{errors.modifiers}</p> : null}
          {form.modifiers.map((m, index) => (
            <div key={m.key} className="flex flex-col gap-2 rounded-card border border-border p-3">
              <div className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_130px]">
                  <Field
                    label={t('modifiers.optionName')}
                    error={errors[`modifiers.${index}.name`]}
                  >
                    <Input
                      value={m.name}
                      onChange={(e) => setOption(m.key, { name: e.target.value })}
                    />
                  </Field>
                  <Field
                    label={t('modifiers.priceDelta')}
                    error={errors[`modifiers.${index}.priceDeltaMinor`]}
                  >
                    <MoneyInput
                      allowNegative
                      value={m.priceDeltaMinor}
                      onChange={(v) => setOption(m.key, { priceDeltaMinor: v })}
                    />
                  </Field>
                </div>
                <div className="mt-7 flex items-center gap-1">
                  <Switch
                    checked={m.active}
                    onCheckedChange={(v) => setOption(m.key, { active: v })}
                    aria-label={t('setup.active')}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('modifiers.removeOption')}
                    disabled={form.modifiers.length === 1}
                    onClick={() =>
                      set(
                        'modifiers',
                        form.modifiers.filter((x) => x.key !== m.key),
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {others.map((lang) => (
                  <Input
                    key={lang}
                    aria-label={t('translations.name', { lang: tc(`language.${lang}`) })}
                    placeholder={tc(`language.${lang}`)}
                    value={m.translations[lang]?.name ?? ''}
                    onChange={(e) =>
                      setOption(m.key, {
                        translations: { ...m.translations, [lang]: { name: e.target.value } },
                      })
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
              set('modifiers', [
                ...form.modifiers,
                {
                  key: `opt-${++key}`,
                  name: '',
                  priceDeltaMinor: 0,
                  active: true,
                  translations: {},
                },
              ])
            }
          >
            <Plus />
            {t('modifiers.addOption')}
          </Button>
        </section>
      </form>
      <div className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-surface-raised py-4">
        {group ? (
          <Button
            type="button"
            variant="ghost"
            className="text-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 />
            {t('modifiers.delete')}
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {tc('actions.cancel')}
          </Button>
          <Button type="submit" form="group-form" loading={save.isPending}>
            {t('modifiers.save')}
          </Button>
        </div>
      </div>
      {group ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('modifiers.deleteConfirm', { name: group.name })}
          description={t('modifiers.deleteDescription')}
          confirmLabel={t('modifiers.delete')}
          loading={remove.isPending}
          onConfirm={() => remove.mutate(undefined)}
        />
      ) : null}
    </>
  );
}
