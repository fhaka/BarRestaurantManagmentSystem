import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  CircleCheck,
  Clock,
  EyeOff,
  FolderPlus,
  ImageOff,
  Languages,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  SearchX,
  Sparkles,
  Star,
  Tag,
} from 'lucide-react';
import {
  effectivePrice,
  formatMoney,
  TIMEZONE,
  type AdminMenu,
  type MenuCategory,
  type MenuItem,
  type OutOfStockMode,
} from '@tavolina/shared';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  cn,
} from '@tavolina/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api } from '../../lib/api';
import { CategoryDialog } from './CategoryDialog';
import { CategoryIconView } from './fields';
import { missingTranslations } from './menu-utils';
import { ItemSheet } from './ItemSheet';
import { isOutOfStock, useMenuLanguages, useMenuMutation } from './useMenu';

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(index + delta, 0, item!);
  return next;
}

export function ItemsTab({ menu }: { menu: AdminMenu }) {
  const { t } = useTranslation('menu');
  const { others } = useMenuLanguages();
  const [selectedId, setSelectedId] = useState<number | null>(menu.categories[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [categoryDialog, setCategoryDialog] = useState<{
    open: boolean;
    category: MenuCategory | null;
  }>({
    open: false,
    category: null,
  });
  const [deleteCategory, setDeleteCategory] = useState<MenuCategory | null>(null);
  const [sheet, setSheet] = useState<{ open: boolean; item: MenuItem | null }>({
    open: false,
    item: null,
  });

  const selected = menu.categories.find((c) => c.id === selectedId) ?? menu.categories[0] ?? null;
  const counts = useMemo(() => {
    const map = new Map<number, number>();
    for (const i of menu.items) map.set(i.categoryId, (map.get(i.categoryId) ?? 0) + 1);
    return map;
  }, [menu.items]);

  const reorderCategories = useMenuMutation((ids: number[]) =>
    api('POST', '/menu/categories/reorder', { body: { ids } }),
  );
  const reorderItems = useMenuMutation(
    ({ categoryId, ids }: { categoryId: number; ids: number[] }) =>
      api('POST', `/menu/categories/${categoryId}/items/reorder`, { body: { ids } }),
  );
  const removeCategory = useMenuMutation((id: number) => api('DELETE', `/menu/categories/${id}`), {
    success: t('categories.deleted'),
    onSuccess: () => setDeleteCategory(null),
  });
  const stock = useMenuMutation(
    ({ item, mode }: { item: MenuItem; mode: OutOfStockMode }) =>
      api<MenuItem>('POST', `/menu/items/${item.id}/out-of-stock`, { body: { mode } }),
    {
      success: (item) =>
        item.outOfStockUntil
          ? t('items.markedOut', { name: item.name })
          : t('items.markedBack', { name: item.name }),
    },
  );

  const q = query.trim().toLocaleLowerCase();
  const visibleItems = q
    ? menu.items.filter(
        (i) =>
          i.name.toLocaleLowerCase().includes(q) ||
          Object.values(i.translations).some((tr) => tr?.name?.toLocaleLowerCase().includes(q)),
      )
    : menu.items.filter((i) => i.categoryId === selected?.id);

  const categoryName = new Map(menu.categories.map((c) => [c.id, c.name]));
  const now = new Date();

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* Categories */}
      <aside className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground-muted">
            {t('categories.title')}
          </h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCategoryDialog({ open: true, category: null })}
          >
            <FolderPlus />
            {t('categories.add')}
          </Button>
        </div>
        {menu.categories.length === 0 ? (
          <p className="rounded-card border border-dashed border-border-strong p-4 text-sm text-foreground-muted">
            {t('categories.empty')}
          </p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {menu.categories.map((c, index) => {
              const active = !q && c.id === selected?.id;
              return (
                <li key={c.id} className="shrink-0">
                  <div
                    className={cn(
                      'group flex items-center gap-1 rounded-control border pr-1 transition-colors',
                      active
                        ? 'border-primary bg-primary-soft'
                        : 'border-transparent hover:bg-surface-sunken',
                      c.parentId && 'lg:ml-5',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(c.id);
                        setQuery('');
                      }}
                      aria-current={active ? 'true' : undefined}
                      className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3 text-left"
                    >
                      <CategoryIconView
                        icon={c.icon}
                        className={cn(
                          'size-5 shrink-0',
                          active ? 'text-primary-soft-fg' : 'text-foreground-muted',
                        )}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span
                          className={cn(
                            'truncate text-sm font-semibold',
                            !c.active && 'text-foreground-subtle line-through',
                          )}
                        >
                          {c.name}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
                          {t('categories.items', { count: counts.get(c.id) ?? 0 })}
                          {c.availableFrom ? (
                            <span className="inline-flex items-center gap-0.5">
                              · <Clock className="size-3" aria-hidden /> {c.availableFrom}–
                              {c.availableTo}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                    <div className="hidden items-center lg:flex">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('categories.moveUp')}
                        disabled={index === 0 || reorderCategories.isPending}
                        onClick={() =>
                          reorderCategories.mutate(
                            move(menu.categories, index, -1).map((x) => x.id),
                          )
                        }
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('categories.moveDown')}
                        disabled={
                          index === menu.categories.length - 1 || reorderCategories.isPending
                        }
                        onClick={() =>
                          reorderCategories.mutate(move(menu.categories, index, 1).map((x) => x.id))
                        }
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={t('categories.edit')}>
                          <MoreVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setCategoryDialog({ open: true, category: c })}
                        >
                          <Pencil />
                          {t('categories.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem destructive onSelect={() => setDeleteCategory(c)}>
                          <Ban />
                          {t('categories.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Items */}
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('items.search')}
              aria-label={t('items.search')}
              className="pl-9"
            />
          </div>
          <Button disabled={!selected} onClick={() => setSheet({ open: true, item: null })}>
            <Plus />
            {t('items.add')}
          </Button>
        </div>

        {!selected ? (
          <EmptyState
            icon={<FolderPlus />}
            title={t('items.noCategoryTitle')}
            description={t('items.noCategoryDescription')}
            action={
              <Button onClick={() => setCategoryDialog({ open: true, category: null })}>
                <FolderPlus />
                {t('categories.add')}
              </Button>
            }
          />
        ) : visibleItems.length === 0 ? (
          q ? (
            <EmptyState icon={<SearchX />} title={t('items.noResults', { query })} />
          ) : (
            <EmptyState
              icon={<Tag />}
              title={t('items.emptyTitle')}
              description={t('items.emptyDescription')}
              action={
                <Button onClick={() => setSheet({ open: true, item: null })}>
                  <Plus />
                  {t('items.add')}
                </Button>
              }
            />
          )
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {visibleItems.map((item, index) => {
              const sold = isOutOfStock(item.outOfStockUntil, now.getTime());
              const missing = missingTranslations(item.translations, others);
              const categoryIds = [
                item.categoryId,
                menu.categories.find((c) => c.id === item.categoryId)?.parentId,
              ].filter((x): x is number => typeof x === 'number');
              const deal = effectivePrice(
                item.priceMinor,
                { itemId: item.id, categoryIds },
                menu.priceRules,
                now,
                TIMEZONE,
              );
              const minVariant = item.variants.length
                ? Math.min(...item.variants.map((v) => v.priceMinor))
                : null;
              return (
                <li
                  key={item.id}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5',
                    !item.active && 'opacity-60',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSheet({ open: true, item })}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface-sunken">
                      {item.thumbUrl ? (
                        <img
                          src={item.thumbUrl}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <ImageOff className="size-5 text-foreground-subtle" aria-hidden />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'truncate font-semibold',
                            sold && 'text-foreground-muted line-through',
                          )}
                        >
                          {item.name}
                        </span>
                        {q ? (
                          <span className="truncate text-xs text-foreground-subtle">
                            {categoryName.get(item.categoryId)}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {sold ? (
                          <Badge tone="danger" size="sm" icon={<Ban />}>
                            {t('items.badges.outOfStock')}
                          </Badge>
                        ) : null}
                        {deal.ruleId ? (
                          <Badge tone="highlight" size="sm" icon={<Sparkles />}>
                            {t('items.badges.happyHour')}
                          </Badge>
                        ) : null}
                        {item.isPopular ? (
                          <Badge tone="highlight" size="sm" icon={<Star />}>
                            {t('items.badges.popular')}
                          </Badge>
                        ) : null}
                        {item.isNew ? (
                          <Badge tone="solid" size="sm">
                            {t('items.badges.new')}
                          </Badge>
                        ) : null}
                        {!item.guestVisible ? (
                          <Badge size="sm" icon={<EyeOff />}>
                            {t('items.badges.hidden')}
                          </Badge>
                        ) : null}
                        {!item.active ? (
                          <Badge size="sm">{t('items.badges.inactive')}</Badge>
                        ) : null}
                        {missing.length ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-warning"
                            title={t('items.missingTranslations', {
                              langs: missing.join(', ').toUpperCase(),
                            })}
                          >
                            <Languages className="size-3.5" aria-hidden />
                            <span className="sr-only">
                              {t('items.missingTranslations', {
                                langs: missing.join(', ').toUpperCase(),
                              })}
                            </span>
                            {missing.join(' ').toUpperCase()}
                          </span>
                        ) : null}
                        {item.variants.length ? (
                          <span className="text-xs text-foreground-muted">
                            {t('items.variantsCount', { count: item.variants.length })}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end font-mono text-sm font-semibold tabular-nums">
                      {deal.ruleId ? (
                        <>
                          <span className="text-highlight-soft-fg">
                            {formatMoney(deal.priceMinor)}
                          </span>
                          <span className="text-xs font-normal text-foreground-subtle line-through">
                            {formatMoney(item.priceMinor)}
                          </span>
                        </>
                      ) : minVariant !== null ? (
                        <span className="text-foreground-muted">
                          {t('items.from', { price: formatMoney(minVariant) })}
                        </span>
                      ) : (
                        formatMoney(item.priceMinor)
                      )}
                    </span>
                  </button>

                  {!q ? (
                    <div className="hidden flex-col sm:flex">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('categories.moveUp')}
                        disabled={index === 0 || reorderItems.isPending}
                        onClick={() =>
                          reorderItems.mutate({
                            categoryId: item.categoryId,
                            ids: move(visibleItems, index, -1).map((x) => x.id),
                          })
                        }
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('categories.moveDown')}
                        disabled={index === visibleItems.length - 1 || reorderItems.isPending}
                        onClick={() =>
                          reorderItems.mutate({
                            categoryId: item.categoryId,
                            ids: move(visibleItems, index, 1).map((x) => x.id),
                          })
                        }
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                  ) : null}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`${t('items.availability')}: ${item.name}`}
                      >
                        <MoreVertical />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>{t('items.availability')}</DropdownMenuLabel>
                      {sold ? (
                        <DropdownMenuItem onSelect={() => stock.mutate({ item, mode: 'back' })}>
                          <CircleCheck />
                          {t('items.backInStock')}
                        </DropdownMenuItem>
                      ) : (
                        <>
                          <DropdownMenuItem onSelect={() => stock.mutate({ item, mode: 'today' })}>
                            <Clock />
                            {t('items.outToday')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => stock.mutate({ item, mode: 'indefinite' })}
                          >
                            <Ban />
                            {t('items.outIndefinite')}
                          </DropdownMenuItem>
                        </>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setSheet({ open: true, item })}>
                        <Pencil />
                        {t('common.edit')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CategoryDialog
        open={categoryDialog.open}
        onOpenChange={(open) => setCategoryDialog((s) => ({ ...s, open }))}
        category={categoryDialog.category}
        categories={menu.categories}
      />
      <ConfirmDialog
        open={deleteCategory !== null}
        onOpenChange={(open) => !open && setDeleteCategory(null)}
        title={t('categories.deleteConfirm', { name: deleteCategory?.name ?? '' })}
        description={t('categories.deleteDescription')}
        confirmLabel={t('categories.delete')}
        loading={removeCategory.isPending}
        onConfirm={() => deleteCategory && removeCategory.mutate(deleteCategory.id)}
      />
      {selected ? (
        <ItemSheet
          open={sheet.open}
          onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
          menu={menu}
          item={sheet.item}
          categoryId={selected.id}
          onCreated={(item) => setSheet({ open: true, item })}
        />
      ) : null}
    </div>
  );
}
