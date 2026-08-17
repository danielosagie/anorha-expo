import { settleWithin } from '../lib/bootGate';
import { stopClerkSupabaseBridge } from '../lib/supabase';
import { purgeClerkAndAuthCaches } from './authCleanup';

type HardenedSignOutClient = {
  session?: unknown | null;
  client?: { sessions?: unknown[] } | null;
  signOut: () => Promise<unknown> | unknown;
  setActive?: (input: { session: null }) => Promise<unknown>;
};

type HardenedSignOutInput = {
  client: HardenedSignOutClient;
  primarySignOut?: () => Promise<unknown> | unknown;
};

// Receipt: this preserves App.tsx's existing 5,000ms cap per sign-out attempt.
// At most two sequential attempts consume 5,000 + 5,000 = 10,000ms, while the
// cache purge starts concurrently with the first attempt.
const SIGN_OUT_ATTEMPT_TIMEOUT_MS = 5_000;

/**
 * Single hardened teardown for manual sign-out and invalid stored sessions.
 * It purges persisted caches immediately, retries a surviving session, then
 * directly clears the active session as the final local fallback.
 */
export async function performHardenedSignOut({
  client,
  primarySignOut,
}: HardenedSignOutInput): Promise<void> {
  try {
    stopClerkSupabaseBridge();
  } catch {
    // The bridge may already be down.
  }

  await Promise.allSettled([
    settleWithin(
      Promise.resolve().then(() => primarySignOut?.()),
      SIGN_OUT_ATTEMPT_TIMEOUT_MS,
      'Session sign out timed out',
    ),
    purgeClerkAndAuthCaches(),
  ]);

  const sessionSurvives = () =>
    !!client.session || (client.client?.sessions?.length ?? 0) > 0;

  if (sessionSurvives()) {
    await settleWithin(
      Promise.resolve().then(() => client.signOut()),
      SIGN_OUT_ATTEMPT_TIMEOUT_MS,
      'Session sign out retry timed out',
    ).catch(() => undefined);
  }

  if (sessionSurvives() && typeof client.setActive === 'function') {
    await client.setActive({ session: null }).catch(() => undefined);
  }
}
