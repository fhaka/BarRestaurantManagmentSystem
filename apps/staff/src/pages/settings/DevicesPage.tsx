import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Copy,
  KeyRound,
  Plus,
  Printer as PrinterIcon,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { printerInputSchema, type Location, type Printer } from '@tavolina/shared';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  SwitchField,
  toast,
} from '@tavolina/ui';
import { PageHeader } from '../../components/AppLayout';
import { currentLocale } from '../../i18n';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { ChipToggle } from '../menu/fields';

interface Routes {
  receiptPrinterId: number | null;
  reportPrinterId: number | null;
  stations: { stationId: number; name: string; printerId: number | null }[];
}
interface Bridge {
  id: number;
  name: string;
  lastSeenAt: string | null;
  createdAt: string;
}
interface Job {
  id: number;
  kind: string;
  status: string;
  error: string | null;
  printer: string;
  createdAt: string;
}

/** Printers, what prints where, the print bridge PC, and the fiscal codes (plan §5.11–5.12). */
export function DevicesPage() {
  const { t } = useTranslation('billing');
  const locationId = useSession((s) => s.locationId);
  const printers = useQuery({
    queryKey: ['printers', locationId],
    queryFn: () => api<Printer[]>('GET', '/printers'),
  });
  const [editing, setEditing] = useState<Printer | 'new' | null>(null);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title={t('devices.title')}
        subtitle={t('devices.subtitle')}
        actions={
          <Button variant="ghost" asChild>
            <Link to="/settings">
              <ArrowLeft />
              {t('devices.back')}
            </Link>
          </Button>
        }
      />

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{t('devices.printers')}</h2>
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus />
            {t('devices.addPrinter')}
          </Button>
        </div>
        {printers.data?.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('devices.noPrinters')}</p>
        ) : null}
        <ul className="flex flex-col divide-y divide-border">
          {printers.data?.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <PrinterIcon className="size-5 text-foreground-muted" aria-hidden />
              <span className="flex-1">
                <span className="font-semibold">{p.name}</span>
                <span className="block text-xs text-foreground-muted">
                  {p.connection === 'network'
                    ? `${p.host}:${p.port}`
                    : p.connection === 'usb'
                      ? p.devicePath
                      : t('devices.console')}{' '}
                  · {t('devices.width', { n: p.widthChars })}
                </span>
              </span>
              {!p.active ? <Badge tone="danger">{t('devices.off')}</Badge> : null}
              <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                {t('devices.edit')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      {printers.data ? <RoutesCard printers={printers.data.filter((p) => p.active)} /> : null}
      <BridgesCard />
      <JobsCard />
      <FiscalCard />

      <PrinterDialog printer={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function PrinterDialog({
  printer,
  onClose,
}: {
  printer: Printer | 'new' | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={printer !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {printer ? (
          <PrinterForm
            key={printer === 'new' ? 'new' : printer.id}
            printer={printer === 'new' ? null : printer}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PrinterForm({ printer, onClose }: { printer: Printer | null; onClose: () => void }) {
  const { t } = useTranslation('billing');
  const { message, fieldErrors, validate } = useErrorMessages();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: printer?.name ?? '',
    connection: printer?.connection ?? ('network' as Printer['connection']),
    host: printer?.host ?? '',
    port: String(printer?.port ?? 9100),
    devicePath: printer?.devicePath ?? '',
    widthChars: printer?.widthChars ?? 42,
    active: printer?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (body: unknown) =>
      printer
        ? api('PATCH', `/printers/${printer.id}`, { body })
        : api('POST', '/printers', { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['printers'] });
      void queryClient.invalidateQueries({ queryKey: ['print-routes'] });
      toast.success(t('devices.saved'));
      onClose();
    },
    onError: (err) => {
      const f = fieldErrors(err);
      if (Object.keys(f).length) setErrors(f);
      else toast.error(message(err));
    },
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/printers/${printer!.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['printers'] });
      void queryClient.invalidateQueries({ queryKey: ['print-routes'] });
      onClose();
    },
    onError: (err) => toast.error(message(err)),
  });
  const submit = () => {
    const body = {
      name: form.name,
      connection: form.connection,
      host: form.host || null,
      port: Number(form.port || 9100),
      devicePath: form.devicePath || null,
      widthChars: form.widthChars,
      active: form.active,
    };
    const result = validate(printerInputSchema, body);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    save.mutate(body);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{printer ? printer.name : t('devices.addPrinter')}</DialogTitle>
        <DialogDescription>{t('devices.printerHint')}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <Field label={t('devices.name')} error={errors.name}>
          <Input
            value={form.name}
            maxLength={80}
            placeholder={t('devices.namePlaceholder')}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {(['network', 'usb', 'console'] as const).map((c) => (
            <ChipToggle
              key={c}
              pressed={form.connection === c}
              onToggle={() => setForm({ ...form, connection: c })}
            >
              {t(`devices.connections.${c}`)}
            </ChipToggle>
          ))}
        </div>
        {form.connection === 'network' ? (
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label={t('devices.host')} error={errors.host}>
              <Input
                value={form.host}
                placeholder="192.168.1.50"
                onChange={(e) => setForm({ ...form, host: e.target.value })}
              />
            </Field>
            <Field label={t('devices.port')} error={errors.port}>
              <Input
                inputMode="numeric"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
          </div>
        ) : null}
        {form.connection === 'usb' ? (
          <Field
            label={t('devices.devicePath')}
            hint={t('devices.devicePathHint')}
            error={errors.devicePath}
          >
            <Input
              value={form.devicePath}
              placeholder="/dev/usb/lp0"
              onChange={(e) => setForm({ ...form, devicePath: e.target.value })}
            />
          </Field>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{t('devices.paper')}</span>
          {([32, 42, 48] as const).map((w) => (
            <ChipToggle
              key={w}
              pressed={form.widthChars === w}
              onToggle={() => setForm({ ...form, widthChars: w })}
            >
              {t('devices.width', { n: w })}
            </ChipToggle>
          ))}
        </div>
        <SwitchField
          label={t('devices.active')}
          checked={form.active}
          onCheckedChange={(v) => setForm({ ...form, active: v })}
        />
      </div>
      <DialogFooter>
        {printer ? (
          <Button
            variant="ghost"
            className="mr-auto text-danger"
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <Trash2 />
            {t('devices.remove')}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button loading={save.isPending} onClick={submit}>
          {t('devices.save')}
        </Button>
      </DialogFooter>
    </>
  );
}

function RoutesCard({ printers }: { printers: Printer[] }) {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const locationId = useSession((s) => s.locationId);
  const queryClient = useQueryClient();
  const routes = useQuery({
    queryKey: ['print-routes', locationId],
    queryFn: () => api<Routes>('GET', '/print-routes'),
  });
  const save = useMutation({
    mutationFn: (
      body: Omit<Routes, 'stations'> & {
        stations: { stationId: number; printerId: number | null }[];
      },
    ) => api<Routes>('PUT', '/print-routes', { body }),
    onSuccess: (r) => {
      queryClient.setQueryData(['print-routes', locationId], r);
      toast.success(t('devices.saved'));
    },
    onError: (err) => toast.error(message(err)),
  });
  if (!routes.data) return null;
  const r = routes.data;
  const options = [
    { value: 'none', label: t('devices.screensOnly') },
    ...printers.map((p) => ({ value: String(p.id), label: p.name })),
  ];
  const value = (id: number | null) => (id ? String(id) : 'none');
  const parse = (v: string) => (v === 'none' ? null : Number(v));
  const change = (patch: Partial<Routes>) => {
    const next = { ...r, ...patch };
    save.mutate({
      receiptPrinterId: next.receiptPrinterId,
      reportPrinterId: next.reportPrinterId,
      stations: next.stations.map((s) => ({ stationId: s.stationId, printerId: s.printerId })),
    });
  };
  const row = (label: string, id: number | null, onChange: (v: number | null) => void) => (
    <div key={label} className="grid items-center gap-2 sm:grid-cols-[1fr_260px]">
      <span className="font-semibold">{label}</span>
      <Select
        aria-label={label}
        value={value(id)}
        onValueChange={(v) => onChange(parse(v))}
        options={options}
      />
    </div>
  );
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-lg font-bold">{t('devices.routes')}</h2>
      <p className="text-sm text-foreground-muted">{t('devices.routesHint')}</p>
      {row(t('devices.receipts'), r.receiptPrinterId, (v) => change({ receiptPrinterId: v }))}
      {row(t('devices.reports'), r.reportPrinterId, (v) => change({ reportPrinterId: v }))}
      {r.stations.map((s) =>
        row(t('devices.stationTickets', { name: s.name }), s.printerId, (v) =>
          change({
            stations: r.stations.map((x) =>
              x.stationId === s.stationId ? { ...x, printerId: v } : x,
            ),
          }),
        ),
      )}
    </Card>
  );
}

function BridgesCard() {
  const { t } = useTranslation('billing');
  const { message } = useErrorMessages();
  const locationId = useSession((s) => s.locationId);
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const bridges = useQuery({
    queryKey: ['print-bridges', locationId],
    queryFn: () => api<Bridge[]>('GET', '/print-bridges'),
  });
  const create = useMutation({
    mutationFn: () =>
      api<{ name: string; token: string }>('POST', '/print-bridges', {
        body: { name: t('devices.bridgeDefault') },
      }),
    onSuccess: (b) => {
      setCreated(b);
      void queryClient.invalidateQueries({ queryKey: ['print-bridges'] });
    },
    onError: (err) => toast.error(message(err)),
  });
  const revoke = useMutation({
    mutationFn: (id: number) => api('DELETE', `/print-bridges/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['print-bridges'] }),
    onError: (err) => toast.error(message(err)),
  });
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{t('devices.bridges')}</h2>
        <Button
          size="sm"
          variant="outline"
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          <KeyRound />
          {t('devices.newKey')}
        </Button>
      </div>
      <p className="text-sm text-foreground-muted">{t('devices.bridgesHint')}</p>
      <ul className="flex flex-col divide-y divide-border">
        {bridges.data?.map((b) => (
          <li key={b.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="flex-1">
              <span className="font-semibold">{b.name}</span>
              <span className="block text-xs text-foreground-muted">
                {b.lastSeenAt
                  ? t('devices.lastSeen', {
                      time: new Date(b.lastSeenAt).toLocaleString(currentLocale()),
                    })
                  : t('devices.neverSeen')}
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={() => revoke.mutate(b.id)}
            >
              {t('devices.revoke')}
            </Button>
          </li>
        ))}
      </ul>
      <Dialog open={created !== null} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('devices.keyTitle')}</DialogTitle>
            <DialogDescription>{t('devices.keyBody')}</DialogDescription>
          </DialogHeader>
          <code className="break-all rounded-control bg-surface-sunken p-3 font-mono text-sm">
            {created?.token}
          </code>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(created?.token ?? '');
                toast.success(t('devices.copied'));
              }}
            >
              <Copy />
              {t('devices.copy')}
            </Button>
            <Button onClick={() => setCreated(null)}>{t('devices.done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function JobsCard() {
  const { t } = useTranslation('billing');
  const locationId = useSession((s) => s.locationId);
  const queryClient = useQueryClient();
  const jobs = useQuery({
    queryKey: ['print-jobs', locationId],
    queryFn: () => api<Job[]>('GET', '/print-jobs'),
    refetchInterval: 15_000,
  });
  const retry = useMutation({
    mutationFn: (id: number) => api('POST', `/print-jobs/${id}/retry`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['print-jobs'] }),
  });
  if (!jobs.data?.length) return null;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-lg font-bold">{t('devices.jobs')}</h2>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {jobs.data.slice(0, 15).map((j) => (
          <li key={j.id} className="flex items-center gap-3 py-2">
            <span className="flex-1">
              {t(`devices.kinds.${j.kind as 'ticket'}`)} · {j.printer}
              <span className="block text-xs text-foreground-muted">
                {new Date(j.createdAt).toLocaleTimeString(currentLocale())}
                {j.error ? ` · ${j.error}` : ''}
              </span>
            </span>
            <Badge
              tone={
                j.status === 'printed' ? 'success' : j.status === 'failed' ? 'danger' : 'warning'
              }
            >
              {t(`devices.status.${j.status as 'printed'}`)}
            </Badge>
            {j.status !== 'printed' ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('devices.retry')}
                onClick={() => retry.mutate(j.id)}
              >
                <RotateCw />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FiscalCard() {
  const { message } = useErrorMessages();
  const locationId = useSession((s) => s.locationId);
  const queryClient = useQueryClient();
  const location = useQuery({
    queryKey: ['location', locationId],
    queryFn: () => api<Location>('GET', '/locations/current'),
  });
  if (!location.data) return null;
  return (
    <FiscalForm
      key={location.dataUpdatedAt}
      location={location.data}
      onSaved={(l) => queryClient.setQueryData(['location', locationId], l)}
      onError={(e) => toast.error(message(e))}
    />
  );
}

function FiscalForm({
  location,
  onSaved,
  onError,
}: {
  location: Location;
  onSaved: (l: Location) => void;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation('billing');
  const [codes, setCodes] = useState(location.settings.fiscal);
  const save = useMutation({
    mutationFn: () =>
      api<Location>('PATCH', `/locations/${location.id}`, {
        body: { settings: { fiscal: codes } },
      }),
    onSuccess: (l) => {
      onSaved(l);
      toast.success(t('devices.saved'));
    },
    onError,
  });
  const field = (key: keyof typeof codes) => (
    <Field label={t(`devices.fiscal.${key}`)}>
      <Input
        value={codes[key]}
        maxLength={20}
        onChange={(e) => setCodes({ ...codes, [key]: e.target.value.trim() })}
      />
    </Field>
  );
  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{t('devices.fiscal.title')}</h2>
      <p className="text-sm text-foreground-muted">{t('devices.fiscal.hint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('businessUnitCode')}
        {field('tcrCode')}
        {field('softwareCode')}
        {field('maintainerCode')}
      </div>
      <Button className="self-start" loading={save.isPending} onClick={() => save.mutate()}>
        {t('devices.save')}
      </Button>
    </Card>
  );
}
