/**
 * Convex Provider with Clerk Authentication
 * 
 * Wraps your app with Convex + Clerk auth.
 * 
 * Usage in _layout.tsx or App.tsx:
 * ```tsx
 * <ClerkProvider>
 *   <ConvexProviderWithClerk>
 *     <App />
 *   </ConvexProviderWithClerk>
 * </ClerkProvider>
 * ```
 */

import React from 'react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { ConvexReactClient } from 'convex/react';
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

interface ConvexProviderProps {
    children: React.ReactNode;
}

/**
 * Convex Provider that integrates with Clerk for authentication
 * 
 * This must be nested inside ClerkProvider
 */
export function ConvexProvider({ children }: ConvexProviderProps) {
    return (
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
            {children}
        </ConvexProviderWithClerk>
    );
}

// Export the client for direct usage if needed
export { convex };
