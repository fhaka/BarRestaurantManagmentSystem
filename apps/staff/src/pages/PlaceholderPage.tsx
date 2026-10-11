import { useTranslation } from 'react-i18next';
import { Hammer } from 'lucide-react';
import { EmptyState } from '@tavolina/ui';
import type { NavItem } from '../nav';

/** Stands in for screens delivered in later phases, so navigation and permissions can be tested now. */
export function PlaceholderPage({ item }: { item: NavItem }) {
  const { t } = useTranslation('app');
  const screen = t(`nav.${item.key}`);
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <EmptyState
        icon={<Hammer />}
        title={t('placeholder.title', { screen })}
        description={t('placeholder.description', { phase: item.phase })}
      />
    </div>
  );
}
