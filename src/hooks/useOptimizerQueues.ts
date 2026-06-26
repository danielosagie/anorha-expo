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
  /**
   * Scope the queues to ONE import: only the variants mapped to this platform
   * connection (via PlatformProductMappings.PlatformConnectionId) are counted —
   * the same scope the backend uses. This is what keeps the import hub and the
   * optimize screen on ONE number. When omitted, falls back to the whole
   * catalog (for a standalone "optimize everything" entry).
   */
  connectionId?: string;
  /** Runaway safety ceiling for the catalog-wide fallback only (ignored when import-scoped). */
  limit?: number;
}

const VARIANT_SELECT = `
  Id, Title, Description, Sku,
  ProductImages:ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl)
`;

export function useOptimizerQueues(options: UseOptimizerQueuesOptions = {}) {
  const { connectionId, limit = 20000 } = options;
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

      let raw: any[] = [];
      if (connectionId) {
        // Import-scoped: resolve this connection's mapped variant ids, then load
        // only those rows (chunked so a large import never hits the IN() limit).
        const { data: maps, error: mapErr } = await supabase
          .from('PlatformProductMappings')
          .select('ProductVariantId')
          .eq('PlatformConnectionId', connectionId);
        if (mapErr) throw mapErr;
        const ids = Array.from(
          new Set((maps || []).map((m: any) => m.ProductVariantId).filter(Boolean)),
        );
        for (let i = 0; i < ids.length; i += 300) {
          const chunk = ids.slice(i, i + 300);
          const { data, error } = await supabase
            .from('ProductVariants')
            .select(VARIANT_SELECT)
            .in('Id', chunk);
          if (error) throw error;
          if (data) raw.push(...data);
        }
      } else {
        // Catalog-wide fallback (no import scope) — page until the catalog is
        // exhausted (a short/empty page) so the count is the real total, not a
        // capped page. `limit` is only a runaway safety ceiling.
        for (let from = 0; from < limit; from += 1000) {
          const { data, error } = await supabase
            .from('ProductVariants')
            .select(VARIANT_SELECT)
            .range(from, from + 999);
          if (error) throw error;
          if (!data || data.length === 0) break;
          raw.push(...data);
          if (data.length < 1000) break;
        }
      }

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
  }, [connectionId, limit]);

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
