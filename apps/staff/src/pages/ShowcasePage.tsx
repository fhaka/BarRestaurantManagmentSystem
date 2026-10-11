import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BellRing,
  Brush,
  CalendarClock,
  ChefHat,
  Circle,
  ClipboardList,
  Flame,
  Leaf,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Receipt,
  Search,
  Send,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { formatMoney } from '@tavolina/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Field,
  Input,
  Select,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
  type SortDirection,
} from '@tavolina/ui';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="flex scroll-mt-20 flex-col gap-4 border-t border-border pt-8"
    >
      <h2 id={id} className="text-xl font-bold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

const SWATCHES = [
  ['background', 'bg-background'],
  ['surface', 'bg-surface'],
  ['surface-sunken', 'bg-surface-sunken'],
  ['primary', 'bg-primary'],
  ['primary-soft', 'bg-primary-soft'],
  ['highlight', 'bg-highlight'],
  ['success', 'bg-success'],
  ['warning', 'bg-warning'],
  ['danger', 'bg-danger'],
  ['info', 'bg-info'],
] as const;

const SAND_STEPS = [
  'bg-sand-50',
  'bg-sand-100',
  'bg-sand-200',
  'bg-sand-300',
  'bg-sand-400',
  'bg-sand-500',
  'bg-sand-600',
  'bg-sand-700',
  'bg-sand-800',
  'bg-sand-900',
  'bg-sand-950',
] as const;

// Demo data for the table section. Item names are menu data (Albanian), not UI strings.
const TOP_ITEMS = [
  { name: 'Kapuçino', category: 'Kafe', sold: 64, revenueMinor: 64 * 18_000 },
  { name: 'Espresso', category: 'Kafe', sold: 112, revenueMinor: 112 * 10_000 },
  { name: 'Tavë kosi', category: 'Pjata kryesore', sold: 18, revenueMinor: 18 * 85_000 },
  { name: 'Freddo espresso', category: 'Kafe', sold: 41, revenueMinor: 41 * 20_000 },
  { name: 'Trileçe', category: 'Ëmbëlsira', sold: 23, revenueMinor: 23 * 35_000 },
  { name: 'Birra Korça', category: 'Birra', sold: 37, revenueMinor: 37 * 25_000 },
  { name: 'Fërgesë', category: 'Pjata kryesore', sold: 15, revenueMinor: 15 * 70_000 },
  { name: 'Byrek me spinaq', category: 'Mëngjes', sold: 29, revenueMinor: 29 * 15_000 },
];

type SortKey = 'name' | 'sold' | 'revenueMinor';

