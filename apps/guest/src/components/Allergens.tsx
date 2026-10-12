import { useTranslation } from 'react-i18next';
import { AlertTriangle, Flame, Leaf, Sprout, WheatOff } from 'lucide-react';
import type { Allergen, DietaryTag } from '@tavolina/shared';

const TAG_ICON = { vegan: Sprout, vegetarian: Leaf, gluten_free: WheatOff, spicy: Flame } as const;

/** Small, readable dietary badges (icon + word, never icon alone). */
export function TagBadges({ tags }: { tags: DietaryTag[] }) {
  const { t } = useTranslation();
  return (
    <>
      {tags.map((tag) => {
        const Icon = TAG_ICON[tag];
        return (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-soft-fg"
          >
            <Icon className="size-3.5" aria-hidden />
            {t(`tags.${tag}`)}
          </span>
        );
      })}
    </>
  );
}

/** Allergens spelled out in the guest's language (EU 14). */
export function AllergenList({ allergens, tags }: { allergens: Allergen[]; tags: DietaryTag[] }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      {tags.length ? (
        <div className="flex flex-wrap gap-1.5">
          <TagBadges tags={tags} />
        </div>
      ) : null}
      {allergens.length ? (
        <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-soft-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>{t('allergens.contains')}</strong>{' '}
            {allergens.map((a) => t(`allergens.${a}`)).join(', ')}
          </span>
        </p>
      ) : null}
    </div>
  );
}
