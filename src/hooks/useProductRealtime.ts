/**
 * useProductRealtime Hook
 * 
 * Provides real-time database synchronization for a product variant.
 * Automatically subscribes to Supabase realtime changes for:
 * - ProductVariants (product data)
 * - PlatformProductMappings (platform listings)
 * - InventoryLevels (inventory quantities)
 * 
 * This keeps your frontend in sync with the backend database automatically.
 */

import { useEffect, useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { ProductVariant, PlatformProductMapping, InventoryLevel } from '../utils/SupaLegend';

interface UseProductRealtimeOptions {
  productVariantId: string | null | undefined;
  onProductUpdate?: (product: ProductVariant) => void;
  onMappingUpdate?: (mappings: PlatformProductMapping[]) => void;
  onInventoryUpdate?: (inventory: InventoryLevel[]) => void;
  skipIfUnsavedChanges?: boolean; // Don't update if user is editing
  onBannerMessage?: (message: string) => void; // Optional banner notification
}

export function useProductRealtime({
  productVariantId,
  onProductUpdate,
  onMappingUpdate,
  onInventoryUpdate,
  skipIfUnsavedChanges = false,
  onBannerMessage,
}: UseProductRealtimeOptions) {
  const [isSubscribed, setIsSubscribed] = useState(false);
  
  // Use ref to track unsaved changes (avoids stale closure issues)
  const skipRef = useRef(skipIfUnsavedChanges);
  useEffect(() => {
    skipRef.current = skipIfUnsavedChanges;
  }, [skipIfUnsavedChanges]);

  useEffect(() => {
    if (!productVariantId) {
      setIsSubscribed(false);
      return;
    }

    console.log('[useProductRealtime] Setting up subscriptions for:', productVariantId);

    // 1. Subscribe to ProductVariant changes
    const productChannel = supabase
      .channel(`product-realtime-${productVariantId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'ProductVariants',
          filter: `Id=eq.${productVariantId}`,
        },
        async (payload) => {
          if (skipRef.current) {
            console.log('[useProductRealtime] Skipping product update - user has unsaved changes');
            onBannerMessage?.('External update available. Save your changes first.');
            return;
          }

          if (payload.eventType === 'UPDATE' && payload.new) {
            const updatedProduct = payload.new as ProductVariant;
            
            // Check if this is a meaningful update (not just timestamp)
            const hasRealChanges = payload.old && (
              (payload.old as ProductVariant).Title !== updatedProduct.Title ||
              (payload.old as ProductVariant).Description !== updatedProduct.Description ||
              (payload.old as ProductVariant).Sku !== updatedProduct.Sku ||
              (payload.old as ProductVariant).Price !== updatedProduct.Price
            );

            if (hasRealChanges) {
              console.log('[useProductRealtime] ✅ Product updated:', updatedProduct.Id);
              onProductUpdate?.(updatedProduct);
              onBannerMessage?.('Product updated from external source');
            } else {
              console.log('[useProductRealtime] Product update has no meaningful changes, skipping');
            }
          }
        }
      )
      .subscribe();

    // 2. Subscribe to PlatformProductMappings changes
    const mappingChannel = supabase
      .channel(`mappings-realtime-${productVariantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'PlatformProductMappings',
          filter: `ProductVariantId=eq.${productVariantId}`,
        },
        async (payload) => {
          if (skipRef.current) {
            console.log('[useProductRealtime] Skipping mapping update - user has unsaved changes');
            onBannerMessage?.('Platform mapping changed. Save your changes first.');
            return;
          }

          // Reload all mappings when any mapping changes
          const { data: mappings, error } = await supabase
            .from('PlatformProductMappings')
            .select('*')
            .eq('ProductVariantId', productVariantId);

          if (error) {
            console.error('[useProductRealtime] Error loading mappings:', error);
            return;
          }

          if (mappings) {
            console.log('[useProductRealtime] ✅ Mappings updated:', mappings.length);
            onMappingUpdate?.(mappings as PlatformProductMapping[]);
            onBannerMessage?.('Platform mappings updated');
          }
        }
      )
      .subscribe();

    // 3. Subscribe to InventoryLevels changes
    const inventoryChannel = supabase
      .channel(`inventory-realtime-${productVariantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'InventoryLevels',
          filter: `ProductVariantId=eq.${productVariantId}`,
        },
        async (payload) => {
          if (skipRef.current) {
            console.log('[useProductRealtime] Skipping inventory update - user has unsaved changes');
            onBannerMessage?.('Inventory changed externally. Save your changes first.');
            return;
          }

          // Reload all inventory when any level changes
          const { data: inventory, error } = await supabase
            .from('InventoryLevels')
            .select('*')
            .eq('ProductVariantId', productVariantId);

          if (error) {
            console.error('[useProductRealtime] Error loading inventory:', error);
            return;
          }

          if (inventory) {
            console.log('[useProductRealtime] ✅ Inventory updated:', inventory.length);
            onInventoryUpdate?.(inventory as InventoryLevel[]);
            onBannerMessage?.('Inventory updated');
          }
        }
      )
      .subscribe();

    setIsSubscribed(true);

    // Cleanup: Unsubscribe when component unmounts or productId changes
    return () => {
      console.log('[useProductRealtime] Cleaning up subscriptions for:', productVariantId);
      productChannel.unsubscribe();
      mappingChannel.unsubscribe();
      inventoryChannel.unsubscribe();
      setIsSubscribed(false);
    };
  }, [productVariantId, onProductUpdate, onMappingUpdate, onInventoryUpdate, onBannerMessage]);

  return { isSubscribed };
}







