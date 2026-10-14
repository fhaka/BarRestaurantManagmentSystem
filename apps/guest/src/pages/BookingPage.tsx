import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, CalendarDays, CalendarX, Minus, Phone, Plus, Users } from 'lucide-react';
import { LANG_LOCALES, isLang } from '@tavolina/shared/client';
import type { PublicAvailability, PublicBookingInfo, PublicBookingResult } from '@tavolina/shared';
import { Button, EmptyState, Field, Input, Skeleton, Textarea, cn } from '@tavolina/ui';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { GuestApiError, publicApi } from '../lib/api';

/** How many dates show as quick chips; later dates use the date field. */
const QUICK_DAYS = 14;

/**
 * The public booking page (plan §5.10) at /book/<locationId>: party size, day, time, then name and
 * phone. Works on its own or embedded in the restaurant's website as an iframe.
 */
export function BookingPage({ locationId }: { locationId: number }) {
  const { t, i18n } = useTranslation();
  const locale = LANG_LOCALES[isLang(i18n.language) ? i18n.language : 'sq'];
  const queryClient = useQueryClient();
  const info = useQuery({
    queryKey: ['booking', locationId],
    queryFn: () => publicApi<PublicBookingInfo>('GET', `/locations/${locationId}/booking`),
    retry: 1,
  });
  const [party, setParty] = useState(2);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });
  const [uuid, setUuid] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<PublicBookingResult | null>(null);

  const day = date ?? info.data?.dates[0] ?? null;
  const slots = useQuery({
    queryKey: ['booking', locationId, 'slots', day, party],
    queryFn: () =>
      publicApi<PublicAvailability>(
        'GET',
        `/locations/${locationId}/availability?date=${day}&partySize=${party}`,
      ),
    enabled: Boolean(day && info.data?.enabled),
  });

  const book = useMutation({
    mutationFn: () =>
      publicApi<PublicBookingResult>('POST', `/locations/${locationId}/reservations`, {
        uuid,
        date: day,
        time,
        partySize: party,
        name: form.name.trim(),
        phone: form.phone.trim(),
        notes: form.notes.trim() || null,
      }),
    onSuccess: (r) => {
      setBooked(r);
      setUuid(crypto.randomUUID());
    },
    onError: (err) => {
      const code = err instanceof GuestApiError ? err.code : 'generic';
      if (code === 'NO_AVAILABILITY') {
        setTime(null);
        void queryClient.invalidateQueries({ queryKey: ['booking', locationId, 'slots'] });
      }
      if (code === 'VALIDATION_ERROR') return setError(t('booking.checkFields'));
      setError(
        code === 'NO_AVAILABILITY' || code === 'BOOKING_DISABLED'
          ? t(`booking.errors.${code}`)
          : code === 'NETWORK' || code === 'RATE_LIMITED'
            ? t(`errors.${code}`)
            : t('errors.generic'),
      );
    },
  });

  const formatDate = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(
      new Date(`${d}T00:00:00Z`),
    );
  const canSubmit = Boolean(
    day && time && form.name.trim().length >= 2 && form.phone.trim().length >= 6,
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-5 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
      <header className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-lg font-extrabold tracking-tight">
            {info.data?.name ?? t('appName')}
          </span>
          {info.data?.address ? (
            <span className="block truncate text-sm text-foreground-muted">
              {info.data.address}
            </span>
          ) : null}
        </span>
        <LanguageSwitch />
      </header>

      {info.isLoading ? <Skeleton className="h-96" /> : null}
      {info.isError ? <EmptyState icon={<CalendarX />} title={t('booking.notFound')} /> : null}
      {info.data && !info.data.enabled ? (
        <EmptyState
          icon={<Phone />}
          title={t('booking.disabled')}
          description={t('booking.disabledDescription')}
        />
      ) : null}

      {booked ? (
        <section className="flex flex-col items-center gap-4 rounded-card border border-border bg-surface p-6 text-center shadow-raised">
          <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success-soft-fg">
            <CalendarCheck className="size-7" aria-hidden />
          </span>
          <h1 className="text-2xl font-extrabold tracking-tight">
            {t('booking.done', { name: booked.name.split(' ')[0] })}
          </h1>
          <p className="text-lg">
            {t('booking.doneWhen', {
              date: formatDate(booked.date, { weekday: 'long', day: 'numeric', month: 'long' }),
              time: booked.time,
              count: booked.partySize,
            })}
          </p>
          <p className="rounded-control bg-surface-sunken px-4 py-2 text-sm">
            {t('booking.reference')}{' '}
            <span className="font-mono text-lg font-bold tracking-widest">{booked.reference}</span>
          </p>
          <p className="text-sm text-foreground-muted">{t('booking.doneHint')}</p>
          <Button
            variant="outline"
            onClick={() => {
              setBooked(null);
              setTime(null);
            }}
          >
            {t('booking.another')}
          </Button>
        </section>
      ) : info.data?.enabled ? (
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (canSubmit) book.mutate();
          }}
        >
          <h1 className="text-3xl font-extrabold tracking-tight">{t('booking.title')}</h1>

          <section className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-4">
            <span className="flex items-center gap-2 font-semibold">
              <Users className="size-5" aria-hidden />
              {t('booking.party')}
            </span>
            <span className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('booking.fewer')}
                disabled={party <= 1}
                onClick={() => {
                  setParty(party - 1);
                  setTime(null);
                }}
              >
                <Minus />
              </Button>
              <span
                className="w-8 text-center font-mono text-xl font-bold tabular-nums"
                aria-live="polite"
              >
                {party}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('booking.more')}
                disabled={party >= info.data.maxPartySize}
                onClick={() => {
                  setParty(party + 1);
                  setTime(null);
                }}
              >
                <Plus />
              </Button>
            </span>
          </section>
          {party >= info.data.maxPartySize ? (
            <p className="-mt-4 text-sm text-foreground-muted">
              {t('booking.bigGroup', { count: info.data.maxPartySize })}
            </p>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 font-semibold">
              <CalendarDays className="size-5" aria-hidden />
              {t('booking.day')}
            </h2>
            <div
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
              role="radiogroup"
              aria-label={t('booking.day')}
            >
              {info.data.dates.slice(0, QUICK_DAYS).map((d, i) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={day === d}
                  onClick={() => {
                    setDate(d);
                    setTime(null);
                  }}
                  className={cn(
                    'flex min-w-16 shrink-0 flex-col items-center rounded-card border px-3 py-2 transition-colors',
                    day === d
                      ? 'border-primary bg-primary text-primary-fg'
                      : 'border-border bg-surface hover:border-primary/50',
                  )}
                >
                  <span className="text-xs font-semibold capitalize">
                    {i === 0
                      ? t('booking.today')
                      : i === 1
                        ? t('booking.tomorrow')
                        : formatDate(d, { weekday: 'short' })}
                  </span>
                  <span className="text-lg font-bold">{formatDate(d, { day: 'numeric' })}</span>
                  <span className="text-xs capitalize opacity-80">
                    {formatDate(d, { month: 'short' })}
                  </span>
                </button>
              ))}
            </div>
            {info.data.dates.length > QUICK_DAYS ? (
              <Field label={t('booking.otherDay')} className="max-w-48">
                <Input
                  type="date"
                  min={info.data.dates[0]}
                  max={info.data.dates.at(-1)}
                  value={day ?? ''}
                  onChange={(e) => {
                    if (!info.data.dates.includes(e.target.value)) return;
                    setDate(e.target.value);
                    setTime(null);
                  }}
                />
              </Field>
            ) : null}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">{t('booking.time')}</h2>
            {slots.isLoading ? (
              <Skeleton className="h-28" />
            ) : !slots.data?.slots.some((s) => s.available) ? (
              <p className="rounded-card bg-surface-sunken p-4 text-sm text-foreground-muted">
                {t('booking.noTimes')}
              </p>
            ) : (
              <div
                className="grid grid-cols-4 gap-2 sm:grid-cols-5"
                role="radiogroup"
                aria-label={t('booking.time')}
              >
                {slots.data.slots.map((s) => (
                  <button
                    key={s.time}
                    type="button"
                    role="radio"
                    aria-checked={time === s.time}
                    disabled={!s.available}
                    onClick={() => setTime(s.time)}
                    className={cn(
                      'h-11 rounded-control border font-mono text-sm font-semibold tabular-nums transition-colors',
                      time === s.time
                        ? 'border-primary bg-primary text-primary-fg'
                        : 'border-border bg-surface hover:border-primary/50',
                      'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface-sunken disabled:text-foreground-subtle disabled:line-through',
                    )}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <Field label={t('booking.name')}>
              <Input
                autoComplete="name"
                value={form.name}
                maxLength={120}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label={t('booking.phone')} hint={t('booking.phoneHint')}>
              <Input
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                placeholder="+355 69 …"
                value={form.phone}
                maxLength={30}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label={t('booking.notes')}>
              <Textarea
                rows={2}
                maxLength={500}
                placeholder={t('booking.notesPlaceholder')}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
          </section>

          {error ? (
            <p
              role="alert"
              className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-soft-fg"
            >
              {error}
            </p>
          ) : null}
          <Button type="submit" size="xl" block disabled={!canSubmit} loading={book.isPending}>
            {time && day
              ? t('booking.submitAt', {
                  date: formatDate(day, { weekday: 'short', day: 'numeric', month: 'short' }),
                  time,
                })
              : t('booking.submit')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
