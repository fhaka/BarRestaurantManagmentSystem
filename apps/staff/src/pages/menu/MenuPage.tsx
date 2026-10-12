import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Eye,
  FileSpreadsheet,
  ListPlus,
  Percent,
  Settings2,
  UtensilsCrossed,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@tavolina/ui';
import { PageHeader } from '../../components/AppLayout';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { ImportExportTab } from './ImportExportTab';
import { ItemsTab } from './ItemsTab';
import { CombosTab } from './CombosTab';
import { ModifiersTab } from './ModifiersTab';
import { OffersTab } from './OffersTab';
import { PreviewTab } from './PreviewTab';
import { SetupTab } from './SetupTab';
import { useMenuQuery } from './useMenu';

export function MenuPage() {
  const { t } = useTranslation('menu');
  const { t: tc } = useTranslation();
  const { message } = useErrorMessages();
  const locationName = useSession((s) => s.locationName);
  const menu = useMenuQuery();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader title={t('title')} subtitle={t('subtitle', { location: locationName ?? '' })} />

      {menu.isPending ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-[72px] w-full" />
            ))}
          </div>
        </div>
      ) : menu.isError ? (
        <EmptyState
          title={message(menu.error)}
          action={
            <Button variant="outline" onClick={() => void menu.refetch()}>
              {tc('actions.retry')}
            </Button>
          }
        />
      ) : (
        <Tabs defaultValue="items">
          <TabsList>
            <TabsTrigger value="items">
              <BookOpen aria-hidden />
              {t('tabs.items')}
            </TabsTrigger>
            <TabsTrigger value="modifiers">
              <ListPlus aria-hidden />
              {t('tabs.modifiers')}
            </TabsTrigger>
            <TabsTrigger value="combos">
              <UtensilsCrossed aria-hidden />
              {t('tabs.combos')}
            </TabsTrigger>
            <TabsTrigger value="offers">
              <Percent aria-hidden />
              {t('tabs.offers')}
            </TabsTrigger>
            <TabsTrigger value="setup">
              <Settings2 aria-hidden />
              {t('tabs.setup')}
            </TabsTrigger>
            <TabsTrigger value="import">
              <FileSpreadsheet aria-hidden />
              {t('tabs.import')}
            </TabsTrigger>
            <TabsTrigger value="preview">
              <Eye aria-hidden />
              {t('tabs.preview')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="items">
            <ItemsTab menu={menu.data} />
          </TabsContent>
          <TabsContent value="modifiers">
            <ModifiersTab menu={menu.data} />
          </TabsContent>
          <TabsContent value="combos">
            <CombosTab menu={menu.data} />
          </TabsContent>
          <TabsContent value="offers">
            <OffersTab menu={menu.data} />
          </TabsContent>
          <TabsContent value="setup">
            <SetupTab menu={menu.data} />
          </TabsContent>
          <TabsContent value="import">
            <ImportExportTab />
          </TabsContent>
          <TabsContent value="preview">
            <PreviewTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
