import { useState, useEffect, useCallback } from 'react';
import { ensureSupabaseJwt, supabase } from '../lib/supabase';
import { createLogger } from '../utils/logger';
const log = createLogger('useOptimizerQueues');


// Canonical thresholds (shared across ImportOverview, BackfillOptimizer, sub-views)
export const OPTIMIZER_THRESHOLDS = {
  /** Minimum images to consider "photo complete" */
  minImages: 2,
  /** Minimum description length to consider "data complete" */
  minDescriptionLength: 50,
  /** Minimum title length */
  minTitleLength: 5,
} as const;

export type OptimizerQueue = 'photo-needed' | 'data-needed' | 'manual-queue';

export interface ClassifiedProduct {
  Id: string;
  Title: string;
  Description?: string | null;
  Sku?: string | null;
  ProductImages?: any[] | null;
  queue: OptimizerQueue;
  /** Primary reason for this queue assignment */
  reason: string;
}

export interface OptimizerQueueCounts {
  photoNeeded: number;
  dataNeeded: number;
  manualQueue: number;
  total: number;
}

function classifyProduct(p: any): ClassifiedProduct & { queue: OptimizerQueue; reason: string } {
  const images = p.ProductImages || [];
  const imageCount = Array.isArray(images) ? images.length : 0;
  const hasEnoughPhotos = imageCount >= OPTIMIZER_THRESHOLDS.minImages;
  const desc = p.Description || '';
  const descOk = desc.length >= OPTIMIZER_THRESHOLDS.minDescriptionLength;
  const titleOk = (p.Title || '').trim().length >= OPTIMIZER_THRESHOLDS.minTitleLength;
  const hasSku = !!(p.Sku && String(p.Sku).trim());

  if (!hasEnoughPhotos) {
    return { ...p, queue: 'photo-needed' as const, reason: `${imageCount} photos (need ${OPTIMIZER_THRESHOLDS.minImages})` };
  }
  if (!hasSku) {
    return { ...p, queue: 'manual-queue' as const, reason: 'Missing SKU' };
  }
  if (!descOk || !titleOk) {
    return { ...p, queue: 'data-needed' as const, reason: !descOk ? 'Weak or missing description' : 'Weak title' };
  }
  return { ...p, queue: 'manual-queue' as const, reason: 'Ready' };
}

export interface UseOptimizerQueuesOptions {
  limit?: number;
}

export function useOptimizerQueues(options: UseOptimizerQueuesOptions = {}) {
  const { limit = 200 } = options;
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ClassifiedProduct[]>([]);
  const [counts, setCounts] = useState<OptimizerQueueCounts>({
    photoNeeded: 0,
    dataNeeded: 0,
    manualQueue: 0,
    total: 0,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      await ensureSupabaseJwt();
      const { data, error } = await supabase
        .from('ProductVariants')
        .select(`
          Id, Title, Description, Sku,
          ProductImages:ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl)
        `)
        .limit(limit);

      if (error) throw error;
      const raw = data || [];
      const classified = raw.map(classifyProduct);
      setProducts(classified);

      const photoNeeded = classified.filter((x) => x.queue === 'photo-needed').length;
      const dataNeeded = classified.filter((x) => x.queue === 'data-needed').length;
      const manualQueue = classified.filter((x) => x.queue === 'manual-queue' && x.reason !== 'Ready').length;
      setCounts({
        photoNeeded,
        dataNeeded,
        manualQueue,
        total: classified.length,
      });
    } catch (e) {
      log.error('[useOptimizerQueues] Error:', e);
      setProducts([]);
      setCounts({ photoNeeded: 0, dataNeeded: 0, manualQueue: 0, total: 0 });
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const photoNeededItems = products.filter((x) => x.queue === 'photo-needed');
  const dataNeededItems = products.filter((x) => x.queue === 'data-needed');
  const manualQueueItems = products.filter((x) => x.queue === 'manual-queue' && x.reason !== 'Ready');

  return {
    loading,
    products,
    counts,
    photoNeededItems,
    dataNeededItems,
    manualQueueItems,
    refresh: fetchData,
  };
}
