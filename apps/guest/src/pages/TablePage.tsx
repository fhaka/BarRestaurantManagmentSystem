import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BellRing,
  CreditCard,
  Banknote,
  ListChecks,
  Receipt,
  Search,
  ShieldAlert,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  WifiOff,
  X,
} from 'lucide-react';
import { ALLERGENS, formatMoney } from '@tavolina/shared/client';
import type {
  Allergen,
  GuestCombo,
  GuestMenu,
  GuestMenuCategory,
  GuestMenuItem,
  GuestTableInfo,
  GuestTableState,
  ServiceRequestType,
} from '@tavolina/shared';
import {
  Button,
  EmptyState,
  Input,
  Sheet,
  SheetContent,
  SheetTitle,
  Skeleton,
  Toaster,
  cn,
  toast,
} from '@tavolina/ui';
import { AfterPayment } from '../components/AfterPayment';
import { CartSheet } from '../components/CartSheet';
import { Chip, ItemSheet, type Subject } from '../components/ItemSheet';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { StatusSheet } from '../components/StatusSheet';
import { TagBadges } from '../components/Allergens';
import { guestApi, GuestApiError } from '../lib/api';
import { describe, toOrderItem, useCart, type GuestCartLine } from '../lib/cart';
import { useTableUpdates } from '../lib/realtime';

function useErrorText() {
  const { t } = useTranslation();
  return (err: unknown) =>
    err instanceof GuestApiError
      ? t(`errors.${err.code}`, { ...err.details, defaultValue: t('errors.generic') })
      : t('errors.generic');
}

export function TablePage({ tableToken }: { tableToken: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const info = useQuery({
    queryKey: ['info', tableToken],
    queryFn: () => guestApi<GuestTableInfo>('GET', `/t/${tableToken}`),
    retry: (count, err) => !(err instanceof GuestApiError && err.status === 404) && count < 3,
  });
  const menu = useQuery({
    queryKey: ['menu', tableToken, lang],
    queryFn: () => guestApi<GuestMenu>('GET', `/t/${tableToken}/menu?lang=${lang}`),
    enabled: info.isSuccess,
    staleTime: 60_000,
  });
  const state = useQuery({
    queryKey: ['state', tableToken],
    queryFn: () => guestApi<GuestTableState>('GET', `/t/${tableToken}/state`),
    enabled: info.isSuccess,
    // Live updates arrive over the socket; polling is the safety net.
    refetchInterval: 20_000,
  });
  const online = useTableUpdates(tableToken);

  if (info.error instanceof GuestApiError && info.error.status === 404) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center px-5">
        <EmptyState
          icon={<ShieldAlert />}
          title={t('invalid.title')}
          description={t('invalid.body')}
        />
      </div>
    );
  }
  if (!info.data || !menu.data) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-5" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-11" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  return (
    <Menu
      tableToken={tableToken}
      info={info.data}
      menu={menu.data}
      state={state.data ?? null}
      online={online}
    />
  );
}

