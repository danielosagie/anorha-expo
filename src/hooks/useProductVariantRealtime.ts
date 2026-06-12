import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getLegendStateObservables } from '../utils/SupaLegend';
import { ProductVariant } from '../utils/SupaLegend';

/**
 * Hook that subscribes to real-time changes for ALL ProductVariants
 * and automatically updates legend-state when changes occur.
 * 
 * IMPORTANT: This hook properly handles the variant architecture:
 * - Base variants (VariantType: 'base' or 'flat') appear in lists
 * - Option variants (VariantType: 'option') are child records
 * - Archived variants (IsArchived: true) are soft-deleted and hidden
 * 
 * Usage: Add this hook to any screen that displays products
 * 
 * Example:
 * ```
 * const MyScreen = observer(() => {
 *   useProductVariantRealtime();
 *   // ... rest of component
 * });
 * ```
 */
export function useProductVariantRealtime() {
  // Track pending updates to batch them
  const pendingUpdatesRef = useRef<Map<string, ProductVariant>>(new Map());
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Counter that increments on each real-time update to trigger re-renders in consuming components
  const [updateCounter, setUpdateCounter] = useState(0);

  useEffect(() => {
    console.log('[Real-time] Setting up ProductVariant subscription...');

    // Batch updates to avoid rapid re-renders
    const flushUpdates = () => {
      const updates = pendingUpdatesRef.current;
      if (updates.size === 0) return;

      // ⚠️ Echo removed: do NOT write realtime payloads back into productVariants$.
      // It's a Legend `customSynced` observable (realtime:true) that already receives
      // these server changes. Calling .set() with a server payload made Legend echo the
      // row back to Supabase (POST /ProductVariants?select=*), failing RLS with HTTP 400
      // and retrying forever. We only bump a counter so consumers that depend on
      // `updateCounter` re-render; Legend owns the actual data.
      console.log(`[Real-time] ${updates.size} variant change(s) observed; Legend sync owns the data`);
      updates.clear();
      setUpdateCounter(c => c + 1);
    };

    // Subscribe to ALL changes in ProductVariants table
    const subscription = supabase
      .channel('product-variants-all')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'ProductVariants',
        },
        (payload) => {
          const variantId = (payload.new as any)?.Id || (payload.old as any)?.Id;
          const variantType = (payload.new as any)?.VariantType || (payload.old as any)?.VariantType;
          const isArchived = (payload.new as any)?.IsArchived;

          console.log('[Real-time] ProductVariant change detected:', {
            eventType: payload.eventType,
            variantId,
            variantType,
            isArchived,
            title: (payload.new as any)?.Title || (payload.old as any)?.Title,
          });

          const observables = getLegendStateObservables();
          if (!observables?.productVariants$) {
            console.warn('[Real-time] Legend-state observables not available');
            return;
          }

          if (payload.eventType === 'INSERT') {
            // New variant inserted - add to legend-state
            const newVariant = payload.new as ProductVariant;
            console.log('[Real-time] ✅ INSERT: Adding new variant', newVariant.Id, 'type:', variantType);

            // Batch the update
            pendingUpdatesRef.current.set(newVariant.Id, newVariant);

            // Schedule flush
            if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
            flushTimeoutRef.current = setTimeout(flushUpdates, 100);

          } else if (payload.eventType === 'UPDATE') {
            // Variant updated - merge into legend-state (preserve existing fields not in update)
            const updatedVariant = payload.new as ProductVariant;
            console.log('[Real-time] ✅ UPDATE: Updating variant', updatedVariant.Id, 'type:', variantType);

            // SOFT DELETE HANDLING: If variant was archived, keep it but mark as archived
            // The UI will filter it out but we don't remove it from state (allows undo)
            if (isArchived) {
              console.log('[Real-time] 📦 Variant archived (soft delete):', updatedVariant.Id);
            }

            // Get existing variant and merge (to preserve any local-only fields)
            const existingVariant = observables.productVariants$[updatedVariant.Id].get();
            const mergedVariant = existingVariant
              ? { ...existingVariant, ...updatedVariant }
              : updatedVariant;

            // Batch the update
            pendingUpdatesRef.current.set(updatedVariant.Id, mergedVariant);

            // Schedule flush
            if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
            flushTimeoutRef.current = setTimeout(flushUpdates, 100);

          } else if (payload.eventType === 'DELETE') {
            // Variant hard-deleted. We prefer soft deletes (IsArchived), so this is rare.
            // ⚠️ Do NOT call .delete() on the synced observable — that echoes a DELETE
            // back to Supabase. Legend's own realtime sync removes the row for us.
            const deletedVariant = payload.old as ProductVariant;
            console.log('[Real-time] ⚠️ DELETE observed (Legend sync will remove):', deletedVariant?.Id);

            // Trigger re-render for DELETE too
            setUpdateCounter(c => c + 1);
          }
        }
      )
      .subscribe(
        (status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[Real-time] ✅ ProductVariant subscription active');
          } else if (status === 'CLOSED') {
            console.log('[Real-time] ProductVariant subscription closed');
          } else if (status === 'CHANNEL_ERROR') {
            console.error('[Real-time] ProductVariant subscription error');
          }
        }
      );

    // Cleanup on unmount
    return () => {
      console.log('[Real-time] Cleaning up ProductVariant subscription');
      if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
      subscription.unsubscribe();
    };
  }, []);

  // Return the updateCounter so consumers can include it in their dependencies
  return { updateCounter };
}

