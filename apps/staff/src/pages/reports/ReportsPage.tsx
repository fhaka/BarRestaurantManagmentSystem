import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Ban, BarChart3, Clock, CreditCard, Package, TrendingUp, Users } from 'lucide-react';
import { ROLE_PERMISSIONS } from '@tavolina/shared';
import { Field, Input, Tabs, TabsContent, TabsList, TabsTrigger } from '@tavolina/ui';
import { PageHeader } from '../../components/AppLayout';
import { useSession } from '../../lib/session';
import { ChipToggle } from '../menu/fields';
import { PRESETS, presetRange, type Preset, type Range } from './report-utils';
import {
  DiscountsTab,
  HoursTab,
  InventoryTab,
  ItemsTab,
  PaymentsTab,
  SalesTab,
  StaffTab,
} from './ReportTabs';

const TABS = [
  { key: 'sales', icon: TrendingUp },
  { key: 'items', icon: BarChart3 },
  { key: 'staff', icon: Users },
  { key: 'payments', icon: CreditCard },
  { key: 'discounts', icon: Ban },
  { key: 'inventory', icon: Package },
  { key: 'hours', icon: Clock },
] as const;

/** Plan §5.13: every report with a date range and location filter, charts and CSV export. */
export function ReportsPage() {
  const { t } = useTranslation('reports');
  const locationName = useSession((s) => s.locationName);
  const locationId = useSession((s) => s.locationId);
  const user = useSession((s) => s.user);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'sales';
  const [preset, setPreset] = useState<Preset | null>('last30');
  const [range, setRange] = useState<Range>(() => presetRange('last30'));
  // Locations where this person's role may see reports (more than one = a filter).
  const reportLocations = (user?.locations ?? []).filter((l) =>
    ROLE_PERMISSIONS[l.roleKey].includes('report.view'),
  );
  const [selected, setSelected] = useState<number[]>([]);
  const locations = selected.length ? selected : [];
  const props = { range, locations };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.subtitle', { location: locationName ?? '' })}
      />

      {/* Filters, one row above the charts. */}
      <div className="flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface p-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <ChipToggle
              key={p}
              pressed={preset === p}
              onToggle={() => {
                setPreset(p);
                setRange(presetRange(p));
              }}
            >
              {t(`reports.presets.${p}`)}
            </ChipToggle>
          ))}
        </div>
        <Field label={t('reports.from')} className="w-40">
          <Input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => {
              setPreset(null);
              if (e.target.value) setRange({ ...range, from: e.target.value });
            }}
          />
        </Field>
        <Field label={t('reports.to')} className="w-40">
          <Input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => {
              setPreset(null);
              if (e.target.value) setRange({ ...range, to: e.target.value });
            }}
          />
        </Field>
        {reportLocations.length > 1 ? (
          <fieldset className="flex flex-wrap items-center gap-1.5">
            <legend className="mb-1.5 text-sm font-semibold">{t('reports.locations')}</legend>
            {reportLocations.map((l) => {
              const on = selected.length ? selected.includes(l.id) : l.id === locationId;
              return (
                <ChipToggle
                  key={l.id}
                  pressed={on}
                  onToggle={() => {
                    const current = selected.length ? selected : [locationId!];
                    const next = on ? current.filter((x) => x !== l.id) : [...current, l.id];
                    setSelected(next.length ? next : [locationId!]);
                  }}
                >
                  {l.name}
                </ChipToggle>
              );
            })}
          </fieldset>
        ) : null}
        <p className="ml-auto text-xs text-foreground-muted">{t('reports.businessDayHint')}</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            {TABS.map(({ key, icon: Icon }) => (
              <TabsTrigger key={key} value={key}>
                <Icon aria-hidden />
                {t(`reports.tabs.${key}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="sales" className="pt-4">
          <SalesTab {...props} />
        </TabsContent>
        <TabsContent value="items" className="pt-4">
          <ItemsTab {...props} />
        </TabsContent>
        <TabsContent value="staff" className="pt-4">
          <StaffTab {...props} />
        </TabsContent>
        <TabsContent value="payments" className="pt-4">
          <PaymentsTab {...props} />
        </TabsContent>
        <TabsContent value="discounts" className="pt-4">
          <DiscountsTab {...props} />
        </TabsContent>
        <TabsContent value="inventory" className="pt-4">
          <InventoryTab {...props} />
        </TabsContent>
        <TabsContent value="hours" className="pt-4">
          <HoursTab {...props} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
