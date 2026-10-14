import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Search, ShoppingBasket, Star, UtensilsCrossed, X } from 'lucide-react';
import {
  formatMoney,
  type AdminMenu,
  type MenuCombo,
  type MenuItem,
  type Order,
} from '@tavolina/shared';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Sheet,
  SheetContent,
  SheetTitle,
  Skeleton,
  cn,
  toast,
} from '@tavolina/ui';
import { useErrorMessages } from '../../lib/errors';
import { sendOrQueue } from '../../lib/outbox';
import { useSession } from '../../lib/session';
import { useFloorQuery, useNow } from '../floor/floor-utils';
import { CATEGORY_ICON_COMPONENTS } from '../menu/menu-utils';
import { useMenuQuery } from '../menu/useMenu';
import { ItemOptionsSheet, type OptionsSubject } from './ItemOptionsSheet';
import { OrderPanel } from './OrderPanel';
import {
  describeLine,
  isOutOfStock,
  itemPrice,
  needsOptions,
  sameChoice,
  targetKey,
  toRequestItem,
  useCarts,
  useCurrentLocation,
  useOrderQuery,
  type CartLine,
  type OrderTarget,
} from './order-utils';

const FAVOURITES = -1;
const EMPTY: CartLine[] = [];

/** Waiter order screen for a table (`/floor/sessions/:sessionId`) or a takeaway order (`/orders/:orderRef`). */
export function OrderPage() {
  const params = useParams();
  const target: OrderTarget = params.sessionId
    ? { kind: 'session', sessionId: Number(params.sessionId) }
    : { kind: 'order', orderRef: params.orderRef! };
  return <OrderScreen key={targetKey(target)} target={target} />;
}