/**
 * Hook that subscribes to real-time changes for a SPECIFIC product's variants
 * Useful if you only want to listen to changes for the product being viewed
 * 
 * Usage:
 * ```
 * const MyDetailScreen = observer(() => {
 *   useProductVariantRealtimeForProduct(productId);
 *   // ... rest of component
 * });
 * ```
 */
export function useProductVariantRealtimeForProduct(productId?: string) {
  useEffect(() => {
    if (!productId) return;

    console.log('[Real-time] Setting up subscription for product:', productId);

    const subscription = supabase
      .channel(`product-variants-${productId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ProductVariants',
          filter: `ProductId=eq.${productId}`,
        },
        (payload) => {
          console.log('[Real-time] Variant changed for product', productId, payload.eventType);

          // NOTE: This hook is currently unused. Do NOT write payloads back into
          // productVariants$ (Legend customSynced + realtime:true) — that echoes the
          // row back to Supabase and fails RLS with HTTP 400. Legend owns the data.
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const v = payload.new as ProductVariant;
            console.log('[Real-time] variant change observed (Legend sync owns data):', v?.Id);
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [productId]);
}

/**
 * Hook that subscribes to real-time changes for InventoryLevels
 * Updates legend-state when inventory changes occur
 * 
 * This is important for:
 * - Reflecting inventory changes from platform webhooks
 * - Syncing inventory across multiple users viewing the same product
 */
export function useInventoryLevelsRealtime() {
  // Counter that increments on each real-time update to trigger re-renders
  const [updateCounter, setUpdateCounter] = useState(0);
  const retryCountRef = useRef(0);
  const maxRetries = 3;  useEffect(() => {
    console.log('[Real-time] Setting up InventoryLevels subscription...');
    let subscription: ReturnType<typeof supabase.channel> | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;    const setupSubscription = () => {
      subscription = supabase
        .channel('inventory-levels-all')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'InventoryLevels',
          },
          (payload) => {
            const levelId = (payload.new as any)?.Id || (payload.old as any)?.Id;
            const variantId = (payload.new as any)?.ProductVariantId || (payload.old as any)?.ProductVariantId;
            const quantity = (payload.new as any)?.Quantity;            console.log('[Real-time] InventoryLevel change:', {
              eventType: payload.eventType,
              levelId,
              variantId,
              quantity,
            });            const observables = getLegendStateObservables();
            if (!observables?.inventoryLevels$) {
              console.warn('[Real-time] Legend-state inventoryLevels$ not available');
              return;
            }            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              // ⚠️ Echo removed (this was the 214-req/400 storm). Do NOT write the
              // realtime payload back into inventoryLevels$ — Legend's own realtime
              // sync already streams these server changes in. Re-setting them made
              // Legend upsert the row back to Supabase (POST /InventoryLevels?select=*),
              // which fails RLS with HTTP 400 (the SELECT policy is broader than the
              // INSERT policy for partner/pool inventory) and retried forever.
              console.log('[Real-time] InventoryLevel change observed:', payload.eventType, levelId);
            } else if (payload.eventType === 'DELETE') {
              console.log('[Real-time] InventoryLevel DELETE observed (Legend sync will remove):', levelId);
            }            // Increment counter to trigger re-renders
            setUpdateCounter(c => c + 1);
          }
        )
        .subscribe(
          (status) => {
            if (status === 'SUBSCRIBED') {
              console.log('[Real-time] ✅ InventoryLevels subscription active');
              retryCountRef.current = 0; // Reset retry count on success
            } else if (status === 'CHANNEL_ERROR') {
              console.error('[Real-time] InventoryLevels subscription error');
              // Auto-retry with exponential backoff
              if (retryCountRef.current < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 10000);
                console.log(`[Real-time] Retrying in ${delay}ms (attempt ${retryCountRef.current + 1}/${maxRetries})`);
                retryTimeout = setTimeout(() => {
                  retryCountRef.current++;
                  subscription?.unsubscribe();
                  setupSubscription();
                }, delay);
              } else {
                console.error('[Real-time] Max retries reached for InventoryLevels subscription');
              }
            }
          }
        );
    };    setupSubscription();    return () => {
      console.log('[Real-time] Cleaning up InventoryLevels subscription');
      if (retryTimeout) clearTimeout(retryTimeout);
      subscription?.unsubscribe();
    };
  }, []);  // Return the updateCounter so consumers can include it in their dependencies
  return { updateCounter };
}