import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Smartphone } from 'lucide-react';
import type { GuestSessionSummary } from '@tavolina/shared';
import { Switch, toast } from '@tavolina/ui';
import { api } from '../../lib/api';
import { useErrorMessages } from '../../lib/errors';
import { useSession } from '../../lib/session';
import { useElapsed, useNow } from '../floor/floor-utils';

/** Phones that ordered from the QR menu at this table; a waiter can stop one (plan §5.5). */
export function GuestPhones({ sessionId }: { sessionId: number }) {
  const { t } = useTranslation('orders');
  const { message } = useErrorMessages();
  const queryClient = useQueryClient();
  const locationId = useSession((s) => s.locationId);
  const can = useSession((s) => s.can);
  const now = useNow();
  const elapsed = useElapsed();
  const key = ['order', locationId, 'guests', sessionId];
  const guests = useQuery({
    queryKey: key,
    queryFn: () => api<GuestSessionSummary[]>('GET', `/table-sessions/${sessionId}/guests`),
  });
  const block = useMutation({
    mutationFn: ({ id, blocked }: { id: number; blocked: boolean }) =>
      api('POST', `/guest-sessions/${id}/block`, { body: { blocked } }),
    onSuccess: (_r, vars) => {
      toast.success(vars.blocked ? t('guest.blocked') : t('guest.unblocked'));
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(message(err)),
  });
  if (!guests.data?.length) return null;
  return (
    <section aria-labelledby="phones-title" className="border-t border-border p-3">
      <h2
        id="phones-title"
        className="mb-2 text-xs font-bold uppercase tracking-wider text-foreground-muted"
      >
        {t('guest.phones')}
      </h2>
      <ul className="flex flex-col gap-2">
        {guests.data.map((g, index) => (
          <li key={g.id} className="flex items-center gap-3 text-sm">
            <Smartphone className="size-4 shrink-0 text-foreground-muted" aria-hidden />
            <span className="flex-1">
              {t('guest.phone', { n: index + 1 })} · {t('guest.phoneItems', { count: g.itemCount })}{' '}
              · {elapsed(g.createdAt, now)}
            </span>
            {can('table.open') ? (
              <label className="flex items-center gap-2">
                <span className={g.blocked ? 'font-semibold text-danger' : 'text-foreground-muted'}>
                  {g.blocked ? t('guest.isBlocked') : t('guest.block')}
                </span>
                <Switch
                  checked={g.blocked}
                  aria-label={t('guest.blockPhone', { n: index + 1 })}
                  onCheckedChange={(blocked) => block.mutate({ id: g.id, blocked })}
                />
              </label>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
