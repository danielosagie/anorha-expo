import { useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getLegendStateObservables } from '../utils/SupaLegend';
import { ProductVariant } from '../utils/SupaLegend';

/**
 * Hook that subscribes to real-time changes for ALL ProductVariants
 * and automatically updates legend-state when changes occur.
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
  useEffect(() => {
    console.log('[Real-time] Setting up ProductVariant subscription...');
    
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
          console.log('[Real-time] ProductVariant change detected:', {
            eventType: payload.eventType,
            variantId: payload.new?.Id || payload.old?.Id,
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
            console.log('[Real-time] ✅ INSERT: Adding new variant', newVariant.Id);
            observables.productVariants$[newVariant.Id].set(newVariant);
          } else if (payload.eventType === 'UPDATE') {
            // Variant updated - update in legend-state
            const updatedVariant = payload.new as ProductVariant;
            console.log('[Real-time] ✅ UPDATE: Updating variant', updatedVariant.Id);
            observables.productVariants$[updatedVariant.Id].set(updatedVariant);
          } else if (payload.eventType === 'DELETE') {
            // Variant deleted - remove from legend-state
            const deletedVariant = payload.old as ProductVariant;
            console.log('[Real-time] ✅ DELETE: Removing variant', deletedVariant.Id);
            observables.productVariants$[deletedVariant.Id].delete();
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
      subscription.unsubscribe();
    };
  }, []);
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

