import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';

const COLLABORATION_URL = `${API_BASE_URL}/collaboration`;

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

async function getToken() {
  return ensureSupabaseJwt();
}

export function useCollaboration() {
  const { user } = useUser();
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!user) return;

    let socket: Socket | null = null;

    // Get token and connect
    (async () => {
      try {
        // Try to get Supabase template token, fallback to default Clerk token
        const token = await getToken()

        if (!token) {
          console.error('[Collaboration] No token available');
          return;
        }

        // Connect to WebSocket with auth token
        socket = io(COLLABORATION_URL, {
          auth: {
            token: token,
          },
          query: {
            userName: user.fullName || user.primaryEmailAddress?.emailAddress || 'Unknown',
          },
          transports: ['websocket', 'polling'], // Fallback to polling if WebSocket fails
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5,
        });

        socket.on('connect', () => {
          console.log('[Collaboration] Connected');
          setIsConnected(true);
        });

        socket.on('disconnect', () => {
          console.log('[Collaboration] Disconnected');
          setIsConnected(false);
        });

        socket.on('connect_error', (error: Error) => {
          console.error('[Collaboration] Connection error:', error.message);
        });

        // Listen for presence updates
        socket.on('presence:update', ({ users }: { users: PresenceUser[] }) => {
          setOnlineUsers(users.filter((u) => u.status === 'online'));
        });

        socketRef.current = socket;
      } catch (error) {
        console.error('[Collaboration] Failed to initialize socket:', error);
      }
    })();

    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [user, getToken]);

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
          console.log('[Collaboration] Edit lock response:', response);
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
      console.log('[Collaboration] Field updated by teammate:', data);
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
      console.log('[Collaboration] Product updated:', data);
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
      console.log('[Collaboration] Edit started:', data);
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
      console.log('[Collaboration] Edit ended:', data);
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

