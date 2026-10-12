import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Bell, BellOff, History, RotateCcw, WifiOff } from 'lucide-react';
import {
  applyTheme,
  Button,
  Sheet,
  SheetContent,
  SheetTitle,
  Toaster,
  cn,
  toast,
  type ThemePreference,
} from '@tavolina/ui';
import type { KdsBoard, KdsTicket, KdsTicketItem } from '@tavolina/shared';
import { UserMenu } from '../../components/UserMenu';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { followStation, useRealtime, useRealtimeStatus } from '../../lib/realtime';
import { useSession } from '../../lib/session';
import { useNow } from '../floor/floor-utils';

const STATION_KEY = 'tavolina.kdsStation';

interface Station {
  id: number;
  name: string;
  type: string;
}

function storedStation(): number | null {
  try {
    const value = Number(localStorage.getItem(STATION_KEY));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function storedTheme(): ThemePreference {
  try {
    const value = localStorage.getItem('tavolina.theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function storeStation(id: number | null) {
  try {
    if (id) localStorage.setItem(STATION_KEY, String(id));
    else localStorage.removeItem(STATION_KEY);
  } catch {
    // The choice just won't survive a reload.
  }
}

/** Kitchen / bar screen (plan §5.4): always dark, big type, readable from two metres. */
export function KdsPage() {
  const { t } = useTranslation('kds');
  const { t: tc } = useTranslation();
  const locationId = useSession((s) => s.locationId);
  const [stationId, setStationId] = useState<number | null>(storedStation);
  useRealtime();

  // The KDS is dark whatever the device theme; restore the user's theme when leaving.
  useEffect(() => {
    applyTheme('dark');
    return () => applyTheme(storedTheme());
  }, []);

  const stations = useQuery({
    queryKey: ['kds', 'stations', locationId],
    queryFn: () => api<Station[]>('GET', '/kds/stations'),
  });
  const station = stations.data?.find((s) => s.id === stationId) ?? null;

  useEffect(() => {
    followStation(station?.id ?? null);
    return () => followStation(null);
  }, [station?.id]);

  const choose = (id: number | null) => {
    storeStation(id);
    setStationId(id);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {station ? (
        <Board station={station} onSwitch={() => choose(null)} />
      ) : (
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 p-6">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-3xl font-extrabold">{t('chooseStation')}</h1>
            <UserMenu compact />
          </div>
          <div className="grid gap-3">
            {stations.data?.map((s) => (
              <Button
                key={s.id}
                size="xl"
                variant="outline"
                className="h-20 text-2xl"
                onClick={() => choose(s.id)}
              >
                {s.name}
              </Button>
            ))}
          </div>
          <Button variant="ghost" asChild>
            <Link to="/">
              <ArrowLeft />
              {t('exit')}
            </Link>
          </Button>
        </div>
      )}
      <Toaster closeLabel={tc('actions.close')} />
    </div>
  );
}

type Column = 'new' | 'in_progress' | 'ready';
const COLUMNS: Column[] = ['new', 'in_progress', 'ready'];

/** Green under 10 minutes, amber under 20, red after (plan §5.4). */
function ageTone(createdAt: string, now: number) {
  const minutes = (now - new Date(createdAt).getTime()) / 60_000;
  return minutes < 10 ? 'fresh' : minutes < 20 ? 'late' : 'overdue';
}

const AGE_STYLE = {
  fresh: 'bg-success text-success-fg',
  late: 'bg-warning text-warning-fg',
  overdue: 'bg-danger text-danger-fg animate-pulse motion-reduce:animate-none',
} as const;

function clock(createdAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function Board({ station, onSwitch }: { station: Station; onSwitch: () => void }) {
  const { t } = useTranslation('kds');
  const { message } = useErrorMessages();
  const queryClient = useQueryClient();
  const locationId = useSession((s) => s.locationId);
  const online = useRealtimeStatus((s) => s.status) !== 'offline';
  const now = useNow(1000);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef<Set<number> | null>(null);
  const queryKey = ['kds', 'board', locationId, station.id];
  const board = useQuery({
    queryKey,
    queryFn: () => api<KdsBoard>('GET', `/kds/stations/${station.id}/board`),
    // Socket events refresh it; polling is the fallback if a message is missed.
    refetchInterval: 20_000,
  });

  // A short chime for each new ticket, once the cook has allowed sound (browsers need a tap first).
  useEffect(() => {
    const ids = new Set(board.data?.tickets.map((x) => x.id) ?? []);
    if (seen.current && sound && audio.current) {
      if ([...ids].some((id) => !seen.current!.has(id))) chime(audio.current);
    }
    if (board.data) seen.current = ids;
  }, [board.data, sound]);

  const mutation = useMutation({
    mutationFn: ({
      path,
      method,
      body,
    }: {
      path: string;
      method: 'POST' | 'PATCH';
      body?: unknown;
    }) => api(method, path, { body }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['kds', 'board'] }),
    onError: (err) => toast.error(message(err)),
  });

  const advance = (item: KdsTicketItem) => {
    if (item.held || !['sent', 'preparing'].includes(item.status)) return;
    mutation.mutate({
      method: 'PATCH',
      path: `/order-items/${item.id}/status`,
      body: { status: item.status === 'sent' ? 'preparing' : 'ready' },
    });
  };
  const bump = (ticket: KdsTicket) =>
    mutation.mutate({ method: 'POST', path: `/kds/tickets/${ticket.id}/bump` });
  const recall = (ticket: KdsTicket) =>
    mutation.mutate({ method: 'POST', path: `/kds/tickets/${ticket.id}/recall` });

  const tickets = board.data?.tickets ?? [];
  // "All day": how many of each dish are still to cook across open tickets.
  const allDay = new Map<string, number>();
  for (const ticket of tickets) {
    for (const item of ticket.items) {
      if (item.status === 'sent' || item.status === 'preparing') {
        const key = item.variantName ? `${item.name} · ${item.variantName}` : item.name;
        allDay.set(key, (allDay.get(key) ?? 0) + item.qty);
      }
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon" asChild aria-label={t('exit')}>
          <Link to="/">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="text-2xl font-extrabold tracking-tight">{station.name}</h1>
        <Button variant="outline" size="sm" onClick={onSwitch}>
          {t('switchStation')}
        </Button>
        <div
          className="flex min-w-0 flex-1 flex-wrap gap-2 overflow-hidden"
          aria-label={t('allDay')}
        >
          {[...allDay].map(([name, qty]) => (
            <span
              key={name}
              className="rounded-full bg-surface-sunken px-3 py-1 text-sm font-semibold"
            >
              <span className="font-mono">{qty}×</span> {name}
            </span>
          ))}
        </div>
        <Button
          variant={sound ? 'secondary' : 'outline'}
          size="icon"
          aria-pressed={sound}
          aria-label={sound ? t('soundOff') : t('soundOn')}
          onClick={() => {
            if (!audio.current) audio.current = new AudioContext();
            void audio.current.resume();
            if (!sound) chime(audio.current);
            setSound(!sound);
          }}
        >
          {sound ? <Bell /> : <BellOff />}
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={t('history')}
          onClick={() => setHistoryOpen(true)}
        >
          <History />
        </Button>
        <UserMenu compact />
      </header>

      {!online ? (
        <div
          role="alert"
          className="flex items-center justify-center gap-2 bg-danger px-4 py-2 text-lg font-bold text-danger-fg"
        >
          <WifiOff className="size-5" aria-hidden />
          {t('offline')}
        </div>
      ) : null}

      <div className="grid flex-1 gap-3 overflow-x-auto p-3 md:grid-cols-3">
        {COLUMNS.map((column) => {
          const list = tickets.filter((x) => x.status === column);
          return (
            <section
              key={column}
              aria-labelledby={`col-${column}`}
              className="flex min-w-72 flex-col gap-3"
            >
              <h2
                id={`col-${column}`}
                className="flex items-center gap-2 text-lg font-bold uppercase tracking-wider text-foreground-muted"
              >
                {t(`columns.${column}`)}
                <span className="rounded-full bg-surface-sunken px-2.5 font-mono text-base">
                  {list.length}
                </span>
              </h2>
              {list.map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  now={now}
                  onBump={() => bump(ticket)}
                  onRecall={() => recall(ticket)}
                  onAdvance={advance}
                />
              ))}
            </section>
          );
        })}
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" closeLabel={t('close')}>
          <SheetTitle className="mb-4 text-2xl font-extrabold">{t('history')}</SheetTitle>
          <div className="flex flex-col gap-3">
            {board.data?.recent.length === 0 ? (
              <p className="text-foreground-muted">{t('noHistory')}</p>
            ) : null}
            {board.data?.recent.map((ticket) => (
              <div key={ticket.id} className="rounded-card border border-border p-3">
                <p className="font-bold">
                  #{ticket.number} · {ticketTitle(ticket, t)}
                </p>
                <p className="text-sm text-foreground-muted">
                  {ticket.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                </p>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function ticketTitle(
  ticket: KdsTicket,
  t: (key: 'table' | 'takeaway' | 'delivery', o?: Record<string, unknown>) => string,
) {
  if (ticket.tableNames.length) return t('table', { names: ticket.tableNames.join(' + ') });
  return `${t(ticket.orderType === 'delivery' ? 'delivery' : 'takeaway')}${ticket.customerName ? ` · ${ticket.customerName}` : ''}`;
}

function TicketCard({
  ticket,
  now,
  onBump,
  onRecall,
  onAdvance,
}: {
  ticket: KdsTicket;
  now: number;
  onBump: () => void;
  onRecall: () => void;
  onAdvance: (item: KdsTicketItem) => void;
}) {
  const { t } = useTranslation('kds');
  const ready = ticket.status === 'ready';
  const tone = ready ? null : ageTone(ticket.createdAt, now);
  const waiting = ticket.items.some(
    (i) => !i.held && (i.status === 'sent' || i.status === 'preparing'),
  );
  return (
    <article
      className={cn(
        'overflow-hidden rounded-card border-2 bg-surface',
        ready ? 'border-success' : 'border-border',
      )}
    >
      {/* Tapping the header bumps the whole ticket. */}
      <button
        type="button"
        disabled={!waiting}
        onClick={onBump}
        aria-label={t('bump', { number: ticket.number })}
        className={cn(
          'flex w-full items-center justify-between gap-2 px-4 py-3 text-left',
          tone ? AGE_STYLE[tone] : 'bg-success-soft text-success-soft-fg',
        )}
      >
        <span className="flex flex-col">
          <span className="text-2xl font-extrabold">
            #{ticket.number} · {ticketTitle(ticket, t)}
          </span>
          <span className="text-sm font-semibold opacity-90">
            {t('orderNo', { number: ticket.orderNumber })}
            {ticket.waiterName ? ` · ${ticket.waiterName}` : ''}
          </span>
        </span>
        <span className="font-mono text-3xl font-bold tabular-nums">
          {clock(ticket.createdAt, now)}
        </span>
      </button>
      <ul className="divide-y divide-border">
        {ticket.items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onAdvance(item)}
              disabled={item.held || !['sent', 'preparing'].includes(item.status)}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3 text-left text-[22px] leading-tight',
                item.status === 'preparing' && 'bg-highlight-soft text-highlight-soft-fg',
                (item.status === 'ready' || item.status === 'served') && 'text-success',
                item.status === 'voided' && 'text-danger line-through opacity-70',
                item.held && 'opacity-50',
              )}
            >
              <span className="w-10 shrink-0 font-mono font-extrabold">{item.qty}×</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-bold">
                  {item.name}
                  {item.variantName ? (
                    <span className="font-semibold"> · {item.variantName}</span>
                  ) : null}
                </span>
                {item.modifiers.length ? (
                  <span className="text-lg">{item.modifiers.join(', ')}</span>
                ) : null}
                {item.notes ? (
                  <span className="text-lg font-bold text-warning">⚠ {item.notes}</span>
                ) : null}
                {item.comboName || item.seat || item.course ? (
                  <span className="text-base text-foreground-muted">
                    {[
                      item.comboName,
                      item.seat ? t('seat', { n: item.seat }) : null,
                      item.course ? t('course', { n: item.course }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-base font-bold uppercase">
                {item.held ? t('held') : t(`itemStatus.${item.status}`)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {ready ? (
        <div className="border-t border-border p-2">
          <Button variant="outline" block size="lg" onClick={onRecall}>
            <RotateCcw />
            {t('recall')}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function chime(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.6);
}
