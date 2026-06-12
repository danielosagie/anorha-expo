import React, { useEffect } from 'react';
import { useQuery } from 'convex/react';
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

/**
 * Subscribes to a thread's messages via Convex and pushes them up to the
 * conversation controller, which appends anything new (agent-initiated digests,
 * proactive updates) to the open thread live. Renders nothing.
 *
 * Wrapped by a silent error boundary below: if the `messages:listByThread` Convex
 * function hasn't been deployed yet (`npx convex deploy`), useQuery throws, and the
 * boundary keeps the chat fully working via the existing fetch path.
 */
function ConvexLiveMessagesInner({ threadId, onMessages }: Props) {
  // `(api as any)` until `npx convex codegen` types the new function.
  const data = useQuery((api as any).messages.listByThread, threadId ? { threadId } : 'skip');
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
  render() {
    // Once it fails (e.g. the Convex function isn't deployed yet), stay null until
    // the app remounts — retrying in place would loop on the same throw.
    return this.state.failed ? null : (this.props.children as React.ReactElement);
  }
}

export function ConvexLiveMessages(props: Props) {
  return (
    <SilentBoundary>
      <ConvexLiveMessagesInner {...props} />
    </SilentBoundary>
  );
}
