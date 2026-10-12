import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudOff, RefreshCw } from 'lucide-react';
import { useErrorMessages } from '../lib/errors';
import { useMyOutbox, useOutbox, useOutboxSync, type OutboxEntry } from '../lib/outbox';
import type { ApiRequestError } from '../lib/api';
import { useRealtimeStatus } from '../lib/realtime';

/** "Offline – 3 actions waiting" (plan §5.15). Also replays the outbox when back online. */
export function OfflineBanner() {
  const { t } = useTranslation('orders');
  const { message } = useErrorMessages();
  const describe = useCallback(
    (entry: OutboxEntry, err: ApiRequestError) =>
      t('offline.failed', { label: entry.meta.label, reason: message(err) }),
    [t, message],
  );
  useOutboxSync(describe);
  const count = useMyOutbox().length;
  const flushing = useOutbox((s) => s.flushing);
  const offline = useRealtimeStatus((s) => s.status) === 'offline';
  if (!count && !offline) return null;
  return (
    <div
      role="status"
      className="sticky top-14 z-20 flex items-center justify-center gap-2 bg-warning px-4 py-2 text-sm font-semibold text-warning-fg lg:top-0 print:hidden"
    >
      {flushing ? (
        <RefreshCw className="size-4 animate-spin" aria-hidden />
      ) : (
        <CloudOff className="size-4" aria-hidden />
      )}
      {count
        ? flushing
          ? t('offline.sending', { count })
          : offline
            ? t('offline.bannerWaiting', { count })
            : t('offline.retrying', { count })
        : t('offline.banner')}
    </div>
  );
}
