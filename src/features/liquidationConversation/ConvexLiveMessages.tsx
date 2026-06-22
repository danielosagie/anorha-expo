import React, { useEffect } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

type RawMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

type Props = {
  threadId: string | null;
  onMessages: (messages: RawMessage[]) => void;
};

// Session-wide kill switch for the live bridge. Flipped the first time the query
// throws — most commonly because the `messages:listByThread` Convex function hasn't
// been deployed to EXPO_PUBLIC_CONVEX_URL yet (`npx convex deploy`). Once flipped we
// stop mounting the subscription so it can't re-throw on every thread open (which
// would redbox in dev each time). Can also be pre-disabled via env until deploy.
let liveDisabled = process.env.EXPO_PUBLIC_DISABLE_CONVEX_LIVE === '1';

/**
 * Subscribes to a thread's messages via Convex and pushes them up to the
 * conversation controller, which appends anything new (agent-initiated digests,
 * proactive updates) to the open thread live. Renders nothing.
 *
 * Wrapped by the silent boundary below: if the Convex function isn't deployed yet,
 * useQuery throws, the boundary swallows it and disables the bridge for the session,
 * and the chat keeps working via the existing fetch path.
 */
function ConvexLiveMessagesInner({ threadId, onMessages }: Props) {
  // Only subscribe once Convex has an authenticated identity. listByThread calls
  // ensureIdentity(), so firing it during the Clerk→Convex auth handshake (or if auth
  // never lands) throws "Unauthorized". Skipping until authenticated avoids that throw
  // and lets the chat fall back to its existing fetch path.
  const { isAuthenticated } = useConvexAuth();
  // `(api as any)` until `npx convex codegen` types the new function.
  const data = useQuery(
    (api as any).messages.listByThread,
    isAuthenticated && threadId ? { threadId } : 'skip',
  );
  useEffect(() => {
    if (Array.isArray(data) && data.length) {
      onMessages(data as RawMessage[]);
    }
  }, [data, onMessages]);
  return null;
}

class SilentBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    // Disable for the rest of the session so we don't loop on the same throw each
    // time the thread screen remounts (the function isn't going to appear mid-session).
    liveDisabled = true;
  }
  render() {
    return this.state.failed ? null : (this.props.children as React.ReactElement);
  }
}

export function ConvexLiveMessages(props: Props) {
  // Already failed (or pre-disabled) — never mount the subscription again this session.
  if (liveDisabled) return null;
  return (
    <SilentBoundary>
      <ConvexLiveMessagesInner {...props} />
    </SilentBoundary>
  );
}
