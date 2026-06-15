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
// so useQuery reads the same deployment the message cache writes to. The old
// hardcoded merry-buffalo-800 is a different project (the backend's browser jobs).
const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL || 'https://merry-buffalo-800.convex.cloud';

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
