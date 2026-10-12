import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { toast } from '@tavolina/ui';
import { api, ApiRequestError, NetworkError } from './api';
import { useSession } from './session';

/**
 * Offline outbox (plan §5.15). Waiter actions that fail because the Wi-Fi dropped are stored in
 * IndexedDB and replayed in order, with the same Idempotency-Key, once the API is reachable.
 * Order lines carry client-generated uuids, so a replay that already reached the server is
 * ignored there instead of being added twice. Each action belongs to the person who made it: on a
 * shared device it waits while someone else is signed in, and is sent once that person is back.
 */
export interface OutboxEntry {
  id: string;
  seq: number;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown;
  idempotencyKey: string;
  locationId: number;
  userId: number;
  /** What the screen shows while waiting, e.g. queued order lines for a table. */
  meta:
    | {
        kind: 'order.items';
        sessionId?: number;
        orderId?: number;
        label: string;
        lines?: QueuedLine[];
      }
    | { kind: 'other'; label: string };
  createdAt: string;
}

export interface QueuedLine {
  uuid: string;
  name: string;
  qty: number;
  notes: string | null;
}

interface OutboxState {
  entries: OutboxEntry[];
  flushing: boolean;
}

export const useOutbox = create<OutboxState>(() => ({ entries: [], flushing: false }));

// ---- IndexedDB (falls back to memory when unavailable, e.g. private mode) --------------------

const DB_NAME = 'tavolina';
const STORE = 'outbox';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function loadEntries() {
  const all = ((await tx('readonly', (s) => s.getAll())) as OutboxEntry[] | null) ?? [];
  useOutbox.setState({ entries: all.sort((a, b) => a.seq - b.seq) });
}

/** Actions waiting for the person signed in right now. */
export function useMyOutbox(): OutboxEntry[] {
  const userId = useSession((s) => s.user?.id);
  const entries = useOutbox((s) => s.entries);
  return entries.filter((e) => e.userId === userId);
}

const mine = (entries: OutboxEntry[]) =>
  entries.filter((e) => e.userId === useSession.getState().user?.id);

async function removeEntry(id: string) {
  useOutbox.setState((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
  await tx('readwrite', (s) => s.delete(id));
}

// ---- Sending ---------------------------------------------------------------------------------

export type SendResult<T> = { queued: false; data: T } | { queued: true };

/**
 * Sends now, or queues the action when the network is down (or older actions are still waiting,
 * so the order of actions is kept).
 */
export async function sendOrQueue<T>(
  method: OutboxEntry['method'],
  path: string,
  body: unknown,
  meta: OutboxEntry['meta'],
): Promise<SendResult<T>> {
  const idempotencyKey = crypto.randomUUID();
  const { locationId, user } = useSession.getState();
  if (!mine(useOutbox.getState().entries).length) {
    try {
      return { queued: false, data: await api<T>(method, path, { body, idempotencyKey }) };
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err;
    }
  }
  const entries = useOutbox.getState().entries;
  const entry: OutboxEntry = {
    id: crypto.randomUUID(),
    seq: (entries.at(-1)?.seq ?? 0) + 1,
    method,
    path,
    body,
    idempotencyKey,
    locationId: locationId!,
    userId: user!.id,
    meta,
    createdAt: new Date().toISOString(),
  };
  useOutbox.setState({ entries: [...entries, entry] });
  await tx('readwrite', (s) => s.put(entry));
  return { queued: true };
}

let failedLabel: ((entry: OutboxEntry, err: ApiRequestError) => string) | null = null;

/** Replays waiting actions in order. Stops at the first network failure. */
export async function flushOutbox(queryClient: QueryClient): Promise<void> {
  const state = useOutbox.getState();
  if (
    state.flushing ||
    !mine(state.entries).length ||
    useSession.getState().status !== 'authenticated'
  )
    return;
  useOutbox.setState({ flushing: true });
  let sent = 0;
  try {
    for (const entry of mine(useOutbox.getState().entries)) {
      // Someone else signed in meanwhile: their actions wait for them.
      if (entry.userId !== useSession.getState().user?.id) break;
      try {
        await api(entry.method, entry.path, {
          body: entry.body,
          idempotencyKey: entry.idempotencyKey,
          locationId: entry.locationId,
        });
        sent++;
      } catch (err) {
        if (err instanceof NetworkError) break;
        // The server refused it (e.g. the item ran out meanwhile): drop it and say so.
        if (err instanceof ApiRequestError && failedLabel) {
          toast({ tone: 'danger', title: failedLabel(entry, err), duration: 10_000 });
        }
      }
      await removeEntry(entry.id);
    }
  } finally {
    useOutbox.setState({ flushing: false });
    if (sent) void queryClient.invalidateQueries();
  }
}

/** Mounted once in the app layout: loads the queue and replays it whenever we are back online. */
export function useOutboxSync(
  describeFailure: (entry: OutboxEntry, err: ApiRequestError) => string,
) {
  const queryClient = useQueryClient();
  const authenticated = useSession((s) => s.status === 'authenticated');
  const count = useMyOutbox().length;

  useEffect(() => {
    failedLabel = describeFailure;
  }, [describeFailure]);

  useEffect(() => {
    void loadEntries();
  }, []);

  useEffect(() => {
    if (!authenticated || !count) return;
    const flush = () => void flushOutbox(queryClient);
    flush();
    window.addEventListener('online', flush);
    const timer = setInterval(flush, 5_000);
    return () => {
      window.removeEventListener('online', flush);
      clearInterval(timer);
    };
  }, [authenticated, count, queryClient]);
}
