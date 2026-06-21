/**
 * Convex Provider with Clerk Authentication
 *
 * Wraps the app with a Convex client authenticated by Clerk.
 *
 * Why NOT `ConvexProviderWithClerk` (from `convex/react-clerk`): that helper hardcodes
 * `getToken({ template: "convex" })`. This Clerk instance has no "convex" JWT template
 * (we only provision "mobile" / the default session token), so getToken() returned
 * null → Convex saw no identity → every authed query threw "Unauthorized" (the
 * messages:listByThread render error).
 *
 * Instead we wire `ConvexProviderWithAuth` to a tiny hook that sends Clerk's DEFAULT
 * session token (no template). Two reasons:
 *   1. convex/auth.config.ts accepts it via its `customJwt` issuer fallback
 *      (https://clerk.app.anorha.app) — no Clerk template needs to exist.
 *   2. The session token's `sub` is the Clerk user id, which is exactly what the Convex
 *      functions expect for `identity.subject` (see convex/schema.ts, campaigns/listing/
 *      presence). A custom template could rewrite `sub` and silently break ownership.
 *
 * Must be nested inside a configured `ClerkProvider` (see App.tsx).
 */

import React, { useCallback, useMemo } from 'react';
import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react';
import { useAuth } from '@clerk/clerk-expo';

// The agent-chat Convex deployment — MUST match the adapter (EXPO_PUBLIC_CONVEX_URL)
// so useQuery reads the same deployment the message cache writes to. We refuse to
// fall back to a hardcoded deployment: the old merry-buffalo-800 default silently
// pointed mobile at a DIFFERENT project (the backend's browser jobs), stranding every
// read/write. Fail loud so a missing EAS/CI env is caught at boot, not in production.
const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) {
    throw new Error(
        'EXPO_PUBLIC_CONVEX_URL is not set — refusing to connect to a fallback Convex deployment. ' +
        'Set it in .env.local (dev) and in every EAS build profile (preview/production).',
    );
}

// Initialize Convex client (singleton)
const convex = new ConvexReactClient(CONVEX_URL);

// Bridges Clerk's `useAuth` to the shape `ConvexProviderWithAuth` expects. Mirrors
// convex/react-clerk's own wrapper, except it requests the plain session token rather
// than a "convex"-templated one, so it doesn't depend on a Clerk template existing.
function useAuthFromClerk() {
    const { isLoaded, isSignedIn, getToken, orgId, orgRole } = useAuth();
    const fetchAccessToken = useCallback(
        async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
            try {
                return await getToken({ skipCache: forceRefreshToken });
            } catch {
                return null;
            }
        },
        // Rebuild the fetcher (→ re-auth) when the active org changes. clerk-expo's
        // getToken isn't memoized, so it's intentionally left out of the deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [orgId, orgRole],
    );
    return useMemo(
        () => ({
            isLoading: !isLoaded,
            isAuthenticated: isSignedIn ?? false,
            fetchAccessToken,
        }),
        [isLoaded, isSignedIn, fetchAccessToken],
    );
}

interface ConvexProviderProps {
    children: React.ReactNode;
}

/**
 * Convex Provider that integrates with Clerk for authentication.
 * This must be nested inside ClerkProvider.
 */
export function ConvexProvider({ children }: ConvexProviderProps) {
    return (
        <ConvexProviderWithAuth client={convex} useAuth={useAuthFromClerk}>
            {children}
        </ConvexProviderWithAuth>
    );
}

// Export the client for direct usage if needed
export { convex };
