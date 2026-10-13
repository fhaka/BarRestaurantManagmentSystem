import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, ChefHat, ClipboardCheck, Package, Truck, Users } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@tavolina/ui';
import { PageHeader } from '../../components/AppLayout';
import { useSession } from '../../lib/session';
import { CountsTab } from './CountsTab';
import { MovementsTab } from './MovementsTab';
import { PurchasesTab } from './PurchasesTab';
import { RecipesTab } from './RecipesTab';
import { StockTab } from './StockTab';
import { SuppliersTab } from './SuppliersTab';

const TABS = [
  { key: 'stock', icon: Package },
  { key: 'recipes', icon: ChefHat },
  { key: 'purchases', icon: Truck },
  { key: 'counts', icon: ClipboardCheck },
  { key: 'suppliers', icon: Users },
  { key: 'movements', icon: ArrowLeftRight },
] as const;

/** Stock, recipes and margins, purchasing and stock counts (plan §5.9). */
export function InventoryPage() {
  const { t } = useTranslation('inventory');
  const locationName = useSession((s) => s.locationName);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'stock';
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title={t('title')} subtitle={t('subtitle', { location: locationName ?? '' })} />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            {TABS.map(({ key, icon: Icon }) => (
              <TabsTrigger key={key} value={key}>
                <Icon aria-hidden />
                {t(`tabs.${key}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="stock" className="pt-4">
          <StockTab />
        </TabsContent>
        <TabsContent value="recipes" className="pt-4">
          <RecipesTab />
        </TabsContent>
        <TabsContent value="purchases" className="pt-4">
          <PurchasesTab />
        </TabsContent>
        <TabsContent value="counts" className="pt-4">
          <CountsTab />
        </TabsContent>
        <TabsContent value="suppliers" className="pt-4">
          <SuppliersTab />
        </TabsContent>
        <TabsContent value="movements" className="pt-4">
          <MovementsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
