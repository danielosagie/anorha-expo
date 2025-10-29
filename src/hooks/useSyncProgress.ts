import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';

interface SyncProgress {
  connectionId: string;
  progress: number;
  description: string;
  status: 'scanning' | 'syncing' | 'active' | 'error' | 'completed' | 'review'; // NEW: Added 'review' status for scan completion
  jobId?: string;
  elapsedSeconds?: number;
  details?: Record<string, any>;
}

async function getToken() {
  return ensureSupabaseJwt();
}

export function useSyncProgress(connectionId: string) {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  
  useEffect(() => {
    // ✅ Get auth token before connecting to WebSocket
    const connectWithAuth = async () => {


      try {
        const token = await getToken()
        
        if (!token) {
          console.warn('[useSyncProgress] No auth token found');
          return;
        }
        
        // ✅ Pass auth token in connection query
        const newSocket = io('https://api.sssync.app/collaboration', {
          transports: ['websocket'],
          timeout: 5000,
          auth: {
            token: token,
          },
          query: {
            token: token,
          },
        });

        newSocket.on('connect', () => {
          console.log('[useSyncProgress] Connected to WebSocket with auth');
        });

        newSocket.on('connect_error', (error: any) => {
          console.error('[useSyncProgress] WebSocket connection error:', error);
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
      } catch (error) {
        console.error('[useSyncProgress] Error connecting to WebSocket:', error);
      }
    };
    
    connectWithAuth();
  }, [connectionId]);
  
  return { progress, socket };
}

