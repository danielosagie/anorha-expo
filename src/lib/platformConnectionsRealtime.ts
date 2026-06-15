import { supabase, getSupabaseUserId } from './supabase';
import { TABLES } from '../constants/tableNames';
import { createLogger } from '../utils/logger';

const log = createLogger('platformConnectionsRealtime');

/**
 * Subscribe to PlatformConnections realtime changes for the current user.
 *
 * Lives in the data layer (src/lib) so contexts/screens don't open raw Supabase
 * channels themselves — the channel is just a change-signal: `onChange` fires on any
 * INSERT/UPDATE/DELETE and the caller re-fetches (the API enriches the rows). Scoped
 * to the current user via a `UserId=eq.<id>` filter when the JWT is minted (RLS
 * enforces it server-side regardless), with bounded exponential-backoff retry on
 * CHANNEL_ERROR. Returns a cleanup function.
 */
export function subscribePlatformConnectionChanges(onChange: () => void): () => void {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let retryCount = 0;
  const maxRetries = 3;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;

  const setup = () => {
    const currentUserId = getSupabaseUserId();
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
        log.debug('Realtime subscription status:', status);
        if (status === 'SUBSCRIBED') {
          retryCount = 0; // Reset on success
        } else if (status === 'CHANNEL_ERROR') {
          if (retryCount < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
            log.debug(`Retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
            retryTimeout = setTimeout(() => {
              retryCount++;
              if (channel) supabase.removeChannel(channel);
              setup();
            }, delay);
          } else {
            log.error('Max retries reached for realtime subscription');
          }
        }
      });
  };

  setup();

  return () => {
    log.debug('Unsubscribing from realtime updates');
    if (retryTimeout) clearTimeout(retryTimeout);
    if (channel) supabase.removeChannel(channel);
  };
}
