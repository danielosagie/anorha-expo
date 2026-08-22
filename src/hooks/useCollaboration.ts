import { useEffect, useRef, useState, useCallback, useContext } from 'react';
import { useAuth, useUser } from '@clerk/expo';
import { acquireCollaborationSocket, releaseCollaborationSocket, type Socket } from '../lib/collaborationSocket';
import { applyLevelPatch, applyVariantPatch, markCatalogStale } from '../lib/catalogPatches';
import { createLogger } from '../utils/logger';
import { SessionContext } from '../context/SessionContext';
import { excludeSelfFromPresence, isOtherUserEditEvent } from '../lib/collaborationPresence';
const log = createLogger('useCollaboration');


interface ProductUpdate {
  productId: string;
  variantId: string;
  userId: string;
  updates: Record<string, any>;
  timestamp: number;
}

/** Payload of 'inventory:updated' (collaboration.gateway.ts emitInventoryUpdated / emitInventoryUpdate). */
export interface InventoryUpdateEvent {
  variantId: string;
  locationId?: string;
  newQuantity: number;
  sourcePlatform: string;
  webhookId?: string;
  timestamp: string;
}

/** Payload of 'partnership:updated' (collaboration.gateway.ts emitPartnershipUpdate). */
export interface PartnershipUpdateEvent {
  type: string;
  inviteId?: string;
  sourceOrgId?: string;
  partnerOrgId?: string;
  partnerPoolId?: string;
  linkId?: string;
  sourceVariantId?: string;
  newQuantity?: number;
  timestamp: string;
  [key: string]: unknown;
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
  const { getToken } = useAuth();
  const appUserId = useContext(SessionContext)?.user?.id ?? null;
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([]);

  // Pending-attach registry for the robust listener path. The shared socket is
  // acquired ASYNCHRONOUSLY, so any consumer that registers a listener in its
  // own mount effect races the acquire: the legacy on* helpers below return a
  // no-op when socketRef.current is still null — the listener NEVER attaches
  // (the "null-socketRef early-return bug"). Robust listeners are recorded here
  // and attached the moment the socket resolves; registrations made after that
  // attach immediately. socket.io keeps listeners across reconnects, so no
  // re-attach on 'connect' is needed.
  const robustListenersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());

  const registerRobustListener = useCallback((event: string, handler: (data: any) => void) => {
    let set = robustListenersRef.current.get(event);
    if (!set) {
      set = new Set();
      robustListenersRef.current.set(event, set);
    }
    set.add(handler);
    socketRef.current?.on(event, handler);
    return () => {
      robustListenersRef.current.get(event)?.delete(handler);
      socketRef.current?.off(event, handler);
    };
  }, []);

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
      setOnlineUsers(excludeSelfFromPresence(
        users.filter((u) => u.status === 'online'),
        appUserId,
      ));
    };

    // Share the single /collaboration connection instead of opening our own.
    acquireCollaborationSocket({
      userName,
      getClerkToken: () => getTokenRef.current(),
    })
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
        // Attach every robust listener registered before the socket resolved.
        robustListenersRef.current.forEach((handlers, event) => {
          handlers.forEach((handler) => s.on(event, handler));
        });
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
        // Detach robust listeners here too: the socket is SHARED, and consumer
        // cleanups that run after socketRef is nulled could otherwise leave
        // handlers attached to a socket other components keep alive.
        robustListenersRef.current.forEach((handlers, event) => {
          handlers.forEach((handler) => socket?.off(event, handler));
        });
      }
      socketRef.current = null;
      releaseCollaborationSocket();
    };
  }, [user, appUserId]);

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
   * Listen for product updates from backend.
   * Robust path: attaches once the shared socket resolves instead of silently
   * no-oping when it is registered before the async acquire completes.
   */
  const onProductUpdate = useCallback((callback: (update: ProductUpdate) => void) => {
    return registerRobustListener('product:updated', (data: ProductUpdate) => {
      log.debug('[Collaboration] Product updated:', data);
      callback(data);
    });
  }, [registerRobustListener]);

  /**
   * Listen for inventory quantity changes pushed by the backend (webhooks,
   * cross-org sync). Robust path — see onProductUpdate.
   */
  const onInventoryUpdate = useCallback((callback: (update: InventoryUpdateEvent) => void) => {
    return registerRobustListener('inventory:updated', (data: InventoryUpdateEvent) => {
      log.debug('[Collaboration] Inventory updated:', data);
      callback(data);
    });
  }, [registerRobustListener]);

  /**
   * Listen for cross-org partnership changes (invite accepted, quantity synced,
   * pause/resume…). Robust path — see onProductUpdate.
   */
  const onPartnershipUpdate = useCallback((callback: (update: PartnershipUpdateEvent) => void) => {
    return registerRobustListener('partnership:updated', (data: PartnershipUpdateEvent) => {
      log.debug('[Collaboration] Partnership updated:', data);
      callback(data);
    });
  }, [registerRobustListener]);

  /**
   * Listen for edit started events
   */
  const onEditStarted = useCallback((callback: (event: ProductEditEvent) => void) => {
    return registerRobustListener('product:editStarted', (data: ProductEditEvent) => {
      if (!isOtherUserEditEvent(data, appUserId)) return;
      log.debug('[Collaboration] Edit started:', data);
      callback(data);
    });
  }, [appUserId, registerRobustListener]);

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
    onInventoryUpdate,
    onPartnershipUpdate,
    onEditStarted,
    onEditEnded,
    updatePresence,
    onJobProgress, // New export
  };
}

