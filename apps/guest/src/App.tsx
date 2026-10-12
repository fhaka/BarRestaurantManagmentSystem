import { useTranslation } from 'react-i18next';
import { BookOpen, QrCode, Smartphone } from 'lucide-react';
import { useTheme } from '@tavolina/ui';
import { LanguageSwitch } from './components/LanguageSwitch';
import { TablePage } from './pages/TablePage';

/** The QR code points to /t/<tableToken>; anything else shows how to start. */
const TABLE_PATH = /^\/t\/([A-Za-z0-9_-]{10,64})\/?$/;

export function App() {
  // Guest app always follows the system theme.
  useTheme({ initial: 'system', persist: false });
  const match = TABLE_PATH.exec(window.location.pathname);
  return match ? <TablePage tableToken={match[1]!} /> : <Welcome />;
}

function Welcome() {
  const { t } = useTranslation();

  const steps = [
    { key: 'scan', icon: QrCode },
    { key: 'browse', icon: BookOpen },
    { key: 'order', icon: Smartphone },
  ] as const;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6">
      <header className="flex items-center justify-between">
        <span className="text-lg font-extrabold tracking-tight">{t('appName')}</span>
        <LanguageSwitch />
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
