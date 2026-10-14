import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu } from 'lucide-react';
import { Button, Sheet, SheetContent, SheetTitle, Toaster, cn } from '@tavolina/ui';
import { useRealtime } from '../lib/realtime';
import { useSession } from '../lib/session';
import { NAV_ITEMS, visibleNav } from '../nav';
import { LanguageSelect } from './LanguageSelect';
import { LocationSwitcher } from './LocationSwitcher';
import { Logo } from './Logo';
import { OfflineBanner } from './OfflineBanner';
import { ThemeSwitch } from './ThemeSwitch';
import { UserMenu } from './UserMenu';

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation('app');
  const { t: tc } = useTranslation();
  const can = useSession((s) => s.can);
  // Re-render when permissions change (location switch).
  useSession((s) => s.permissions);
  const groups = visibleNav(can);

  return (
    <div className="flex h-full flex-col gap-5">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-2 pt-1">
        <Logo className="size-8" />
        <span className="text-lg font-extrabold tracking-tight">{tc('appName')}</span>
      </Link>

      <LocationSwitcher />

      <nav
        aria-label={tc('appName')}
        className="-mx-1 flex flex-1 flex-col gap-5 overflow-y-auto px-1"
      >
        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground-subtle">
              {t(`nav.groups.${group.key}`)}
            </p>
            {group.items.map((item) => (
              <NavLink
                key={item.key}
                to={item.path}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-semibold transition-colors',
                    isActive
                      ? 'bg-primary-soft text-primary-soft-fg'
                      : 'text-foreground-muted hover:bg-surface-sunken hover:text-foreground',
                  )
                }
              >
                <item.icon className="size-[18px] shrink-0" aria-hidden />
                {t(`nav.${item.key}`)}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2 px-1">
          <LanguageSelect />
          <ThemeSwitch />
        </div>
        <UserMenu />
      </div>
    </div>
  );
}

/** Signed-in shell: sidebar on desktop, top bar + slide-out menu on phones and tablets. */
export function AppLayout() {
  const { t } = useTranslation('app');
  const { t: tc } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  useRealtime();
  const current = NAV_ITEMS.find((i) => pathname.startsWith(i.path));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_1fr] print:block">
      <aside className="sticky top-0 hidden h-dvh border-r border-border bg-surface px-4 py-5 lg:block print:hidden">
        <SidebarContent />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-2 backdrop-blur-sm lg:hidden print:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('nav.openMenu')}
              onClick={() => setMenuOpen(true)}
            >
              <Menu />
            </Button>
            <SheetContent side="left" closeLabel={tc('actions.close')} className="p-4">
              <SheetTitle className="sr-only">{t('nav.openMenu')}</SheetTitle>
              <SidebarContent onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="min-w-0 flex-1 truncate font-bold">
            {current ? t(`nav.${current.key}`) : tc('appName')}
          </span>
          <UserMenu compact />
        </header>

        <main className="flex-1">
          <OfflineBanner />
          <Outlet />
        </main>
      </div>
      <Toaster closeLabel={tc('actions.close')} />
    </div>
  );
}

/** Consistent page header: title, subtitle and actions on the right. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="text-foreground-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}