/** ProductVariants columns a 'product:updated' payload may legally patch. */
const VARIANT_PATCH_COLUMNS = ['Title', 'Price', 'CompareAtPrice', 'Sku', 'Barcode'] as const;

/**
 * App-level bridge: socket events → catalog patch bus. Mount ONCE near the app
 * root (App.tsx) so team edits, webhook-driven inventory changes, and
 * partnership updates reach the inventory shelf even while it is not focused.
 *
 * - product:updated with field updates  → variant patch (instant shelf update)
 * - inventory:updated with a locationId → level patch on that exact row
 * - anything less precise               → stale mark (shelf runs a cheap
 *                                         delta refetch, bypassing its gate)
 */
export function useCatalogRealtimeBridge() {
  const { onProductUpdate, onInventoryUpdate, onPartnershipUpdate } = useCollaboration();

  useEffect(() => {
    const offProduct = onProductUpdate((update) => {
      const variantId = update?.variantId;
      const updates = update?.updates;
      if (variantId && updates && typeof updates === 'object') {
        const fields: Record<string, unknown> = {};
        for (const column of VARIANT_PATCH_COLUMNS) {
          if (updates[column] !== undefined) fields[column] = updates[column];
        }
        // Product copy lives on the embedded Products projection on the shelf.
        const products: Record<string, unknown> = {};
        if (updates.Title !== undefined) products.Title = updates.Title;
        if (updates.Description !== undefined) products.Description = updates.Description;
        if (updates.Tags !== undefined) products.Tags = updates.Tags;
        if (Object.keys(products).length > 0) fields.Products = products;
        if (Object.keys(fields).length > 0) {
          applyVariantPatch(variantId, {
            ...fields,
            UpdatedAt: new Date(update.timestamp || Date.now()).toISOString(),
          });
          return;
        }
      }
      // Webhook-shaped payloads carry no field updates — refetch instead.
      markCatalogStale('product');
    });

    const offInventory = onInventoryUpdate((update) => {
      if (update?.variantId && update?.locationId && Number.isFinite(update?.newQuantity)) {
        applyLevelPatch(
          null,
          {
            Quantity: update.newQuantity,
            UpdatedAt: update.timestamp || new Date().toISOString(),
          },
          {
            productVariantId: update.variantId,
            platformLocationId: update.locationId,
          },
        );
        return;
      }
      // Without a locationId we cannot know WHICH of the variant's level rows
      // changed; guessing would corrupt quantities. Delta refetch instead.
      markCatalogStale('inventory');
    });

    const offPartnership = onPartnershipUpdate(() => {
      markCatalogStale('partnership');
    });

    return () => {
      offProduct();
      offInventory();
      offPartnership();
    };
  }, [onProductUpdate, onInventoryUpdate, onPartnershipUpdate]);
}
