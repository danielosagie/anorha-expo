import React, { useEffect, useMemo, useState, forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput, Modal, Pressable, FlatList, SectionList, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Boxes, X, Sparkles } from 'lucide-react-native';
import { black, grey400 } from 'react-native-paper/lib/typescript/styles/themes/v2/colors';
import { overlay } from 'react-native-paper';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';

export type PlatformsData = Record<string, any>;

type Props = {
  platforms: PlatformsData;
  updateCounter?: number; // NEW: Signal when platforms ref content changes
  images: string[];
  platformLocations?: Record<string, Array<{ id: string; name: string; connectionId: string; connectionName: string }>>;
  onChangePlatforms: (next: PlatformsData) => void;
  onChangeImages?: (next: string[]) => void;
  onOpenFieldPanel?: (fieldKey: string) => void;
  onOpenBarcodeScanner?: (onResult: (code: string) => void) => void;
  onOpenImageCapture?: (onResult: (uris: string[]) => void) => void;
  onRegenerateField?: (platformKey: string, fieldKey: string) => void;
  onAddMissingField?: (platformKey: string) => void;
  getMissingFieldsCount?: (platformKey: string) => number;
  onGeneratePlatform?: (platformKey: string) => Promise<void>;
  enableAIRefill?: boolean;
  onSuggestVariants?: (platformKey: string) => void;
  onBoostListing?: (platformKey: string, kind: 'boost' | 'advanced') => void;
  // Optional publish-ignore controls
  onToggleIgnorePlatform?: (platformKey: string, ignored: boolean) => void;
  isPlatformIgnored?: (platformKey: string) => boolean;
};

export type ListingEditorFormRef = { openPlatformPicker: () => void };

type Variant = {
  id: string;
  optionValues: Record<string, string>; // e.g., { Size: 'Small', Color: 'Red' }
  price?: number;
  image?: string;
  inventoryByLocation?: Record<string, { quantity: number; price?: number; image?: string }>;
};

type PlatformState = {
  title?: string;
  description?: string;
  tags?: string[];
  price?: number;
  aiRecommendedPrice?: number; // AI-generated price suggestion from backend metadata
  weight?: number;
  weightUnit?: string;
  sku?: string;
  barcode?: string;
  images?: string[];
  // Advanced listing structures
  locations?: Array<{ id: string; name: string }>;
  locationQuantities?: Record<string, number>; // simple per-location inventory
  options?: Array<{ name: string; values: string[] }>; // e.g., [{name:'Size', values:['S','M','L']}]
  variants?: Variant[];
  // SEO fields removed - replaced with dynamic Additional Fields
  // Additional Fields

  // Inventory behavior
  inventoryType?: InventoryType;
};

const PLATFORM_META: Record<string, { label: string; icon: string }> = {
  shopify: { label: 'Shopify', icon: 'shopping' },
  amazon: { label: 'Amazon', icon: 'amazon' },
  ebay: { label: 'eBay', icon: 'shopping' },
  clover: { label: 'Clover', icon: 'leaf' },
  square: { label: 'Square', icon: 'square-outline' },
  facebook: { label: 'Facebook', icon: 'facebook' },
};

// Inventory behavior mapping
export type InventoryType = 'LOCATION_VARIANT_WITH_OPTIONS' | 'VARIANT_WITH_OPTIONS' | 'BASIC';

const DEFAULT_INVENTORY_TYPE_BY_PLATFORM: Record<string, InventoryType> = {
  shopify: 'LOCATION_VARIANT_WITH_OPTIONS',
  square: 'LOCATION_VARIANT_WITH_OPTIONS',
  clover: 'LOCATION_VARIANT_WITH_OPTIONS',
  amazon: 'VARIANT_WITH_OPTIONS',
  ebay: 'VARIANT_WITH_OPTIONS',
  facebook: 'BASIC',
  whatnot: 'BASIC',
  depop: 'BASIC',
};

// ✅ PRESET OPTIONS - baked into client, no API needed
export const PRESET_OPTIONS = [
  {
    name: 'Clothing Sizes',
    values: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL']
  },
  {
    name: 'Shoe Sizes',
    values: ['5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15']
  },
  {
    name: 'Colors',
    values: ['Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Pink', 'Orange', 'Brown', 'Gray', 'Navy', 'Beige']
  },
  {
    name: 'Materials',
    values: ['Cotton', 'Polyester', 'Wool', 'Silk', 'Leather', 'Linen', 'Nylon', 'Denim', 'Spandex']
  },
  {
    name: 'Condition',
    values: ['New', 'Like New', 'Good', 'Fair', 'Used', 'Refurbished']
  },
  {
    name: 'Size (General)',
    values: ['One Size', 'Small', 'Medium', 'Large', 'Extra Large']
  }
];

