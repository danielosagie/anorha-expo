/**
 * BrowserJobsConvexProvider — wraps a subtree in a SECOND Convex client pointed
 * at the BACKEND's browserJobs deployment (see useBrowserJobsConvex). This is
 * DISTINCT from the top-level agent-chat ConvexProvider (src/providers/
 * ConvexProvider.tsx); the chat's useQuery must keep resolving to that one.
 *
 * WHY a raw `convex/react` ConvexProvider (not ConvexProviderWithAuth): the
 * browserJobs queries are PUBLIC + arg-scoped (by userId) — no Clerk identity.
 * So this provider does NOT need ClerkProvider for auth. It DOES need
 * SessionContext for the userId fallback, so it must mount inside the
 * WithSessionProvider/OrgProvider subtree.
 *
 * BINDING SAFETY: this provider is a pure CONTEXT carrier — it does NOT wrap
 * children in a `convex/react` ConvexProvider. That matters: `useQuery` binds to
 * the NEAREST ConvexProvider, so wrapping the (app-wide) subtree here would
 * hijack the chat screens' reads away from the OUTER agent-chat client. Instead
 * the only consumer, useFacebookJobStatus, subscribes to this client EXPLICITLY
 * via client.watchQuery(...), so the agent-chat provider stays authoritative for
 * every useQuery in the tree. We expose { client, userId } via context for that
 * hook to read.
 *
 * DEGRADE: when the bootstrap is unavailable, value = { client:null, userId:null }
 * and callers branch to the OAuth-only path.
 */
import React, { createContext, useContext } from 'react';
import { SessionContext } from '../context/SessionContext';
import { useBrowserJobsConvex, BrowserJobsConvexValue } from '../hooks/useBrowserJobsConvex';

const BrowserJobsConvexContext = createContext<BrowserJobsConvexValue>({
  client: null,
  userId: null,
});

/** Read the resolved browserJobs client + userId from the nearest provider. */
export function useBrowserJobsConvexContext(): BrowserJobsConvexValue {
  return useContext(BrowserJobsConvexContext);
}

interface Props {
  children: React.ReactNode;
}

export function BrowserJobsConvexProvider({ children }: Props) {
  // SessionContext may be null in some auth states; treat null as signed-out.
  const session = useContext(SessionContext);
  const signedIn = !!session?.user?.id;
  const fallbackUserId = session?.user?.id ?? null;

  const value = useBrowserJobsConvex(signedIn, fallbackUserId);

  // Pure context carrier — never wraps children in a ConvexProvider (see the
  // BINDING SAFETY note above). Consumers read the client off context and
  // subscribe explicitly.
  return (
    <BrowserJobsConvexContext.Provider value={value}>
      {children}
    </BrowserJobsConvexContext.Provider>
  );
}

export default BrowserJobsConvexProvider;
