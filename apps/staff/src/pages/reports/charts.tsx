import { useState, type ReactNode } from 'react';
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { formatMoney } from '@tavolina/shared';
import { cn } from '@tavolina/ui';
import { axisMoney, formatBp, formatNumber } from './report-utils';

// Roles, not raw colours: the theme tokens switch for dark mode.
const C = {
  primary: 'rgb(var(--primary))',
  muted: 'rgb(var(--foreground-subtle))',
  grid: 'rgb(var(--border))',
  axis: 'rgb(var(--foreground-muted))',
  surface: 'rgb(var(--surface))',
};
const CATEGORICAL = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'].map(
  (v) => `rgb(${v})`,
);
const tick = { fill: C.axis, fontSize: 12 };

/** A titled chart; `legend` names the series when there are two or more. */
export function ChartCard({
  title,
  legend,
  action,
  children,
  className,
}: {
  title: string;
  legend?: { label: string; color: string; dashed?: boolean }[];
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-raised',
        className,
      )}
    >
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">{title}</span>
        <span className="flex flex-wrap items-center gap-3 text-xs text-foreground-muted">
          {legend?.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5">
              <svg width="18" height="8" aria-hidden>
                <line
                  x1="1"
                  x2="17"
                  y1="4"
                  y2="4"
                  stroke={l.color}
                  strokeWidth="2"
                  strokeDasharray={l.dashed ? '4 3' : undefined}
                  strokeLinecap="round"
                />
              </svg>
              {l.label}
            </span>
          ))}
          {action}
        </span>
      </figcaption>
      {children}
    </figure>
  );
}

function TooltipBox({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string; color?: string; dashed?: boolean }[];
}) {
  return (
    <div className="rounded-control border border-border bg-surface px-3 py-2 text-xs shadow-overlay">
      <p className="mb-1 font-semibold text-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-foreground-muted">
          {r.color ? (
            <span
              className={cn(
                'inline-block h-0.5 w-3',
                r.dashed && 'border-t-2 border-dashed bg-transparent',
              )}
              style={r.dashed ? { borderColor: r.color } : { background: r.color }}
              aria-hidden
            />
          ) : null}
          <span>{r.label}</span>
          <span className="ml-auto pl-3 font-mono font-semibold tabular-nums text-foreground">
            {r.value}
          </span>
        </p>
      ))}
    </div>
  );
}