function ListingEditorFormInner({ platforms, updateCounter, images, platformLocations, onChangePlatforms, onChangeImages, onOpenFieldPanel, onOpenBarcodeScanner, onOpenImageCapture, onRegenerateField, onAddMissingField, getMissingFieldsCount, onGeneratePlatform, enableAIRefill, onSuggestVariants, onBoostListing, onToggleIgnorePlatform, isPlatformIgnored }: Props, ref: React.Ref<ListingEditorFormRef>) {
  const platformKeys = useMemo(() => {
    const keys = Object.keys(platforms || {}).filter((k) => typeof k === 'string' && k.trim().length > 0);
    console.log('[ListingEditorForm] platformKeys:', keys);
    return keys;
  }, [platforms]);

  const canonicalKey = useMemo(() => {
    const key = platformKeys.includes('shopify') ? 'shopify' : (platformKeys[0] || 'shopify');
    console.log('[ListingEditorForm] canonicalKey:', key, 'from platformKeys:', platformKeys);
    return key;
  }, [platformKeys]);

  // Default to 'all' tab instead of first platform
  const [activeTab, setActiveTab] = useState<string>('all');
  const [showAdditionalFields, setShowAdditionalFields] = useState<boolean>(true);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [optionEditorOpen, setOptionEditorOpen] = useState<boolean>(false);
  const [newOptionName, setNewOptionName] = useState<string>('');
  const [newOptionValues, setNewOptionValues] = useState<string[]>(['']);
  const [allPlatformOptions, setAllPlatformOptions] = useState<Array<{ name: string; values: string[]; sources: string[] }>>([]);
  const [optionPresets, setOptionPresets] = useState<Array<{ name: string; values: string[] }>>([]);
  const [loadingPlatformOptions, setLoadingPlatformOptions] = useState<boolean>(false);
  const [openImagePickerFor, setOpenImagePickerFor] = useState<string | null>(null);
  const [variantImagePicker, setVariantImagePicker] = useState<{ variantId: string; open: boolean } | null>(null);
  const [showPlatformPicker, setShowPlatformPicker] = useState<boolean>(false);
  const [generatingPlatforms, setGeneratingPlatforms] = useState<Set<string>>(new Set());

  useImperativeHandle(ref, () => ({
    openPlatformPicker: () => setShowPlatformPicker(true),
  }), []);

  const lastPlatformRef = useRef<string>('');
  const lastOptionsRef = useRef<string>('');

  // Update activeTab only if current tab becomes invalid. Avoid redundant resets.
  useEffect(() => {
    console.log('[ListingEditorForm] activeTab effect', { canonicalKey, activeTab, platformKeys });
    // Always allow 'all' tab
    if (activeTab === 'all') return;
    // If current platform tab is valid, keep it
    const activeExists = platformKeys.includes(activeTab);
    if (!activeExists && activeTab !== canonicalKey) {
      console.log('[ListingEditorForm] activeTab invalid → switching to all');
      setActiveTab('all');
    }
  }, [canonicalKey, platformKeys, activeTab]);
  const activePlatformKey = activeTab === 'all' ? canonicalKey : activeTab;
  const activeData = useMemo<PlatformState>(() => (platforms[activePlatformKey] || {}) as PlatformState, [activePlatformKey, platforms, updateCounter]);

  // When in 'all' tab, aggregate locations and quantities from all platforms
  const aggregatedLocations = useMemo(() => {
    if (activeTab !== 'all') return activeData.locations || [];
    const allLocs: Array<{ id: string; name: string; platformKey: string }> = [];
    for (const platformKey of platformKeys) {
      const platformData = platforms[platformKey] as PlatformState;
      const locs = platformData?.locations || [];
      for (const loc of locs) {
        // Use the raw location id for lookup so it matches variant.inventoryByLocation keys
        allLocs.push({ ...loc, platformKey, id: loc.id });
      }
    }
    return allLocs;
  }, [activeTab, activeData.locations, platformKeys, platforms]);

  const aggregatedLocationQuantities = useMemo<Record<string, { platformKey: string; quantity: number }>>(() => {
    if (activeTab !== 'all') return {};
    const agg: Record<string, { platformKey: string; quantity: number }> = {};
    for (const platformKey of platformKeys) {
      const platformData = platforms[platformKey] as PlatformState;
      const locs = platformData?.locations || [];
      const locQty = platformData?.locationQuantities || {};
      for (const loc of locs) {
        // Use raw loc.id so it matches inventoryByLocation keys
        const key = loc.id;
        agg[key] = { platformKey, quantity: locQty[loc.id] || 0 };
      }
    }
    return agg;
  }, [activeTab, platformKeys, platforms]);

  const selectedInventoryType: InventoryType = (activeData.inventoryType || DEFAULT_INVENTORY_TYPE_BY_PLATFORM[activePlatformKey] || 'BASIC');
  const isAdvanced = selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS';
  const supportsVariants = selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS' || selectedInventoryType === 'VARIANT_WITH_OPTIONS';

  const variantSuggestions: Array<{ name: string; values: string[] }> = ((platforms as any)[activePlatformKey]?.__variantSuggestions) || [];

  // Compute minimal required fields per platform for highlighting
  const requiredByPlatform: Record<string, string[]> = useMemo(() => ({
    shopify: ['title', 'sku', 'price'],
    square: ['title', 'sku', 'price'],
    amazon: ['title', 'sku', 'price'],
    ebay: ['title', 'price'],
    facebook: ['title', 'price'],
    clover: ['name', 'price'],
  }), []);
  const requiredFields = requiredByPlatform[activePlatformKey] || ['title', 'sku', 'price'];
  const ignoredForPublish = isPlatformIgnored?.(activePlatformKey) ?? false;

  const patchField = (key: string, value: any) => {
    if (activeTab === 'all') {
      // When in "all" mode, update all platforms
      const next = { ...platforms };
      for (const platformKey of platformKeys) {
        next[platformKey] = { ...(platforms[platformKey] || {}), [key]: value };
      }
      onChangePlatforms(next);
    } else {
      // Update only the active platform
      const keyToEdit = activePlatformKey;
      const next = { ...platforms, [keyToEdit]: { ...(platforms[keyToEdit] || {}), [key]: value } };
      onChangePlatforms(next);
    }
  };

  const patchPlatform = (updater: (prev: PlatformState) => PlatformState) => {
    const prev = (platforms[activePlatformKey] || {}) as PlatformState;
    const nextPlatform = updater(prev);
    console.log(`[PATCH] ${activePlatformKey}: variants before=${(prev.variants || []).length}, after=${(nextPlatform.variants || []).length}`);
    if (nextPlatform.variants?.length) {
      console.log(`[PATCH] First variant inv keys:`, Object.keys(nextPlatform.variants[0]?.inventoryByLocation || {}));
    }
    onChangePlatforms({ ...platforms, [activePlatformKey]: nextPlatform });
  };

  // Get locations for the active platform from prop
  const locations = useMemo(() => {
    // If platform has its own locations array, use that
    if (activeData.locations && activeData.locations.length > 0) {
      console.log(`[ListingEditorForm] Using locations from activeData for ${activePlatformKey}:`, activeData.locations);
      return activeData.locations;
    }

    // Otherwise, get from platformLocations prop for this platform type
    const platformType = activePlatformKey.toLowerCase();
    const platformLocs = platformLocations?.[platformType] || [];

    console.log(`[ListingEditorForm] Platform ${activePlatformKey} (${platformType}):`, {
      hasPlatformLocations: !!platformLocations,
      platformLocsCount: platformLocs.length,
      platformLocsKeys: Object.keys(platformLocations || {}),
      platformLocs: platformLocs
    });

    if (platformLocs.length > 0) {
      // Map to expected format with full display name
      return platformLocs.map(loc => ({
        id: loc.id,
        name: `${loc.name} - ${loc.connectionName}`
      }));
    }

    // Fallback to dummy data if no locations available
    return [{ id: 'loc-default', name: 'Default Location' }];
  }, [activeData.locations, activePlatformKey, platformLocations]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>(locations[0]?.id || 'loc-1');

  // CRITICAL: When locations change, reset selectedLocationId to first valid location
  useEffect(() => {
    const firstValidLoc = locations[0]?.id || 'loc-1';
    if (!locations.find(l => l.id === selectedLocationId)) {
      console.log(`[LOC-RESET] selectedLocationId ${selectedLocationId} no longer valid! Resetting to ${firstValidLoc}`);
      setSelectedLocationId(firstValidLoc);
    }
  }, [locations]);

  // Debug logging for inventory state (after locations are defined)
  console.log('[ListingEditorForm] Inventory state:', {
    activePlatformKey,
    selectedInventoryType,
    isAdvanced,
    supportsVariants,
    hasOptions: (activeData.options || []).length,
    hasVariants: (activeData.variants || []).length,
    activeDataKeys: Object.keys(activeData),
    locationsCount: locations.length,
    shouldShowLocationDropdown: selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS' && activeTab !== 'all'
  });

  const cartesian = (arrays: string[][]): string[][] => {
    return arrays.reduce<string[][]>((acc, curr) => {
      const res: string[][] = [];
      for (const a of acc) for (const b of curr) res.push([...a, b]);
      return res;
    }, [[]]);
  };

  const recomputeVariants = () => {
    console.log('[recomputeVariants] Starting variant recomputation for', activePlatformKey, 'activeTab:', activeTab);
    const opts = (activeData.options || []).filter(o => Array.isArray(o.values) && o.values.length);
    console.log('[recomputeVariants] Options:', opts);

    if (!opts.length) {
      console.log('[recomputeVariants] No options, clearing variants');
      patchPlatform(prev => ({ ...prev, variants: [] }));
      return;
    }

    const names = opts.map(o => o.name);
    const vals = opts.map(o => o.values);
    const combos = cartesian(vals);
    console.log('[recomputeVariants] Generated', combos.length, 'variant combinations');

    // CRITICAL FIX: When in "all" tab, update variants for ALL platforms
    const platformsToUpdate = activeTab === 'all' ? platformKeys : [activePlatformKey];
    console.log('[recomputeVariants] Updating platforms:', platformsToUpdate);

    // Build updated platforms object
    const updatedPlatforms = { ...platforms };

    for (const platformKey of platformsToUpdate) {
      const platformData = (platforms[platformKey] || {}) as PlatformState;
      const platformLocs = platformData.locations || platformLocations?.[platformKey.toLowerCase()] || [];

      const nextVariants: Variant[] = combos.map((combo, i) => {
        const optionValues: Record<string, string> = {};
        combo.forEach((v, idx) => optionValues[names[idx]] = v);
        const id = `${platformKey}-var-${names.map((n, ix) => `${n}:${combo[ix]}`).join('|')}`;
        const existing = (platformData.variants || []).find(v => JSON.stringify(v.optionValues) === JSON.stringify(optionValues));

        // CRITICAL FIX: Initialize inventoryByLocation for new variants
        // Without this, inventory fields won't render!
        if (existing) {
          return existing;
        } else {
          // New variant - initialize with default inventory structure
          const inventoryByLocation: Record<string, { quantity: number; price?: number; image?: string }> = {};

          // Initialize for default location (used by VARIANT_WITH_OPTIONS)
          inventoryByLocation['default'] = {
            quantity: 0,
            price: platformData.price || activeData.price || 0,
          };

          // Also initialize for all known locations (used by LOCATION_VARIANT_WITH_OPTIONS)
          (platformLocs as Array<{ id: string }>).forEach(loc => {
            inventoryByLocation[loc.id] = {
              quantity: 0,
              price: platformData.price || activeData.price || 0,
            };
          });

          console.log(`[recomputeVariants] Created new variant for ${platformKey}:`, id);
          return {
            id,
            optionValues,
            price: platformData.price || activeData.price,
            inventoryByLocation
          };
        }
      });

      // Also copy options to this platform if in "all" mode
      updatedPlatforms[platformKey] = {
        ...platformData,
        variants: nextVariants,
        options: activeTab === 'all' ? opts : platformData.options
      };
    }

    console.log('[recomputeVariants] Updating', platformsToUpdate.length, 'platforms with variants');
    onChangePlatforms(updatedPlatforms);
  };

  // Normalize options: merge duplicate names (case-insensitive), drop empties, dedupe values
  const normalizeOptions = (opts?: Array<{ name: string; values: string[] }>) => {
    const acc: Record<string, string[]> = {};
    for (const o of (opts || [])) {
      const nameRaw = (o?.name || '').trim();
      if (!nameRaw) continue;
      const key = nameRaw.toLowerCase();
      const values = Array.from(new Set((o?.values || []).map(v => (v || '').trim()).filter(Boolean)));
      if (!acc[key]) acc[key] = [];
      acc[key] = Array.from(new Set([...acc[key], ...values]));
    }
    return Object.entries(acc).map(([k, values]) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), values }));
  };

  useEffect(() => {
    console.log('[Options useEffect] Running for platform:', activePlatformKey, 'options:', activeData.options);
    const cleaned = normalizeOptions(activeData.options);
    console.log('[Options useEffect] Normalized options:', cleaned);

    if (JSON.stringify(cleaned) !== JSON.stringify(activeData.options || [])) {
      console.log('[Options useEffect] Options changed, updating platform');
      patchPlatform(prev => ({ ...prev, options: cleaned }));
    }

    // CRITICAL FIX: Only recompute variants if OPTIONS changed, not just platform
    const optionsJson = JSON.stringify(activeData.options || []);
    const platformChanged = lastPlatformRef.current !== activePlatformKey;
    const optionsChanged = lastOptionsRef.current !== optionsJson;

    console.log('[Options useEffect] Changes detected:', { platformChanged, optionsChanged, hasPreviousPlatform: !!lastPlatformRef.current, prevOptions: lastOptionsRef.current, currentOptions: optionsJson });

    // ONLY recompute if options actually changed, NOT on platform switch
    if (optionsChanged && (optionsJson !== '[]' || lastOptionsRef.current !== '[]')) {
      // Options truly changed (not just switching to empty options)
      console.log('[Options useEffect] Scheduling recomputeVariants (options actually changed)');
      setTimeout(recomputeVariants, 0);
    } else if (platformChanged && lastPlatformRef.current) {
      // Just switching platforms - DON'T recompute, preserve variants from current platform
      console.log('[Options useEffect] Platform switched - NOT recomputing variants (preserving data)');
    } else if (!lastPlatformRef.current) {
      // First load of ANY platform
      console.log('[Options useEffect] First load - recomputing variants');
      setTimeout(recomputeVariants, 0);
    }

    lastPlatformRef.current = activePlatformKey;
    lastOptionsRef.current = optionsJson;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlatformKey, JSON.stringify(activeData.options || [])]);

  // Fetch platform options when options editor opens
  useEffect(() => {
    if (optionEditorOpen) {
      fetchAllPlatformOptions();
    }
  }, [optionEditorOpen]);

  // Variant editing helpers
  const setVariantOptionValue = (variantId: string, optionName: string, newValue: string) => {
    patchPlatform(prev => {
      const variants = (prev.variants || []).map(v => {
        if (v.id !== variantId) return v;
        const optionValues = { ...(v.optionValues || {}) };
        optionValues[optionName] = newValue;
        return { ...v, optionValues };
      });
      return { ...prev, variants } as PlatformState;
    });
  };

  const addVariantRow = () => {
    const opts = (activeData.options || []).filter(o => Array.isArray(o.values) && o.values.length);
    if (!opts.length) {
      setOptionEditorOpen(true);
      return;
    }
    const optionValues: Record<string, string> = {};
    for (const opt of opts) {
      optionValues[opt.name] = opt.values[0];
    }
    const id = `${activePlatformKey}-var-${Date.now()}`;

    // Initialize inventoryByLocation for the new variant
    const inventoryByLocation: Record<string, { quantity: number; price?: number; image?: string }> = {};
    inventoryByLocation['default'] = { quantity: 0, price: activeData.price || 0 };
    locations.forEach(loc => {
      inventoryByLocation[loc.id] = { quantity: 0, price: activeData.price || 0 };
    });

    patchPlatform(prev => ({
      ...prev,
      variants: [
        ...(prev.variants || []),
        { id, optionValues, price: activeData.price, inventoryByLocation }
      ]
    }));
  };

  const handleAddOptionValueRow = () => setNewOptionValues(prev => [...prev, '']);
  const handleChangeOptionValue = (index: number, value: string) => {
    setNewOptionValues(prev => prev.map((v, i) => i === index ? value : v));
  };
  const handleCancelOption = () => {
    setOptionEditorOpen(false);
    setNewOptionName('');
    setNewOptionValues(['']);
  };

  async function getToken() {
    return await ensureSupabaseJwt();
  }

  const fetchAllPlatformOptions = async () => {
    setLoadingPlatformOptions(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      console.log('[fetchAllPlatformOptions] ⚡ Querying PlatformOptions directly from DB (no API call)...');

      // Step 1: Get active connections for this user
      const { data: connections, error: connError } = await supabase
        .from('PlatformConnections')
        .select('Id')
        .eq('UserId', user.id)
        .eq('IsEnabled', true);

      if (connError || !connections || connections.length === 0) {
        console.log('[fetchAllPlatformOptions] No active connections found');
        setAllPlatformOptions([]);
        setOptionPresets([]);
        return;
      }

      const connectionIds = connections.map(c => c.Id);
      console.log('[fetchAllPlatformOptions] Found', connectionIds.length, 'active connections');

      // Step 2: Query PlatformOptions for these connections
      const { data: platformOptions, error } = await supabase
        .from('PlatformOptions')
        .select('Name, Values, Source')
        .in('PlatformConnectionId', connectionIds);

      if (error) {
        console.error('[fetchAllPlatformOptions] DB query error:', error);
        return;
      }

      console.log('[fetchAllPlatformOptions] Retrieved', platformOptions?.length || 0, 'raw options from DB');

      // Step 3: Group by option name to deduplicate and merge
      const optionsByName = new Map<string, { values: Set<string>; sources: Set<string> }>();
      for (const option of platformOptions || []) {
        const optionName = option.Name?.trim();
        if (!optionName) continue;

        if (!optionsByName.has(optionName)) {
          optionsByName.set(optionName, { values: new Set<string>(), sources: new Set<string>() });
        }

        const stored = optionsByName.get(optionName)!;
        for (const value of option.Values || []) {
          if (value) stored.values.add(value);
        }
        if (option.Source) stored.sources.add(option.Source);
      }

      // Step 4: Convert to array format
      const formatted = Array.from(optionsByName).map(([name, data]) => ({
        name,
        values: Array.from(data.values),
        sources: Array.from(data.sources)
      }));

      console.log('[fetchAllPlatformOptions] ✅ Loaded', formatted.length, 'deduplicated platform options from DB in <1s');
      setAllPlatformOptions(formatted);
      setOptionPresets(formatted); // Reuse as presets too
    } catch (error) {
      console.error('[fetchAllPlatformOptions] Error:', error);
    } finally {
      setLoadingPlatformOptions(false);
    }
  };
  const handleDoneOption = () => {
    const name = newOptionName.trim();
    const values = Array.from(new Set(newOptionValues.map(v => v.trim()).filter(Boolean)));
    if (!name || values.length === 0) {
      // keep editor open; in production show a toast
      return;
    }
    patchPlatform(prev => {
      const options = Array.isArray(prev.options) ? prev.options.slice() : [];
      // If an option with the same name exists, replace it; else append
      const existingIndex = options.findIndex(o => o.name === name);
      if (existingIndex >= 0) {
        options[existingIndex] = { name, values };
      } else {
        options.push({ name, values });
      }
      return { ...prev, options } as PlatformState;
    });
    // recompute variants based on new options
    setTimeout(recomputeVariants, 0);
    // reset editor
    setOptionEditorOpen(false);
    setNewOptionName('');
    setNewOptionValues(['']);
  };

  const addOption = (name: string) => {
    patchPlatform(prev => {
      const options = Array.isArray(prev.options) ? prev.options.slice() : [];
      options.push({ name, values: [] });
      return { ...prev, options };
    });
  };

  const addOptionValue = (optName: string, value: string) => {
    patchPlatform(prev => {
      const options = (prev.options || []).map(o => o.name === optName ? { ...o, values: Array.from(new Set([...(o.values || []), value])) } : o);
      return { ...prev, options } as PlatformState;
    });
    // Recompute variants after short delay to let state settle
    setTimeout(recomputeVariants, 0);
  };

  const setLocationQuantity = (locId: string, qty: number) => {
    patchPlatform(prev => ({ ...prev, locationQuantities: { ...(prev.locationQuantities || {}), [locId]: qty } }));
  };

  // Hydrate platform with generated data if missing
  const fieldsToAutoFill: Array<keyof PlatformState> = [
    'title', 'description', 'tags', 'price', 'weight', 'weightUnit', 'sku', 'barcode', 'images', 'options'
  ];

  const autofillMissingFromCanonical = () => {
    const base = (platforms[canonicalKey] || {}) as PlatformState;
    if (!base) return;
    patchPlatform(prev => {
      const next: PlatformState = { ...prev } as PlatformState;
      let changed = false;
      for (const key of fieldsToAutoFill) {
        const curr = (next as any)[key];
        const val = (base as any)[key];
        if ((curr === undefined || (Array.isArray(curr) && curr.length === 0)) && val !== undefined) {
          (next as any)[key] = Array.isArray(val) ? [...val] : val;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  };

  useEffect(() => {
    // When switching to a platform tab, populate missing fields from canonical if possible
    autofillMissingFromCanonical();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlatformKey]);

  const setVariantAtLocation = (variantId: string, locId: string, field: 'quantity' | 'price' | 'image', value: any) => {
    console.log(`[INV] setVariantAtLocation START - variant: ${variantId}, location: ${locId}, field: ${field}, value: ${value}`);
    patchPlatform(prev => {
      const variants = (prev.variants || []).map(v => {
        if (v.id !== variantId) return v;

        console.log(`[INV] Found variant ${variantId}, current inventoryByLocation keys:`, Object.keys(v.inventoryByLocation || {}));

        const inv = { ...(v.inventoryByLocation || {}) };
        if (!inv[locId]) {
          console.log(`[INV] ⚠️  Location ${locId} missing! Creating new entry`);
          inv[locId] = { quantity: 0, price: 0 };
        }

        const oldVal = inv[locId][field];
        inv[locId] = { ...inv[locId], [field]: value };

        console.log(`[INV] Updated ${field}: ${oldVal} → ${value} at location ${locId}`);
        console.log(`[INV] After update, inventoryByLocation keys:`, Object.keys(inv));

        return { ...v, inventoryByLocation: inv };
      });
      return { ...prev, variants };
    });
  };

  // NEW: Set global variant price (does not touch per-location quantities)
  const setVariantPrice = (variantId: string, price: number) => {
    console.log(`[PRICE] setVariantPrice START - variant: ${variantId}, price: ${price}`);
    patchPlatform(prev => {
      const variants = (prev.variants || []).map(v => v.id === variantId ? { ...v, price } : v);
      return { ...prev, variants };
    });
  };

  const pills = ['all', ...platformKeys];
  // Add a couple of extra platforms for quick swap-in
  const allKnownPlatforms = Array.from(new Set([...Object.keys(PLATFORM_META), 'whatnot', 'depop']));
  const addPlatform = async (platformKey: string, shouldGenerate: boolean = false) => {
    if (!platformKey) return;
    platformKey = platformKey.toLowerCase().trim();
    if (platformKeys.includes(platformKey)) return;

    if (shouldGenerate && onGeneratePlatform) {
      // Start generation process
      setGeneratingPlatforms(prev => new Set([...prev, platformKey]));
      setShowPlatformPicker(false);

      // Add empty platform data first to show loading state
      const base = (platforms[canonicalKey] || {}) as PlatformState;
      const newData: PlatformState = {} as PlatformState;
      for (const key of fieldsToAutoFill) {
        const val = (base as any)[key];
        if (val !== undefined) (newData as any)[key] = Array.isArray(val) ? [...val] : val;
      }
      const next = { ...platforms, [platformKey]: newData } as PlatformsData;
      onChangePlatforms(next);
      setActiveTab(platformKey);

      try {
        await onGeneratePlatform(platformKey);
      } catch (error) {
        console.error('Platform generation failed:', error);
      } finally {
        setGeneratingPlatforms(prev => {
          const newSet = new Set(prev);
          newSet.delete(platformKey);
          return newSet;
        });
      }
    } else {
      // Regular platform addition without generation
      const base = (platforms[canonicalKey] || {}) as PlatformState;
      const newData: PlatformState = {} as PlatformState;
      for (const key of fieldsToAutoFill) {
        const val = (base as any)[key];
        if (val !== undefined) (newData as any)[key] = Array.isArray(val) ? [...val] : val;
      }
      const next = { ...platforms, [platformKey]: newData } as PlatformsData;
      onChangePlatforms(next);
      setShowPlatformPicker(false);
      setActiveTab(platformKey);
      setTimeout(recomputeVariants, 0);
    }
  };
  const removePlatform = (platformKey: string) => {
    if (!platformKey) return;
    const next = { ...platforms } as PlatformsData;
    delete (next as any)[platformKey];
    onChangePlatforms(next);
    if (activeTab === platformKey) setActiveTab('all');
  };


  return (
    <View style={{ paddingBottom: 120 }}>
      {/* Media with Remove & Add Photo Management */}
      <View style={styles.mediaRow}>
        <ScrollView style={{paddingVertical: 10}} horizontal={true} showsHorizontalScrollIndicator={false}>
          {(images || []).map((uri, i) => (
            <View key={`${uri}-${i}`} style={{ position: 'relative', marginRight: 8}}>
              <TouchableOpacity
                style={[styles.thumbWrap, i === 0 && styles.thumbCover]}
                onPress={() => {
                  const next = (images || []).slice();
                  const [chosen] = next.splice(i, 1);
                  next.unshift(chosen);
                  onChangeImages?.(next);
                }}
              >
                <Image source={{ uri }} style={styles.thumb} />
                {i === 0 && (
                  <View style={styles.coverBadge}>
                    <Icon name="star" size={14} color="#fff" />
                    <Text style={{ color: '#fff', marginLeft: 4, fontSize: 10 }}>Cover</Text>
                  </View>
                )}
              </TouchableOpacity>
              {/* Remove Button */}
              <TouchableOpacity
                onPress={() => {
                  const next = (images || []).filter((_, idx) => idx !== i);
                  onChangeImages?.(next);
                }}
                style={{
                  position: 'absolute',
                  top: -8,
                  right: -6,
                  backgroundColor: '#EF4444',
                  borderRadius: 12,
                  width: 24,
                  height: 24,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderWidth: 2,
                  borderColor: '#FFF',
                  zIndex: 10,
                }}
              >
                <Icon name="close" size={12} color="#FFF" />
              </TouchableOpacity>
            </View>
          ))}

          {/* Add Photo Slots (max 6 total) */}
          {Array.from({ length: Math.max(0, Math.min(6 - (images?.length || 0), 1)) }).map((_, slotIdx) => (
            <TouchableOpacity
              key={`add-slot-${slotIdx}`}
              style={[styles.thumbWrap, styles.addThumb]}
              onPress={() => {
                if (onOpenImageCapture) {
                  onOpenImageCapture((uris: string[]) => onChangeImages?.([...(images || []), ...uris]));
                }
              }}
            >
              <Icon name="plus" size={22} color="#666" />
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={styles.mediaHint}>Tap an image to set it as the cover</Text>
      </View>

      {/* Platform filter pills */}
      <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8 }}>
        {pills.map((key) => (
          key === 'all' ? (
            <TouchableOpacity key={key} onPress={() => setActiveTab(key)} style={[styles.pill, activeTab === key && styles.pillActive]}>
              <Text style={[styles.pillText, activeTab === key && styles.pillTextActive]}>All</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              key={key}
              onPress={async () => {
                if (generatingPlatforms.has(key)) return;
                setActiveTab(key);
                // Trigger generation if this platform has no data yet
                if (onGeneratePlatform && Object.keys((platforms as any)?.[key] || {}).length === 0) {
                  setGeneratingPlatforms(prev => new Set([...prev, key]));
                  try {
                    await onGeneratePlatform(key);
                  } catch (e) {
                    console.error('Generate platform on tap failed:', e);
                  } finally {
                    setGeneratingPlatforms(prev => { const s = new Set(prev); s.delete(key); return s; });
                  }
                }
              }}
              style={[styles.pill, activeTab === key && styles.pillActive, generatingPlatforms.has(key) && styles.pillGenerating, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
              disabled={generatingPlatforms.has(key)}
            >
              {generatingPlatforms.has(key) ? (
                <View style={{ width: 12, height: 12, justifyContent: 'center', alignItems: 'center' }}>
                  <Icon name="loading" size={12} color="#6B7280" />
                </View>
              ) : (
                (() => {
                  const map: Record<string, any> = { shopify: ShopifySvg, amazon: AmazonSvg, facebook: FacebookSvg, ebay: EbaySvg, clover: CloverSvg, square: SquareSvg };
                  const SVG = map[key];
                  return SVG ? <SVG width={12} height={12} /> : null;
                })()
              )}
              <Text style={[styles.pillText, activeTab === key && styles.pillTextActive, generatingPlatforms.has(key) && styles.pillTextGenerating]}>
                {PLATFORM_META[key]?.label || key}
                {generatingPlatforms.has(key) && ' (Generating...)'}
              </Text>
            </TouchableOpacity>
          )
        ))}
        <TouchableOpacity style={styles.pillDashed} onPress={() => setShowPlatformPicker(v => !v)}>
          <Text style={styles.pillText}>+ Add Platform</Text>
        </TouchableOpacity>
      </ScrollView>
      {activeTab !== 'all' && onToggleIgnorePlatform && (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8 }}>
          <TouchableOpacity
            style={[styles.btnSecondary, { backgroundColor: ignoredForPublish ? '#FFEFEF' : '#FFF', borderColor: ignoredForPublish ? '#ef4444' : '#E5E5E5' }]}
            onPress={() => onToggleIgnorePlatform(activePlatformKey, !ignoredForPublish)}
          >
            <Text style={{ color: ignoredForPublish ? '#ef4444' : '#000' }}>{ignoredForPublish ? 'Will NOT publish' : 'Publish enabled'}</Text>
          </TouchableOpacity>
        </View>
      )}
      {showPlatformPicker && (
        <View style={styles.platformPickerDock}>
          <View style={styles.platformPickerCapsule}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 }}>
              <TouchableOpacity style={[{ alignSelf: 'center', marginTop: 10, paddingHorizontal: 34, paddingVertical: 10, }]}>

              </TouchableOpacity>
              <Text style={{ color: '#000', fontWeight: '700', marginBottom: 10, textAlign: 'center' }}>Add Platform</Text>
              <TouchableOpacity style={[styles.btnSecondary, { alignSelf: 'center', marginTop: 10, backgroundColor: "#FFF" }]} onPress={() => setShowPlatformPicker(false)}>
                <Text style={{ color: '#000' }}>Close</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.platformGrid}>
              {allKnownPlatforms.filter(k => !platformKeys.includes(k)).map(k => (
                <TouchableOpacity key={k} onPress={() => addPlatform(k, true)} style={styles.platformSquare}>
                  {(() => { const map: Record<string, any> = { shopify: ShopifySvg, amazon: AmazonSvg, facebook: FacebookSvg, ebay: EbaySvg, clover: CloverSvg, square: SquareSvg }; const SVG = map[k]; return SVG ? <SVG width={40} height={40} /> : null; })()}
                  <Text style={{ color: '#000', fontWeight: '500' }}>{PLATFORM_META[k]?.label || k}</Text>
                </TouchableOpacity>
              ))}
            </View>

          </View>
        </View>
      )}

      {/* Core fields (optimized for conversion) */}
      <View style={{ paddingTop: 18, gap: 9 }}>
        <Field
          label="Title"
          required
          value={activeData.title}
          multiline
          onChangeText={(t) => patchField('title', t)}
          onInfo={() => onOpenFieldPanel?.('title')}
          onRegenerate={enableAIRefill && activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'title') : undefined}
          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('title')}
          error={requiredFields?.includes?.('title') && !activeData.title}
        />

        <Field
          label="Description"
          value={activeData.description}
          multiline
          onChangeText={(t) => patchField('description', t)}
          onInfo={() => onOpenFieldPanel?.('description')}
          onRegenerate={enableAIRefill && activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'description') : undefined}
          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('description')}
        />

        <ChipsField
          label="Tags"
          valueArray={activeData.tags}
          onChangeArray={(arr) => patchField('tags', arr)}
          onInfo={() => onOpenFieldPanel?.('tags')}
          onRegenerate={enableAIRefill && activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'tags') : undefined}
          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('tags')}
        />

        {/* AI Recommended Price Tag */}
        {(activeData as any).aiRecommendedPrice && (
          <View style={{ backgroundColor: '#F0F9FF', borderRadius: 8, padding: 10, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#3B82F6' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Sparkles size={16} color="#3B82F6" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#1E40AF' }}>AI Suggested Price</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#059669', marginTop: 2 }}>
                  ${Number((activeData as any).aiRecommendedPrice).toFixed(2)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Price field - if variants with options exist and have prices, don't require main price */}
        {(() => {
          const hasVariantsWithOptions = (activeData.options || []).length > 0 && (activeData.variants || []).length > 0;
          const allVariantsHavePrice = hasVariantsWithOptions && (activeData.variants || []).every((v: any) => 
            v.price != null && v.price !== '' && Number(v.price) > 0
          );
          const priceRequired = requiredFields?.includes?.('price') && !allVariantsHavePrice;
          const priceError = priceRequired && ((activeData as any).price == null || String((activeData as any).price) === '' || Number((activeData as any).price) === 0);
          
          return (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <View style={{ flex: 1, flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
                <View style={{ flex: 1 }}>
                
                  <Field
                    label={hasVariantsWithOptions ? "Base Price (optional with variants)" : "Price"}
                    required={!hasVariantsWithOptions}
                    value={String((activeData as any).price ?? '')}
                    onChangeText={(t) => patchField('price', t)}
                    onInfo={() => onOpenFieldPanel?.('price')}
                    onRegenerate={enableAIRefill && activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'price') : undefined}
                    refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('price')}
                    error={priceError}
                    keyboardType={"decimal-pad"}
                  />
                  
                </View>
                <View style={{ width: "25%", marginBottom: 12 }}>
                  <Dropdown
                    label="USD"
                    options={["USD", "CAD", "EUR", "GBP"]}
                    value={(activeData as any).currency || 'USD'}
                    onChange={(v) => patchField('currency', v)}
                  />
                </View>
              </View>
            </View>
          );
        })()}

        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', alignItems: 'flex-end', }}>
          <View style={{ flex: 1 }}>
            <Field label="Shipping Weight" value={String(activeData.weight ?? '')} onChangeText={(t) => patchField('weight', t)} onInfo={() => onOpenFieldPanel?.('weight')} />
          </View>
          <View style={{ width: 120, marginBottom: 12 }}>
            <Dropdown label="Ounces" options={["Ounces", "Pounds", "Grams", "Kilograms"]} value={activeData.weightUnit || 'Ounces'} onChange={(v) => patchField('weightUnit', v)} />
          </View>
        </View>

        <Field
          label="SKU"
          required
          value={activeData.sku}
          onChangeText={(t) => patchField('sku', t)}
          onInfo={() => onOpenFieldPanel?.('sku')}
          onRegenerate={enableAIRefill && activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'sku') : undefined}
          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('sku')}
          error={requiredFields?.includes?.('sku') && !activeData.sku}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Barcode" value={activeData.barcode} onChangeText={(t) => patchField('barcode', t)} onInfo={() => onOpenFieldPanel?.('barcode')} />
          </View>
          <TouchableOpacity style={[styles.scanBtn, {}]} onPress={() => { (onOpenBarcodeScanner || (() => { }))((code: string) => patchField('barcode', code)); }}>
            <Icon name="qrcode-scan" size={20} color="#fff" />
          </TouchableOpacity>
        </View>


      </View>


      {/* Variants: only for platforms that support variants */}
      {supportsVariants && (
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.sectionTitle}>Variants</Text>
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={() => {
                setOptionEditorOpen(true);
                fetchAllPlatformOptions();
              }}
            >
              <Text style={{ color: '#000' }}>Options</Text>
            </TouchableOpacity>
          </View>

          {Array.isArray(variantSuggestions) && variantSuggestions.length > 0 && (
            <View style={styles.suggestionBox}>
              <Text style={{ color: '#000', fontWeight: '600', marginBottom: 6 }}>We detected these possible options:</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {variantSuggestions.map((opt, idx) => (
                  <View key={`${opt.name}-${idx}`} style={styles.suggestionChip}>
                    <Text style={{ color: '#000' }}>{opt.name}: {opt.values.join(', ')}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <TouchableOpacity style={styles.btnPrimary} onPress={() => {
                  // Merge suggestions into options without duplication
                  patchPlatform(prev => {
                    const options = Array.isArray(prev.options) ? prev.options.slice() : [];
                    const nextOptions = options.slice();
                    for (const s of variantSuggestions) {
                      const existingIndex = nextOptions.findIndex(o => (o.name || '').toLowerCase() === s.name.toLowerCase());
                      const values = Array.from(new Set([...(nextOptions[existingIndex]?.values || []), ...s.values]));
                      if (existingIndex >= 0) {
                        nextOptions[existingIndex] = { name: s.name, values };
                      } else {
                        nextOptions.push({ name: s.name, values });
                      }
                    }
                    return { ...prev, options: nextOptions, __variantSuggestions: [] } as PlatformState as any;
                  });
                  setTimeout(recomputeVariants, 0);
                }}>
                  <Text style={{ color: '#fff' }}>Add suggested options</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnSecondary} onPress={() => {
                  patchPlatform(prev => ({ ...(prev as any), __variantSuggestions: [] } as any));
                }}>
                  <Text style={{ color: '#000' }}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {/* Inline options wizard / summary */}
          {optionEditorOpen ? (
            <View style={{ marginTop: 10 }}>
              {/* Platform Options Section */}
              <View style={{ marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <Text style={styles.fieldLabel}>Your Platform Options</Text>
                  <TouchableOpacity
                    style={styles.btnSecondary}
                    onPress={fetchAllPlatformOptions}
                    disabled={loadingPlatformOptions}
                  >
                    <Text style={{ color: '#000' }}>
                      {loadingPlatformOptions ? 'Loading...' : 'Refresh'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {allPlatformOptions.length > 0 ? (
                  <View style={{ maxHeight: 200, backgroundColor: '#f5f5f5', borderRadius: 8, padding: 10 }}>
                    <ScrollView showsVerticalScrollIndicator={true}>
                      {allPlatformOptions.map((option, idx) => (
                        <TouchableOpacity
                          key={`platform-${option.name}-${idx}`}
                          style={[styles.optionChip, { marginBottom: 8, backgroundColor: '#fff' }]}
                          onPress={() => {
                            setNewOptionName(option.name);
                            setNewOptionValues(option.values);
                          }}
                        >
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <Text style={{ fontWeight: 'bold' }}>{option.name}</Text>
                            <View style={{ flexDirection: 'row', gap: 4 }}>
                              {option.sources.map(source => (
                                <View key={source} style={{ backgroundColor: '#e0e0e0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                                  <Text style={{ fontSize: 10, color: '#666', textTransform: 'capitalize' }}>{source}</Text>
                                </View>
                              ))}
                            </View>
                          </View>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                            {option.values.map(value => (
                              <Text key={value} style={{ fontSize: 12, color: '#666' }}>
                                {value}
                              </Text>
                            ))}
                          </View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                ) : (
                  <Text style={{ color: '#999', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
                    No platform options found. Use presets below or create new ones.
                  </Text>
                )}
              </View>

              {/* Presets Section 
              <View style={{ marginBottom: 20 }}>
                <Text style={styles.fieldLabel}>Presets</Text>
                <View style={{ maxHeight: 150, backgroundColor: '#f0f8ff', borderRadius: 8, padding: 10 }}>
                  <ScrollView showsVerticalScrollIndicator={true}>
                    {optionPresets.map((preset, idx) => (
                      <TouchableOpacity
                        key={`preset-${preset.name}-${idx}`}
                        style={[styles.optionChip, { marginBottom: 8, backgroundColor: '#fff' }]}
                        onPress={() => {
                          setNewOptionName(preset.name);
                          setNewOptionValues(preset.values);
                        }}
                      >
                        <Text style={{ fontWeight: 'bold', marginBottom: 4 }}>{preset.name}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                          {preset.values.map(value => (
                            <Text key={value} style={{ fontSize: 12, color: '#666' }}>
                              {value}
                            </Text>
                          ))}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>
              */}

              <Text style={styles.fieldLabel}>Option Name</Text>
              <TextInput
                style={styles.input}
                value={newOptionName}
                onChangeText={setNewOptionName}
                placeholder="eg: Size"
                placeholderTextColor={"#999999"}
              />

              {/* Show preset and platform options as quick suggestions
              <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Quick Presets & Platform Options</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {[...PRESET_OPTIONS, ...allPlatformOptions].map((opt, idx) => (
                  <TouchableOpacity
                    key={`quick-preset-${idx}`}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      marginRight: 8,
                      backgroundColor: newOptionName === opt.name ? '#dbeafe' : '#f3f4f6',
                      borderRadius: 6,
                      borderWidth: newOptionName === opt.name ? 2 : 1,
                      borderColor: newOptionName === opt.name ? '#3b82f6' : '#d1d5db'
                    }}
                    onPress={() => {
                      setNewOptionName(opt.name);
                      setNewOptionValues(opt.values.slice(0, 1).map(v => v) || ['']);
                    }}
                  >
                    <Text style={{ fontSize: 12, color: newOptionName === opt.name ? '#1e40af' : '#666' }}>
                      {opt.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              */}

              <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Option Values</Text>
              {newOptionValues.map((v, idx) => (
                <TextInput
                  key={`opt-val-${idx}`}
                  style={[styles.input, { marginTop: 6 }]}
                  value={v}
                  onChangeText={(t) => handleChangeOptionValue(idx, t)}
                  placeholder={idx === 0 ? 'eg: Small' : 'eg: Medium'}
                  placeholderTextColor={"#999999"}
                />
              ))}
              <TouchableOpacity style={styles.addInline} onPress={handleAddOptionValueRow}>
                <Icon name="plus" size={16} color="#000" />
                <Text style={{ color: '#000', marginLeft: 6 }}>Add another option</Text>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                <TouchableOpacity
                  style={[styles.btnSecondary, { backgroundColor: '#fee2e2' }]}
                  onPress={() => {
                    patchPlatform(prev => ({ ...prev, options: [], variants: [] }));
                    setOptionEditorOpen(false);
                  }}
                >
                  <Text style={{ color: '#dc2626' }}>Clear All</Text>
                </TouchableOpacity>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={styles.btnSecondary} onPress={handleCancelOption}>
                    <Text style={{ color: '#000' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnPrimary} onPress={handleDoneOption}>
                    <Text style={{ color: '#fff' }}>Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : (
            <>
              {((activeData.options || []).filter(o => (o.values || []).length > 0)).length > 0 && (
                (activeData.options || []).filter(o => (o.values || []).length > 0).map((opt, idx) => (
                  <View key={`${opt.name}-${idx}`} style={styles.optionSummaryCard}>
                    <Text style={styles.subtle}>{opt.name}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {(opt.values || []).map(v => (
                        <View key={`${opt.name}-${v}`} style={[styles.optionChip, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                          <TouchableOpacity onPress={() => {
                            patchPlatform(prev => {
                              const options = (prev.options || []).map(o => o.name === opt.name ? { ...o, values: (o.values || []).filter(val => val !== v) } : o);
                              return { ...prev, options } as PlatformState;
                            });
                          }}>
                            <Icon name="close" size={10} color="#6B7280" />
                          </TouchableOpacity>
                          <Text style={{ color: '#000' }}>{v}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))
              )}
              <TouchableOpacity style={styles.addOption} onPress={() => { setNewOptionName(''); setNewOptionValues(['']); setOptionEditorOpen(true); }}>
                <Icon name="plus" size={18} color="#71717A" />
                <Text style={{ color: '#71717A', marginLeft: 8 }}>Add an option</Text>
              </TouchableOpacity>
            </>
          )}


        </View>
      )}

      {/* Inventory summary (auto-decided per platform) */}
      <View style={styles.darkerCard}>
        <View style={{ marginVertical: 8, flexDirection: 'column', gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.sectionTitle}>Inventory{activeTab === 'all' ? ' (All Platforms)' : ''}</Text>
            {/* Locations only for LOCATION_VARIANT_WITH_OPTIONS; NEVER show for VARIANT_WITH_OPTIONS or BASIC */}
            {selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS' && activeTab !== 'all' && (
              <Dropdown label={locations.find(l => l.id === selectedLocationId)?.name || 'Select Location'} options={locations.map(l => l.name)} value={locations.find(l => l.id === selectedLocationId)?.name || locations[0]?.name || ''} onChange={(name) => {
                const loc = locations.find(l => l.name === name);
                if (loc) {
                  console.log(`[LOC] Location changed from ${selectedLocationId} to ${loc.id}`);
                  setSelectedLocationId(loc.id);
                }
              }} />
            )}
          </View>

          {/* Copy inventory from another platform */}
          {activeTab !== 'all' && platformKeys.length > 1 && (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text style={{ color: '#71717A', fontSize: 12 }}>Copy from:</Text>
              {platformKeys.filter(k => k !== activePlatformKey).map(platformKey => (
                <TouchableOpacity
                  key={platformKey}
                  onPress={() => {
                    const sourcePlatform = platforms[platformKey] as PlatformState;
                    const sourceVariants = sourcePlatform?.variants || [];

                    if (sourceVariants.length === 0) {
                      alert(`No inventory data found on ${platformKey}`);
                      return;
                    }

                    // Copy inventory from source platform to current platform
                    patchPlatform(prev => {
                      const currentVariants = prev.variants || [];
                      const updatedVariants = currentVariants.map(variant => {
                        // Find matching variant by name
                        const variantName = Object.values(variant.optionValues || {}).join(' / ') || 'Variant';
                        const sourceVariant = sourceVariants.find(sv =>
                          Object.values(sv.optionValues || {}).join(' / ') === variantName
                        );

                        if (sourceVariant && sourceVariant.inventoryByLocation) {
                          return {
                            ...variant,
                            inventoryByLocation: { ...sourceVariant.inventoryByLocation }
                          };
                        }
                        return variant;
                      });

                      return { ...prev, variants: updatedVariants };
                    });

                    alert(`Copied inventory from ${platformKey} to ${activePlatformKey}`);
                  }}
                  style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: '#F8F9FA' }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#000' }}>
                    {PLATFORM_META[platformKey]?.label || platformKey}
                  </Text>
                </TouchableOpacity>
              ))}
              {/* Pricing capability indicator moved here */}
              <View style={{ marginLeft: 'auto', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, backgroundColor: activePlatformKey === 'shopify' ? '#E3F2FD' : '#E8F5E9' }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: activePlatformKey === 'shopify' ? '#1976D2' : '#388E3C' }}>
                  {activePlatformKey === 'shopify' ? '🔒 Global Price' : '📍 Per-Location Pricing'}
                </Text>
              </View>
            </View>
          )}
        </View>
        {(() => {
          console.log('[Inventory Render] supportsVariants:', supportsVariants, 'variants count:', (activeData.variants || []).length);
          return null;
        })()}
        {supportsVariants ? (
          activeTab === 'all' ? (
            // ALL TAB: Show ALL variants with EDITABLE location inventories across ALL platforms
            <View style={{ gap: 16 }}>
              {(() => {
                // Helper function to get readable location name
                const getLocationName = (locId: string, platformKey: string) => {
                  const platformType = platformKey.toLowerCase();
                  const platformLocs = platformLocations?.[platformType] || [];
                  const loc = platformLocs.find(l => l.id === locId);
                  if (loc) {
                    return `${loc.name || loc.connectionName}`;
                  }
                  return `${platformKey.toUpperCase()} - ${locId.slice(0, 20)}`;
                };

                // Aggregate all variants from all platforms - show ALL locations, not just those with data
                const allVariantsMap = new Map<string, {
                  variant: Variant;
                  platformKey: string;
                  platformData: PlatformState;
                  locId: string;
                  readableName: string;
                }[]>();

                for (const platformKey of platformKeys) {
                  const platformData = platforms[platformKey] as PlatformState;
                  const variants = platformData?.variants || [];

                  // Get ALL locations for this platform type from platformLocations
                  const platformType = platformKey.toLowerCase();
                  const allPlatformLocs = platformLocations?.[platformType] || [];

                  for (const variant of variants) {
                    const variantName = Object.values(variant.optionValues || {}).join(' / ') || 'Variant';

                    if (!allVariantsMap.has(variantName)) {
                      allVariantsMap.set(variantName, []);
                    }

                    // Show ALL locations for this platform, not just ones with existing data
                    if (allPlatformLocs.length > 0) {
                      for (const loc of allPlatformLocs) {
                        if (loc.id === 'loc-default' || loc.id === 'default') continue;

                        const readableName = `${loc.name || loc.connectionName}`;
                        allVariantsMap.get(variantName)!.push({
                          variant,
                          platformKey,
                          platformData,
                          locId: loc.id,
                          readableName,
                        });
                      }
                    } else {
                      // Fallback: use existing inventoryByLocation keys if no platformLocations available
                      const invByLoc = variant.inventoryByLocation || {};
                      Object.entries(invByLoc).forEach(([locId, locData]: [string, any]) => {
                        if (locId === 'loc-default' || locId === 'default') return;

                        const readableName = getLocationName(locId, platformKey);
                        allVariantsMap.get(variantName)!.push({
                          variant,
                          platformKey,
                          platformData,
                          locId,
                          readableName,
                        });
                      });
                    }
                  }
                }

                if (allVariantsMap.size === 0) {
                  return <Text style={{ color: '#999', fontStyle: 'italic' }}>No variants configured</Text>;
                }

                // Get suggested price from any platform that has it
                const suggestedPrice = (() => {
                  for (const pk of platformKeys) {
                    const pd = platforms[pk] as PlatformState;
                    if (pd?.aiRecommendedPrice) return pd.aiRecommendedPrice;
                  }
                  return null;
                })();

                // Function to apply suggested price to ALL variants across ALL platforms
                const applySuggestedPriceToAll = () => {
                  if (!suggestedPrice) return;
                  const nextPlatforms = { ...platforms };
                  for (const pk of platformKeys) {
                    const pd = nextPlatforms[pk] || {};
                    const isShopify = pk === 'shopify';
                    const newVariants = (pd.variants || []).map((v: any) => {
                      if (isShopify) {
                        // Shopify: set variant.price (global)
                        return { ...v, price: suggestedPrice };
                      } else {
                        // Square/Clover: set price in all inventoryByLocation entries
                        const updatedInv = { ...(v.inventoryByLocation || {}) };
                        Object.keys(updatedInv).forEach(locId => {
                          updatedInv[locId] = { ...updatedInv[locId], price: suggestedPrice };
                        });
                        return { ...v, price: suggestedPrice, inventoryByLocation: updatedInv };
                      }
                    });
                    nextPlatforms[pk] = { ...pd, price: suggestedPrice, variants: newVariants };
                  }
                  onChangePlatforms(nextPlatforms);
                };

                return (
                  <>
                    {/* Suggested Price Tag - Apply to All */}
                    {suggestedPrice && (
                      <TouchableOpacity 
                        onPress={applySuggestedPriceToAll}
                        style={{ backgroundColor: '#F0F9FF', borderRadius: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#3B82F6', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                      >
                        <Sparkles size={18} color="#3B82F6" />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12, fontWeight: '600', color: '#1E40AF' }}>AI Suggested Price</Text>
                          <Text style={{ fontSize: 15, fontWeight: '700', color: '#059669' }}>${suggestedPrice.toFixed(2)}</Text>
                        </View>
                        <View style={{ backgroundColor: '#3B82F6', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}>
                          <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 12 }}>Apply to All</Text>
                        </View>
                      </TouchableOpacity>
                    )}

                    {Array.from(allVariantsMap.entries()).map(([variantName, locationData]) => (
                      <View key={variantName} style={{ gap: 8, marginBottom: 16 }}>
                        <Text style={{ color: '#000', fontWeight: '700', fontSize: 15 }}>{variantName}</Text>
                        {locationData.length === 0 ? (
                          <Text style={{ color: '#999', fontSize: 12, fontStyle: 'italic', marginLeft: 12 }}>No inventory set for any location</Text>
                        ) : (
                          locationData.map((item, idx) => {
                            const { variant, platformKey, platformData, locId, readableName } = item;
                            const isShopify = platformKey === 'shopify';
                            const currentQty = variant.inventoryByLocation?.[locId]?.quantity ?? 0;
                            
                            // For Shopify: use variant.price (global), for others: use inventoryByLocation price
                            const currentPriceRaw = isShopify 
                              ? variant.price 
                              : variant.inventoryByLocation?.[locId]?.price;
                            const currentPrice = (currentPriceRaw !== undefined && currentPriceRaw !== null) ? Number(currentPriceRaw) : undefined;
                            const defaultPrice = Number(variant.price ?? platformData.price ?? 0) || 0;
                            const displayPrice = currentPrice ?? defaultPrice;
                            const isOverride = !isShopify && currentPrice !== undefined && currentPrice !== null && currentPrice !== defaultPrice;

                            // Truncate location name - prioritize location, max 18 chars
                            const truncatedName = readableName.length > 18 ? readableName.slice(0, 18) + '…' : readableName;

                            return (
                              <View
                                key={`${platformKey}-${locId}-${idx}`}
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 8,
                                  paddingHorizontal: 10,
                                  paddingVertical: 12,
                                  borderRadius: 10,
                                  borderWidth: 1,
                                  borderColor: isOverride ? '#FFD700' : '#E5E5E5',
                                  backgroundColor: isOverride ? '#FFFEF0' : '#FFF',
                                }}
                              >
                                {/* Platform Logo + Location Name (truncated) */}
                                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                  {(() => {
                                    const logoMap: Record<string, any> = { shopify: ShopifySvg, amazon: AmazonSvg, facebook: FacebookSvg, ebay: EbaySvg, clover: CloverSvg, square: SquareSvg };
                                    const Logo = logoMap[platformKey];
                                    return Logo ? <Logo width={18} height={18} /> : null;
                                  })()}
                                  <Text style={{ color: '#000', fontWeight: '600', fontSize: 12, flexShrink: 1 }} numberOfLines={1} ellipsizeMode="tail">
                                    {truncatedName}
                                  </Text>
                                  {isShopify && (
                                    <View style={{ backgroundColor: '#E3F2FD', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 }}>
                                      <Text style={{ fontSize: 9, color: '#1976D2', fontWeight: '600' }}>GLOBAL</Text>
                                    </View>
                                  )}
                                </View>

                                {/* Quantity Input with +/- and editable field */}
                                <View style={{ alignItems: 'center', gap: 2 }}>
                                  <Text style={{ color: '#666', fontSize: 10 }}>Qty</Text>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 6 }}>
                                    <TouchableOpacity
                                      onPress={() => {
                                        const newQty = Math.max(0, currentQty - 1);
                                        const nextPlatforms = { ...platforms };
                                        const pData = nextPlatforms[platformKey] || {};
                                        const newVariants = (pData.variants || []).map((v: any) => {
                                          if (v.id === variant.id) {
                                            return {
                                              ...v,
                                              inventoryByLocation: {
                                                ...(v.inventoryByLocation || {}),
                                                [locId]: { ...((v.inventoryByLocation || {})[locId] || {}), quantity: newQty },
                                              },
                                            };
                                          }
                                          return v;
                                        });
                                        nextPlatforms[platformKey] = { ...pData, variants: newVariants };
                                        onChangePlatforms(nextPlatforms);
                                      }}
                                      style={{ paddingHorizontal: 5, paddingVertical: 4 }}
                                    >
                                      <Icon name="minus" size={12} color="#666" />
                                    </TouchableOpacity>
                                    <TextInput
                                      style={{ color: '#000', fontWeight: '600', width: 32, textAlign: 'center', fontSize: 13, paddingVertical: 4 }}
                                      value={String(currentQty)}
                                      onChangeText={(text) => {
                                        const newQty = Math.max(0, parseInt(text.replace(/[^0-9]/g, ''), 10) || 0);
                                        const nextPlatforms = { ...platforms };
                                        const pData = nextPlatforms[platformKey] || {};
                                        const newVariants = (pData.variants || []).map((v: any) => {
                                          if (v.id === variant.id) {
                                            return {
                                              ...v,
                                              inventoryByLocation: {
                                                ...(v.inventoryByLocation || {}),
                                                [locId]: { ...((v.inventoryByLocation || {})[locId] || {}), quantity: newQty },
                                              },
                                            };
                                          }
                                          return v;
                                        });
                                        nextPlatforms[platformKey] = { ...pData, variants: newVariants };
                                        onChangePlatforms(nextPlatforms);
                                      }}
                                      keyboardType="number-pad"
                                      selectTextOnFocus
                                    />
                                    <TouchableOpacity
                                      onPress={() => {
                                        const newQty = currentQty + 1;
                                        const nextPlatforms = { ...platforms };
                                        const pData = nextPlatforms[platformKey] || {};
                                        const newVariants = (pData.variants || []).map((v: any) => {
                                          if (v.id === variant.id) {
                                            return {
                                              ...v,
                                              inventoryByLocation: {
                                                ...(v.inventoryByLocation || {}),
                                                [locId]: { ...((v.inventoryByLocation || {})[locId] || {}), quantity: newQty },
                                              },
                                            };
                                          }
                                          return v;
                                        });
                                        nextPlatforms[platformKey] = { ...pData, variants: newVariants };
                                        onChangePlatforms(nextPlatforms);
                                      }}
                                      style={{ paddingHorizontal: 5, paddingVertical: 4 }}
                                    >
                                      <Icon name="plus" size={12} color="#666" />
                                    </TouchableOpacity>
                                  </View>
                                </View>

                                {/* Price Input - Shopify is global (updates ALL locations), others are per-location */}
                                <View style={{ alignItems: 'center', gap: 2 }}>
                                  <Text style={{ color: '#666', fontSize: 10 }}>{isShopify ? 'Price' : 'Price'}</Text>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: isOverride ? '#FFD700' : (isShopify ? '#1976D2' : '#E5E5E5'), borderRadius: 6, backgroundColor: isOverride ? '#FFFEF0' : (isShopify ? '#F5FAFF' : '#FFF') }}>
                                    <Text style={{ color: '#666', paddingLeft: 6, fontSize: 13 }}>$</Text>
                                    <TextInput
                                      style={{ color: isOverride ? '#B8860B' : (isShopify ? '#1976D2' : '#000'), fontWeight: '600', width: 50, textAlign: 'center', fontSize: 13, paddingVertical: 6, paddingRight: 6 }}
                                      value={displayPrice.toFixed(2)}
                                      onChangeText={(text) => {
                                        const newPrice = Math.max(0, parseFloat(text.replace(/[^0-9.]/g, '')) || 0);
                                        const nextPlatforms = { ...platforms };
                                        const pData = nextPlatforms[platformKey] || {};
                                        
                                        if (isShopify) {
                                          // Shopify: Update variant.price (global for this variant)
                                          const newVariants = (pData.variants || []).map((v: any) => {
                                            if (v.id === variant.id) {
                                              return { ...v, price: newPrice };
                                            }
                                            return v;
                                          });
                                          nextPlatforms[platformKey] = { ...pData, variants: newVariants };
                                        } else {
                                          // Square/Clover: Update per-location price
                                          const newVariants = (pData.variants || []).map((v: any) => {
                                            if (v.id === variant.id) {
                                              return {
                                                ...v,
                                                inventoryByLocation: {
                                                  ...(v.inventoryByLocation || {}),
                                                  [locId]: { ...((v.inventoryByLocation || {})[locId] || {}), price: newPrice },
                                                },
                                              };
                                            }
                                            return v;
                                          });
                                          nextPlatforms[platformKey] = { ...pData, variants: newVariants };
                                        }
                                        onChangePlatforms(nextPlatforms);
                                      }}
                                      keyboardType="decimal-pad"
                                      selectTextOnFocus
                                    />
                                  </View>
                                </View>
                              </View>
                            );
                          })
                        )}
                      </View>
                    ))}
                  </>
                );
              })()}
            </View>
          ) : (
            // PLATFORM TAB: Show variants for selected location only
            (activeData.variants || []).map((variant, variantIdx) => {
              const variantName = Object.values(variant.optionValues || {}).join(' / ') || 'Variant';
              const invKey = selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS' ? selectedLocationId : 'default';
              const inv = (variant.inventoryByLocation || {})[invKey] || { quantity: 0, price: undefined };
              const currentPriceRaw = inv.price;
              const currentPrice = (currentPriceRaw !== undefined && currentPriceRaw !== null) ? Number(currentPriceRaw) : undefined;
              const defaultPrice = Number(variant.price ?? activeData.price ?? 0) || 0;
              const isOverride = currentPrice !== undefined && currentPrice !== defaultPrice;

              console.log(`[INV-RENDER] Variant ${variant.id} at loc ${invKey}: allLocs=${Object.keys(variant.inventoryByLocation || {}).join(',')}, qty=${inv.quantity}, price=${currentPrice}`);

              return (
                <View key={`${variant.id}-${variantIdx}`} style={{ marginBottom: 12 }}>
                  {/* Location-specific row with quantity and price below */}
                  <VariantInventoryRow
                    variantName={variantName}
                    variantId={variant.id}
                    invKey={invKey}
                    quantity={inv.quantity ?? 0}
                    price={currentPrice ?? defaultPrice}
                    isOverride={isOverride}
                    onChangeQuantity={(qty) => setVariantAtLocation(variant.id, invKey, 'quantity', qty)}
                    onChangePrice={(p) => {
                      // Update variant global price (Shopify) or per-location price (Square/Clover)
                      if (activePlatformKey === 'shopify') {
                        setVariantPrice(variant.id, p);
                      } else {
                        setVariantAtLocation(variant.id, invKey, 'price', p);
                      }
                    }}
                    onSelectImage={() => setVariantImagePicker({ variantId: variant.id, open: true })}
                    platformKey={activePlatformKey}
                  />
                </View>
              );
            })
          )
        ) : (
          activeTab === 'all' ? (
            // Show all platform locations in "all" tab with logos and truncation
            <View style={{ gap: 8 }}>
              {aggregatedLocations.length > 0 ? (
                aggregatedLocations.map((loc: any) => {
                  const key = `${loc.platformKey}:${loc.id}`;
                  const qty = aggregatedLocationQuantities[key]?.quantity || 0;
                  const truncatedName = loc.name.length > 20 ? loc.name.slice(0, 20) + '…' : loc.name;
                  const logoMap: Record<string, any> = { shopify: ShopifySvg, amazon: AmazonSvg, facebook: FacebookSvg, ebay: EbaySvg, clover: CloverSvg, square: SquareSvg };
                  const Logo = logoMap[loc.platformKey];
                  return (
                    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, backgroundColor: '#FFF' }}>
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {Logo && <Logo width={18} height={18} />}
                        <Text style={{ color: '#000', fontWeight: '600', fontSize: 13, flexShrink: 1 }} numberOfLines={1} ellipsizeMode="tail">
                          {truncatedName}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: '#666', fontSize: 12 }}>Qty:</Text>
                        <Text style={{ color: '#000', fontWeight: '700', fontSize: 14 }}>{qty}</Text>
                      </View>
                    </View>
                  );
                })
              ) : (
                <Text style={{ color: '#999', fontStyle: 'italic' }}>No locations available across platforms</Text>
              )}
            </View>
          ) : (
            // Show simple quantity for single platform
            <SimpleQuantityInput
              quantity={(activeData.locationQuantities || {})['default'] ?? 0}
              onChangeQuantity={(qty) => setLocationQuantity('default', qty)}
            />
          )
        )}

      </View>


      {/* Additional fields basic toggle */}
      <TouchableOpacity style={styles.toggleRow} onPress={() => setShowAdditionalFields(v => !v)}>
        <Icon name={showAdditionalFields ? 'chevron-down' : 'chevron-right'} size={18} color="#000" />
        <Text style={styles.sectionTitle}>Additional Fields</Text>

        {/*
          <View style={{ flexDirection: 'row', gap: 8, marginLeft: 'auto' }}>
            {!!onBoostListing && (
              <TouchableOpacity style={styles.btnSecondary} onPress={() => onBoostListing(activePlatformKey, 'boost')}>
                <Text style={{ color: '#000' }}>Boost</Text>
              </TouchableOpacity>
            )}
            {!!onBoostListing && (
              <TouchableOpacity style={styles.btnSecondary} onPress={() => onBoostListing(activePlatformKey, 'advanced')}>
                <Text style={{ color: '#000' }}>Fill Advanced</Text>
              </TouchableOpacity>
            )}
          </View>
          */}
      </TouchableOpacity>
      {showAdditionalFields && (
        <>
          {activeTab !== 'all' && (() => {
            const standardFields = new Set([
              'title', 'description', 'tags', 'price', 'weight', 'weightUnit', 'sku', 'barcode',
              'images', 'options', 'variants', 'locations', 'locationQuantities', 'inventoryType',
              '__refilled', '_rawResponse', '_parseError', '_extractedJson' // Exclude internal fields
            ]);

            const additionalFields = Object.entries(activeData || {})
              .filter(([key, value]) =>
                !standardFields.has(key) &&
                value !== undefined &&
                value !== null &&
                !key.startsWith('_') // Skip internal fields
              );

            if (additionalFields.length === 0) {
              return (
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Additional Fields</Text>
                  <Text style={styles.subtle}>No additional fields detected from AI response</Text>
                </View>
              );
            }

            return (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Additional Fields</Text>
                <Text style={styles.subtle}>Fields automatically detected from AI response</Text>
                {additionalFields.map(([key, value]) => {
                  const isArray = Array.isArray(value);
                  const isObject = typeof value === 'object' && !isArray;
                  const displayValue = isObject ? JSON.stringify(value, null, 2) :
                    isArray ? value.join(', ') : String(value);

                  return (
                    <View key={key} style={{ marginTop: 12 }}>
                      {isArray && value.every((item: any) => typeof item === 'string') ? (
                        <ChipsField
                          label={key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                          valueArray={value as string[]}
                          onChangeArray={(arr) => patchField(key, arr)}
                          onInfo={() => onOpenFieldPanel?.(key)}
                          onRegenerate={enableAIRefill && onRegenerateField ? () => onRegenerateField(activePlatformKey, key) : undefined}
                          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes(key)}
                        />
                      ) : (
                        <Field
                          label={key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                          value={displayValue}
                          multiline={isObject || displayValue.length > 50}
                          onChangeText={(t) => {
                            // Try to parse back to original type
                            if (isObject) {
                              try {
                                patchField(key, JSON.parse(t));
                              } catch {
                                patchField(key, t); // Fallback to string
                              }
                            } else if (typeof value === 'number') {
                              patchField(key, Number(t) || 0);
                            } else if (typeof value === 'boolean') {
                              patchField(key, t.toLowerCase() === 'true');
                            } else {
                              patchField(key, t);
                            }
                          }}
                          onInfo={() => onOpenFieldPanel?.(key)}
                          onRegenerate={enableAIRefill && onRegenerateField ? () => onRegenerateField(activePlatformKey, key) : undefined}
                          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes(key)}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })()}

          {/* Add Missing Field Button for current platform */}
          {activeTab !== 'all' && onAddMissingField && (
            <TouchableOpacity
              style={styles.addMissingFieldButton}
              onPress={() => onAddMissingField(activePlatformKey)}
            >
              <Icon name="plus" size={18} color="#71717A" />
              <Text style={styles.addMissingFieldText}>Add fields & boost</Text>
            </TouchableOpacity>
          )}
        </>
      )}



    </View>
  );
}

export default forwardRef<ListingEditorFormRef, Props>(ListingEditorFormInner);

function SimpleQuantityInput({ quantity, onChangeQuantity }: { quantity: number; onChangeQuantity: (qty: number) => void }) {
  const [localQty, setLocalQty] = useState(String(quantity));
  const timeoutRef = React.useRef<any>(null);
  const isEditingRef = React.useRef(false);

  useEffect(() => {
    // Only sync from prop if user is NOT actively editing
    if (!isEditingRef.current) {
      console.log('[SimpleQuantityInput] Syncing from prop:', quantity);
      setLocalQty(String(quantity));
    } else {
      console.log('[SimpleQuantityInput] User is editing, not syncing from prop:', quantity);
    }
  }, [quantity]);

  const handleChange = (text: string) => {
    console.log('[SimpleQuantityInput] handleChange:', text);
    isEditingRef.current = true;
    const num = text.replace(/[^0-9]/g, '');
    setLocalQty(num);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      console.log('[SimpleQuantityInput] Calling onChangeQuantity with:', Number(num || '0'));
      onChangeQuantity(Number(num || '0'));
      isEditingRef.current = false;
    }, 300);
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ color: '#000' }}>Quantity:</Text>
      <TextInput
        style={styles.qtyInput}
        value={localQty}
        onChangeText={handleChange}
        onBlur={() => {
          isEditingRef.current = false;
          // Sync to prop value on blur to ensure consistency
          setLocalQty(String(quantity));
        }}
        placeholder="0"
        keyboardType="numeric"
      />
    </View>
  );
}

function VariantInventoryRow({ variantName, variantId, invKey, quantity, price, isOverride, onChangeQuantity, onChangePrice, onSelectImage, platformKey }: {
  variantName: string;
  variantId: string;
  invKey: string;
  quantity: number;
  price: number;
  isOverride?: boolean;
  onChangeQuantity: (qty: number) => void;
  onChangePrice: (price: number) => void;
  onSelectImage: () => void;
  platformKey?: string; // NEW: Platform type to determine pricing UI
}) {
  const [localQty, setLocalQty] = useState(String(quantity));
  const [localPrice, setLocalPrice] = useState(String(price));
  const qtyTimeoutRef = React.useRef<any>(null);
  const priceTimeoutRef = React.useRef<any>(null);

  // Determine if platform supports per-location pricing
  const isShopify = platformKey === 'shopify';
  const supportsPerLocationPricing = platformKey === 'square' || platformKey === 'clover';

  // Sync from parent when values change externally
  useEffect(() => {
    if (String(quantity) !== localQty) {
      setLocalQty(String(quantity));
    }
  }, [quantity]);

  useEffect(() => {
    if (String(price) !== localPrice) {
      setLocalPrice(String(price));
    }
  }, [price]);

  const handleQtyChange = (text: string) => {
    const num = text.replace(/[^0-9]/g, ''); // Only allow numbers
    setLocalQty(num);

    if (qtyTimeoutRef.current) clearTimeout(qtyTimeoutRef.current);
    qtyTimeoutRef.current = setTimeout(() => {
      onChangeQuantity(Number(num || '0'));
    }, 300);
  };

  const handlePriceChange = (text: string) => {
    const num = text.replace(/[^0-9.]/g, ''); // Allow numbers and decimal
    setLocalPrice(num);

    if (priceTimeoutRef.current) clearTimeout(priceTimeoutRef.current);
    priceTimeoutRef.current = setTimeout(() => {
      onChangePrice(Number(num || '0'));
    }, 300);
  };

  return (
    <View style={[
      styles.inventoryRow,
      isOverride && {
        borderWidth: 4,
        borderColor: '#FFD700',
        borderTopWidth: 6,
        backgroundColor: '#FFFEF0',
        borderRadius: 10,
        position: 'relative',
        marginTop: 12,
      }
    ]}>
      {isOverride && (
        <View style={{ position: 'absolute', top: -12, left: 12, backgroundColor: '#FFD700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, zIndex: 10 }}>
          <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '700' }}>OVERRIDE</Text>
        </View>
      )}
      <View style={{ flexDirection: "column", gap: 12, alignSelf: 'flex-start' }}>
        <Text style={{ backgroundColor: '#F8F9FB', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, color: '#000', fontWeight: '600' }}>{variantName}</Text>

        {/* Platform indicator */}
        {platformKey && (
          <View style={{ alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 8, backgroundColor: isShopify ? '#E3F2FD' : '#E8F5E9', borderRadius: 4 }}>
            <Text style={{ fontSize: 11, color: isShopify ? '#1976D2' : '#388E3C', fontWeight: '600' }}>
              {isShopify ? '🔒 Global Price' : '📍 Per-Location Pricing'}
            </Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 9, alignItems: 'center', alignSelf: 'flex-end' }}>
          <Text style={{ color: '#000' }}>Quantity:</Text>
          <TextInput
            style={styles.qtyInput}
            value={localQty}
            onChangeText={handleQtyChange}
            keyboardType={'decimal-pad'}
          />
        </View>

        {/* Price input under quantity */}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 9, alignItems: 'center', alignSelf: 'flex-end' }}>
          <Text style={{ color: isOverride ? '#FFD700' : '#000', fontWeight: isOverride ? '700' : '400' }}>Price:</Text>
          <TextInput
            style={styles.qtyInput}
            value={localPrice}
            onChangeText={handlePriceChange}
            keyboardType={'decimal-pad'}
            editable={true}
          />
        </View>
      </View>
    </View>
  );
}

function Field({ label, value, onChangeText, multiline, keyboardType, onInfo, required, onRegenerate, refilled, error }: { label: string; value?: string; onChangeText?: (t: string) => void; multiline?: boolean; keyboardType?: any; onInfo?: () => void; required?: boolean; onRegenerate?: () => void; refilled?: boolean; error?: boolean }) {
  // Use local state with uncontrolled input to prevent re-render issues
  const [localValue, setLocalValue] = useState(value ?? '');
  const timeoutRef = React.useRef<any>(null);

  // Sync from parent when value changes externally (but not from our own typing)
  useEffect(() => {
    if (value !== localValue && value !== undefined) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = (text: string) => {
    setLocalValue(text);

    // Debounce the callback to parent
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      onChangeText?.(text);
    }, 300);
  };

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 0 }}>
          <Text style={styles.fieldLabel}>{label}{required ? <Text style={{ color: '#ef4444' }}> *</Text> : null}</Text>
          {refilled ? (
            <View style={{ backgroundColor: 'rgba(147,200,34,0.12)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#3f6212', fontSize: 10 }}>Refilled</Text>
            </View>
          ) : null}
          {!!onRegenerate && (
            <TouchableOpacity onPress={onRegenerate} style={{ borderWidth: 1, borderColor: '#E5E5E5', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#fff' }}>
              <Sparkles size={14} color={'#000'} />
            </TouchableOpacity>
          )}
        </View>
        {!!onInfo && (
          <TouchableOpacity onPress={onInfo}><Icon name="information-outline" size={18} color="#999999" /></TouchableOpacity>
        )}
      </View>
      <TextInput
        style={[
          styles.input,
          multiline && { minHeight: 100, textAlignVertical: 'top' },
          error ? { borderColor: '#ef4444' } : null,
        ]}
        value={localValue}
        onChangeText={handleChange}
        placeholder=''
        placeholderTextColor={"#999999"}
        multiline={multiline}
        keyboardType={keyboardType}
      />
    </View>
  );
}

function ChipsField({ label, valueArray, onChangeArray, onInfo, onRegenerate, refilled }: { label: string; valueArray?: string[]; onChangeArray: (arr: string[]) => void; onInfo?: () => void; onRegenerate?: () => void; refilled?: boolean }) {
  const [text, setText] = useState('');
  const arr = Array.isArray(valueArray) ? valueArray : [];
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, }}>
          <Text style={styles.fieldLabel}>{label}</Text>
          {refilled ? (
            <View style={{ backgroundColor: 'rgba(147,200,34,0.12)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#3f6212', fontSize: 10 }}>Refilled</Text>
            </View>
          ) : null}
          {!!onRegenerate && (

            <TouchableOpacity onPress={onRegenerate} style={{ borderWidth: 1, borderColor: '#E5E5E5', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#fff' }}>
              <Sparkles size={14} color={'#000'} />
            </TouchableOpacity>


          )}
        </View>
        {!!onInfo && (
          <TouchableOpacity onPress={onInfo}><Icon name="information-outline" size={18} color="#999999" /></TouchableOpacity>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 10, }}>
        <TextInput style={{ flex: 1, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: '#000' }} value={text} onChangeText={setText} placeholder="Add tag and press + Add" placeholderTextColor={"#999999"} />
        <TouchableOpacity style={styles.addTagBtn} onPress={() => { if (text.trim().length) { onChangeArray([...arr, text.trim()]); setText(''); } }}>
          <Icon name="plus" size={16} color="#000" /><Text style={{ color: '#000', marginLeft: 6 }}>Add</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
        {arr.map((t, i) => (
          <View key={`${t}-${i}`} style={[styles.tagChip, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
            <TouchableOpacity onPress={() => onChangeArray(arr.filter((_, idx) => idx !== i))}>
              <Icon name="close" size={10} color="#6B7280" />
            </TouchableOpacity>
            {/* Small platform logo placeholder space for tags (if needed in future) */}
            <Text style={{ color: '#000' }}>{t}</Text>
          </View>
        ))}
      </View>

    </View>
  );
}

function Dropdown({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ position: 'relative', zIndex: open ? 1000 : 1 }}>
      <TouchableOpacity style={styles.dropdown} onPress={() => setOpen(o => !o)}>
        <Text style={{ color: '#000' }}>{value || label}</Text>
        <Icon name="chevron-down" size={18} color="#000" />
      </TouchableOpacity>
      {open && (
        <View style={[styles.dropdownMenu, { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, marginTop: 0 }]}>
          {options.map(opt => (
            <TouchableOpacity key={opt} style={styles.dropdownItem} onPress={() => { onChange(opt); setOpen(false); }}>
              <Text style={{ color: '#000' }}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mediaRow: { paddingVertical: 10, borderBottomColor: '#E5E5E5', borderBottomWidth: 1, paddingBottom: 10, marginBottom: 10, gap: 8 },
  thumbWrap: { width: 86, height: 86, borderRadius: 8, overflow: 'hidden', marginRight: 8, borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: '100%' },
  addThumb: { borderStyle: 'dashed' },
  thumbCover: { borderColor: '#93C822', borderWidth: 2 },
  coverBadge: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, flexDirection: 'row', alignItems: 'center' },
  mediaHint: { textAlign: 'center', color: '#71717A', marginTop: 6 },
  pill: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#E5E5E5', marginRight: 8 },
  pillActive: { backgroundColor: 'rgba(147,200,34,0.12)', borderColor: '#93C822' },
  pillText: { color: '#000' },
  pillTextActive: { fontWeight: '700' },
  pillDashed: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#E5E5E5' },
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 12 },
  darkerCard: { borderWidth: 1, backgroundColor: '#F8F9FB', borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 12 },
  fieldLabel: { color: '#71717A', fontWeight: '600', fontSize: 12, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: '#000' },
  addTagBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  tagChip: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  optionChip: { backgroundColor: '#E5E5E5', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  dropdown: { backgroundColor: 'white', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownMenu: { backgroundColor: 'white', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, marginTop: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3 },
  dropdownItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  scanBtn: { backgroundColor: '#93C822', width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: -18 },
  sectionTitle: { color: '#000', fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  subtle: { color: '#71717A', marginTop: 4 },
  addOption: { borderWidth: 1, borderColor: '#E5E5E5', borderStyle: 'dashed', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 12, alignSelf: 'stretch', marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  addInline: { borderWidth: 1, borderColor: '#E5E5E5', borderStyle: 'dashed', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, alignSelf: 'stretch', marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  locationPill: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12, marginVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dotOnline: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FACC15', marginRight: 6 },
  inventoryRow: { justifyContent: 'space-between', backgroundColor: 'white', flexDirection: 'row', gap: 24, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'flex-end', borderWidth: 1, borderRadius: 6, marginBottom: 12, borderColor: '#D9D9D9' },
  qtyInput: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, width: 100, color: '#000' },
  variantImgSlot: { width: 120, height: 120, borderWidth: 2, borderStyle: 'dashed', borderColor: '#E5E5E5', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnSecondary: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: '#93C822', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  optionCard: { marginTop: 10, backgroundColor: '#fff' },
  optionSummaryCard: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 12, marginTop: 10, backgroundColor: '#fff' },
  platformPickerModal: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  platformPickerCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, width: '90%' },
  platformGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  pillClose: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#EFEFEF', alignItems: 'center', justifyContent: 'center' },
  // Docked platform picker similar to scanner capsule
  platformPickerDock: { position: 'absolute', top: 6, left: 24, right: 24, zIndex: 5000 },
  platformPickerCapsule: { backgroundColor: 'rgba(248, 249, 251, 1)', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(153, 153, 153, 0.3)', padding: 12 },
  platformPill: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, margin: 6, flexDirection: 'row', alignItems: 'center' },
  platformSquare: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#FFF',
    margin: 4,
    width: 125,
    height: 125,
    borderWidth: 2,
    borderColor: 'rgba(153, 153, 153, 0.3)',
    flexDirection: 'column',
    gap: 6,
  },

  // Add Missing Field Button
  addMissingFieldButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#71717A',
    marginTop: 16,
    gap: 8
  },
  addMissingFieldText: {
    color: '#71717A',
    fontSize: 14,
    fontWeight: '600'
  },
  // Platform generation styles
  pillGenerating: {
    opacity: 0.7,
    backgroundColor: '#F3F4F6',
  },
  pillTextGenerating: {
    color: '#6B7280',
  },
  generatePlatformPill: {
    borderColor: '#93C822',
    backgroundColor: 'rgba(147,200,34,0.05)',
    marginTop: 4,
  },
  suggestionBox: { borderWidth: 1, borderColor: '#E5E5E5', borderStyle: 'dashed', borderRadius: 10, padding: 12, marginTop: 10, backgroundColor: '#FAFAFA' },
  suggestionChip: { borderWidth: 1, borderColor: '#E5E5E5', borderStyle: 'dashed', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
});


