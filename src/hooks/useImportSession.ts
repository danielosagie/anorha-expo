import { useState, useEffect, useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';

// Shared key so the in-progress import survives leaving the flow and can be
// picked back up (status polling / progress banner) when the user returns.
export const LAST_IMPORT_STORAGE_KEY = 'anorha:lastImport';
import {
  MappingSuggestion,
  ProductCreationMode,
  ConnectionLocation,
  ImportSessionCounts,
} from '../types/importSession';

const SSSYNC_API_BASE_URL = (
  process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL ||
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  'https://api.sssync.app'
).replace(/\/+$/, '');

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
      console.error('[useImportSession] Error fetching connection:', e);
    }
  }, [connectionId, externalConnection]);

  const fetchPlatformConnections = useCallback(async () => {
    if (externalPlatformConnections.length > 0) {
      setPlatformConnections(externalPlatformConnections);
      return;
    }
    try {
      const token = await ensureSupabaseJwt();
      const orgRes = await fetch(`${SSSYNC_API_BASE_URL}/api/organizations/me/active`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      let orgId: string | undefined;
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        orgId = orgData.id || orgData.orgId;
      }
      const connRes = await supabase.from('PlatformConnections').select('Id, UserId, OrgId, PlatformType, DisplayName, Status').eq('IsEnabled', true);
      if (connRes.data && connRes.data.length > 0) {
        const filtered = orgId ? connRes.data.filter((c: any) => c.OrgId === orgId) : connRes.data;
        setPlatformConnections(filtered);
      }
    } catch (e) {
      console.error('[useImportSession] Error fetching connections:', e);
    }
  }, [externalPlatformConnections]);

  const fetchMappingSuggestions = useCallback(async () => {
    if (!connectionId || connectionId === 'csv-import') return;
    if (isCSVImport && importedProducts) {
      const mapped: MappingSuggestion[] = importedProducts.map((p: any, index: number) => ({
        action: 'CREATE_NEW',
        platformProduct: {
          id: `csv-${index}`,
          sku: p.sku || `CSV-${index}`,
          title: p.title || 'Untitled',
          price: Number(p.price) || 0,
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
          console.error('[useImportSession] Mappings query error:', mappingsError.message);
        }

        if (mappings && mappings.length > 0) {
          console.log(`[useImportSession] ✅ ${mappings.length} existing mappings from DB`);
          const mapped: MappingSuggestion[] = mappings.map((m: any) => {
            const pv = m.ProductVariants;
            return {
              action: 'LINK_EXISTING' as const,
              isSelected: true,
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
        console.error('[useImportSession] Error loading mappings:', err?.message);
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
            console.log(`[useImportSession] ✅ ${missing.length} unmapped items from /missing-mappings`);
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
            console.log(`[useImportSession] 🔄 ${data.length} scan suggestions available, merging...`);

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
                if (existing && item.suggestedCanonicalVariant) {
                  existing.suggestedCanonicalProduct = {
                    id: item.suggestedCanonicalVariant.Id,
                    sku: item.suggestedCanonicalVariant.Sku,
                    title: item.suggestedCanonicalVariant.Title,
                    price: item.suggestedCanonicalVariant.Price,
                    imageUrl: item.suggestedCanonicalVariant.ImageUrl,
                  };
                  existing.matchType = item.matchType || existing.matchType;
                  existing.confidence = item.confidence ?? existing.confidence;
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
                    imageUrl: item.suggestedCanonicalVariant.ImageUrl,
                  } : null,
                  direction: direction === 'bidirectional' ? 'bidirectional' : 'platform_to_anorha',
                  isSelected,
                  matchType: item.matchType,
                  confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
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

      console.log(`[useImportSession] 📊 Final: ${deduped.length} total suggestions (${deduped.filter(s => s.action === 'LINK_EXISTING').length} matched, ${deduped.filter(s => s.action === 'UNMATCHED').length} unmatched)`);
      setSuggestions(deduped);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [connectionId, isCSVImport, importedProducts]);

  const refreshSuggestions = useCallback(() => fetchMappingSuggestions(), [fetchMappingSuggestions]);

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
        if (!connectionId || !Array.isArray(suggestions) || isCSVImport) return;
        const confirmedMatches = suggestions.map((s) => ({
          platformProductId: s.platformProduct.id,
          sssyncVariantId: s.action === 'LINK_EXISTING' ? s.suggestedCanonicalProduct?.id : null,
          action: s.action === 'LINK_EXISTING' ? 'link' : s.action === 'CREATE_NEW' ? 'create' : 'ignore',
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
        if (!orgId) {
          const res = await fetch(`${SSSYNC_API_BASE_URL}/api/organizations/me/active`, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          });
          if (res.ok) {
            const d = await res.json();
            orgId = d.id || d.orgId;
          }
        }
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
      if (!orgId) {
        const res = await fetch(`${SSSYNC_API_BASE_URL}/api/organizations/me/active`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const d = await res.json();
          orgId = d.id || d.orgId;
        }
      }
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
    if (!connectionId || connectionId === 'csv-import') return;
    const confirmedMappings = (suggestions || [])
      .filter((item) => item.isSelected)
      .map((item) => {
        let action: string;
        if (item.direction === 'anorha_to_platform') {
          action = 'push';
        } else if (item.action === 'CREATE_NEW') {
          action = 'create';
        } else if (item.action === 'LINK_EXISTING') {
          action = 'link';
        } else {
          action = 'ignore';
        }
        return {
          platformProductId: item.platformProduct.id,
          platformVariantId: item.platformProduct.id,
          platformProductSku: item.platformProduct.sku,
          platformProductTitle: item.platformProduct.title,
          sssyncVariantId:
            item.direction === 'anorha_to_platform'
              ? item.anorhaVariant?.id || item.platformProduct.id
              : item.suggestedCanonicalProduct?.id || null,
          action: action as 'link' | 'create' | 'ignore' | 'push',
        };
      });

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

      const confirmRes = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/confirm-mappings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmedMatches: confirmedMappings, syncRules: syncRulesPayload }),
      });

      if (!confirmRes.ok) {
        const errText = await confirmRes.text();
        throw new Error(`Failed to confirm mappings: ${errText}`);
      }

      const result = await confirmRes.json().catch(() => ({}));
      const jobId = result?.jobId;
      const operationId = result?.operationId;

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
              itemsTotal: confirmedMappings?.length || 0,
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
    suggestions,
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
