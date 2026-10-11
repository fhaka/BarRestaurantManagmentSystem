import { useTranslation } from 'react-i18next';
import { BookOpen, QrCode, Smartphone } from 'lucide-react';
import { LANGS } from '@tavolina/shared';
import { cn, useTheme } from '@tavolina/ui';
import { changeLanguage } from './i18n';

/** Phase 0 placeholder. The real menu lives at /t/:tableToken from Phase 5. */
export function App() {
  const { t, i18n } = useTranslation();
  // Guest app always follows the system theme.
  useTheme({ initial: 'system', persist: false });

  const steps = [
    { key: 'scan', icon: QrCode },
    { key: 'browse', icon: BookOpen },
    { key: 'order', icon: Smartphone },
  ] as const;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6">
      <header className="flex items-center justify-between">
        <span className="text-lg font-extrabold tracking-tight">{t('appName')}</span>
        <div
          role="group"
          aria-label={t('language')}
          className="flex rounded-full border border-border-strong p-0.5"
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
      </header>

      <main className="flex flex-1 flex-col justify-center gap-8 py-10">
        <div className="flex flex-col gap-3">
          <h1 className="text-4xl font-extrabold tracking-tight">{t('welcome.title')}</h1>
          <p className="text-lg text-foreground-muted">{t('welcome.body')}</p>
        </div>
        <ol className="flex flex-col gap-3">
          {steps.map(({ key, icon: Icon }, i) => (
            <li
              key={key}
              className="flex items-center gap-4 rounded-card border border-border bg-surface p-4 shadow-raised"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="font-semibold">
                <span className="mr-1.5 tabular-nums text-foreground-subtle">{i + 1}.</span>
                {t(`welcome.steps.${key}`)}
              </span>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
