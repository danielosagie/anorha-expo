import { useEffect, useRef, useState, useCallback } from 'react';
import { useUser } from '@clerk/clerk-expo';
import { acquireCollaborationSocket, releaseCollaborationSocket, type Socket } from '../lib/collaborationSocket';
import { createLogger } from '../utils/logger';
const log = createLogger('useCollaboration');


interface ProductUpdate {
  productId: string;
  variantId: string;
  userId: string;
  updates: Record<string, any>;
  timestamp: number;
}

interface ProductEditEvent {
  productId: string;
  userId: string;
  userName: string;
}

interface PresenceUser {
  userId: string;
  userName: string;
  status: 'online' | 'idle' | 'offline';
  currentPage?: string;
}

export function useCollaboration() {
  const { user } = useUser();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!user) return;

    let active = true;
    let socket: Socket | null = null;
    const userName = user.fullName || user.primaryEmailAddress?.emailAddress || 'Unknown';

    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);
    const handleConnectError = (error: Error) => {
      log.error('[Collaboration] Connection error:', error.message);
    };
    const handlePresence = ({ users }: { users: PresenceUser[] }) => {
      setOnlineUsers(users.filter((u) => u.status === 'online'));
    };

    // Share the single /collaboration connection instead of opening our own.
    acquireCollaborationSocket({ userName })
      .then((s) => {
        if (!active) {
          releaseCollaborationSocket();
          return;
        }
        if (!s) return;
        socket = s;
        socketRef.current = s;
        if (s.connected) setIsConnected(true);
        s.on('connect', handleConnect);
        s.on('disconnect', handleDisconnect);
        s.on('connect_error', handleConnectError);
        s.on('presence:update', handlePresence);
      })
      .catch((error) => {
        log.error('[Collaboration] Failed to initialize socket:', error);
      });

    return () => {
      active = false;
      if (socket) {
        socket.off('connect', handleConnect);
        socket.off('disconnect', handleDisconnect);
        socket.off('connect_error', handleConnectError);
        socket.off('presence:update', handlePresence);
      }
      socketRef.current = null;
      releaseCollaborationSocket();
    };
  }, [user]);

  /**
   * Request edit lock for a product
   */
  const startEditing = useCallback(
    (productId: string): Promise<{ success: boolean; lockedBy?: string; message?: string }> => {
      return new Promise((resolve) => {
        if (!socketRef.current?.connected) {
          resolve({ success: false, message: 'Not connected to collaboration server' });
          return;
        }

        socketRef.current.emit('product:startEdit', { productId }, (response: any) => {
          log.debug('[Collaboration] Edit lock response:', response);
          resolve(response);
        });
      });
    },
    []
  );

  /**
   * Release edit lock
   */
  const stopEditing = useCallback((productId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('product:endEdit', { productId });
    }
  }, []);

  /**
   * Broadcast field update to team members (called by backend after save)
   */
  const broadcastFieldUpdate = useCallback(
    (productId: string, fieldName: string, fieldValue: any) => {
      if (!user || !socketRef.current?.connected) return;

      socketRef.current.emit('product:fieldUpdate', {
        productId,
        fieldName,
        fieldValue,
        userId: user.id,
        userName: user.fullName || 'Unknown',
        timestamp: Date.now(),
      });
    },
    [user]
  );

  /**
   * Listen for field updates from other users
   */
  const onFieldUpdate = useCallback((callback: (update: any) => void) => {
    if (!socketRef.current) return () => { };

    const handler = (data: any) => {
      log.debug('[Collaboration] Field updated by teammate:', data);
      callback(data);
    };

    socketRef.current.on('product:fieldUpdated', handler);

    return () => {
      socketRef.current?.off('product:fieldUpdated', handler);
    };
  }, []);

  /**
   * Listen for product updates from backend
   */
  const onProductUpdate = useCallback((callback: (update: ProductUpdate) => void) => {
    if (!socketRef.current) return () => { };

    const handler = (data: ProductUpdate) => {
      log.debug('[Collaboration] Product updated:', data);
      callback(data);
    };

    socketRef.current.on('product:updated', handler);

    return () => {
      socketRef.current?.off('product:updated', handler);
    };
  }, []);

  /**
   * Listen for edit started events
   */
  const onEditStarted = useCallback((callback: (event: ProductEditEvent) => void) => {
    if (!socketRef.current) return () => { };

    const handler = (data: ProductEditEvent) => {
      log.debug('[Collaboration] Edit started:', data);
      callback(data);
    };

    socketRef.current.on('product:editStarted', handler);

    return () => {
      socketRef.current?.off('product:editStarted', handler);
    };
  }, []);

  /**
   * Listen for edit ended events
   */
  const onEditEnded = useCallback((callback: (event: { productId: string; userId: string }) => void) => {
    if (!socketRef.current) return () => { };

    const handler = (data: { productId: string; userId: string }) => {
      log.debug('[Collaboration] Edit ended:', data);
      callback(data);
    };

    socketRef.current.on('product:editEnded', handler);

    return () => {
      socketRef.current?.off('product:editEnded', handler);
    };
  }, []);

  /**
   * Update presence
   */
  const updatePresence = useCallback(
    (status: 'online' | 'idle' | 'offline', currentPage?: string) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('presence:update', { status, currentPage });
      }
    },
    []
  );

  /**
   * Listen for job progress updates
   */
  const onJobProgress = useCallback((callback: (data: any) => void) => {
    if (!socketRef.current) return () => { };

    const handler = (data: any) => {
      // console.log('[Collaboration] Job Progress:', data);
      callback(data);
    };

    socketRef.current.on('job:progress', handler);

    return () => {
      socketRef.current?.off('job:progress', handler);
    };
  }, []);

  return {
    isConnected,
    onlineUsers,
    startEditing,
    stopEditing,
    broadcastFieldUpdate,
    onFieldUpdate,
    onProductUpdate,
    onEditStarted,
    onEditEnded,
    updatePresence,
    onJobProgress, // New export
  };
}

