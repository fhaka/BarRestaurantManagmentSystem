import { Link, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Toaster } from '@tavolina/ui';
import { Logo } from './Logo';
import { LanguageSelect } from './LanguageSelect';
import { ThemeSwitch } from './ThemeSwitch';

export function AppShell() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-control font-bold tracking-tight"
          >
            <Logo className="size-8" />
            <span className="text-lg">{t('appName')}</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSelect />
            <ThemeSwitch />
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <Toaster closeLabel={t('actions.close')} />
    </div>
  );
}
