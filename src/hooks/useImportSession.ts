import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';

// Shared key so the in-progress import survives leaving the flow and can be
// picked back up (status polling / progress banner) when the user returns.
export const LAST_IMPORT_STORAGE_KEY = 'anorha:lastImport';
import {
  MappingSuggestion,
  ProductCreationMode,
  ConnectionLocation,
  ImportSessionCounts,
  ImportDraft,
  DraftDecision,
} from '../types/importSession';
import type { MappingSuggestion as BackendMappingSuggestion } from '../contracts';
import { createLogger } from '../utils/logger';
const log = createLogger('useImportSession');


const SSSYNC_API_BASE_URL = API_BASE_URL;

// CSV cells carry human-formatted prices ("$1,299.00", "€1.299,00", "1 299").
// Strip currency symbols and grouping separators before Number() so a real
// price never silently coerces to 0.
function parseCsvPrice(raw: any): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (raw == null) return 0;
  let s = String(raw).trim();
  if (!s) return 0;
  // Keep only digits, separators and a leading sign.
  s = s.replace(/[^0-9.,-]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator is rightmost is the decimal point; the other groups.
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    // Comma only: decimal if it looks like cents (",NN"), else thousands.
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else {
    // Dot only (or none): any extra dots are thousands separators.
    const firstDot = s.indexOf('.');
    if (firstDot !== lastDot) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Module-level cache + in-flight coalescing for the active org id. Several import
// effects need it, and a render loop was firing one of them dozens of times a
// second — each hitting /api/organizations/me/active and flooding the server logs.
// The active org barely changes within a session, so cache it briefly and never
// run more than one request at a time.
let __activeOrgCache: { id: string | null; ts: number } | null = null;
let __activeOrgInFlight: Promise<string | null> | null = null;
const ACTIVE_ORG_TTL_MS = 60_000;
async function getActiveOrgIdCached(token: string | null): Promise<string | null> {
  if (__activeOrgCache && Date.now() - __activeOrgCache.ts < ACTIVE_ORG_TTL_MS) {
    return __activeOrgCache.id;
  }
  if (__activeOrgInFlight) return __activeOrgInFlight;
  __activeOrgInFlight = (async () => {
    try {
      const res = await fetch(`${SSSYNC_API_BASE_URL}/api/organizations/me/active`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const d = res.ok ? await res.json() : null;
      const id = d ? (d.id || d.orgId || null) : null;
      __activeOrgCache = { id, ts: Date.now() };
      return id;
    } catch {
      return __activeOrgCache?.id ?? null;
    } finally {
      __activeOrgInFlight = null;
    }
  })();
  return __activeOrgInFlight;
}

/** Pull the v2 matching signals off a raw backend suggestion item so the
 *  resolver classifier can route precisely (these were being dropped before).
 *  Input is contract-typed: if the backend renames a signal, this stops compiling
 *  instead of silently dropping it again. */
function extractV2Signals(item: Partial<BackendMappingSuggestion> & Record<string, any>): Partial<MappingSuggestion> {
  const out: Partial<MappingSuggestion> = {};
  if (item.productShape) out.productShape = item.productShape;
  if (item.requiresFamilyDecision === true) out.requiresFamilyDecision = true;
  if (item.familyDecisionReason) out.familyDecisionReason = item.familyDecisionReason;
  if (item.isDuplicateSuggestedCanonical === true || item.isDuplicatePlatformProduct === true) out.isDuplicate = true;
  if (typeof item.duplicateCount === 'number') out.duplicateCount = item.duplicateCount;
  if (Array.isArray(item.fieldConflicts) && item.fieldConflicts.length) {
    out.fieldConflicts = item.fieldConflicts.map((c: any) => ({
      field: c.field,
      platformValue: c.platformValue ?? null,
      canonicalValue: c.canonicalValue ?? null,
      severity: c.severity,
    }));
  }
  if (Array.isArray(item.candidateVariants) && item.candidateVariants.length) {
    out.candidateVariants = item.candidateVariants.map((c: any) => ({
      id: c.Id || c.id,
      sku: c.Sku ?? c.sku ?? null,
      title: c.Title ?? c.title ?? null,
      price: c.Price ?? c.price ?? null,
      imageUrl: c.ImageUrl ?? c.imageUrl ?? null,
    }));
  }
  // Composition + lifecycle signals (bundle/kit, stale links, idempotency).
  if (item.compositionType === 'bundle' || item.compositionType === 'kit') out.compositionType = item.compositionType;
  if (Array.isArray(item.bundleParts) && item.bundleParts.length) {
    out.bundleParts = item.bundleParts.map((p: any) => ({ sku: p.sku ?? null, title: p.title ?? null, quantity: p.quantity }));
  }
  if (Array.isArray(item.kitComponents) && item.kitComponents.length) {
    out.kitComponents = item.kitComponents.map((c: any) => ({
      id: c.id,
      sku: c.sku ?? null,
      title: c.title ?? null,
      price: c.price ?? null,
      imageUrl: c.imageUrl ?? null,
    }));
  }
  if (item.isStaleLink === true) {
    out.isStaleLink = true;
    if (item.staleReason) out.staleReason = item.staleReason;
  }
  if (item.alreadyMapped === true) out.alreadyMapped = true;
  if (item.priorResolution) out.priorResolution = item.priorResolution;
  if (typeof item.sourceHash === 'string') out.sourceHash = item.sourceHash;
  return out;
}

export interface UseImportSessionOptions {
  connectionId: string | undefined;
  platformName: string;
  isCSVImport?: boolean;
  importedProducts?: any[];
  connection?: any;
  platformConnections?: any[];
  onNavigate?: (screen: string, params?: any) => void;
  /** When true, hook does not run initial fetch; parent must call refreshSuggestions() when ready */
  skipInitialFetch?: boolean;
}

export interface UseImportSessionResult {
  // Core state
  suggestions: MappingSuggestion[] | null;
  setSuggestions: React.Dispatch<React.SetStateAction<MappingSuggestion[] | null>>;
  importDraft: ImportDraft | null;
  draftLog: DraftDecision[];
  recordDecision: (decision: DraftDecision) => void;
  reopenDecision: (unitId: string) => void;
  loading: boolean;
  error: string | null;
  hasLoadedDraft: boolean;

  // Counts derived from suggestions
  counts: ImportSessionCounts;
  totalScanned: number;
  matchedCount: number;
  reviewCount: number;
  mappingDone: boolean;

  // Settings summary
  settingsDone: boolean;
  syncDirection: string;
  poolName: string;

  // Wizard state
  wizardVisible: boolean;
  setWizardVisible: (v: boolean) => void;
  wizardStep: number;
  setWizardStep: (n: number | ((prev: number) => number)) => void;
  productCreationMode: ProductCreationMode;
  setProductCreationMode: (m: ProductCreationMode) => void;
  selectedPool: string | null;
  setSelectedPool: (p: string | null) => void;
  poolNameInput: string;
  setPoolNameInput: (s: string) => void;
  pools: any[];
  setPools: React.Dispatch<React.SetStateAction<any[]>>;
  connectionLocations: ConnectionLocation[];
  displayConnectionLocations: ConnectionLocation[];
  locationPoolAssignments: Record<string, string>;
  setLocationPoolAssignments: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  isLoadingPools: boolean;
  isLoadingLocations: boolean;
  isCreatingPool: boolean;
  setIsCreatingPool: (v: boolean) => void;
  syncMode: 'auto' | 'manual';
  setSyncMode: (m: 'auto' | 'manual') => void;
  delistMode: 'auto' | 'manual';
  setDelistMode: (m: 'auto' | 'manual') => void;
  priceBuffer: Record<string, number>;
  setPriceBuffer: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  inventoryBuffer: Record<string, number>;
  setInventoryBuffer: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  globalInventoryBuffer: number;
  setGlobalInventoryBuffer: (n: number) => void;
  inventoryMergeMode: 'merged' | 'separate' | null;
  setInventoryMergeMode: (m: 'merged' | 'separate' | null) => void;
  platformConnections: any[];

  // Actions
  refreshSuggestions: () => Promise<void>;
  submitImport: () => Promise<void>;
  handleCreatePool: () => Promise<void>;
  getSyncRuleDirectionPatch: (mode: ProductCreationMode) => any;
  isSubmitting: boolean;
  connection: any;
}

export function useImportSession(options: UseImportSessionOptions): UseImportSessionResult {
  const {
    connectionId,
    platformName,
    isCSVImport = false,
    importedProducts,
    connection: externalConnection,
    platformConnections: externalPlatformConnections = [],
    onNavigate,
    skipInitialFetch = false,
  } = options;

  const [suggestions, setSuggestions] = useState<MappingSuggestion[] | null>(null);
  // The backend-built decision draft (processed: auto-resolved, clustered,
  // ordered, with per-unit recommendations). An enhancement layered over the
  // local pipeline — null until fetched / if the endpoint is unavailable.
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);
  // The running decision log (the user's choices), held locally and saved to the
  // server as they go. Seeded from the draft on load so the queue resumes.
  const [draftLog, setDraftLog] = useState<DraftDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
  const [connection, setConnection] = useState<any>(externalConnection || null);
  const [platformConnections, setPlatformConnections] = useState<any[]>(externalPlatformConnections);

  // Wizard state
  const [wizardVisible, setWizardVisible] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [productCreationMode, setProductCreationMode] = useState<ProductCreationMode>('pull_only');
  const [selectedPool, setSelectedPool] = useState<string | null>(null);
  const [poolNameInput, setPoolNameInput] = useState('');
  const [pools, setPools] = useState<any[]>([]);
  const [connectionLocations, setConnectionLocations] = useState<ConnectionLocation[]>([]);
  const [locationPoolAssignments, setLocationPoolAssignments] = useState<Record<string, string>>({});
  const [isLoadingPools, setIsLoadingPools] = useState(false);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [isCreatingPool, setIsCreatingPool] = useState(false);
  const [syncMode, setSyncMode] = useState<'auto' | 'manual'>('auto');
  const [delistMode, setDelistMode] = useState<'auto' | 'manual'>('auto');
  const [priceBuffer, setPriceBuffer] = useState<Record<string, number>>({});
  const [inventoryBuffer, setInventoryBuffer] = useState<Record<string, number>>({});
  const [globalInventoryBuffer, setGlobalInventoryBufferState] = useState(0);
  const [inventoryMergeMode, setInventoryMergeMode] = useState<'merged' | 'separate' | null>('merged');
  const [settingsDone, setSettingsDone] = useState(false);
  const [syncDirection, setSyncDirection] = useState('Bi-directional');
  const [poolName, setPoolName] = useState('Pool not assigned');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isVirtualDefaultLoc = (l: ConnectionLocation) =>
    l.platformLocationId.startsWith('default-') ||
    l.locationName === 'Default Location' ||
    (l.locationName != null && l.locationName.endsWith(' Inventory'));

  const displayConnectionLocations = useMemo(() => {
    const hasReal = connectionLocations.some((l) => !isVirtualDefaultLoc(l));
    return hasReal ? connectionLocations.filter((l) => !isVirtualDefaultLoc(l)) : connectionLocations;
  }, [connectionLocations]);

  const setGlobalInventoryBuffer = useCallback((n: number) => {
    setGlobalInventoryBufferState(n);
    setInventoryBuffer((prev) => {
      const next: Record<string, number> = {};
      platformConnections.forEach((c: any) => {
        next[c.Id] = n;
      });
      return { ...prev, ...next };
    });
  }, [platformConnections]);

  const getSyncRuleDirectionPatch = useCallback((mode: ProductCreationMode) => {
    if (mode === 'sync_everywhere') {
      return { syncDirection: 'bidirectional', allowPullFromPlatform: true, allowPushToPlatform: true, propagateCreates: true, propagateUpdates: true, propagateDeletes: false, propagateInventory: true };
    }
    if (mode === 'pull_only') {
      return { syncDirection: 'pull_only', allowPullFromPlatform: true, allowPushToPlatform: false, propagateCreates: false, propagateUpdates: false, propagateDeletes: false, propagateInventory: false };
    }
    if (mode === 'push_only') {
      return { syncDirection: 'push_only', allowPullFromPlatform: false, allowPushToPlatform: true, propagateCreates: true, propagateUpdates: true, propagateDeletes: false, propagateInventory: true };
    }
    return { syncDirection: 'bidirectional', allowPullFromPlatform: true, allowPushToPlatform: true, propagateCreates: false, propagateUpdates: true, propagateDeletes: false, propagateInventory: true };
  }, []);

  const fetchConnection = useCallback(async () => {
    if (!connectionId || connectionId === 'csv-import' || externalConnection) return;
    try {
      const token = await ensureSupabaseJwt();
      const res = await fetch(`${SSSYNC_API_BASE_URL}/api/platform-connections/${connectionId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        setConnection(data);
      }
    } catch (e) {
      log.error('[useImportSession] Error fetching connection:', e);
    }
  }, [connectionId, externalConnection]);

  const fetchPlatformConnections = useCallback(async () => {
    if (externalPlatformConnections.length > 0) {
      setPlatformConnections(externalPlatformConnections);
      return;
    }
    try {
      const token = await ensureSupabaseJwt();
      const orgId = (await getActiveOrgIdCached(token)) || undefined;
      const connRes = await supabase.from('PlatformConnections').select('Id, UserId, OrgId, PlatformType, DisplayName, Status').eq('IsEnabled', true);
      if (connRes.data && connRes.data.length > 0) {
        const filtered = orgId ? connRes.data.filter((c: any) => c.OrgId === orgId) : connRes.data;
        setPlatformConnections(filtered);
      }
    } catch (e) {
      log.error('[useImportSession] Error fetching connections:', e);
    }
  }, [externalPlatformConnections]);

  const fetchMappingSuggestions = useCallback(async () => {
    if (!connectionId) return;
    // The CSV connection insert failed upstream (placeholder id). Don't leave
    // the flow spinning — show a clear error so the user can go back and retry.
    if (connectionId === 'csv-import') {
      setLoading(false);
      setSuggestions([]);
      setError("We couldn't set up this import. Please go back and try again.");
      return;
    }
    if (isCSVImport && importedProducts) {
      const mapped: MappingSuggestion[] = importedProducts.map((p: any, index: number) => ({
        action: 'CREATE_NEW',
        platformProduct: {
          id: `csv-${index}`,
          sku: p.sku || `CSV-${index}`,
          title: p.title || 'Untitled',
          // CSV prices are user-formatted ("$1,299.00", "1.299,00"): strip
          // currency symbols and thousands separators before Number() so a
          // real price never coerces to 0.
          price: parseCsvPrice(p.price),
          imageUrl: p.imageUrl || null,
        },
        suggestedCanonicalProduct: null,
        isSelected: true,
        matchType: 'NONE',
        confidence: 1.0,
        originalData: p,
      }));
      setSuggestions(mapped);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setSuggestions(null);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error('Authentication token not found.');

      // ═══════════════════════════════════════════════════════════════
      // PRIMARY: Always load the real mapping state from the database.
      // This is the source of truth — not transient scan cache data.
      // ═══════════════════════════════════════════════════════════════
      let suggestions: MappingSuggestion[] = [];

      // 1️⃣ Existing mappings from PlatformProductMappings → MATCHED items
      try {
        const { data: mappings, error: mappingsError } = await supabase
          .from('PlatformProductMappings')
          .select(`*, ProductVariants (Id, ProductId, Sku, Title, Price, PrimaryImageUrl)`)
          .eq('PlatformConnectionId', connectionId);

        if (mappingsError) {
          log.error('[useImportSession] Mappings query error:', mappingsError.message);
        }

        if (mappings && mappings.length > 0) {
          log.debug(`[useImportSession] ✅ ${mappings.length} existing mappings from DB`);
          const mapped: MappingSuggestion[] = mappings.map((m: any) => {
            const pv = m.ProductVariants;
            return {
              action: 'LINK_EXISTING' as const,
              isSelected: true,
              // These are already linked in the DB — settle them so they never
              // surface as a pending decision (and carry the idempotency hash).
              resolved: true,
              alreadyMapped: true,
              sourceHash: m.SourceHash ?? undefined,
              platformProduct: {
                id: m.PlatformProductId || m.Id,
                sku: m.PlatformSku || pv?.Sku || 'N/A',
                title: pv?.Title || m.PlatformSku || 'Unknown Product',
                price: pv?.Price || 0,
                imageUrl: pv?.PrimaryImageUrl || (m.PlatformSpecificData as any)?.imageUrl || null,
                parentId: pv?.ProductId || null,
              },
              suggestedCanonicalProduct: pv ? {
                id: m.ProductVariantId,
                sku: pv.Sku || 'N/A',
                title: pv.Title || 'Unknown Product',
                imageUrl: pv.PrimaryImageUrl || null,
              } : null,
              matchType: 'SKU' as const,
              confidence: 1.0,
            };
          });
          suggestions = [...suggestions, ...mapped];
        }
      } catch (err: any) {
        log.error('[useImportSession] Error loading mappings:', err?.message);
      }

      // 2️⃣ Unmapped org variants from /missing-mappings → UNMATCHED items to push
      try {
        const missingResp = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/missing-mappings`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (missingResp.ok) {
          const missing = await missingResp.json();
          if (Array.isArray(missing) && missing.length > 0) {
            log.debug(`[useImportSession] ✅ ${missing.length} unmapped items from /missing-mappings`);
            const missingAsSuggestions: MappingSuggestion[] = missing.map((m: any) => ({
              action: 'UNMATCHED' as const,
              direction: 'anorha_to_platform' as const,
              platformProduct: {
                id: m.variantId || `missing-${m.productId}`,
                sku: m.sku || '',
                title: m.title || '',
                price: m.price || 0,
                imageUrl: m.imageUrl || null,
                parentId: m.productId || null,
              },
              suggestedCanonicalProduct: null,
              isSelected: false,
              matchType: 'NONE' as const,
              confidence: 0,
            }));
            suggestions = [...suggestions, ...missingAsSuggestions];
          }
        }
      } catch {
        // Non-blocking: missing-mappings endpoint may not exist for CSV connections
      }

      // ═══════════════════════════════════════════════════════════════
      // OVERLAY: If a fresh scan just ran, the mapping-suggestions API
      // returns richer data (AI matches, confidence scores, scan-specific
      // data). Merge these on top of the DB data.
      // ═══════════════════════════════════════════════════════════════
      try {
        const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/mapping-suggestions`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });

        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && data.length > 0) {
            log.debug(`[useImportSession] 🔄 ${data.length} scan suggestions available, merging...`);

            // Build a lookup of existing suggestions by platform product ID
            const existingIds = new Set(suggestions.map(s => s.platformProduct?.id).filter(Boolean));

            for (const item of data) {
              const direction = item.direction || 'platform_to_anorha';
              const itemId = direction === 'anorha_to_platform'
                ? (item.anorhaVariant?.Id || item.anorhaVariant?.id)
                : (item.platformProduct?.id);

              if (!itemId) continue;

              // If this item already exists from DB, update it with scan data (richer info)
              if (existingIds.has(itemId)) {
                const existing = suggestions.find(s => s.platformProduct?.id === itemId);
                if (existing) {
                  if (item.suggestedCanonicalVariant) {
                    existing.suggestedCanonicalProduct = {
                      id: item.suggestedCanonicalVariant.Id,
                      sku: item.suggestedCanonicalVariant.Sku,
                      title: item.suggestedCanonicalVariant.Title,
                      price: item.suggestedCanonicalVariant.Price,
                      imageUrl: item.suggestedCanonicalVariant.PrimaryImageUrl ?? item.suggestedCanonicalVariant.ImageUrl,
                    };
                    existing.matchType = item.matchType || existing.matchType;
                    existing.confidence = item.confidence ?? existing.confidence;
                  }
                  // Don't drop the server's decision signals for known rows: a
                  // re-scan can newly flag a broken link or a value conflict.
                  // extractV2Signals normalizes both naming conventions (the
                  // resolver kit reads the v2 names); layer the server's draft
                  // ids on top so the queue can still address the row.
                  Object.assign(existing, extractV2Signals(item));
                  existing.suggestionId = item.suggestionId ?? existing.suggestionId;
                  // A newly-surfaced conflict or broken link must re-open the row.
                  if ((item.fieldConflicts && item.fieldConflicts.length > 0) || item.isStaleLink) {
                    existing.resolved = false;
                  }
                }
                continue;
              }

              // New item from scan not in DB yet — add it
              const parentId = item.platformProduct?.parentId || null;
              const parentTitle = item.platformProduct?.parentTitle || null;

              if (direction === 'anorha_to_platform') {
                const productData = item.anorhaVariant?.Product;
                const parentProductTitle = Array.isArray(productData) ? productData[0]?.Title : productData?.Title || null;
                suggestions.push({
                  action: 'UNMATCHED',
                  platformProduct: {
                    id: item.anorhaVariant?.Id || item.anorhaVariant?.id || `anorha-${Date.now()}`,
                    sku: item.anorhaVariant?.Sku || item.anorhaVariant?.sku || '',
                    title: item.anorhaVariant?.Title || item.anorhaVariant?.title || 'Unnamed Item',
                    price: item.anorhaVariant?.Price || item.anorhaVariant?.price || 0,
                    imageUrl: item.anorhaVariant?.ImageUrl || item.anorhaVariant?.imageUrl || null,
                    parentId: item.anorhaVariant?.ProductId || item.anorhaVariant?.productId || null,
                    parentTitle: parentProductTitle,
                  },
                  anorhaVariant: item.anorhaVariant ? {
                    id: item.anorhaVariant.Id || item.anorhaVariant.id,
                    sku: item.anorhaVariant.Sku || item.anorhaVariant.sku,
                    title: item.anorhaVariant.Title || item.anorhaVariant.title,
                    price: item.anorhaVariant.Price || item.anorhaVariant.price,
                    barcode: item.anorhaVariant.Barcode || item.anorhaVariant.barcode,
                    imageUrl: item.anorhaVariant.ImageUrl || item.anorhaVariant.imageUrl,
                  } : null,
                  suggestedCanonicalProduct: null,
                  direction: 'anorha_to_platform',
                  isSelected: false,
                  matchType: (item.matchType as any) || 'NONE',
                  confidence: 0,
                  ...extractV2Signals(item),
                });
              } else {
                let action: MappingSuggestion['action'] = 'UNMATCHED';
                let isSelected = false;
                if ((item.matchType === 'SKU' || item.matchType === 'BARCODE') && item.suggestedCanonicalVariant) {
                  action = 'LINK_EXISTING';
                  isSelected = true;
                }

                suggestions.push({
                  action,
                  platformProduct: {
                    id: item.platformProduct?.id || '',
                    sku: item.platformProduct?.sku || '',
                    title: item.platformProduct?.title || '',
                    price: item.platformProduct?.price ? parseFloat(String(item.platformProduct.price)) : 0,
                    imageUrl: item.platformProduct?.imageUrl || null,
                    parentId,
                    parentTitle,
                  },
                  suggestedCanonicalProduct: item.suggestedCanonicalVariant ? {
                    id: item.suggestedCanonicalVariant.Id,
                    sku: item.suggestedCanonicalVariant.Sku,
                    title: item.suggestedCanonicalVariant.Title,
                    price: item.suggestedCanonicalVariant.Price,
                    imageUrl: item.suggestedCanonicalVariant.PrimaryImageUrl ?? item.suggestedCanonicalVariant.ImageUrl,
                  } : null,
                  direction: direction === 'bidirectional' ? 'bidirectional' : 'platform_to_anorha',
                  isSelected,
                  matchType: item.matchType,
                  confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
                  // Normalize the v2 resolver-kit signals (classifyMatch reads
                  // these) and carry through the server's draft-queue fields that
                  // extractV2Signals doesn't cover.
                  ...extractV2Signals(item),
                  suggestionId: item.suggestionId,
                  familyMemberCount: item.familyMemberCount,
                  familyResolvedCount: item.familyResolvedCount,
                  familyUnmatchedCount: item.familyUnmatchedCount,
                  isDuplicateSuggestedCanonical: item.isDuplicateSuggestedCanonical,
                  duplicateSuggestedCanonicalSuggestionIds: item.duplicateSuggestedCanonicalSuggestionIds,
                });
              }
            }
          }
        }
      } catch {
        // Non-blocking: scan suggestions are an overlay, not required
      }

      // Deduplicate by platformProduct.id
      const seenIds = new Set<string>();
      const deduped = suggestions.filter((s) => {
        const id = s.platformProduct?.id;
        if (!id || seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
      });

      // Clustering, auto-resolve, ordering — all owned by the backend now. The
      // app just keeps the raw rows for the lobby's matched/skipped tabs.
      setSuggestions(deduped);

      // The processed plan IS the import flow now (the queue walks it and records
      // choices locally). Cleared first so a stale draft can't outlive a refresh;
      // the saved log comes back on the draft so the queue resumes mid-flow.
      // Reset draft AND log together: a surviving log over a missing/empty draft
      // would submit stale decisions and drift the lobby counts.
      setImportDraft(null);
      setDraftLog([]);
      try {
        const draftRes = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/import-draft`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (draftRes.ok) {
          const draft = (await draftRes.json()) as ImportDraft;
          setImportDraft(draft);
          setDraftLog(Array.isArray(draft.decisions) ? draft.decisions : []);
        }
      } catch {
        // ignore — draft fetch failure leaves the queue empty until refresh
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [connectionId, isCSVImport, importedProducts]);

  const refreshSuggestions = useCallback(() => fetchMappingSuggestions(), [fetchMappingSuggestions]);

  // ── The decision log: choices live here, saved to the server as the user goes
  // (debounced) and pushed once at commit. Reversing is instant — it's a local
  // edit, no round-trip. The app never derives; it just records taps.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDraftLog = useCallback((log: DraftDecision[]) => {
    if (!connectionId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const token = await ensureSupabaseJwt();
        await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/import-draft/decisions`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ decisions: log }),
        });
      } catch {
        // best-effort persistence; the in-memory log is still authoritative
      }
    }, 700);
  }, [connectionId]);

  // Record (or replace) a decision. Answers are keyed by unit; drops accumulate.
  const recordDecision = useCallback((decision: DraftDecision) => {
    setDraftLog((prev) => {
      const next = decision.kind === 'answer'
        ? [...prev.filter((d) => !(d.kind === 'answer' && d.unitId === decision.unitId)), decision]
        : [...prev, decision];
      saveDraftLog(next);
      return next;
    });
  }, [saveDraftLog]);

  // Step back into a decision — drop it from the log; the unit returns to the queue.
  const reopenDecision = useCallback((unitId: string) => {
    setDraftLog((prev) => {
      const next = prev.filter((d) => !(d.kind === 'answer' && d.unitId === unitId));
      saveDraftLog(next);
      return next;
    });
  }, [saveDraftLog]);

  // Sync productCreationMode effect - update suggestions selection
  useEffect(() => {
    if (!suggestions || suggestions.length === 0) return;
    setSuggestions((prev) =>
      (prev || []).map((suggestion) => {
        const direction = suggestion.direction || 'platform_to_anorha';
        switch (productCreationMode) {
          case 'sync_everywhere':
            return { ...suggestion, isSelected: suggestion.action !== 'IGNORE' && suggestion.action !== 'UNMATCHED' };
          case 'pull_only':
            if (direction === 'anorha_to_platform') return { ...suggestion, isSelected: false };
            return { ...suggestion, isSelected: suggestion.action !== 'IGNORE' && suggestion.action !== 'UNMATCHED' };
          case 'push_only':
            if (direction === 'anorha_to_platform') return { ...suggestion, isSelected: true };
            if (suggestion.action === 'CREATE_NEW' || suggestion.action === 'UNMATCHED') return { ...suggestion, isSelected: false };
            return { ...suggestion, isSelected: suggestion.action !== 'IGNORE' };
          case 'do_nothing':
            if (direction === 'anorha_to_platform') return { ...suggestion, isSelected: false };
            if (suggestion.action === 'CREATE_NEW' || suggestion.action === 'UNMATCHED') return { ...suggestion, isSelected: false };
            return { ...suggestion, isSelected: suggestion.action !== 'IGNORE' };
          default:
            return suggestion;
        }
      })
    );
  }, [productCreationMode]);

  // Fetch connection
  useEffect(() => {
    if (externalConnection) {
      setConnection(externalConnection);
      return;
    }
    fetchConnection();
  }, [connectionId, externalConnection, fetchConnection]);

  // Initial fetch
  useEffect(() => {
    if (!connectionId) {
      setLoading(false);
      return;
    }
    if (skipInitialFetch) {
      setLoading(false);
      return;
    }
    if (isCSVImport && importedProducts) {
      fetchMappingSuggestions();
      return;
    }
    fetchMappingSuggestions();
  }, [connectionId, isCSVImport, skipInitialFetch]);

  // Draft load
  useEffect(() => {
    if (!connectionId || hasLoadedDraft || isCSVImport) return;
    (async () => {
      try {
        const token = await ensureSupabaseJwt();
        if (!token) return;
        const resp = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/draft-mappings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          setHasLoadedDraft(true);
          return;
        }
        const data = await resp.json();
        const draftMatches = Array.isArray(data?.confirmedMatches) ? data.confirmedMatches : [];
        if (draftMatches.length > 0) {
          setSuggestions((prev) => {
            if (!Array.isArray(prev)) return prev;
            const mapById: Record<string, any> = {};
            for (const d of draftMatches) {
              mapById[d.platformProductId || d.sourceId] = d;
            }
            return prev.map((s) => {
              const d = mapById[s.platformProduct.id];
              if (!d) return s;
              const action =
                d.action?.toUpperCase?.() === 'LINK'
                  ? 'LINK_EXISTING'
                  : d.action?.toUpperCase?.() === 'CREATE'
                  ? 'CREATE_NEW'
                  : 'IGNORE';
              return {
                ...s,
                action: action as any,
                isSelected: action !== 'IGNORE',
                suggestedCanonicalProduct: d.sssyncVariantId
                  ? { id: d.sssyncVariantId, sku: s.suggestedCanonicalProduct?.sku || '', title: s.suggestedCanonicalProduct?.title || '', price: undefined, imageUrl: undefined }
                  : s.suggestedCanonicalProduct,
              };
            });
          });
        }
      } catch {
        // ignore
      }
      setHasLoadedDraft(true);
    })();
  }, [connectionId, hasLoadedDraft, isCSVImport]);

  // Draft save (debounced)
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        // Don't PUT an empty confirmedMatches: suggestions is set to [] on a
        // fetch error, and saving that empty draft would clobber a real
        // server-side draft. Only autosave when there is something to save.
        if (!connectionId || !Array.isArray(suggestions) || suggestions.length === 0 || isCSVImport) return;
        const confirmedMatches = suggestions.map((s) => ({
          platformProductId: s.platformProduct.id,
          sssyncVariantId: s.action === 'LINK_EXISTING' ? s.suggestedCanonicalProduct?.id : null,
          action: s.action === 'LINK_EXISTING' ? 'link' : s.action === 'CREATE_NEW' ? 'create' : 'ignore',
          // Resolver-composer extras — best effort; the backend ignores keys it
          // doesn't know yet, so this is safe to send today.
          ...(s.reasonNote ? { reasonNote: s.reasonNote } : {}),
          ...(s.reasonTags && s.reasonTags.length ? { reasonTags: s.reasonTags } : {}),
        }));
        const token = await ensureSupabaseJwt();
        if (!token) return;
        await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/draft-mappings`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmedMatches }),
        });
      } catch {
        // ignore
      }
    }, 600);
    return () => clearTimeout(t);
  }, [suggestions, connectionId, isCSVImport]);

  // Fetch pools
  useEffect(() => {
    if (!connectionId || connectionId === 'csv-import') return;
    const run = async () => {
      setIsLoadingPools(true);
      try {
        const token = await ensureSupabaseJwt();
        let orgId = connection?.OrgId || externalConnection?.OrgId;
        if (!orgId) orgId = (await getActiveOrgIdCached(token)) || undefined;
        if (!orgId) {
          setPools([]);
          return;
        }
        const res = await fetch(`${SSSYNC_API_BASE_URL}/api/pools/org/${orgId}`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (!res.ok) {
          setPools([]);
          return;
        }
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setPools(list);
        if (list.length > 0 && !selectedPool) setSelectedPool(list[0].id);
      } catch (e) {
        setPools([]);
      } finally {
        setIsLoadingPools(false);
      }
    };
    run();
  }, [connectionId, connection?.OrgId, externalConnection?.OrgId]);

  // Fetch locations
  useEffect(() => {
    if (!connectionId || connectionId === 'csv-import' || isLoadingPools) return;
    const run = async () => {
      setIsLoadingLocations(true);
      try {
        const { data: locations } = await supabase
          .from('PlatformLocations')
          .select('PlatformLocationId, Name, Timezone')
          .eq('PlatformConnectionId', connectionId);

        const formatted: ConnectionLocation[] = (locations || []).map((l) => ({
          platformLocationId: l.PlatformLocationId,
          locationName: l.Name || 'Unnamed Location',
          timezone: l.Timezone || undefined,
        }));
        setConnectionLocations(formatted);

        const existingAssignments: Record<string, string> = {};
        for (const loc of formatted) {
          const pool = pools.find((p) => (p.locationIds || p.location_ids || []).includes(loc.platformLocationId));
          if (pool) existingAssignments[loc.platformLocationId] = pool.id;
        }
        if (Object.keys(existingAssignments).length > 0) {
          setLocationPoolAssignments(existingAssignments);
          const first = Object.values(existingAssignments)[0];
          if (first && !selectedPool) setSelectedPool(first);
        }
      } catch (e) {
        setConnectionLocations([]);
      } finally {
        setIsLoadingLocations(false);
      }
    };
    run();
  }, [connectionId, pools, isLoadingPools]);

  // Load quick settings
  useEffect(() => {
    if (!connectionId || connectionId === 'csv-import') return;
    const run = async () => {
      try {
        const token = await ensureSupabaseJwt();
        const res = await fetch(`${SSSYNC_API_BASE_URL}/api/connections/${connectionId}/quick-settings`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (!res.ok) return;
        const qs = await res.json();
        const dir = qs?.syncRules?.syncDirection;
        const canPush = qs?.syncRules?.allowPushToPlatform !== false;
        const canPull = qs?.syncRules?.allowPullFromPlatform !== false;
        setSettingsDone(Boolean(dir || qs?.poolName));
        if (dir === 'push_only' || (canPush && !canPull)) setSyncDirection('Push only');
        else if (dir === 'pull_only' || (!canPush && canPull)) setSyncDirection('Pull only');
        else setSyncDirection('Bi-directional');
        if (qs?.poolName) setPoolName(qs.poolName);
        if (qs.poolId) setSelectedPool(qs.poolId);
        setSyncMode(qs.autoSyncMode ? 'auto' : 'manual');
        setDelistMode(qs.autoDelist ? 'auto' : 'manual');
        setPriceBuffer(qs.priceAdjustment || {});
        setInventoryBuffer(qs.inventoryBuffer || {});
        if (dir === 'push_only' || (canPush && !canPull)) setProductCreationMode('push_only');
        else if (dir === 'pull_only' || (!canPush && canPull)) setProductCreationMode('pull_only');
        else if (qs?.syncRules?.propagateCreates === false) setProductCreationMode('do_nothing');
        else setProductCreationMode('sync_everywhere');
      } catch {
        // keep defaults
      }
    };
    run();
  }, [connectionId]);

  // Fetch platform connections for wizard
  useEffect(() => {
    fetchPlatformConnections();
  }, [fetchPlatformConnections]);

  const counts = useMemo((): ImportSessionCounts => {
    const list = suggestions || [];
    const all = list.length;
    const matched = list.filter((s) => s.action === 'LINK_EXISTING' || (s.action === 'CREATE_NEW' && s.resolved === true)).length;
    const needs_review = list.filter((s) => s.action === 'UNMATCHED' || (s.action === 'CREATE_NEW' && !s.resolved)).length;
    const ignored = list.filter((s) => s.action === 'IGNORE').length;
    const push = list.filter((s) => s.direction === 'anorha_to_platform' && s.isSelected).length;
    const pushTotal = list.filter((s) => s.direction === 'anorha_to_platform').length;
    return {
      all,
      matched,
      needs_review,
      review: needs_review,
      ignored,
      ignore: ignored,
      push,
      pushTotal,
    };
  }, [suggestions]);

  const totalScanned = counts.all;
  const matchedCount = counts.matched;
  const reviewCount = counts.needs_review;
  const mappingDone = reviewCount === 0;

  const handleCreatePool = useCallback(async () => {
    if (!poolNameInput.trim() || !connectionId) return;
    try {
      setIsCreatingPool(true);
      const token = await ensureSupabaseJwt();
      let orgId = connection?.OrgId;
      if (!orgId) orgId = (await getActiveOrgIdCached(token)) || undefined;
      if (!orgId) throw new Error('Could not determine organization');

      const locationIdsForNewPool = displayConnectionLocations
        .filter((loc) => {
          const assigned = locationPoolAssignments[loc.platformLocationId];
          return assigned === 'create-new' || !assigned;
        })
        .map((loc) => loc.platformLocationId);

      const res = await fetch(`${SSSYNC_API_BASE_URL}/api/pools`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          name: poolNameInput.trim(),
          description: `Pool for ${connection?.DisplayName || 'new connection'}`,
          syncInventory: true,
          syncPricing: true,
          location_ids: locationIdsForNewPool,
        }),
      });
      if (!res.ok) throw new Error('Failed to create pool');
      const newPool = await res.json();

      const poolsRes = await fetch(`${SSSYNC_API_BASE_URL}/api/pools/org/${orgId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (poolsRes.ok) {
        const poolsData = await poolsRes.json();
        const list = Array.isArray(poolsData) ? poolsData : [];
        setPools(list);
        const found = list.find((p: any) => p.id === newPool.id) || newPool;
        setSelectedPool(found.id);
      } else {
        setPools((p) => [...p, newPool]);
        setSelectedPool(newPool.id);
      }
      setPoolNameInput('');
      setWizardStep(1);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to create pool');
    } finally {
      setIsCreatingPool(false);
    }
  }, [poolNameInput, connectionId, connection, displayConnectionLocations, locationPoolAssignments]);

  const submitImport = useCallback(async () => {
    if (!connectionId) return;
    // 'csv-import' is the placeholder used when the CSV connection insert
    // failed upstream — there is no real connection to commit against, so
    // surface the failure instead of silently no-op'ing into a dead-end.
    if (connectionId === 'csv-import') {
      Alert.alert('Import unavailable', "We couldn't set up this import. Please go back and try again.");
      return;
    }
    // The server builds the commit items from its own decision log — the app
    // just sends the sync rules and triggers the commit (POST import-draft/commit).
    setIsSubmitting(true);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error('Authentication token not found.');

      let mapPoolId = selectedPool;
      const assignments = { ...locationPoolAssignments };

      const needsNewPool = selectedPool === 'create-new' || Object.values(assignments).some((id) => id === 'create-new');
      if (needsNewPool && poolNameInput) {
        const createRes = await fetch(`${SSSYNC_API_BASE_URL}/api/pools`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: 'current',
            name: poolNameInput,
            description: `Created during import from ${platformName}`,
            syncInventory: true,
            syncPricing: true,
            inventoryMode: 'shared',
          }),
        });
        if (createRes.ok) {
          const newPool = await createRes.json();
          if (mapPoolId === 'create-new') mapPoolId = newPool.id;
          Object.keys(assignments).forEach((locId) => {
            if (assignments[locId] === 'create-new') assignments[locId] = newPool.id;
          });
        }
      }

      const poolToLocations = new Map<string, string[]>();
      Object.entries(assignments).forEach(([locId, poolId]) => {
        if (!poolId || poolId === 'create-new') return;
        const list = poolToLocations.get(poolId) || [];
        list.push(locId);
        poolToLocations.set(poolId, list);
      });
      for (const [pId, locIds] of poolToLocations.entries()) {
        if (locIds.length > 0) {
          await fetch(`${SSSYNC_API_BASE_URL}/api/pools/${pId}/locations`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ location_ids: locIds }),
          });
        }
      }

      const directionPatch = getSyncRuleDirectionPatch(productCreationMode);
      const syncRulesPayload = {
        ...directionPatch,
        poolId: mapPoolId || undefined,
        inventoryMergeMode: inventoryMergeMode || 'merged',
        autoSyncMode: syncMode === 'auto',
        autoDelist: delistMode === 'auto',
        priceAdjustment: priceBuffer,
        inventoryBuffer,
        syncInventory: true,
        syncPricing: true,
        productCreationMode,
      };

      // The review deck resolves matches directly on `suggestions` (sets action +
      // isSelected). That resolved set is the real plan — send it as explicit
      // commit items. (We still send draftLog so the server can fall back to its
      // replay path for older builds.) Without this, the server rebuilt the plan
      // from its own — sometimes empty — base and committed nothing.
      const commitItems = (suggestions || [])
        .filter((s) => s.isSelected && s.action !== 'IGNORE' && s.action !== 'UNMATCHED')
        .map((s) => {
          const parentId = s.platformProduct?.parentId ?? null;
          const action =
            s.direction === 'anorha_to_platform'
              ? 'PUSH_TO_PLATFORM'
              : s.action === 'LINK_EXISTING'
                ? 'LINK_EXISTING'
                : 'CREATE_NEW';
          // CSV imports carry the full mapped row in originalData. Lift the
          // fields the backend create-new path can persist (quantity, barcode,
          // cost, description, …) so they aren't silently dropped at commit.
          const csv = s.originalData;
          const csvFields = csv
            ? {
                description: csv.description ?? null,
                barcode: csv.barcode ?? null,
                quantity: csv.quantity != null && csv.quantity !== '' ? Math.trunc(parseCsvPrice(csv.quantity)) : null,
                cost: csv.cost != null && csv.cost !== '' ? parseCsvPrice(csv.cost) : null,
                compareAtPrice: csv.compareAtPrice != null && csv.compareAtPrice !== '' ? parseCsvPrice(csv.compareAtPrice) : null,
                weight: csv.weight != null && csv.weight !== '' ? parseCsvPrice(csv.weight) : null,
                brand: csv.brand ?? null,
                category: csv.category ?? null,
                condition: csv.condition ?? null,
                size: csv.size ?? null,
                color: csv.color ?? null,
              }
            : null;
          return {
            platformProduct: {
              id: s.platformProduct.id,
              sku: s.platformProduct.sku ?? null,
              title: s.platformProduct.title ?? null,
              price: s.platformProduct.price ?? null,
              imageUrl: s.platformProduct.imageUrl ?? null,
              parentId,
              ...(csvFields ? { csvFields } : {}),
            },
            action,
            direction: s.direction || 'platform_to_anorha',
            productShape: s.productShape || (parentId ? 'variant_family' : 'simple'),
            parentId,
            sourceHash: s.sourceHash,
            suggestedCanonicalProduct:
              s.action === 'LINK_EXISTING' && s.suggestedCanonicalProduct?.id
                ? {
                    id: s.suggestedCanonicalProduct.id,
                    sku: s.suggestedCanonicalProduct.sku ?? null,
                    title: s.suggestedCanonicalProduct.title ?? null,
                    price: s.suggestedCanonicalProduct.price ?? null,
                    imageUrl: s.suggestedCanonicalProduct.imageUrl ?? null,
                  }
                : null,
          };
        });

      // Nothing actionable to import (everything UNMATCHED/IGNORE and no
      // replayable decisions): short-circuit to a clear empty state instead of
      // POSTing an empty body — which the server either 500s on or "completes"
      // with 0 items, both of which read as a confusing dead-end.
      if (commitItems.length === 0 && (!Array.isArray(draftLog) || draftLog.length === 0)) {
        setIsSubmitting(false);
        setWizardVisible(false);
        Alert.alert('Nothing to import', 'No items were selected to import. Match or create at least one item, then try again.');
        return;
      }

      const confirmRes = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/import-draft/commit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: commitItems, decisions: draftLog, syncRules: syncRulesPayload }),
      });

      if (!confirmRes.ok) {
        const errText = await confirmRes.text();
        throw new Error(`Failed to confirm mappings: ${errText}`);
      }

      const result = await confirmRes.json().catch(() => ({}));
      const jobId = result?.jobId;
      const operationId = result?.operationId;
      // The server reports how many items it actually committed. Fall back to the
      // count we sent so the completion screen never reads "Imported 0 items" when
      // it really linked things.
      const committedCount = typeof result?.committedCount === 'number' ? result.committedCount : commitItems.length;

      // Persist the in-flight import so the user can leave and come back to
      // accurate, resumable progress (polled via useImportProgress).
      if (operationId) {
        try {
          await AsyncStorage.setItem(
            LAST_IMPORT_STORAGE_KEY,
            JSON.stringify({
              operationId,
              jobId: jobId || null,
              connectionId,
              // Best-effort total for the progress banner: everything the user
              // decided plus what the server auto-matched.
              itemsTotal: committedCount || (importDraft?.completed?.length || 0) + (importDraft?.summary?.autoResolved || 0),
              startedAt: new Date().toISOString(),
            }),
          );
        } catch (e) {
          // non-fatal: progress UI just won't auto-resume
        }
      }

      setWizardVisible(false);
      if (onNavigate) {
        onNavigate('PublishConfirmation', {
          platforms: [],
          priceBuffer,
          syncMode,
          delistMode,
          jobId,
          importCount: committedCount,
          origin: 'import',
        });
      }
    } catch (err: any) {
      Alert.alert('Import Error', err.message || 'Failed to complete import.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    connectionId,
    draftLog,
    suggestions,
    importDraft,
    selectedPool,
    poolNameInput,
    locationPoolAssignments,
    productCreationMode,
    inventoryMergeMode,
    syncMode,
    delistMode,
    priceBuffer,
    inventoryBuffer,
    platformName,
    getSyncRuleDirectionPatch,
    onNavigate,
  ]);

  return {
    suggestions,
    setSuggestions,
    importDraft,
    draftLog,
    recordDecision,
    reopenDecision,
    loading,
    error,
    hasLoadedDraft,
    counts,
    totalScanned,
    matchedCount,
    reviewCount,
    mappingDone,
    settingsDone,
    syncDirection,
    poolName,
    wizardVisible,
    setWizardVisible,
    wizardStep,
    setWizardStep,
    productCreationMode,
    setProductCreationMode,
    selectedPool,
    setSelectedPool,
    poolNameInput,
    setPoolNameInput,
    pools,
    setPools,
    connectionLocations,
    displayConnectionLocations,
    locationPoolAssignments,
    setLocationPoolAssignments,
    isLoadingPools,
    isLoadingLocations,
    isCreatingPool,
    setIsCreatingPool,
    syncMode,
    setSyncMode,
    delistMode,
    setDelistMode,
    priceBuffer,
    setPriceBuffer,
    inventoryBuffer,
    setInventoryBuffer,
    globalInventoryBuffer,
    setGlobalInventoryBuffer,
    inventoryMergeMode,
    setInventoryMergeMode,
    platformConnections,
  refreshSuggestions,
  submitImport,
  handleCreatePool,
  getSyncRuleDirectionPatch,
  isSubmitting,
  connection,
  };
}
