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
  ProductId: string;
  Title: string;
  Description?: string | null;
  Sku?: string | null;
  ProductImages?: any[] | null;
  /** Independent gap flags — an item can need photos AND details at once. */
  needsPhotos: boolean;
  /** Weak/missing title or description (AI-generatable). */
  needsContent: boolean;
  /** Missing SKU (must be entered by hand). */
  needsSku: boolean;
  /** Any details gap (content or SKU). */
  needsDetails: boolean;
  queue: OptimizerQueue;
  /** Primary reason for this queue assignment */
  reason: string;
}

export interface OptimizerQueueCounts {
  photoNeeded: number;
  dataNeeded: number;
  manualQueue: number;
  /** Distinct items needing ANY work (photos OR details) — never double-counts. */
  attention: number;
  total: number;
}

// Classify each item against TWO independent dimensions — photos and details —
// so an item that needs photos is STILL assessed for details. (The old chain
// short-circuited on photos, which made "Details: Done" lie while every item
// was stuck at the photo stage.)
function classifyProduct(p: any): ClassifiedProduct {
  const images = p.ProductImages || [];
  const imageCount = Array.isArray(images) ? images.length : 0;
  const needsPhotos = imageCount < OPTIMIZER_THRESHOLDS.minImages;
  const descOk = (p.Description || '').length >= OPTIMIZER_THRESHOLDS.minDescriptionLength;
  const titleOk = (p.Title || '').trim().length >= OPTIMIZER_THRESHOLDS.minTitleLength;
  const needsSku = !(p.Sku && String(p.Sku).trim());
  const needsContent = !descOk || !titleOk;
  const needsDetails = needsContent || needsSku;

  // `queue` is the item's primary bucket for the camera/generate sub-views'
  // priority sort only — counts/queues below use the independent flags.
  const queue: OptimizerQueue = needsPhotos ? 'photo-needed' : needsContent ? 'data-needed' : 'manual-queue';
  const reason = needsPhotos
    ? `${imageCount} photos (need ${OPTIMIZER_THRESHOLDS.minImages})`
    : !descOk
      ? 'Weak or missing description'
      : !titleOk
        ? 'Weak title'
        : needsSku
          ? 'Missing SKU'
          : 'Ready';

  return { ...p, needsPhotos, needsContent, needsSku, needsDetails, queue, reason };
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

export const OPTIMIZER_VARIANT_SELECT = `
  Id, ProductId, Title, Sku, Price,
  ProductImages:ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl),
  Products!inner(Title, Description)
`;

export function normalizeOptimizerVariantRow(row: any): any {
  const parent = Array.isArray(row?.Products) ? row.Products[0] : row?.Products;
  return {
    ...row,
    ProductId: row?.ProductId || parent?.Id,
    // Product copy was normalized onto Products in item-model Phase 4B.
    // A variant Title is only an option label now, not the canonical product title.
    Title: parent?.Title || row?.Title || '',
    Description: parent?.Description || '',
    ProductImages: Array.isArray(row?.ProductImages) ? row.ProductImages : [],
  };
}

export function useOptimizerQueues(options: UseOptimizerQueuesOptions = {}) {
  const { connectionId, limit = 20000 } = options;
  const [loading, setLoading] = useState(true);
  // A load failure used to zero the counts silently, which made "Details: Done" (and a
  // blank optimizer lobby) LIE — indistinguishable from a genuinely all-clear catalog.
  // Surface the failure so callers can offer a quiet retry instead of a false "done".
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ClassifiedProduct[]>([]);
  const [counts, setCounts] = useState<OptimizerQueueCounts>({
    photoNeeded: 0,
    dataNeeded: 0,
    manualQueue: 0,
    attention: 0,
    total: 0,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
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
            .select(OPTIMIZER_VARIANT_SELECT)
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
            .select(OPTIMIZER_VARIANT_SELECT)
            .range(from, from + 999);
          if (error) throw error;
          if (!data || data.length === 0) break;
          raw.push(...data);
          if (data.length < 1000) break;
        }
      }

      const classified = raw.map(normalizeOptimizerVariantRow).map(classifyProduct);
      setProducts(classified);

      // Independent dimensions — an item can need both photos and details.
      // photoNeeded + content/sku counts can overlap; `attention` is the distinct
      // union (the honest "items needing any work").
      const photoNeeded = classified.filter((x) => x.needsPhotos).length;
      const dataNeeded = classified.filter((x) => x.needsContent).length;
      const manualQueue = classified.filter((x) => !x.needsContent && x.needsSku).length;
      const attention = classified.filter((x) => x.needsPhotos || x.needsDetails).length;
      setCounts({
        photoNeeded,
        dataNeeded,
        manualQueue,
        attention,
        total: classified.length,
      });
    } catch (e) {
      log.error('[useOptimizerQueues] Error:', e);
      setProducts([]);
      setCounts({ photoNeeded: 0, dataNeeded: 0, manualQueue: 0, attention: 0, total: 0 });
      setError(e instanceof Error ? e.message : 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }, [connectionId, limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Disjoint details split so [...dataNeededItems, ...manualQueueItems] = every
  // item needing details, with no dupes: content gaps go to AI-generate/review,
  // SKU-only gaps go straight to manual review. Photo-needing items still appear
  // here too if they also lack details (the fix for the "Details: Done" lie).
  const photoNeededItems = products.filter((x) => x.needsPhotos);
  const dataNeededItems = products.filter((x) => x.needsContent);
  const manualQueueItems = products.filter((x) => !x.needsContent && x.needsSku);

  return {
    loading,
    error,
    products,
    counts,
    photoNeededItems,
    dataNeededItems,
    manualQueueItems,
    refresh: fetchData,
  };
}