function Menu({
  tableToken,
  info,
  menu,
  state,
  online,
}: {
  tableToken: string;
  info: GuestTableInfo;
  menu: GuestMenu;
  state: GuestTableState | null;
  online: boolean;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const currency = menu.location.currencyDisplay;
  const cart = useCart(tableToken);
  const [subject, setSubject] = useState<{
    subject: Subject;
    initial: GuestCartLine | null;
    canOrder: boolean;
  } | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [avoid, setAvoid] = useState<Allergen[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(
    menu.categories[0]?.id ?? null,
  );
  const sections = useRef(new Map<number, HTMLElement>());
  const chips = useRef(new Map<number, HTMLButtonElement>());

  const blocked = state?.blocked ?? false;
  const canOrder = info.orderingEnabled && !blocked;
  const setState = (next: GuestTableState) => queryClient.setQueryData(['state', tableToken], next);

  const order = useMutation({
    mutationFn: () =>
      guestApi<GuestTableState>('POST', `/t/${tableToken}/orders`, {
        items: cart.lines.map(toOrderItem),
      }),
    onSuccess: (next) => {
      setState(next);
      cart.clear();
      setCartOpen(false);
      setStatusOpen(true);
      toast({
        tone: 'success',
        title: info.requiresConfirmation ? t('ordered.waiting') : t('ordered.sent'),
      });
    },
    onError: (err) => toast({ tone: 'danger', title: errorText(err) }),
  });
  const request = useMutation({
    mutationFn: (type: ServiceRequestType) =>
      guestApi<GuestTableState>('POST', `/t/${tableToken}/requests`, { type }),
    onSuccess: (next, type) => {
      setState(next);
      setBillOpen(false);
      toast({
        tone: 'success',
        title: type === 'call_waiter' ? t('requests.called') : t('requests.billAsked'),
      });
    },
    onError: (err) => toast({ tone: 'danger', title: errorText(err) }),
  });

  // Highlight the category on screen in the sticky bar (scroll spy).
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0])
          setActiveCategory(Number((visible[0].target as HTMLElement).dataset.category));
      },
      { rootMargin: '-120px 0px -60% 0px' },
    );
    for (const el of sections.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [menu, query, avoid]);
  useEffect(() => {
    if (activeCategory !== null)
      chips.current.get(activeCategory)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [activeCategory]);

  const needle = query.trim().toLocaleLowerCase();
  const visibleItem = (item: GuestMenuItem) =>
    (!needle ||
      item.name.toLocaleLowerCase().includes(needle) ||
      item.description.toLocaleLowerCase().includes(needle)) &&
    !item.allergens.some((a) => avoid.includes(a));
  const categories = useMemo(
    () =>
      menu.categories
        .map((c) => ({
          ...c,
          items: c.items.filter(visibleItem),
          combos: needle
            ? c.combos.filter((x) => x.name.toLocaleLowerCase().includes(needle))
            : c.combos,
        }))
        .filter((c) => c.items.length || c.combos.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menu, needle, avoid],
  );
  const popular = useMemo(
    () =>
      needle || avoid.length
        ? []
        : menu.categories.flatMap((c) => c.items.filter((i) => i.isPopular && c.availableNow)),
    [menu, needle, avoid],
  );

  const cartCount = cart.lines.reduce((n, l) => n + l.qty, 0);
  const cartTotal = cart.lines.reduce((sum, l) => sum + describe(menu, l).totalMinor, 0);
  const activeLines =
    state?.lines.filter((l) => l.parentItemId === null && l.status !== 'voided') ?? [];
  const readyCount = activeLines.filter((l) => l.status === 'ready').length;
  const requested = (type: ServiceRequestType) =>
    state?.openRequests.some((r) => r.type === type) ?? false;
  const billRequested = requested('bill_cash') || requested('bill_card');

  const open = (s: Subject, category: GuestMenuCategory) =>
    setSubject({ subject: s, initial: null, canOrder: canOrder && category.availableNow });

  const itemRow = (item: GuestMenuItem, category: GuestMenuCategory) => (
    <li key={item.id}>
      <button
        type="button"
        onClick={() => open({ kind: 'item', item }, category)}
        className="flex w-full gap-3 rounded-card border border-border bg-surface p-3 text-left shadow-raised transition-transform active:scale-[0.99]"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold leading-snug">{item.name}</span>
            {item.isNew ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-highlight-soft px-2 py-0.5 text-xs font-semibold text-highlight-soft-fg">
                <Sparkles className="size-3" aria-hidden />
                {t('menu.new')}
              </span>
            ) : null}
          </span>
          {item.description ? (
            <span className="line-clamp-2 text-sm text-foreground-muted">{item.description}</span>
          ) : null}
          {item.tags.length ? (
            <span className="flex flex-wrap gap-1">
              <TagBadges tags={item.tags} />
            </span>
          ) : null}
          <span className="mt-auto flex items-baseline gap-2 pt-1 font-mono tabular-nums">
            {item.regularPriceMinor !== null ? (
              <s className="text-sm text-foreground-subtle">
                {formatMoney(item.regularPriceMinor, { currency })}
              </s>
            ) : null}
            <span
              className={cn('font-semibold', item.regularPriceMinor !== null && 'text-success')}
            >
              {item.variants.length > 1
                ? t('menu.from', { price: formatMoney(item.priceMinor, { currency }) })
                : formatMoney(item.priceMinor, { currency })}
            </span>
          </span>
        </span>
        {item.thumbUrl ? (
          <img
            src={item.thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            width={96}
            height={96}
            className="size-24 shrink-0 rounded-control object-cover"
          />
        ) : null}
      </button>
    </li>
  );

  const comboRow = (combo: GuestCombo, category: GuestMenuCategory) => (
    <li key={`c${combo.id}`}>
      <button
        type="button"
        onClick={() => open({ kind: 'combo', combo }, category)}
        className="flex w-full flex-col gap-1 rounded-card border-2 border-highlight bg-highlight-soft p-4 text-left text-highlight-soft-fg"
      >
        <span className="text-lg font-extrabold">{combo.name}</span>
        {combo.description ? <span className="text-sm">{combo.description}</span> : null}
        <span className="text-sm">{combo.slots.map((s) => s.name).join(' + ')}</span>
        <span className="font-mono font-bold tabular-nums">
          {formatMoney(combo.priceMinor, { currency })}
        </span>
      </button>
    </li>
  );

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-40">
      <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground-muted">{info.location.name}</p>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {t('table', { name: info.table.name })}
          </h1>
        </div>
        <LanguageSwitch />
      </header>

      {!online ? (
        <p
          role="status"
          className="mx-4 mb-2 flex items-center gap-2 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-soft-fg"
        >
          <WifiOff className="size-4" aria-hidden />
          {t('offline')}
        </p>
      ) : null}
      {blocked ? (
        <p
          role="alert"
          className="mx-4 mb-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-soft-fg"
        >
          {t('blocked')}
        </p>
      ) : !info.orderingEnabled ? (
        <p className="mx-4 mb-2 rounded-control bg-info-soft px-3 py-2 text-sm text-info-soft-fg">
          {t('browseOnly')}
        </p>
      ) : null}

      {state ? <AfterPayment tableToken={tableToken} state={state} currency={currency} /> : null}

      {/* Waiter and bill: always one tap away. */}
      <div className="grid grid-cols-2 gap-2 px-4 pb-3">
        <Button
          variant="outline"
          size="lg"
          disabled={requested('call_waiter') || blocked}
          loading={request.isPending && request.variables === 'call_waiter'}
          onClick={() => request.mutate('call_waiter')}
        >
          <BellRing />
          {requested('call_waiter') ? t('requests.coming') : t('requests.call')}
        </Button>
        <Button
          variant="outline"
          size="lg"
          disabled={billRequested || blocked || !state?.session}
          onClick={() => setBillOpen(true)}
        >
          <Receipt />
          {billRequested ? t('requests.billComing') : t('requests.bill')}
        </Button>
      </div>

      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="flex gap-2 px-4 pt-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
              aria-hidden
            />
            <Input
              type="search"
              aria-label={t('menu.search')}
              placeholder={t('menu.search')}
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button
            variant={avoid.length ? 'secondary' : 'outline'}
            size="icon"
            aria-label={t('filter.title')}
            onClick={() => setFilterOpen(true)}
          >
            <SlidersHorizontal />
          </Button>
        </div>
        <nav aria-label={t('menu.categories')} className="flex gap-2 overflow-x-auto px-4 py-2">
          {categories.map((c) => (
            <button
              key={c.id}
              ref={(el) => {
                if (el) chips.current.set(c.id, el);
                else chips.current.delete(c.id);
              }}
              type="button"
              onClick={() =>
                sections.current.get(c.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
              className={cn(
                'h-10 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors',
                activeCategory === c.id
                  ? 'bg-primary text-primary-fg'
                  : 'bg-surface-sunken text-foreground',
              )}
            >
              {c.name}
            </button>
          ))}
        </nav>
      </div>

      <main className="flex flex-col gap-8 px-4 pt-4">
        {popular.length ? (
          <section aria-labelledby="popular">
            <h2 id="popular" className="mb-3 flex items-center gap-2 text-xl font-extrabold">
              <Star className="size-5 text-highlight" aria-hidden />
              {t('menu.popular')}
            </h2>
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {popular.map((item) => {
                const category = menu.categories.find((c) => c.items.includes(item))!;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => open({ kind: 'item', item }, category)}
                    className="flex w-40 shrink-0 flex-col overflow-hidden rounded-card border border-border bg-surface text-left shadow-raised"
                  >
                    {item.thumbUrl ? (
                      <img
                        src={item.thumbUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="aspect-square w-full object-cover"
                      />
                    ) : (
                      <span className="flex aspect-square w-full items-center justify-center bg-primary-soft text-primary-soft-fg">
                        <Star className="size-8" aria-hidden />
                      </span>
                    )}
                    <span className="flex flex-col gap-1 p-2.5">
                      <span className="line-clamp-2 text-sm font-bold">{item.name}</span>
                      <span className="font-mono text-sm tabular-nums">
                        {formatMoney(item.priceMinor, { currency })}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {categories.length === 0 ? (
          <p className="py-10 text-center text-foreground-muted">{t('menu.noMatch')}</p>
        ) : null}
        {categories.map((c) => (
          <section
            key={c.id}
            data-category={c.id}
            ref={(el) => {
              if (el) sections.current.set(c.id, el);
              else sections.current.delete(c.id);
            }}
            aria-labelledby={`cat-${c.id}`}
            className="scroll-mt-32"
          >
            <h2 id={`cat-${c.id}`} className="text-xl font-extrabold">
              {c.name}
            </h2>
            {c.description ? (
              <p className="text-sm text-foreground-muted">{c.description}</p>
            ) : null}
            {!c.availableNow ? (
              <p className="mt-1 text-sm font-semibold text-warning-soft-fg">
                {c.availableFrom
                  ? t('menu.servedBetween', { from: c.availableFrom, to: c.availableTo })
                  : t('menu.notNow')}
              </p>
            ) : null}
            {/* Not served now: images in grey, text kept readable (WCAG contrast); the note above says why. */}
            <ul className={cn('mt-3 flex flex-col gap-3', !c.availableNow && 'grayscale')}>
              {c.combos.map((combo) => comboRow(combo, c))}
              {c.items.map((item) => itemRow(item, c))}
            </ul>
          </section>
        ))}
      </main>

      {/* Bottom bar: the cart, and the order status once something was ordered. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-raised/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl gap-2">
          {activeLines.length ? (
            <Button
              variant={cartCount ? 'outline' : 'primary'}
              size="xl"
              className={cn(cartCount ? 'shrink-0' : 'flex-1')}
              onClick={() => setStatusOpen(true)}
            >
              <ListChecks />
              {cartCount ? null : t('status.button')}
              {readyCount ? (
                <span className="rounded-full bg-success px-2 text-sm text-success-fg">
                  {t('status.ready', { count: readyCount })}
                </span>
              ) : null}
            </Button>
          ) : null}
          {cartCount ? (
            <Button size="xl" className="flex-1" onClick={() => setCartOpen(true)}>
              <ShoppingBag />
              {t('cart.view', { count: cartCount })}
              <span className="ml-auto font-mono tabular-nums">
                {formatMoney(cartTotal, { currency })}
              </span>
            </Button>
          ) : null}
        </div>
      </div>

      <ItemSheet
        menu={menu}
        subject={subject?.subject ?? null}
        initial={subject?.initial ?? null}
        canOrder={subject?.canOrder ?? false}
        onClose={() => setSubject(null)}
        onSave={(line) => {
          cart.save(line);
          setSubject(null);
          toast({
            tone: 'success',
            title: t('cart.added', { name: describe(menu, line).name }),
            duration: 2000,
          });
        }}
      />
      <CartSheet
        open={cartOpen}
        onOpenChange={setCartOpen}
        menu={menu}
        lines={cart.lines}
        requiresConfirmation={info.requiresConfirmation}
        sending={order.isPending}
        onQty={cart.setQty}
        onEdit={(line) => {
          const item = menu.categories.flatMap((c) => c.items).find((i) => i.id === line.itemId);
          const combo = menu.categories.flatMap((c) => c.combos).find((x) => x.id === line.comboId);
          const s: Subject | null = item
            ? { kind: 'item', item }
            : combo
              ? { kind: 'combo', combo }
              : null;
          if (s) {
            setCartOpen(false);
            setSubject({ subject: s, initial: line, canOrder });
          }
        }}
        onOrder={() => order.mutate()}
      />
      {state ? (
        <StatusSheet open={statusOpen} onOpenChange={setStatusOpen} state={state} menu={menu} />
      ) : null}

      <Sheet open={billOpen} onOpenChange={setBillOpen}>
        <SheetContent side="bottom" closeLabel={t('close')}>
          <SheetTitle className="text-2xl font-extrabold">{t('requests.billTitle')}</SheetTitle>
          <p className="text-foreground-muted">{t('requests.billBody')}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button
              size="xl"
              variant="outline"
              className="h-20 flex-col"
              loading={request.isPending}
              onClick={() => request.mutate('bill_cash')}
            >
              <Banknote />
              {t('requests.cash')}
            </Button>
            <Button
              size="xl"
              variant="outline"
              className="h-20 flex-col"
              loading={request.isPending}
              onClick={() => request.mutate('bill_card')}
            >
              <CreditCard />
              {t('requests.card')}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetContent side="bottom" closeLabel={t('close')}>
          <SheetTitle className="text-2xl font-extrabold">{t('filter.title')}</SheetTitle>
          <p className="text-foreground-muted">{t('filter.body')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {ALLERGENS.map((a) => (
              <Chip
                key={a}
                pressed={avoid.includes(a)}
                onToggle={() =>
                  setAvoid(avoid.includes(a) ? avoid.filter((x) => x !== a) : [...avoid, a])
                }
              >
                {avoid.includes(a) ? <X className="size-4" aria-hidden /> : null}
                {t(`allergens.${a}`)}
              </Chip>
            ))}
          </div>
          <p className="mt-4 text-sm text-foreground-muted">{t('filter.disclaimer')}</p>
          <Button className="mt-4" size="lg" block onClick={() => setFilterOpen(false)}>
            {t('filter.done')}
          </Button>
        </SheetContent>
      </Sheet>

      <Toaster closeLabel={t('close')} />
    </div>
  );
}
