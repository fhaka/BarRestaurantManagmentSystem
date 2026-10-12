import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { GUEST_NAMESPACE } from '@tavolina/shared/client';

/**
 * Live updates for the table: the server only says "something changed at your table" and the
 * phone refetches its order. Returns whether the connection is up (polling covers the rest).
 */
export function useTableUpdates(tableToken: string): boolean {
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const socket = io(GUEST_NAMESPACE, {
      path: '/socket.io',
      auth: { tableToken },
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 10_000,
    });
    let connectedBefore = false;
    socket.on('connect', () => {
      setOnline(true);
      if (connectedBefore) void queryClient.invalidateQueries({ queryKey: ['state'] });
      connectedBefore = true;
    });
    socket.on('disconnect', () => setOnline(false));
    socket.on('connect_error', () => setOnline(false));
    socket.on('guest.updated', () => void queryClient.invalidateQueries({ queryKey: ['state'] }));
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [tableToken, queryClient]);
  return online;
}
