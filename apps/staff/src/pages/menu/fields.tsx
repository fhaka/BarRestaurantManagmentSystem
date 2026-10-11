import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { UtensilsCrossed } from 'lucide-react';
import type { CategoryIcon, Lang, Translations } from '@tavolina/shared';
import { Input, cn } from '@tavolina/ui';
import {
  CATEGORY_ICON_COMPONENTS,
  minorToInput,
  parseLekInput,
  useWeekdayNames,
} from './menu-utils';

export function CategoryIconView({
  icon,
  className,
}: {
  icon: CategoryIcon | null;
  className?: string;
}) {
  const Icon = icon ? CATEGORY_ICON_COMPONENTS[icon] : UtensilsCrossed;
  return <Icon className={className} aria-hidden />;
}

// ---- Money -------------------------------------------------------------------------------------

/**
 * Lek amount input with a currency suffix. Reports minor units, or NaN when the text is not a
 * number (so validation can say so); the text is tidied on blur.
 */
export function MoneyInput({
  value,
  onChange,
  allowNegative = false,
  className,
  ...props
}: {
  value: number | null;
  onChange: (minor: number | null) => void;
  allowNegative?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
}) {
  const [text, setText] = useState(() => minorToInput(value));
  return (
    <div className="relative">
      <Input
        inputMode="decimal"
        className={cn('pr-10 font-mono tabular-nums', className)}
        value={text}
        onBlur={() => {
          if (value !== null && !Number.isNaN(value)) setText(minorToInput(value));
        }}
        onChange={(e) => {
          const next = allowNegative ? e.target.value : e.target.value.replace('-', '');
          setText(next);
          onChange(parseLekInput(next));
        }}
        {...props}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-foreground-subtle">
        L
      </span>
    </div>
  );
}

// ---- Translations ------------------------------------------------------------------------------

const LANG_FLAGS: Record<Lang, string> = { sq: 'SQ', en: 'EN', it: 'IT' };

/** Name (and optionally description) inputs for each non-main language. */
export function TranslationFields({
  langs,
  value,
  onChange,
  withDescription = false,
  placeholders,
}: {
  langs: Lang[];
  value: Translations;
  onChange: (next: Translations) => void;
  withDescription?: boolean;
  placeholders?: { name?: string; description?: string };
}) {
  const { t } = useTranslation('menu');
  const { t: tc } = useTranslation();
  const set = (lang: Lang, field: 'name' | 'description', text: string) =>
    onChange({ ...value, [lang]: { ...value[lang], [field]: text } });

  return (
    <div className="flex flex-col gap-4">
      {langs.map((lang) => (
        <fieldset key={lang} className="flex flex-col gap-2">
          <legend className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
            <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-foreground-muted">
              {LANG_FLAGS[lang]}
            </span>
            {tc(`language.${lang}`)}
          </legend>
          <Input
            aria-label={t('translations.name', { lang: tc(`language.${lang}`) })}
            placeholder={placeholders?.name}
            value={value[lang]?.name ?? ''}
            onChange={(e) => set(lang, 'name', e.target.value)}
          />
          {withDescription ? (
            <textarea
              aria-label={t('translations.description', { lang: tc(`language.${lang}`) })}
              placeholder={placeholders?.description}
              rows={2}
              className="w-full rounded-control border border-border-strong bg-surface px-3 py-2.5 text-sm placeholder:text-foreground-subtle focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              value={value[lang]?.description ?? ''}
              onChange={(e) => set(lang, 'description', e.target.value)}
            />
          ) : null}
        </fieldset>
      ))}
      <p className="text-xs text-foreground-muted">{t('translations.hint')}</p>
    </div>
  );
}

// ---- Weekdays & chips --------------------------------------------------------------------------

export function WeekdayPicker({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (mask: number) => void;
  label: string;
}) {
  const names = useWeekdayNames();
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {names.map((name, day) => {
        const on = (value & (1 << day)) !== 0;
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(value ^ (1 << day))}
            className={cn(
              'h-10 min-w-12 rounded-control border px-2 text-sm font-semibold capitalize transition-colors',
              on
                ? 'border-primary bg-primary-soft text-primary-soft-fg'
                : 'border-border-strong text-foreground-muted hover:bg-surface-sunken',
            )}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}

export function ChipToggle({
  pressed,
  onToggle,
  children,
  icon,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        'inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors [&_svg]:size-4',
        pressed
          ? 'border-primary bg-primary-soft text-primary-soft-fg'
          : 'border-border-strong text-foreground-muted hover:bg-surface-sunken hover:text-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-bold uppercase tracking-wider text-foreground-muted">
        {children}
      </h3>
      {hint ? <p className="text-sm text-foreground-muted">{hint}</p> : null}
    </div>
  );
}