export function ShowcasePage() {
  const { t } = useTranslation('showcase');
  const { t: tc } = useTranslation('common');
  const [loading, setLoading] = useState(false);
  const [area, setArea] = useState<string>();
  const [course, setCourse] = useState('main');
  const [phone, setPhone] = useState('069 12');
  const [sort, setSort] = useState<{ key: SortKey; dir: Exclude<SortDirection, false> }>({
    key: 'revenueMinor',
    dir: 'desc',
  });

  const rows = useMemo(() => {
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...TOP_ITEMS].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      return (typeof av === 'string' ? av.localeCompare(String(bv)) : av - Number(bv)) * factor;
    });
  }, [sort]);

  const sortFor = (key: SortKey): SortDirection => (sort.key === key ? sort.dir : false);
  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );

  const simulateSend = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast.success(t('toasts.successTitle'), t('toasts.successBody'));
    }, 1200);
  };

  const statusBadges = [
    { key: 'free', tone: 'neutral', icon: <Circle /> },
    { key: 'occupied', tone: 'info', icon: <Users /> },
    { key: 'ordered', tone: 'primary', icon: <ClipboardList /> },
    { key: 'foodReady', tone: 'success', icon: <ChefHat /> },
    { key: 'billRequested', tone: 'highlight', icon: <Receipt /> },
    { key: 'needsCleaning', tone: 'warning', icon: <Brush /> },
    { key: 'reserved', tone: 'danger', icon: <CalendarClock /> },
  ] as const;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <Badge tone="highlight" className="self-start" icon={<Sparkles />}>
          /dev/showcase
        </Badge>
        <h1 className="text-3xl font-extrabold tracking-tight">{t('title')}</h1>
        <p className="max-w-2xl text-foreground-muted">{t('subtitle')}</p>
      </header>

      <Section id="colors" title={t('sections.colors')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SWATCHES.map(([name, cls]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div className={`h-14 rounded-control border border-border ${cls}`} />
              <code className="font-mono text-xs text-foreground-muted">{name}</code>
            </div>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-control border border-border">
          {SAND_STEPS.map((cls) => (
            <div key={cls} className={`h-8 flex-1 ${cls}`} title={cls.replace('bg-', '')} />
          ))}
        </div>
      </Section>

      <Section id="typography" title={t('sections.typography')}>
        <div className="flex flex-col gap-3">
          <p className="text-3xl font-extrabold tracking-tight">{t('typography.display')}</p>
          <p className="text-base">{t('typography.body')}</p>
          <p className="text-sm text-foreground-muted">{t('typography.small')}</p>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <span className="text-sm text-foreground-muted">{t('typography.numbers')}:</span>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {formatMoney(120_000)}
            </span>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {formatMoney(1_845_000)}
            </span>
            <span className="font-mono text-lg font-semibold tabular-nums text-warning">12:48</span>
          </div>
        </div>
      </Section>

      <Section id="buttons" title={t('sections.buttons')}>
        <div className="flex flex-wrap gap-3">
          <Button loading={loading} onClick={simulateSend}>
            {loading ? null : <Send />}
            {loading ? t('buttons.sending') : t('buttons.send')}
          </Button>
          <Button variant="secondary">{t('buttons.draft')}</Button>
          <Button variant="outline">{t('buttons.split')}</Button>
          <Button variant="ghost">{t('buttons.cancel')}</Button>
          <Button variant="highlight">
            <Receipt />
            {t('buttons.bill')}
          </Button>
          <Button variant="danger">{t('buttons.void')}</Button>
          <Button disabled>{t('buttons.send')}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline">
            {t('buttons.small')}
          </Button>
          <Button size="md" variant="outline">
            {t('buttons.medium')}
          </Button>
          <Button size="lg" variant="outline">
            {t('buttons.large')}
          </Button>
          <Button size="xl">
            <Plus />
            {t('buttons.add')}
          </Button>
          <Button size="icon" variant="outline" aria-label={t('buttons.add')}>
            <Plus />
          </Button>
          <Button size="icon-lg" variant="ghost" aria-label={t('buttons.more')}>
            <MoreHorizontal />
          </Button>
        </div>
      </Section>

      <Section id="inputs" title={t('sections.inputs')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('inputs.name')} hint={t('inputs.nameHint')}>
            <Input placeholder={t('inputs.namePlaceholder')} autoComplete="off" />
          </Field>
          <Field label={t('inputs.phone')} error={t('inputs.phoneError')}>
            <Input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label={t('inputs.notes')}>
            <Textarea placeholder={t('inputs.notesPlaceholder')} />
          </Field>
          <div className="flex flex-col gap-5">
            <Field label={t('inputs.disabled')}>
              <Input disabled value={t('inputs.disabledValue')} readOnly />
            </Field>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle"
                aria-hidden
              />
              <Input
                type="search"
                aria-label={t('inputs.search')}
                placeholder={t('inputs.search')}
                className="pl-9"
              />
            </div>
          </div>
        </div>
      </Section>

      <Section id="select" title={t('sections.select')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('select.area')}>
            <Select
              value={area}
              onValueChange={setArea}
              placeholder={t('select.areaPlaceholder')}
              options={['Salla', 'Tarraca', 'Bar', 'VIP'].map((a) => ({ value: a, label: a }))}
            />
          </Field>
          <Field label={t('select.course')}>
            <Select
              value={course}
              onValueChange={setCourse}
              options={(['starter', 'main', 'dessert'] as const).map((c) => ({
                value: c,
                label: t(`select.courses.${c}`),
              }))}
            />
          </Field>
        </div>
      </Section>

      <Section id="overlays" title={t('sections.overlays')}>
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">{t('overlays.openDialog')}</Button>
            </DialogTrigger>
            <DialogContent closeLabel={tc('actions.close')}>
              <DialogHeader>
                <DialogTitle>{t('overlays.dialogTitle')}</DialogTitle>
                <DialogDescription>{t('overlays.dialogDescription')}</DialogDescription>
              </DialogHeader>
              <Field label={t('overlays.reason')}>
                <Input placeholder={t('overlays.reasonPlaceholder')} />
              </Field>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">{tc('actions.cancel')}</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button variant="danger">{t('overlays.confirmVoid')}</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">{t('overlays.openSheet')}</Button>
            </SheetTrigger>
            <SheetContent side="right" closeLabel={tc('actions.close')}>
              <SheetHeader>
                <SheetTitle className="text-lg font-bold">{t('overlays.sheetTitle')}</SheetTitle>
                <SheetDescription className="text-sm text-foreground-muted">
                  {t('overlays.sheetDescription')}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-3">
                {TOP_ITEMS.slice(0, 4).map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between rounded-control border border-border p-3"
                  >
                    <span className="font-medium">{item.name}</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(item.revenueMinor / item.sold)}
                    </span>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">{t('overlays.openBottomSheet')}</Button>
            </SheetTrigger>
            <SheetContent side="bottom" closeLabel={tc('actions.close')}>
              <SheetHeader>
                <SheetTitle className="text-lg font-bold">
                  {t('overlays.bottomSheetTitle')}
                </SheetTitle>
                <SheetDescription className="text-sm text-foreground-muted">
                  {t('overlays.bottomSheetDescription')}
                </SheetDescription>
              </SheetHeader>
              <div className="mx-auto flex max-w-md flex-col gap-4">
                <Field label={t('select.course')}>
                  <Select
                    value={course}
                    onValueChange={setCourse}
                    options={(['starter', 'main', 'dessert'] as const).map((c) => ({
                      value: c,
                      label: t(`select.courses.${c}`),
                    }))}
                  />
                </Field>
                <Button size="lg" block>
                  <Plus />
                  {t('buttons.add')} · {formatMoney(18_000)}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </Section>

      <Section id="table" title={t('sections.table')}>
        <Table containerClassName="max-h-80">
          <TableCaption>{t('table.caption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead sort={sortFor('name')} onSort={() => toggleSort('name')}>
                {t('table.item')}
              </TableHead>
              <TableHead>{t('table.category')}</TableHead>
              <TableHead numeric sort={sortFor('sold')} onSort={() => toggleSort('sold')}>
                {t('table.sold')}
              </TableHead>
              <TableHead
                numeric
                sort={sortFor('revenueMinor')}
                onSort={() => toggleSort('revenueMinor')}
              >
                {t('table.revenue')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-foreground-muted">{row.category}</TableCell>
                <TableCell numeric>{row.sold}</TableCell>
                <TableCell numeric>{formatMoney(row.revenueMinor)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section id="badges" title={t('sections.badges')}>
        <p className="text-sm text-foreground-muted">{t('badges.statuses')}</p>
        <div className="flex flex-wrap gap-2">
          {statusBadges.map((b) => (
            <Badge key={b.key} tone={b.tone} size="lg" icon={b.icon}>
              {t(`badges.${b.key}`)}
            </Badge>
          ))}
        </div>
        <p className="text-sm text-foreground-muted">{t('badges.tags')}</p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="success" icon={<Leaf />}>
            {t('badges.vegan')}
          </Badge>
          <Badge tone="danger" icon={<Flame />}>
            {t('badges.spicy')}
          </Badge>
          <Badge tone="highlight" icon={<Star />}>
            {t('badges.popular')}
          </Badge>
          <Badge tone="solid" size="sm">
            {t('badges.new')}
          </Badge>
        </div>
      </Section>

      <Section id="cards" title={t('sections.cards')}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>{t('cards.revenue')}</CardDescription>
              <CardTitle className="font-mono text-2xl tabular-nums">
                {formatMoney(14_235_000)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge tone="success" icon={<TrendingUp />}>
                {t('cards.revenueDelta')}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>{t('cards.openTables')}</CardDescription>
              <CardTitle className="font-mono text-2xl tabular-nums">11</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-foreground-muted">
              {t('cards.openTablesDetail')}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>{t('cards.averageTicket')}</CardDescription>
              <CardTitle className="font-mono text-2xl tabular-nums">
                {formatMoney(169_500)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-foreground-muted">
              {t('cards.averageTicketDetail')}
            </CardContent>
            <CardFooter>
              <Button variant="link" size="sm">
                {t('cards.viewReport')}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </Section>

      <Section id="toasts" title={t('sections.toasts')}>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => toast.success(t('toasts.successTitle'), t('toasts.successBody'))}
          >
            {t('toasts.success')}
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.error(t('toasts.errorTitle'), t('toasts.errorBody'))}
          >
            {t('toasts.error')}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast({
                title: t('toasts.infoTitle'),
                tone: 'info',
                action: { label: t('toasts.undo'), onClick: () => undefined },
              })
            }
          >
            <BellRing />
            {t('toasts.info')}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast({
                title: t('toasts.warningTitle'),
                description: t('toasts.warningBody'),
                tone: 'warning',
              })
            }
          >
            {t('toasts.warning')}
          </Button>
        </div>
      </Section>

      <Section id="skeleton" title={t('sections.skeleton')}>
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex flex-col gap-3 p-5">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </Card>
          ))}
        </div>
      </Section>

      <Section id="empty" title={t('sections.empty')}>
        <EmptyState
          icon={<UtensilsCrossed />}
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            <Button>
              <LayoutGrid />
              {t('empty.action')}
            </Button>
          }
        />
      </Section>
    </div>
  );
}
