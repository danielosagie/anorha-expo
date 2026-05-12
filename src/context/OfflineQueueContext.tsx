import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type OfflineOperationType =
  | 'inventory_update'
  | 'product_update'
  | 'import_prepare'
  | 'scan_capture';

export interface OfflineQueueItem {
  id: string;
  type: OfflineOperationType;
  createdAt: string;
  summary: string;
  payload?: Record<string, unknown>;
}

interface OfflineQueueContextValue {
  items: OfflineQueueItem[];
  pendingCount: number;
  enqueue: (item: Omit<OfflineQueueItem, 'id' | 'createdAt'>) => Promise<OfflineQueueItem>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}

const OFFLINE_QUEUE_STORAGE_KEY = 'sssync_offline_queue_v1';

const OfflineQueueContext = createContext<OfflineQueueContextValue>({
  items: [],
  pendingCount: 0,
  enqueue: async () => ({
    id: '',
    type: 'product_update',
    createdAt: new Date().toISOString(),
    summary: '',
  }),
  remove: async () => { },
  clear: async () => { },
});

export const OfflineQueueProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<OfflineQueueItem[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          setItems(JSON.parse(stored));
        }
      })
      .catch((error) => {
        console.warn('[OfflineQueue] Failed to hydrate queue:', error);
      });
  }, []);

  const persistItems = useCallback(async (nextItems: OfflineQueueItem[]) => {
    setItems(nextItems);
    try {
      await AsyncStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(nextItems));
    } catch (error) {
      console.warn('[OfflineQueue] Failed to persist queue:', error);
    }
  }, []);

  const enqueue = useCallback(async (item: Omit<OfflineQueueItem, 'id' | 'createdAt'>) => {
    const nextItem: OfflineQueueItem = {
      ...item,
      id: `${item.type}-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    const nextItems = [...items, nextItem];
    await persistItems(nextItems);
    return nextItem;
  }, [items, persistItems]);

  const remove = useCallback(async (id: string) => {
    await persistItems(items.filter((item) => item.id !== id));
  }, [items, persistItems]);

  const clear = useCallback(async () => {
    await persistItems([]);
  }, [persistItems]);

  const value = useMemo(() => ({
    items,
    pendingCount: items.length,
    enqueue,
    remove,
    clear,
  }), [items, enqueue, remove, clear]);

  return (
    <OfflineQueueContext.Provider value={value}>
      {children}
    </OfflineQueueContext.Provider>
  );
};

export function useOfflineQueue(): OfflineQueueContextValue {
  return useContext(OfflineQueueContext);
}
