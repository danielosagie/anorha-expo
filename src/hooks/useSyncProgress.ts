import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

interface SyncProgress {
  connectionId: string;
  progress: number;
  description: string;
  status: 'scanning' | 'syncing' | 'active' | 'error' | 'completed';
  jobId?: string;
}

export function useSyncProgress(connectionId: string) {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  
  useEffect(() => {
    // Connect to WebSocket
    const newSocket = io('https://api.sssync.app/collaboration', {
      transports: ['websocket'],
      timeout: 5000,
    });

    newSocket.on('connect', () => {
      console.log('[useSyncProgress] Connected to WebSocket');
    });

    newSocket.on('disconnect', () => {
      console.log('[useSyncProgress] Disconnected from WebSocket');
    });

    newSocket.on('sync:progress', (data: SyncProgress) => {
      if (data.connectionId === connectionId) {
        console.log('[useSyncProgress] Received progress update:', data);
        setProgress(data);
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [connectionId]);
  
  return { progress, socket };
}

