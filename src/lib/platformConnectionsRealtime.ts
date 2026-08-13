import { supabase, getUserLike } from './supabase';
import { TABLES } from '../constants/tableNames';
import { createLogger } from '../utils/logger';
import { nextRealtimeRetry, PLATFORM_CONNECTION_REALTIME_MAX_RETRIES } from './realtimeRetry';

const log = createLogger('platformConnectionsRealtime');

/**
 * Subscribe to PlatformConnections realtime changes for the current user.
 *
 * Lives in the data layer (src/lib) so contexts/screens don't open raw Supabase
 * channels themselves — the channel is just a change-signal: `onChange` fires on any
 * INSERT/UPDATE/DELETE and the caller re-fetches (the API enriches the rows). Scoped
 * to the current user via a `UserId=eq.<internal UUID>` filter resolved from the `me`
 * view (RLS enforces it server-side regardless), with bounded exponential-backoff retry on
 * CHANNEL_ERROR. Returns a cleanup function.
 */
export function subscribePlatformConnectionChanges(onChange: () => void): () => void {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let retriesScheduled = 0;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let terminal = false;
  let setupGeneration = 0;

  const setup = async () => {
    if (cancelled || terminal) return;
    const generation = ++setupGeneration;
    // Resolve the INTERNAL user UUID from the `me` view — NOT the JWT `sub`. Under native
    // Clerk auth `sub` is the Clerk id (user_xxx), not Users.Id, so `UserId=eq.<sub>` would
    // match zero rows and drop every change event. The `me` view returns the real UUID in
    // both auth modes; RLS still enforces scoping server-side regardless of this filter.
    let currentUserId: string | null = null;
    try {
      currentUserId = (await getUserLike()).user?.id ?? null;
    } catch {
      currentUserId = null;
    }
    if (cancelled || terminal || generation !== setupGeneration) return;

    channel = supabase
      // Stable channel name: a `Date.now()` suffix produced a new, distinctly-named
      // channel on every (re)subscribe, risking orphaned channels on the server.
      .channel('platform-connections-changes')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen for INSERT, UPDATE, DELETE
          schema: 'public',
          table: TABLES.PlatformConnections,
          ...(currentUserId ? { filter: `UserId=eq.${currentUserId}` } : {}),
        },
        (payload) => {
          log.debug('Realtime update received:', payload.eventType);
          onChange();
        },
      )
      .subscribe((status) => {
        if (cancelled || terminal || generation !== setupGeneration) return;
        log.debug('Realtime subscription status:', status);
        if (status === 'SUBSCRIBED') {
          retryTimeout = null;
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // A channel can emit more than one terminal callback while it tears
          // down. Coalesce them so one failed attempt schedules one retry.
          if (retryTimeout) return;

          const retry = nextRealtimeRetry(retriesScheduled);
          if (retry.terminal) {
            terminal = true;
            const failedChannel = channel;
            channel = null;
            if (failedChannel) void supabase.removeChannel(failedChannel);
            // Background-only failure. Existing focus/progress polling remains
            // the fallback, so never escalate this to a user-facing error toast.
            log.warn('Realtime unavailable after capped retries; continuing with polling', {
              attempts: PLATFORM_CONNECTION_REALTIME_MAX_RETRIES,
              status,
            });
            return;
          }

          retriesScheduled = retry.attempt;
          log.debug(`Retrying in ${retry.delayMs}ms (attempt ${retry.attempt}/${PLATFORM_CONNECTION_REALTIME_MAX_RETRIES})`);
          const failedChannel = channel;
          channel = null;
          if (failedChannel) void supabase.removeChannel(failedChannel);
          retryTimeout = setTimeout(() => {
            retryTimeout = null;
            void setup();
          }, retry.delayMs);
        }
      });
  };

  void setup();

  return () => {
    log.debug('Unsubscribing from realtime updates');
    cancelled = true;
    setupGeneration += 1;
    if (retryTimeout) clearTimeout(retryTimeout);
    if (channel) void supabase.removeChannel(channel);
  };
}
