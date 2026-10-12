import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import {
  REALTIME_EVENTS,
  type ItemStatusChangedData,
  type RealtimeEnvelope,
} from '@tavolina/shared';
import { toast } from '@tavolina/ui';
import i18n from '../i18n';
import { refreshSession } from './api';
import { useSession } from './session';

export type RealtimeStatus = 'connecting' | 'online' | 'offline';

export const useRealtimeStatus = create<{ status: RealtimeStatus }>(() => ({
  status: 'connecting',
}));

/** Which cached queries each event makes stale. Events are hints; the REST API is the truth. */
const INVALIDATES: Record<(typeof REALTIME_EVENTS)[number], string[]> = {
  'table.updated': ['floor'],
  'menu.item_availability': ['menu'],
  'order.items_sent': ['order', 'orders', 'kds'],
  'order_item.status_changed': ['order', 'orders', 'kds'],
  'kds.ticket_bumped': ['kds'],
};

// The KDS screen follows one station; remembered so a reconnect joins it again.
let currentSocket: Socket | null = null;
let wantedStation: number | null = null;

/** Receive one station's ticket events (KDS). Pass null to stop. */
export function followStation(stationId: number | null): void {
  wantedStation = stationId;
  if (stationId && currentSocket?.connected) currentSocket.emit('station:join', { stationId });
}

/** "Food ready" for the waiter who owns the table (plan §5.5). */
function notifyReady(event: RealtimeEnvelope<ItemStatusChangedData>) {
  const me = useSession.getState().user?.id;
  if (!me || event.data.waiterId !== me) return;
  const ready = event.data.items.filter((i) => i.status === 'ready');
  if (!ready.length) return;
  const where = event.data.tableNames.length
    ? i18n.t('orders:readyToast.table', { tables: event.data.tableNames.join(' + ') })
    : i18n.t('orders:readyToast.order');
  toast({
    tone: 'success',
    title: i18n.t('orders:readyToast.title', { where }),
    description: ready.map((i) => i.name).join(', '),
    duration: 8000,
  });
  try {
    navigator.vibrate?.([120, 60, 120]);
  } catch {
    // Vibration is optional.
  }
}

/**
 * Keeps one Socket.IO connection for the signed-in user and current location (mounted in the app
 * layout). Reconnects with a fresh token after refreshes, and refetches everything after a
 * reconnect because events may have been missed while offline.
 */
export function useRealtime(): void {
  const queryClient = useQueryClient();
  const locationId = useSession((s) => s.locationId);
  const authenticated = useSession((s) => s.status === 'authenticated');

  useEffect(() => {
    if (!authenticated || !locationId) return;
    const setStatus = (status: RealtimeStatus) => useRealtimeStatus.setState({ status });

    const socket: Socket = io({
      path: '/socket.io',
      // A function, so every (re)connect sends the current access token.
      auth: (cb) => cb({ token: useSession.getState().accessToken ?? '', locationId }),
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });

    currentSocket = socket;
    let connectedBefore = false;
    socket.on('connect', () => {
      setStatus('online');
      if (wantedStation) socket.emit('station:join', { stationId: wantedStation });
      // After a drop we may have missed events: refetch what is on screen.
      if (connectedBefore) void queryClient.invalidateQueries();
      connectedBefore = true;
    });
    socket.on('disconnect', () => setStatus('offline'));
    socket.on('connect_error', async (err) => {
      setStatus('offline');
      // The access token expired while connected or offline: refresh it, then try again.
      if (err.message === 'token_expired' || err.message === 'unauthorized') {
        if ((await refreshSession()) === 'ok') socket.connect();
      }
    });

    for (const type of REALTIME_EVENTS) {
      socket.on(type, (event: RealtimeEnvelope) => {
        if (event.locationId !== locationId) return;
        for (const key of INVALIDATES[type])
          void queryClient.invalidateQueries({ queryKey: [key] });
        if (type === 'order_item.status_changed') {
          notifyReady(event as unknown as RealtimeEnvelope<ItemStatusChangedData>);
        }
      });
    }

    return () => {
      currentSocket = null;
      socket.removeAllListeners();
      socket.disconnect();
      setStatus('connecting');
    };
  }, [authenticated, locationId, queryClient]);
}
