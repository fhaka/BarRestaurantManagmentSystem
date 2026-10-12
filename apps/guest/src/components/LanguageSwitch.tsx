import { useTranslation } from 'react-i18next';
import { LANGS } from '@tavolina/shared/client';
import { cn } from '@tavolina/ui';
import { changeLanguage } from '../i18n';

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t('language')}
      className="flex shrink-0 rounded-full border border-border-strong p-0.5"
    >
      {LANGS.map((lang) => (
        <button
          key={lang}
          type="button"
          aria-pressed={i18n.language === lang}
          onClick={() => void changeLanguage(lang)}
          className={cn(
            'h-9 min-w-11 rounded-full px-3 text-sm font-semibold uppercase transition-colors',
            i18n.language === lang
              ? 'bg-primary text-primary-fg'
              : 'text-foreground-muted hover:text-foreground',
          )}
        >
          {lang}
        </button>
      ))}
    </div>
  );
}
