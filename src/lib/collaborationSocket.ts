import { io, Socket } from 'socket.io-client';
import { ensureSupabaseJwt } from './supabase';

// Re-exported so consumers get the Socket type without importing socket.io-client
// directly (the lint guardrail funnels all socket usage through src/lib).
export type { Socket } from 'socket.io-client';

/**
 * Single shared client for the realtime `/collaboration` namespace.
 *
 * Before this, three call sites (`useSyncProgress`, `useCollaboration`,
 * `PlatformConnectionsContext`) each opened their own `io()` connection to the
 * same endpoint — triple auth handshakes and duplicate subscriptions. This
 * module owns ONE connection, ref-counted across subscribers, created with the
 * superset of the previous options so every consumer's needs are met:
 *   - auth:   { token }                      (both)
 *   - query:  { token, userName? }           (sync sent token; collab sent userName)
 *   - transports: ['websocket', 'polling']   (collab's superset; sync was websocket-only)
 *   - reconnection enabled                   (collab's behavior)
 *
 * Subscribers attach their own `.on()/.off()` listeners to the returned socket
 * and must NOT call `socket.disconnect()` directly — call `releaseCollaborationSocket()`
 * instead. The connection is torn down only after the last subscriber releases
 * (with a short grace period to avoid churn when a consumer re-subscribes, e.g.
 * `useSyncProgress` re-running on a connectionId change).
 *
 * ⚠️ Behavior-sensitive: this changes the realtime connection model from N
 * sockets to 1. Verify on a device (sync progress + presence + team edit locks)
 * before merging.
 */
const COLLABORATION_URL = 'https://api.sssync.app/collaboration';
const RELEASE_GRACE_MS = 3000;

let sharedSocket: Socket | null = null;
let connectPromise: Promise<Socket | null> | null = null;
let refCount = 0;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentUserName: string | undefined;

async function createSocket(): Promise<Socket | null> {
  const token = await ensureSupabaseJwt();
  if (!token) {
    console.warn('[collaborationSocket] No auth token available; not connecting');
    return null;
  }
  return io(COLLABORATION_URL, {
    transports: ['websocket', 'polling'],
    timeout: 5000,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
    auth: { token },
    query: { token, ...(currentUserName ? { userName: currentUserName } : {}) },
  });
}

/**
 * Acquire the shared collaboration socket, incrementing the subscriber count.
 * Resolves to the connected socket (or null if no auth token is available).
 */
export async function acquireCollaborationSocket(opts?: { userName?: string }): Promise<Socket | null> {
  if (opts?.userName) currentUserName = opts.userName;
  refCount += 1;
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  if (sharedSocket) return sharedSocket;
  if (!connectPromise) {
    connectPromise = createSocket().then((s) => {
      sharedSocket = s;
      connectPromise = null;
      return s;
    });
  }
  return connectPromise;
}

/**
 * Release one subscriber's hold on the shared socket. The connection is closed
 * only after the last subscriber releases (and survives a brief grace window so
 * a quick re-acquire does not cause a reconnect).
 */
export function releaseCollaborationSocket(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  if (disconnectTimer) clearTimeout(disconnectTimer);
  disconnectTimer = setTimeout(() => {
    disconnectTimer = null;
    if (refCount === 0 && sharedSocket) {
      sharedSocket.disconnect();
      sharedSocket = null;
      currentUserName = undefined;
    }
  }, RELEASE_GRACE_MS);
}

/** Current shared socket, if connected (for imperative emits). */
export function getCollaborationSocket(): Socket | null {
  return sharedSocket;
}
