import { useState, useEffect, useCallback, useMemo } from 'react';
import { ensureSupabaseJwt, supabase } from '../lib/supabase';
import { createLogger } from '../utils/logger';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { isVisiblePlatformConnection } from '../lib/platformConnectStatus';
import { getPlatform } from '../config/platforms';
const log = createLogger('useOptimizerQueues');


// THIN heuristics only — these numbers decide "could be better", never "blocked".
// Whether an item is REQUIRED-blocked comes from the platform registry's
// requiredFields (config/platforms.ts), the same source the publish gate checks
// (utils/platformRequirements.ts). Keep the two ideas separate: a threshold here
// is a nudge; a registry field is a wall.
export const OPTIMIZER_THRESHOLDS = {
  /** Below this, photos are THIN (a connected platform may still REQUIRE >= 1). */
  minImages: 2,
  /** Below this, the description is THIN (required-ness is simply non-empty). */
  minDescriptionLength: 50,
  /** Below this, the title is THIN (required-ness is simply non-empty). */
  minTitleLength: 5,
} as const;

export type OptimizerQueue = 'photo-needed' | 'data-needed' | 'manual-queue';

export interface ClassifiedProduct {
  Id: string;
  ProductId: string;
  Title: string;
  Description?: string | null;
  Sku?: string | null;
  Price?: string | number | null;
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

  // ── Consequence classification (platform-aware) ────────────────────────────
  /** Registry fields missing that a connected TARGET platform requires. */
  requiredMissing: string[];
  /** The platform keys whose requirements this item fails (e.g. ['ebay']). */
  requiredFor: string[];
  /** A connected store will refuse this item until fixed. */
  isRequired: boolean;
  /** Publishable everywhere it can go, just thin (below the nudge thresholds). */
  isThin: boolean;
}

export interface OptimizerQueueCounts {
  photoNeeded: number;
  dataNeeded: number;
  manualQueue: number;
  /** Distinct items needing ANY work (required or thin) — never double-counts. */
  attention: number;
  /** Items a connected platform will REFUSE until fixed — the owed number. */
  required: number;
  /** Items that publish fine but are thin — invited, never owed. */
  polish: number;
  total: number;
}

// Required-ness checks mirror utils/platformRequirements.hasRequiredField exactly
// (same brain as the publish gate): presence, not quality. Quality lives in the
// THIN thresholds above. `category` is deliberately not checked here yet — the
// committed-variant rows carry no category field to read; the publish screen
// still gates it. (Receipt: requiredFields lists category only for shopify/ebay.)
const REQUIRED_CHECKABLE = ['title', 'sku', 'price', 'description', 'images'] as const;

function missingRequiredFields(p: any): string[] {
  const images = Array.isArray(p.ProductImages) ? p.ProductImages : [];
  const missing: string[] = [];
  if (!(p.Title || '').trim()) missing.push('title');
  if (!(p.Sku && String(p.Sku).trim())) missing.push('sku');
  const price = Number(p.Price);
  if (!(p.Price != null && p.Price !== '' && !isNaN(price) && price > 0)) missing.push('price');
  if (!(p.Description || '').trim()) missing.push('description');
  if (images.length === 0) missing.push('images');
  return missing;
}

