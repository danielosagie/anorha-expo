import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../types/server/app.router';
import { ensureSupabaseJwt, getApiBaseUrl } from './supabase';

/**
 * Typed tRPC client for the PRIVILEGED backend endpoints (exchange / sync / AI / billing).
 * CRUD does NOT go through here — that's the typed Supabase client + Zod (see src/lib/db.ts).
 *
 * The `AppRouter` type is vendored from the backend at src/types/server/app.router.d.ts
 * (regenerate via `npm run trpc:types` in sssync-bknd, or replace with a published
 * @sssync/api package). Auth reuses the same minted Supabase JWT as apiClient.
 *
 * Usage:
 *   const me = await trpc.me.query();
 *   await trpc.echo.mutate({ message: 'hi' });
 */
export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getApiBaseUrl()}/trpc`,
      async headers() {
        const token = await ensureSupabaseJwt();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
