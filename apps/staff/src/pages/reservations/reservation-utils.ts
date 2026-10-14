import { useQuery } from '@tanstack/react-query';
import {
  TIMEZONE,
  businessDate,
  type AvailabilitySlot,
  type Reservation,
  type ReservationStatus,
} from '@tavolina/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';

export const STATUS_TONE: Record<
  ReservationStatus,
  'info' | 'primary' | 'success' | 'neutral' | 'danger' | 'reserved'
> = {
  booked: 'reserved',
  confirmed: 'primary',
  seated: 'success',
  completed: 'neutral',
  no_show: 'danger',
  cancelled: 'neutral',
};

/** Timeline block colours, matching the badges. */
export const STATUS_BLOCK: Record<ReservationStatus, string> = {
  booked: 'border-reserved bg-reserved-soft text-reserved-soft-fg',
  confirmed: 'border-primary bg-primary-soft text-primary-soft-fg',
  seated: 'border-success bg-success-soft text-success-soft-fg',
  completed: 'border-border bg-surface-sunken text-foreground-muted',
  no_show: 'border-danger bg-danger-soft text-danger-soft-fg opacity-70',
  cancelled: 'border-border bg-surface-sunken text-foreground-subtle line-through opacity-60',
};

/** The business day (04:00–04:00), so bookings just after midnight still show on "tonight". */
export const todayLocal = () => businessDate(new Date(), TIMEZONE);

export function useReservations(date: string) {
  const locationId = useSession((s) => s.locationId);
  return useQuery({
    queryKey: ['reservations', locationId, date],
    queryFn: () => api<Reservation[]>('GET', `/reservations?date=${date}`),
    refetchInterval: 60_000,
  });
}

export function useAvailability(
  date: string,
  partySize: number,
  durationMin?: number,
  excludeId?: number,
) {
  const locationId = useSession((s) => s.locationId);
  return useQuery({
    queryKey: ['reservations', 'availability', locationId, date, partySize, durationMin, excludeId],
    queryFn: () => {
      const q = new URLSearchParams({ date, partySize: String(partySize) });
      if (durationMin) q.set('durationMin', String(durationMin));
      if (excludeId) q.set('excludeId', String(excludeId));
      return api<AvailabilitySlot[]>('GET', `/reservations/availability?${q}`);
    },
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
}
