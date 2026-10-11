import { useTranslation } from 'react-i18next';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn, useTheme, type ThemePreference } from '@tavolina/ui';

const options: { value: ThemePreference; icon: typeof Sun }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

/** Segmented light / dark / system control. */
export function ThemeSwitch() {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label={t('theme.label')}
      className="flex h-10 items-center gap-0.5 rounded-control border border-border-strong bg-surface p-0.5"
    >
      {options.map(({ value, icon: Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={t(`theme.${value}`)}
            title={t(`theme.${value}`)}
            onClick={() => setPreference(value)}
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-[7px] transition-colors',
              active
                ? 'bg-primary-soft text-primary-soft-fg'
                : 'text-foreground-muted hover:bg-surface-sunken hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
