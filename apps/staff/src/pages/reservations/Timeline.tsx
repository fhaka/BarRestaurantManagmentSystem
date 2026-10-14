import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import {
  TIMEZONE,
  zonedDateTime,
  type AvailabilitySlot,
  type FloorState,
  type Reservation,
} from '@tavolina/shared';
import { cn } from '@tavolina/ui';
import { formatTime } from '../../lib/format';
import { useNow } from '../floor/floor-utils';
import { STATUS_BLOCK, todayLocal } from './reservation-utils';

const HOUR = 3_600_000;
const LANE = 44;
const LABEL_W = 112;

interface Row {
  key: string;
  label: string;
  sub: string | null;
  items: Reservation[];
}

/** Puts overlapping reservations of one row on separate lanes. */
function lanes(items: Reservation[]): Map<number, number> {
  const ends: number[] = [];
  const out = new Map<number, number>();
  for (const r of [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const start = Date.parse(r.startsAt);
    let lane = ends.findIndex((end) => end <= start);
    if (lane === -1) lane = ends.length;
    ends[lane] = Date.parse(r.endsAt);
    out.set(r.id, lane);
  }
  return out;
}

/** One day by table: who sits where and when (plan §5.10 calendar view). */
export function Timeline({
  date,
  floor,
  reservations,
  slots,
  onOpen,
}: {
  date: string;
  floor: FloorState;
  reservations: Reservation[];
  slots: AvailabilitySlot[];
  onOpen: (id: number) => void;
}) {
  const { t } = useTranslation('reservations');
  const now = useNow();

  // From the first bookable slot to two hours after the last one, widened to fit every booking.
  const starts = [
    ...slots.map((s) => Date.parse(s.startsAt)),
    ...reservations.map((r) => Date.parse(r.startsAt)),
  ];
  const ends = [
    ...slots.map((s) => Date.parse(s.startsAt) + 2 * HOUR),
    ...reservations.map((r) => Date.parse(r.endsAt)),
  ];
  const from =
    Math.floor(
      (starts.length ? Math.min(...starts) : zonedDateTime(date, 10 * 60, TIMEZONE).getTime()) /
        HOUR,
    ) * HOUR;
  const to =
    Math.ceil(
      (ends.length ? Math.max(...ends) : zonedDateTime(date, 23 * 60, TIMEZONE).getTime()) / HOUR,
    ) * HOUR;
  const span = to - from;
  const pct = (ms: number) => `${((ms - from) / span) * 100}%`;
  const hours = Array.from({ length: span / HOUR }, (_, i) => from + i * HOUR);

  const byTable = new Map<number, Reservation[]>();
  const unassigned: Reservation[] = [];
  for (const r of reservations) {
    if (r.tableId === null) unassigned.push(r);
    else byTable.set(r.tableId, [...(byTable.get(r.tableId) ?? []), r]);
  }
  const rows: { area: string | null; rows: Row[] }[] = [];
  if (unassigned.length) {
    rows.push({
      area: null,
      rows: [{ key: 'none', label: t('unassigned'), sub: null, items: unassigned }],
    });
  }
  for (const area of floor.areas) {
    const tables = floor.tables
      .filter((x) => x.areaId === area.id && (x.active || byTable.has(x.id)))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!tables.length) continue;
    rows.push({
      area: area.name,
      rows: tables.map((x) => ({
        key: String(x.id),
        label: x.name,
        sub: t('seats', { count: x.seats }),
        items: byTable.get(x.id) ?? [],
      })),
    });
  }
  const showNow = date === todayLocal() && now >= from && now <= to;

  // Open at "now" on today, otherwise at the first booking of the day.
  const scroller = useRef<HTMLDivElement>(null);
  const firstStart = reservations.length
    ? Math.min(...reservations.map((r) => Date.parse(r.startsAt)))
    : null;
  const focus = showNow ? now : firstStart;
  useEffect(() => {
    const el = scroller.current;
    if (!el || focus === null) return;
    const track = el.scrollWidth - LABEL_W;
    el.scrollLeft = Math.max(0, ((focus - from) / span) * track - 2 * 96);
    // Only when the day or its range changes, not on every clock tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, from, span, firstStart]);

  return (
    <div ref={scroller} className="overflow-x-auto rounded-card border border-border bg-surface">
      <div className="relative" style={{ minWidth: LABEL_W + hours.length * 96 }}>
        {/* Hour scale */}
        <div className="sticky top-0 z-10 flex h-9 border-b border-border bg-surface-sunken/95">
          <div
            className="sticky left-0 z-10 shrink-0 bg-surface-sunken"
            style={{ width: LABEL_W }}
          />
          <div className="relative flex-1">
            {hours.map((h) => (
              <span
                key={h}
                className="absolute top-2 pl-1 font-mono text-xs tabular-nums text-foreground-muted"
                style={{ left: pct(h) }}
              >
                {formatTime(new Date(h).toISOString())}
              </span>
            ))}
          </div>
        </div>

        {rows.map((group) => (
          <div key={group.area ?? 'none'}>
            {group.area ? (
              <div className="sticky left-0 border-b border-border bg-surface px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground-subtle">
                {group.area}
              </div>
            ) : null}
            {group.rows.map((row) => {
              const laneOf = lanes(row.items);
              const count = Math.max(1, ...[...laneOf.values()].map((l) => l + 1));
              return (
                <div key={row.key} className="flex border-b border-border last:border-b-0">
                  <div
                    className="sticky left-0 z-[5] flex shrink-0 flex-col justify-center border-r border-border bg-surface px-3"
                    style={{ width: LABEL_W, minHeight: count * LANE + 8 }}
                  >
                    <span className="font-bold">{row.label}</span>
                    {row.sub ? (
                      <span className="text-xs text-foreground-muted">{row.sub}</span>
                    ) : null}
                  </div>
                  <div className="relative flex-1" style={{ height: count * LANE + 8 }}>
                    {hours.map((h) => (
                      <span
                        key={h}
                        aria-hidden
                        className="absolute inset-y-0 border-l border-border/60"
                        style={{ left: pct(h) }}
                      />
                    ))}
                    {row.items.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => onOpen(r.id)}
                        aria-label={`${formatTime(r.startsAt)} ${r.name}, ${t('guests', { count: r.partySize })}, ${t(`status.${r.status}`)}`}
                        className={cn(
                          'absolute flex items-center gap-1.5 overflow-hidden rounded-control border-l-4 px-2 text-left text-xs shadow-raised transition-transform hover:z-10 hover:scale-[1.02]',
                          STATUS_BLOCK[r.status],
                        )}
                        style={{
                          left: pct(Date.parse(r.startsAt)),
                          width: `calc(${((Date.parse(r.endsAt) - Date.parse(r.startsAt)) / span) * 100}% - 2px)`,
                          top: 4 + (laneOf.get(r.id) ?? 0) * LANE,
                          height: LANE - 6,
                        }}
                      >
                        <span className="font-mono font-bold tabular-nums">
                          {formatTime(r.startsAt)}
                        </span>
                        <span className="truncate font-semibold">{r.name}</span>
                        <span className="ml-auto flex shrink-0 items-center gap-0.5">
                          <Users className="size-3" aria-hidden />
                          {r.partySize}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {showNow ? (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 top-0 z-20"
            style={{ left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${(now - from) / span})` }}
          >
            <span className="absolute top-1 -translate-x-1/2 rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">
              {t('now')}
            </span>
            <span className="absolute bottom-0 top-6 w-0.5 -translate-x-1/2 bg-danger" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
