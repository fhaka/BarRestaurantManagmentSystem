import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Clock, Flame, Leaf, Sparkles, Star, Wheat } from 'lucide-react';
import { LANGS, formatMoney, type GuestMenu, type Lang } from '@tavolina/shared';
import { Badge, EmptyState, Skeleton, cn } from '@tavolina/ui';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { CategoryIconView } from './fields';

const TAG_ICONS = { vegan: Leaf, vegetarian: Leaf, gluten_free: Wheat, spicy: Flame } as const;

/** What guests see on the QR menu, rendered from the same endpoint data, at a phone width. */
export function PreviewTab() {
  const { t, i18n } = useTranslation('menu');
  const { t: tc } = useTranslation();
  const locationId = useSession((s) => s.locationId);
  const [lang, setLang] = useState<Lang>('en');
  const menu = useQuery({
    queryKey: ['menu', locationId, 'guest-preview', lang],
    queryFn: () => api<GuestMenu>('GET', '/menu/guest-preview', { query: { lang } }),
  });
  // Labels inside the phone follow the previewed language, like the real guest app.
  const tg = i18n.getFixedT(menu.data?.lang ?? lang, 'menu');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground-muted">{t('preview.description')}</p>
        <div
          role="group"
          aria-label={t('preview.language')}
          className="flex rounded-full border border-border-strong p-0.5"
        >
          {LANGS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={cn(
                'h-9 min-w-12 rounded-full px-3 text-sm font-semibold uppercase transition-colors',
                lang === l
                  ? 'bg-primary text-primary-fg'
                  : 'text-foreground-muted hover:text-foreground',
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-sm overflow-hidden rounded-[28px] border-[6px] border-sand-900 bg-background shadow-overlay dark:border-sand-700">
        <div className="max-h-[70dvh] overflow-y-auto px-4 py-5" lang={menu.data?.lang}>
          {menu.isPending ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : menu.isError || !menu.data.categories.length ? (
            <EmptyState title={t('preview.empty')} />
          ) : (
            <div className="flex flex-col gap-6">
              <h2 className="text-xl font-extrabold tracking-tight">{menu.data.location.name}</h2>
              {menu.data.categories.map((c) => (
                <section
                  key={c.id}
                  className={cn('flex flex-col gap-2', !c.availableNow && 'opacity-60')}
                >
                  <h3 className="flex items-center gap-2 font-bold">
                    <CategoryIconView icon={c.icon} className="size-4 text-foreground-muted" />
                    {c.name}
                  </h3>
                  {!c.availableNow && c.availableFrom ? (
                    <p className="flex items-center gap-1 text-xs text-foreground-muted">
                      <Clock className="size-3" aria-hidden />
                      {tg('preview.unavailable', { from: c.availableFrom, to: c.availableTo })}
                    </p>
                  ) : c.description ? (
                    <p className="text-xs text-foreground-muted">{c.description}</p>
                  ) : null}
                  <ul className="flex flex-col gap-2">
                    {c.items.map((i) => (
                      <li
                        key={i.id}
                        className="flex gap-3 rounded-card bg-surface p-2.5 shadow-raised ring-1 ring-border"
                      >
                        {i.thumbUrl ? (
                          <img
                            src={i.thumbUrl}
                            alt=""
                            loading="lazy"
                            className="size-16 shrink-0 rounded-control object-cover"
                          />
                        ) : null}
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold leading-tight">{i.name}</span>
                            <span className="shrink-0 text-right font-mono text-sm font-semibold tabular-nums">
                              {formatMoney(i.priceMinor, {
                                currency: menu.data.location.currencyDisplay,
                              })}
                              {i.regularPriceMinor ? (
                                <span className="block text-xs font-normal text-foreground-subtle line-through">
                                  {formatMoney(i.regularPriceMinor, {
                                    currency: menu.data.location.currencyDisplay,
                                  })}
                                </span>
                              ) : null}
                            </span>
                          </div>
                          {i.description ? (
                            <p className="line-clamp-2 text-xs text-foreground-muted">
                              {i.description}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-1">
                            {i.regularPriceMinor ? (
                              <Badge tone="highlight" size="sm" icon={<Sparkles />}>
                                {tg('items.badges.happyHour')}
                              </Badge>
                            ) : null}
                            {i.isPopular ? (
                              <Badge tone="highlight" size="sm" icon={<Star />}>
                                {tg('items.badges.popular')}
                              </Badge>
                            ) : null}
                            {i.isNew ? (
                              <Badge tone="solid" size="sm">
                                {tg('items.badges.new')}
                              </Badge>
                            ) : null}
                            {i.tags.map((tag) => {
                              const Icon = TAG_ICONS[tag];
                              return (
                                <Badge
                                  key={tag}
                                  tone={tag === 'spicy' ? 'danger' : 'success'}
                                  size="sm"
                                  icon={<Icon />}
                                >
                                  {tg(`tags.${tag}`)}
                                </Badge>
                              );
                            })}
                          </div>
                          {i.allergens.length ? (
                            <p className="text-[11px] text-foreground-subtle">
                              {i.allergens.map((a) => tg(`allergens.${a}`)).join(' · ')}
                            </p>
                          ) : null}
                          {i.variants.length ? (
                            <p className="text-xs text-foreground-muted">
                              {i.variants
                                .map(
                                  (v) =>
                                    `${v.name} ${formatMoney(v.priceMinor, { currency: menu.data.location.currencyDisplay })}`,
                                )
                                .join(' · ')}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <p className="text-center text-[11px] text-foreground-subtle">{tc('appName')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
