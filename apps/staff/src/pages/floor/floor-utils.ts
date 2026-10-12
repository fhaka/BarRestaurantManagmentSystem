import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Brush,
  CalendarClock,
  ChefHat,
  Circle,
  ClipboardList,
  Receipt,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { FloorState, FloorTable, TableStatus } from '@tavolina/shared';
import { toast } from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';

/** Status is shown with colour + icon + label, never colour alone (plan §12). */
export const STATUS_STYLE: Record<
  TableStatus,
  {
    icon: LucideIcon;
    tone: 'neutral' | 'info' | 'primary' | 'success' | 'highlight' | 'warning' | 'reserved';
    tile: string;
  }
> = {
  free: { icon: Circle, tone: 'neutral', tile: 'border-border-strong bg-surface text-foreground' },
  occupied: { icon: Users, tone: 'info', tile: 'border-info bg-info-soft text-info-soft-fg' },
  ordered: {
    icon: ClipboardList,
    tone: 'primary',
    tile: 'border-primary bg-primary-soft text-primary-soft-fg',
  },
  food_ready: {
    icon: ChefHat,
    tone: 'success',
    tile: 'border-success bg-success-soft text-success-soft-fg',
  },
  bill_requested: {
    icon: Receipt,
    tone: 'highlight',
    tile: 'border-highlight bg-highlight-soft text-highlight-soft-fg',
  },
  needs_cleaning: {
    icon: Brush,
    tone: 'warning',
    tile: 'border-warning border-dashed bg-warning-soft text-warning-soft-fg',
  },
  reserved: {
    icon: CalendarClock,
    tone: 'reserved',
    tile: 'border-reserved bg-reserved-soft text-reserved-soft-fg',
  },
};

export function useFloorQuery() {
  const locationId = useSession((s) => s.locationId);
  return useQuery({
    queryKey: ['floor', locationId],
    queryFn: () => api<FloorState>('GET', '/floor'),
    // Socket events keep it fresh; this is a safety net if a socket message is ever missed.
    refetchInterval: 60_000,
  });
}

/** A floor action that returns the new floor state; the cache is updated straight away. */
export function useFloorMutation<TVars>(
  fn: (vars: TVars) => Promise<FloorState>,
  options: { success?: (vars: TVars) => string; onSuccess?: () => void } = {},
) {
  const queryClient = useQueryClient();
  const locationId = useSession((s) => s.locationId);
  const { message } = useErrorMessages();
  return useMutation({
    mutationFn: fn,
    onSuccess: (floor, vars) => {
      queryClient.setQueryData(['floor', locationId], floor);
      if (options.success) toast.success(options.success(vars));
      options.onSuccess?.();
    },
    onError: (err) => {
      toast.error(message(err));
      void queryClient.invalidateQueries({ queryKey: ['floor'] });
    },
  });
}

/** Current time, refreshed every `intervalMs` (for "open for 25 min" labels). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useElapsed() {
  const { t } = useTranslation('floor');
  return (iso: string, now: number) => {
    const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
    return minutes < 60
      ? t('minutes', { count: minutes })
      : t('hours', { h: Math.floor(minutes / 60), m: minutes % 60 });
  };
}

/** Grid area actually used by tables, plus a margin, so the live view is not mostly empty space. */
export function usedExtent(tables: Pick<FloorTable, 'x' | 'y' | 'w' | 'h'>[]) {
  const cols = Math.max(16, ...tables.map((t) => t.x + t.w + 2));
  const rows = Math.max(10, ...tables.map((t) => t.y + t.h + 2));
  return { cols, rows };
}
