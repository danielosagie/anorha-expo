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
      const observables = getLegendStateObservables();
      if (!observables?.productVariants$) return;

      const updates = pendingUpdatesRef.current;
      if (updates.size === 0) return;

      console.log(`[Real-time] Flushing ${updates.size} batched updates`);
      updates.forEach((variant, id) => {
        observables.productVariants$[id].set(variant);
      });
      updates.clear();

      // Increment counter to trigger re-renders in consuming components
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
          const variantId = payload.new?.Id || payload.old?.Id;
          const variantType = (payload.new as any)?.VariantType || (payload.old as any)?.VariantType;
          const isArchived = (payload.new as any)?.IsArchived;

          console.log('[Real-time] ProductVariant change detected:', {
            eventType: payload.eventType,
            variantId,
            variantType,
            isArchived,
            title: payload.new?.Title || payload.old?.Title,
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
            // Variant hard-deleted - remove from legend-state
            // Note: We prefer soft deletes (IsArchived), so hard deletes should be rare
            const deletedVariant = payload.old as ProductVariant;
            console.log('[Real-time] ⚠️ DELETE: Removing variant (hard delete)', deletedVariant.Id);
            observables.productVariants$[deletedVariant.Id].delete();

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

          const observables = getLegendStateObservables();
          if (!observables?.productVariants$) return;

          if (payload.eventType === 'UPDATE') {
            const updatedVariant = payload.new as ProductVariant;
            console.log('[Real-time] ✅ Updating variant', updatedVariant.Id);
            observables.productVariants$[updatedVariant.Id].set(updatedVariant);
          } else if (payload.eventType === 'INSERT') {
            const newVariant = payload.new as ProductVariant;
            console.log('[Real-time] ✅ Adding new variant', newVariant.Id);
            observables.productVariants$[newVariant.Id].set(newVariant);
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
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const setupSubscription = () => {
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
            const levelId = payload.new?.Id || payload.old?.Id;
            const variantId = payload.new?.ProductVariantId || payload.old?.ProductVariantId;
            const quantity = payload.new?.Quantity;

            console.log('[Real-time] InventoryLevel change:', {
              eventType: payload.eventType,
              levelId,
              variantId,
              quantity,
            });

            const observables = getLegendStateObservables();
            if (!observables?.inventoryLevels$) {
              console.warn('[Real-time] Legend-state inventoryLevels$ not available');
              return;
            }

            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const level = payload.new;
              console.log('[Real-time] ✅ Updating inventory level', levelId, 'qty:', quantity);
              observables.inventoryLevels$[levelId].set(level);
            } else if (payload.eventType === 'DELETE') {
              console.log('[Real-time] ✅ Removing inventory level', levelId);
              observables.inventoryLevels$[levelId].delete();
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
    };

    setupSubscription();    return () => {
      console.log('[Real-time] Cleaning up InventoryLevels subscription');
      if (retryTimeout) clearTimeout(retryTimeout);
      subscription?.unsubscribe();
    };
  }, []);  // Return the updateCounter so consumers can include it in their dependencies
  return { updateCounter };
}
