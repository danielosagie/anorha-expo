import { io, Socket } from 'socket.io-client';
import { getClerkSessionToken } from './supabase';
import { CLERK_TOKEN_TIMEOUT_MS, settleWithin } from './bootGate';
import { SOCKET_BASE_URL } from '../config/env';
import { createLogger } from '../utils/logger';
const log = createLogger('collaborationSocket');


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
 *   - auth:   fresh raw Clerk session token  (the gateway's accepted mobile token)
 *   - query:  { userName? }                  (identity comes from verified auth, not query)
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
// Env-aware: derive from the configured host so dev/staging don't silently hit
// the production socket server (the old hardcoded URL ignored env overrides).
const COLLABORATION_URL = `${SOCKET_BASE_URL}/collaboration`;
const RELEASE_GRACE_MS = 3000;

let sharedSocket: Socket | null = null;
let connectPromise: Promise<Socket | null> | null = null;
let refCount = 0;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentUserName: string | undefined;
let currentGetClerkToken: (() => Promise<string | null>) | null = null;

/**
 * Ready listeners fire whenever a shared socket instance becomes available —
 * immediately on registration if one already exists, and again for every NEW
 * socket created after a full teardown. Consumers that need to emit stateful
 * context (e.g. OrgContext's 'org:switch') use this instead of polling
 * getCollaborationSocket(), which is null until some subscriber connects.
 */
type SocketReadyListener = (socket: Socket) => void;
const readyListeners = new Set<SocketReadyListener>();

export function onCollaborationSocketReady(listener: SocketReadyListener): () => void {
  readyListeners.add(listener);
  if (sharedSocket) {
    try {
      listener(sharedSocket);
    } catch (e) {
      log.warn('[collaborationSocket] ready listener threw:', e);
    }
  }
  return () => readyListeners.delete(listener);
}

function notifySocketReady(socket: Socket) {
  readyListeners.forEach((listener) => {
    try {
      listener(socket);
    } catch (e) {
      log.warn('[collaborationSocket] ready listener threw:', e);
    }
  });
}

async function createSocket(): Promise<Socket | null> {
  // `/collaboration` accepts Supabase Auth tokens or raw Clerk session tokens. It does
  // NOT verify the custom HS256 token returned by the legacy /api/auth/exchange bridge,
  // even though REST's SupabaseAuthGuard does. Always use raw Clerk here.
  const readRawClerkToken = () => currentGetClerkToken
    ? settleWithin(
        Promise.resolve().then(() => currentGetClerkToken?.() ?? null),
        CLERK_TOKEN_TIMEOUT_MS,
        'Collaboration Clerk token read timed out',
      )
    : getClerkSessionToken();
  let prefetchedToken = await readRawClerkToken().catch(() => null);
  if (!prefetchedToken) {
    log.warn('[collaborationSocket] No auth token available; not connecting');
    return null;
  }
  return io(COLLABORATION_URL, {
    transports: ['websocket', 'polling'],
    timeout: 5000,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
    // Socket.IO calls the auth callback for every connection attempt. Consume the
    // preflight token once, then ask Clerk for a fresh token on reconnect so a socket
    // suspended past JWT expiry cannot keep replaying the stale handshake forever.
    auth: (callback) => {
      if (prefetchedToken) {
        const token = prefetchedToken;
        prefetchedToken = null;
        callback({ token });
        return;
      }
      readRawClerkToken()
        .then((token) => callback(token ? { token } : {}))
        .catch(() => callback({}));
    },
    query: { ...(currentUserName ? { userName: currentUserName } : {}) },
  });
}

/**
 * Acquire the shared collaboration socket, incrementing the subscriber count.
 * Resolves to the connected socket (or null if no auth token is available).
 */
export async function acquireCollaborationSocket(opts?: {
  userName?: string;
  getClerkToken?: () => Promise<string | null>;
}): Promise<Socket | null> {
  if (opts?.userName) currentUserName = opts.userName;
  if (opts?.getClerkToken) currentGetClerkToken = opts.getClerkToken;
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
      if (s) notifySocketReady(s);
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
    if (refCount === 0) {
      sharedSocket?.disconnect();
      sharedSocket = null;
      currentUserName = undefined;
      currentGetClerkToken = null;
    }
  }, RELEASE_GRACE_MS);
}

/** Current shared socket, if connected (for imperative emits). */
export function getCollaborationSocket(): Socket | null {
  return sharedSocket;
}
