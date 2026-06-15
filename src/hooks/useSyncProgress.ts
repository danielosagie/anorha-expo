import { useState, useEffect } from 'react';
import { acquireCollaborationSocket, releaseCollaborationSocket, type Socket } from '../lib/collaborationSocket';
import { createLogger } from '../utils/logger';
const log = createLogger('useSyncProgress');


interface SyncProgress {
  connectionId: string;
  progress: number;
  description: string;
  status: 'scanning' | 'syncing' | 'active' | 'error' | 'completed' | 'review'; // NEW: Added 'review' status for scan completion
  jobId?: string;
  elapsedSeconds?: number;
  details?: Record<string, any>;
}

export function useSyncProgress(connectionId: string) {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    let active = true;
    let acquiredSocket: Socket | null = null;

    const handleProgress = (data: SyncProgress) => {
      if (data.connectionId === connectionId) {
        setProgress(data);
      }
    };

    // Share the single /collaboration connection instead of opening our own.
    acquireCollaborationSocket()
      .then((s) => {
        if (!active) {
          // Effect was cleaned up before the socket resolved — release our hold.
          releaseCollaborationSocket();
          return;
        }
        acquiredSocket = s;
        setSocket(s);
        s?.on('sync:progress', handleProgress);
      })
      .catch((error) => {
        log.error('[useSyncProgress] Error acquiring collaboration socket:', error);
      });

    return () => {
      active = false;
      // Detach only our listener; the shared socket lives on for other subscribers.
      acquiredSocket?.off('sync:progress', handleProgress);
      releaseCollaborationSocket();
    };
  }, [connectionId]);

  return { progress, socket };
}
