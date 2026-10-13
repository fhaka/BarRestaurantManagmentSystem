import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  GUEST_NAMESPACE,
  guestSocketAuthSchema,
  roomFor,
  socketAuthSchema,
  stationJoinSchema,
  type RealtimeEnvelope,
  type RealtimeEventType,
} from '@tavolina/shared';
import { env } from '../config/env.js';
import { db } from '../db/knex.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { logger } from '../lib/logger.js';
import * as accessRepo from '../modules/auth/access-repo.js';
import * as floorRepo from '../modules/floor/repo.js';
import { attachPrintBridge } from '../modules/printing/queue.js';

export interface SocketData {
  userId: number;
  accountId: number;
  locationId: number;
}

let io: Server | null = null;

/**
 * Staff sockets authenticate in the handshake with their access token and location (same checks
 * as requireAuth + requireLocation), then join `location:<id>` and `user:<id>`.
 */
async function authenticate(socket: Socket, next: (err?: Error) => void) {
  const parsed = socketAuthSchema.safeParse(socket.handshake.auth);
  if (!parsed.success) return next(new Error('unauthorized'));
  const verified = await verifyAccessToken(parsed.data.token);
  if (!verified.ok) return next(new Error(verified.expired ? 'token_expired' : 'unauthorized'));
  const { userId, accountId } = verified.claims;
  const user = await accessRepo.findActiveUser(userId);
  const access = user
    ? await accessRepo.findLocationAccess(userId, parsed.data.locationId)
    : undefined;
  if (!user || user.accountId !== accountId || !access || access.accountId !== accountId) {
    return next(new Error('forbidden'));
  }
  (socket.data as SocketData) = { userId, accountId, locationId: parsed.data.locationId };
  next();
}

export function attachRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    // Waiters' phones drop Wi-Fi briefly; let them come back without missing the room.
    connectionStateRecovery: { maxDisconnectionDuration: 60_000 },
  });
  io.use((socket, next) => {
    authenticate(socket, next).catch((err: unknown) => {
      logger.warn({ err }, 'Socket authentication failed');
      next(new Error('unauthorized'));
    });
  });
  io.on('connection', (socket) => {
    const data = socket.data as SocketData;
    void socket.join([roomFor.location(data.locationId), roomFor.user(data.userId)]);
    // A kitchen or bar screen follows one station; switching stations leaves the old room.
    socket.on('station:join', (payload: unknown, ack?: (ok: boolean) => void) => {
      void joinStation(socket, payload)
        .then((ok) => ack?.(ok))
        .catch((err: unknown) => {
          logger.warn({ err }, 'Station join failed');
          ack?.(false);
        });
    });
  });
  attachGuestNamespace(io);
  attachPrintBridge(io);
  return io;
}

/**
 * Guests' phones connect to `/guest` with their table's QR token and join `table:<id>`. They only
 * receive `guest.updated` ("something changed at your table") and refetch their state.
 */
function attachGuestNamespace(server: Server) {
  const guests = server.of(GUEST_NAMESPACE);
  guests.use((socket, next) => {
    const parsed = guestSocketAuthSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) return next(new Error('unauthorized'));
    floorRepo
      .findTableByToken(parsed.data.tableToken)
      .then((table) => {
        if (!table || !table.active) return next(new Error('unauthorized'));
        socket.data = { tableId: table.id };
        next();
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Guest socket authentication failed');
        next(new Error('unauthorized'));
      });
  });
  guests.on('connection', (socket) => {
    void socket.join(roomFor.table((socket.data as { tableId: number }).tableId));
  });
}

async function joinStation(socket: Socket, payload: unknown): Promise<boolean> {
  const parsed = stationJoinSchema.safeParse(payload);
  if (!parsed.success) return false;
  const { locationId } = socket.data as SocketData;
  const station = await db('stations')
    .where({ id: parsed.data.stationId, location_id: locationId })
    .first('id');
  if (!station) return false;
  for (const room of socket.rooms) if (room.startsWith('station:')) void socket.leave(room);
  await socket.join(roomFor.station(parsed.data.stationId));
  return true;
}

export async function closeRealtime(): Promise<void> {
  if (!io) return;
  await new Promise<void>((resolve) => io!.close(() => resolve()));
  io = null;
}

/** Sends an event to a location (and optionally extra rooms). No-op when no server is attached. */
export function emit<T extends Record<string, unknown>>(
  type: RealtimeEventType,
  locationId: number,
  data: T,
  extraRooms: string[] = [],
): void {
  if (!io) return;
  const envelope: RealtimeEnvelope<T> = { type, locationId, at: new Date().toISOString(), data };
  io.to([roomFor.location(locationId), ...extraRooms]).emit(type, envelope);
}

export function emitTableUpdated(locationId: number, tableIds: number[], layout = false): void {
  const unique = [...new Set(tableIds)];
  emit('table.updated', locationId, { tableIds: unique, layout });
  // Guests at these tables refetch their order and status (layout edits don't concern them).
  if (io && !layout && unique.length) {
    io.of(GUEST_NAMESPACE)
      .to(unique.map(roomFor.table))
      .emit('guest.updated', { tableIds: unique });
  }
}