/** Money over time (line); an optional dashed comparison series (e.g. last week). */
export function TrendChart({
  data,
  valueLabel,
  compareLabel,
  height = 260,
}: {
  data: { label: string; value: number | null; compare?: number }[];
  valueLabel: string;
  compareLabel?: string;
  height?: number;
}) {
  const compare = compareLabel !== undefined;
  return (
    <div style={{ height }} role="img" aria-label={valueLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={C.grid} strokeOpacity={0.6} vertical={false} />
          <XAxis
            dataKey="label"
            tick={tick}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            minTickGap={16}
          />
          <YAxis
            tick={tick}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={axisMoney}
          />
          <Tooltip
            cursor={{ stroke: C.axis, strokeDasharray: '3 3' }}
            content={({ active, payload, label }: TooltipProps<number, string>) =>
              active && payload?.length ? (
                <TooltipBox
                  title={String(label)}
                  rows={payload.map((p) => ({
                    label: p.dataKey === 'compare' ? compareLabel! : valueLabel,
                    value: formatMoney(Number(p.value)),
                    color: p.dataKey === 'compare' ? C.muted : C.primary,
                    dashed: p.dataKey === 'compare',
                  }))}
                />
              ) : null
            }
          />
          {compare ? (
            <Line
              type="monotone"
              dataKey="compare"
              stroke={C.muted}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, stroke: C.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="value"
            stroke={C.primary}
            strokeWidth={2}
            dot={
              data.length <= 14
                ? { r: 3, fill: C.primary, stroke: C.surface, strokeWidth: 2 }
                : false
            }
            activeDot={{ r: 5, stroke: C.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Ranked magnitudes (horizontal bars), e.g. top items: the label and value sit on the row and the
 * bar runs underneath, so it works in a narrow card too. Hover or focus shows the detail.
 */
export function RankBars({
  data,
  format = (v) => formatMoney(v),
  valueLabel,
}: {
  data: { label: string; value: number; detail?: string }[];
  format?: (v: number) => string;
  valueLabel: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ol className="flex flex-col gap-2.5" aria-label={valueLabel}>
      {data.map((d) => (
        <li key={d.label} className="group relative flex flex-col gap-1" tabIndex={0}>
          <span className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{d.label}</span>
            <span className="shrink-0 font-mono font-semibold tabular-nums">{format(d.value)}</span>
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max(1, (d.value / max) * 100)}%`, background: C.primary }}
            />
          </span>
          {d.detail ? (
            <span className="pointer-events-none absolute right-0 top-full z-10 mt-1 hidden group-hover:block group-focus:block">
              <TooltipBox
                title={d.label}
                rows={[
                  { label: valueLabel, value: format(d.value) },
                  { label: '', value: d.detail },
                ]}
              />
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Share of a whole (donut) — only for payment methods (plan §5.13), always with a value legend. */
export function ShareDonut({ data }: { data: { key: string; label: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="size-44 shrink-0"
        role="img"
        aria-label={data.map((d) => `${d.label} ${formatMoney(d.value)}`).join(', ')}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              stroke={C.surface}
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d, i) => (
                <Cell key={d.key} fill={CATEGORICAL[i % CATEGORICAL.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }: TooltipProps<number, string>) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={String(payload[0]!.name)}
                    rows={[
                      {
                        label: formatBp(
                          total ? Math.round((Number(payload[0]!.value) * 10_000) / total) : 0,
                        ),
                        value: formatMoney(Number(payload[0]!.value)),
                      },
                    ]}
                  />
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex w-full flex-col gap-2 text-sm">
        {data.map((d, i) => (
          <li key={d.key} className="flex items-center gap-2">
            <span
              className="size-3 shrink-0 rounded-xs"
              style={{ background: CATEGORICAL[i % CATEGORICAL.length] }}
              aria-hidden
            />
            <span className="font-semibold">{d.label}</span>
            <span className="ml-auto font-mono tabular-nums">{formatMoney(d.value)}</span>
            <span className="w-14 text-right font-mono text-xs tabular-nums text-foreground-muted">
              {formatBp(total ? Math.round((d.value * 10_000) / total) : 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Busiest hours (plan §5.13): weekday × hour, one hue from light to dark by revenue. Each cell
 * names itself for screen readers and shows its numbers on hover or focus.
 */
export function Heatmap({
  cells,
  weekdays,
  emptyLabel,
}: {
  cells: { weekday: number; hour: number; revenueMinor: number; orders: number }[];
  weekdays: string[];
  emptyLabel: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  if (!cells.length) return <p className="text-sm text-foreground-muted">{emptyLabel}</p>;
  const hours = [...new Set(cells.map((c) => c.hour))];
  const first = Math.min(...hours.map((h) => (h + 20) % 24));
  const last = Math.max(...hours.map((h) => (h + 20) % 24));
  // In business-day order (04:00 first) so a late night sits at the end of its row.
  const columns = Array.from({ length: last - first + 1 }, (_, i) => (first + i + 4) % 24);
  const max = Math.max(...cells.map((c) => c.revenueMinor));
  const at = new Map(cells.map((c) => [`${c.weekday}:${c.hour}`, c]));
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-xs" role="grid">
        <thead>
          <tr>
            <th />
            {columns.map((h) => (
              <th
                key={h}
                scope="col"
                className="px-0.5 pb-1 text-center font-mono font-normal text-foreground-muted"
              >
                {String(h).padStart(2, '0')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weekdays.map((day, weekday) => (
            <tr key={day}>
              <th
                scope="row"
                className="pr-2 text-left font-semibold capitalize text-foreground-muted"
              >
                {day}
              </th>
              {columns.map((hour) => {
                const key = `${weekday}:${hour}`;
                const c = at.get(key);
                const share = c && max ? c.revenueMinor / max : 0;
                const label = `${day} ${String(hour).padStart(2, '0')}:00 · ${formatMoney(c?.revenueMinor ?? 0)} · ${formatNumber(c?.orders ?? 0)}`;
                return (
                  <td key={hour} className="relative p-0">
                    <button
                      type="button"
                      aria-label={label}
                      onMouseEnter={() => setHover(key)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(key)}
                      onBlur={() => setHover(null)}
                      className="block size-7 rounded-[4px] outline-offset-1 sm:size-8"
                      style={{
                        background: share
                          ? `rgb(var(--primary) / ${0.08 + share * 0.92})`
                          : 'rgb(var(--surface-sunken))',
                      }}
                    />
                    {hover === key ? (
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap">
                        <TooltipBox
                          title={`${day} ${String(hour).padStart(2, '0')}:00`}
                          rows={[
                            { label: '', value: formatMoney(c?.revenueMinor ?? 0) },
                            { label: '#', value: formatNumber(c?.orders ?? 0) },
                          ]}
                        />
                      </span>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