function OrderScreen({ target }: { target: OrderTarget }) {
  const { t } = useTranslation('orders');
  const { message } = useErrorMessages();
  const queryClient = useQueryClient();
  const locationId = useSession((s) => s.locationId);
  const menuQuery = useMenuQuery();
  const orderQuery = useOrderQuery(target);
  const floor = useFloorQuery();
  const location = useCurrentLocation();
  const timeZone = location.data?.timezone ?? 'Europe/Tirane';
  const key = targetKey(target);
  const cart = useCarts((s) => s.carts[key] ?? EMPTY);
  const setCart = useCarts((s) => s.set);
  const [options, setOptions] = useState<{
    subject: OptionsSubject;
    initial: CartLine | null;
  } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const session =
    target.kind === 'session'
      ? (floor.data?.tables.find((x) => x.session?.id === target.sessionId)?.session ?? null)
      : null;
  const order = orderQuery.data ?? null;
  const tableNames =
    target.kind === 'session' && session && floor.data
      ? session.tableIds.map((id) => floor.data.tables.find((x) => x.id === id)?.name ?? '')
      : (order?.tableNames ?? []);
  const sessionClosed = target.kind === 'session' && floor.data !== undefined && !session;
  const orderClosed = order !== null && order.status !== 'open';
  const readOnly = sessionClosed || orderClosed || (session !== null && !session.mine);

  const title =
    target.kind === 'session'
      ? t('screen.table', { names: tableNames.join(' + ') || '…' })
      : order
        ? t('screen.order', {
            number: order.number,
            name: order.customerName ?? t(`types.${order.type}`),
          })
        : '…';

  const setOrder = (next: Order) => queryClient.setQueryData(['order', locationId, key], next);

  const addLine = (line: CartLine) => {
    const existing = cart.find((l) => l.uuid === line.uuid);
    if (existing)
      return setCart(
        key,
        cart.map((l) => (l.uuid === line.uuid ? line : l)),
      );
    const same = cart.find((l) => sameChoice(l, line));
    if (same)
      return setCart(
        key,
        cart.map((l) => (l === same ? { ...l, qty: Math.min(99, l.qty + line.qty) } : l)),
      );
    setCart(key, [...cart, line]);
  };

  const tapItem = (item: MenuItem) => {
    if (!menuQuery.data || readOnly) return;
    if (needsOptions(menuQuery.data, item))
      return setOptions({ subject: { kind: 'item', item }, initial: null });
    addLine({
      uuid: crypto.randomUUID(),
      menuItemId: item.id,
      variantId: null,
      modifierIds: [],
      comboSelections: [],
      qty: 1,
      seat: null,
      course: null,
      notes: null,
    });
  };

  const send = async () => {
    if (!cart.length || sending || !menuQuery.data) return;
    const lines = cart;
    const path =
      target.kind === 'session'
        ? `/table-sessions/${target.sessionId}/items`
        : `/orders/${target.orderRef}/items`;
    setSending(true);
    try {
      const result = await sendOrQueue<Order>(
        'POST',
        path,
        { items: lines.map(toRequestItem), send: true },
        {
          kind: 'order.items',
          ...(target.kind === 'session' ? { sessionId: target.sessionId } : { orderId: order?.id }),
          label: title,
          lines: lines.map((l) => {
            const view = describeLine(menuQuery.data!, l, timeZone);
            return { uuid: l.uuid, name: view.name, qty: l.qty, notes: l.notes };
          }),
        },
      );
      setCart(key, []);
      setPanelOpen(false);
      if (result.queued) {
        toast({
          tone: 'warning',
          title: t('offline.queuedTitle'),
          description: t('offline.queuedBody'),
        });
      } else {
        setOrder(result.data);
        toast.success(t('sent', { count: lines.reduce((n, l) => n + l.qty, 0) }));
        void queryClient.invalidateQueries({ queryKey: ['floor'] });
      }
    } catch (err) {
      toast.error(message(err));
    } finally {
      setSending(false);
    }
  };

  // Ctrl/Cmd+Enter sends the cart from anywhere on the screen.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void sendRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cartTotal = menuQuery.data
    ? cart.reduce((sum, l) => sum + describeLine(menuQuery.data!, l, timeZone).totalMinor, 0)
    : 0;
  const cartCount = cart.reduce((n, l) => n + l.qty, 0);

  const panel = menuQuery.data ? (
    <OrderPanel
      menu={menuQuery.data}
      order={order}
      target={target}
      cart={cart}
      timeZone={timeZone}
      readOnly={readOnly}
      sending={sending}
      onCartChange={(lines) => setCart(key, lines)}
      onEditLine={(line) => {
        const subject: OptionsSubject | null =
          line.comboId !== undefined
            ? (() => {
                const combo = menuQuery.data!.combos.find((c) => c.id === line.comboId);
                return combo ? { kind: 'combo' as const, combo } : null;
              })()
            : (() => {
                const item = menuQuery.data!.items.find((i) => i.id === line.menuItemId);
                return item ? { kind: 'item' as const, item } : null;
              })();
        if (subject) setOptions({ subject, initial: line });
      }}
      onSend={() => void send()}
      onOrderChange={setOrder}
    />
  ) : null;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
        <Button variant="ghost" size="icon" asChild aria-label={t('screen.back')}>
          <Link to={target.kind === 'session' ? '/floor' : '/orders'}>
            <ArrowLeft />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-lg font-extrabold tracking-tight sm:text-xl">{title}</h1>
          <p className="truncate text-xs text-foreground-muted sm:text-sm">
            {[
              session ? t('screen.guests', { count: session.guestCount }) : null,
              session?.waiterName ?? order?.waiterName,
              order ? t('screen.number', { number: order.number }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {readOnly ? (
          <Badge tone="warning">
            {sessionClosed || orderClosed ? t('screen.closed') : t('screen.notYours')}
          </Badge>
        ) : null}
      </header>

      {menuQuery.isLoading || orderQuery.isLoading ? (
        <div className="grid flex-1 gap-3 p-4 sm:grid-cols-3">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : !menuQuery.data ? (
        <EmptyState icon={<UtensilsCrossed />} title={t('screen.menuMissing')} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_400px]">
          <MenuBrowser
            menu={menuQuery.data}
            timeZone={timeZone}
            disabled={readOnly}
            onTapItem={tapItem}
            onTapCombo={(combo) =>
              !readOnly && setOptions({ subject: { kind: 'combo', combo }, initial: null })
            }
          />
          <aside className="hidden min-h-0 border-l border-border lg:flex lg:flex-col">
            {panel}
          </aside>
        </div>
      )}

      {/* Phones and tablets: the order slides up from a bar at the bottom. */}
      <div className="border-t border-border bg-surface p-2 lg:hidden">
        <Button
          size="xl"
          block
          variant={cartCount ? 'primary' : 'outline'}
          onClick={() => setPanelOpen(true)}
        >
          <ShoppingBasket />
          {cartCount ? t('cart.review', { count: cartCount }) : t('cart.viewOrder')}
          <span className="ml-auto font-mono tabular-nums">
            {formatMoney(cartCount ? cartTotal : (order?.totalMinor ?? 0))}
          </span>
        </Button>
      </div>
      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent
          side="bottom"
          closeLabel={t('screen.closePanel')}
          className="flex h-[90dvh] flex-col p-0"
        >
          <SheetTitle className="sr-only">{title}</SheetTitle>
          {panel}
        </SheetContent>
      </Sheet>

      {menuQuery.data ? (
        <ItemOptionsSheet
          menu={menuQuery.data}
          subject={options?.subject ?? null}
          initial={options?.initial ?? null}
          guestCount={session?.guestCount ?? null}
          timeZone={timeZone}
          onClose={() => setOptions(null)}
          onSave={(line) => {
            addLine(line);
            setOptions(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ---- Menu browser ----------------------------------------------------------------------------

function MenuBrowser({
  menu,
  timeZone,
  disabled,
  onTapItem,
  onTapCombo,
}: {
  menu: AdminMenu;
  timeZone: string;
  disabled: boolean;
  onTapItem: (item: MenuItem) => void;
  onTapCombo: (combo: MenuCombo) => void;
}) {
  const { t } = useTranslation('orders');
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const topCategories = useMemo(
    () =>
      menu.categories
        .filter((c) => c.active && c.parentId === null)
        .sort((a, b) => a.sort - b.sort),
    [menu.categories],
  );
  const hasFavourites = menu.items.some((i) => i.active && i.isPopular);
  const [categoryId, setCategoryId] = useState<number>(
    hasFavourites ? FAVOURITES : (topCategories[0]?.id ?? 0),
  );
  const now = useNow(60_000);

  // "/" jumps to search (plan §12: keyboard shortcuts for the order screen).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const inCategory = (catId: number) => {
    const ids = new Set([
      catId,
      ...menu.categories.filter((c) => c.parentId === catId).map((c) => c.id),
    ]);
    return (id: number) => ids.has(id);
  };
  const needle = query.trim().toLocaleLowerCase();
  const matches = (name: string) => name.toLocaleLowerCase().includes(needle);
  const items = menu.items
    .filter((i) => i.active)
    .filter((i) =>
      needle
        ? matches(i.name) ||
          Object.values(i.translations).some((tr) => tr?.name && matches(tr.name))
        : categoryId === FAVOURITES
          ? i.isPopular
          : inCategory(categoryId)(i.categoryId),
    )
    .sort((a, b) => a.sort - b.sort);
  const combos = menu.combos.filter(
    (c) =>
      c.active &&
      (needle
        ? matches(c.name)
        : categoryId !== FAVOURITES && inCategory(categoryId)(c.categoryId)),
  );

  const chip = (id: number, label: string, icon: React.ReactNode) => (
    <button
      key={id}
      type="button"
      aria-pressed={!needle && categoryId === id}
      onClick={() => {
        setQuery('');
        setCategoryId(id);
      }}
      className={cn(
        'flex min-h-11 shrink-0 items-center gap-2 rounded-control px-3 text-left text-sm font-semibold transition-colors [&_svg]:size-4',
        !needle && categoryId === id
          ? 'bg-primary text-primary-fg'
          : 'bg-surface-sunken text-foreground hover:bg-border lg:bg-transparent',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    // Categories run down the side when there is room; from lg to xl the ticket column sits next to
    // the menu (and the sidebar is open), so they become a strip on top to leave the dishes room.
    <div className="flex min-h-0 min-w-0 flex-col sm:flex-row lg:flex-col xl:flex-row">
      <nav
        aria-label={t('menu.categories')}
        className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border p-2 sm:w-48 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r lg:w-auto lg:flex-row lg:overflow-x-auto lg:border-b lg:border-r-0 xl:w-48 xl:flex-col xl:overflow-y-auto xl:border-b-0 xl:border-r"
      >
        {hasFavourites ? chip(FAVOURITES, t('menu.favourites'), <Star />) : null}
        {topCategories.map((c) => {
          const Icon = c.icon ? CATEGORY_ICON_COMPONENTS[c.icon] : UtensilsCrossed;
          return chip(c.id, c.name, <Icon />);
        })}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative p-2 sm:p-3">
          <Search
            className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle sm:left-6"
            aria-hidden
          />
          <Input
            ref={searchRef}
            type="search"
            aria-label={t('menu.search')}
            placeholder={t('menu.searchPlaceholder')}
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
              // Enter adds the only match: fast for keyboard users at the bar.
              if (e.key === 'Enter' && items.length === 1 && !combos.length) {
                onTapItem(items[0]!);
                setQuery('');
              }
            }}
          />
          {query ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute right-4 top-1/2 -translate-y-1/2 sm:right-5"
              aria-label={t('menu.clear')}
              onClick={() => setQuery('')}
            >
              <X />
            </Button>
          ) : null}
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-2 pt-0 sm:grid-cols-3 sm:p-3 sm:pt-0 xl:grid-cols-4">
          {combos.map((combo) => (
            <button
              key={`c${combo.id}`}
              type="button"
              disabled={disabled}
              onClick={() => onTapCombo(combo)}
              className="flex min-h-24 flex-col justify-between gap-2 rounded-card border-2 border-highlight bg-highlight-soft p-3 text-left text-highlight-soft-fg transition-transform active:scale-[0.97] disabled:opacity-60"
            >
              <span className="font-bold leading-snug">{combo.name}</span>
              <span className="flex items-center justify-between gap-2">
                <Badge tone="highlight" size="sm">
                  {t('menu.combo')}
                </Badge>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {formatMoney(combo.priceMinor)}
                </span>
              </span>
            </button>
          ))}
          {items.map((item) => {
            const out = isOutOfStock(item, now);
            const price = itemPrice(menu, item, item.variants[0]?.id ?? null, timeZone);
            const base = item.variants[0]?.priceMinor ?? item.priceMinor;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled || out}
                onClick={() => onTapItem(item)}
                className={cn(
                  'flex min-h-24 flex-col justify-between gap-2 rounded-card border border-border bg-surface p-3 text-left shadow-raised transition-transform active:scale-[0.97] disabled:shadow-none',
                  out && 'opacity-55',
                  disabled && !out && 'opacity-70',
                )}
              >
                <span className={cn('font-semibold leading-snug', out && 'line-through')}>
                  {item.name}
                </span>
                <span className="flex flex-wrap items-center justify-between gap-1">
                  {out ? (
                    <Badge tone="danger" size="sm">
                      {t('menu.outOfStock')}
                    </Badge>
                  ) : needsOptions(menu, item) ? (
                    <Badge size="sm">
                      {item.variants.length ? t('menu.sizes') : t('menu.options')}
                    </Badge>
                  ) : (
                    <span />
                  )}
                  <span className="flex items-baseline gap-1.5 font-mono text-sm tabular-nums">
                    {price.priceMinor < base ? (
                      <s className="text-xs text-foreground-subtle">{formatMoney(base)}</s>
                    ) : null}
                    <span
                      className={cn('font-semibold', price.priceMinor < base && 'text-success')}
                    >
                      {item.variants.length > 1
                        ? t('menu.from', { price: formatMoney(price.priceMinor) })
                        : formatMoney(price.priceMinor)}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
          {!items.length && !combos.length ? (
            <p className="col-span-full p-6 text-center text-foreground-muted">
              {needle ? t('menu.noMatch') : t('menu.emptyCategory')}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