// Classify one item against BOTH dimensions:
//   required — a connected platform this item is NOT yet on refuses it as-is.
//   thin     — below the nudge thresholds (publishes fine, sells slower).
// `targets` = connected platform keys minus the ones this variant is already
// mapped to (an item live on Shopify owes Shopify nothing).
function classifyProduct(
  p: any,
  targets: string[],
  requiredFieldsByKey: Record<string, string[]>,
): ClassifiedProduct {
  const images = p.ProductImages || [];
  const imageCount = Array.isArray(images) ? images.length : 0;

  const absent = new Set(missingRequiredFields(p));
  const requiredMissing = new Set<string>();
  const requiredFor: string[] = [];
  for (const key of targets) {
    const reqs = (requiredFieldsByKey[key] || []).filter((f) =>
      (REQUIRED_CHECKABLE as readonly string[]).includes(f),
    );
    const misses = reqs.filter((f) => absent.has(f));
    if (misses.length > 0) {
      requiredFor.push(key);
      misses.forEach((f) => requiredMissing.add(f));
    }
  }
  const isRequired = requiredMissing.size > 0;

  const thinPhotos = imageCount < OPTIMIZER_THRESHOLDS.minImages;
  const thinDesc = (p.Description || '').length < OPTIMIZER_THRESHOLDS.minDescriptionLength;
  const thinTitle = (p.Title || '').trim().length < OPTIMIZER_THRESHOLDS.minTitleLength;
  const isThin = !isRequired && (thinPhotos || thinDesc || thinTitle);

  // Mode routing (camera vs editor) — required items route by their required
  // gaps; thin items by the nudge thresholds. Kept as the same independent
  // flags the optimizer views already consume.
  const needsPhotos = isRequired ? requiredMissing.has('images') : thinPhotos;
  const needsContent = isRequired
    ? requiredMissing.has('title') || requiredMissing.has('description') || requiredMissing.has('price')
    : thinDesc || thinTitle;
  const needsSku = isRequired ? requiredMissing.has('sku') : false;
  const needsDetails = needsContent || needsSku;

  const queue: OptimizerQueue = needsPhotos ? 'photo-needed' : needsContent ? 'data-needed' : 'manual-queue';
  const reason = isRequired
    ? `Needed for ${requiredFor.join(', ')}`
    : thinPhotos
      ? `${imageCount} photo${imageCount === 1 ? '' : 's'} (nice to have ${OPTIMIZER_THRESHOLDS.minImages})`
      : thinDesc
        ? 'Thin description'
        : thinTitle
          ? 'Thin title'
          : 'Ready';

  return {
    ...p,
    needsPhotos,
    needsContent,
    needsSku,
    needsDetails,
    queue,
    reason,
    requiredMissing: Array.from(requiredMissing),
    requiredFor,
    isRequired,
    isThin,
  };
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
    required: 0,
    polish: 0,
    total: 0,
  });

  // The platform context that decides required-ness. Connected keys come from
  // the visible (enabled, non-hidden) connections; pseudo-connections (csv,
  // camera) resolve to no registry platform and drop out on their own.
  const { liveConnections } = usePlatformConnections();
  const { connectedKeys, keyByConnectionId, requiredFieldsByKey } = useMemo(() => {
    const keys = new Set<string>();
    const byConn = new Map<string, string>();
    const reqs: Record<string, string[]> = {};
    for (const c of liveConnections || []) {
      const def = getPlatform(c?.PlatformType);
      if (!def) continue;
      byConn.set(c.Id, def.key);
      if (isVisiblePlatformConnection(c)) {
        keys.add(def.key);
        reqs[def.key] = def.capabilities.requiredFields;
      }
    }
    return { connectedKeys: Array.from(keys), keyByConnectionId: byConn, requiredFieldsByKey: reqs };
  }, [liveConnections]);
  // Refetch only when the connected-platform SET changes, not on status flips.
  const platformSig = connectedKeys.slice().sort().join('|');

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

      // Which platforms each variant is ALREADY on — an item live on Shopify
      // owes Shopify nothing; its targets are the connected platforms it is
      // missing from. One paged read of the mappings narrow columns, keyed back
      // through the connection→platform map above.
      const mappedKeysByVariant = new Map<string, Set<string>>();
      const variantIds = raw.map((r: any) => r?.Id).filter(Boolean);
      for (let i = 0; i < variantIds.length; i += 300) {
        const chunk = variantIds.slice(i, i + 300);
        const { data: maps, error: mapErr } = await supabase
          .from('PlatformProductMappings')
          .select('ProductVariantId, PlatformConnectionId')
          .in('ProductVariantId', chunk);
        if (mapErr) throw mapErr;
        for (const m of maps || []) {
          const key = keyByConnectionId.get(m.PlatformConnectionId);
          if (!key) continue;
          const set = mappedKeysByVariant.get(m.ProductVariantId) || new Set<string>();
          set.add(key);
          mappedKeysByVariant.set(m.ProductVariantId, set);
        }
      }

      const classified = raw.map(normalizeOptimizerVariantRow).map((p: any) => {
        const mapped = mappedKeysByVariant.get(p.Id);
        const targets = connectedKeys.filter((k) => !mapped?.has(k));
        return classifyProduct(p, targets, requiredFieldsByKey);
      });
      setProducts(classified);

      // Independent dimensions — an item can need both photos and details.
      // photoNeeded + content/sku counts can overlap; `attention` is the distinct
      // union (the honest "items needing any work"). `required` is the only
      // number ever OWED; `polish` is invited.
      const photoNeeded = classified.filter((x) => x.needsPhotos).length;
      const dataNeeded = classified.filter((x) => x.needsContent).length;
      const manualQueue = classified.filter((x) => !x.needsContent && x.needsSku).length;
      const required = classified.filter((x) => x.isRequired).length;
      const polish = classified.filter((x) => x.isThin).length;
      setCounts({
        photoNeeded,
        dataNeeded,
        manualQueue,
        attention: required + polish,
        required,
        polish,
        total: classified.length,
      });
    } catch (e) {
      log.error('[useOptimizerQueues] Error:', e);
      setProducts([]);
      setCounts({ photoNeeded: 0, dataNeeded: 0, manualQueue: 0, attention: 0, required: 0, polish: 0, total: 0 });
      setError(e instanceof Error ? e.message : 'Failed to load items');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, limit, platformSig]);

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

  // Consequence lists: required items (owed) and thin items (invited), each
  // split by fix mode so callers can run camera-then-editor.
  const requiredItems = products.filter((x) => x.isRequired);
  const polishItems = products.filter((x) => x.isThin);
  // Platforms driving ANY required item — for copy ("Needed for eBay").
  const requiredPlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.isRequired) p.requiredFor.forEach((k) => set.add(k));
    return Array.from(set);
  }, [products]);

  return {
    loading,
    error,
    products,
    counts,
    photoNeededItems,
    dataNeededItems,
    manualQueueItems,
    requiredItems,
    polishItems,
    requiredPlatforms,
    refresh: fetchData,
  };
}
