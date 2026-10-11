import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import { Button, EmptyState } from '@tavolina/ui';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        icon={<Compass />}
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={
          <Button asChild>
            <Link to="/">{t('notFound.back')}</Link>
          </Button>
        }
      />
    </div>
  );
}
