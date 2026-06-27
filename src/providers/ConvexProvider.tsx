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

import React, { useCallback, useMemo, useRef } from 'react';
import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react';
import { useAuth } from '@clerk/expo';

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
    // Core 3 (@clerk/expo 3.x) rebuilds `getToken` as a BRAND-NEW closure on every
    // render (its wrapper re-wraps clerk-js v6's getToken to add the SecureStore JWT
    // cache). clerk-js v6 also drives `useAuth` via useSyncExternalStore and emits a
    // fresh resource object on every resource change, so every useAuth() consumer
    // re-renders on every emit. If that churning getToken leaks into the fetcher we
    // hand ConvexProviderWithAuth, `client.setAuth` re-fires and feeds the re-render
    // storm (hundreds of pure re-renders with stable isSignedIn). Read getToken through
    // a ref so the fetcher's identity is PERMANENTLY stable but always calls the latest
    // getToken — mirrors the WithSessionProvider.getClerkToken pattern in App.tsx.
    const getTokenRef = useRef(getToken);
    getTokenRef.current = getToken;
    const fetchAccessToken = useCallback(
        async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
            try {
                return await getTokenRef.current({ skipCache: forceRefreshToken });
            } catch {
                return null;
            }
        },
        // Rebuild only on active-org change (re-auth on org switch). getToken is read
        // via the ref above, so its per-render identity churn can't perturb this.
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
