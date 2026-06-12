import React, { useEffect, useMemo, useState, forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput, Modal, Pressable, FlatList, SectionList, Alert, ActivityIndicator, Dimensions, Linking, Platform } from 'react-native';
import { isPlatformReady, getMissingPlatformFields, hasPlatformPrice } from '../utils/platformRequirements';
import { Paths, Directory, File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import VariantInventoryEditor, { InventoryItemData, VariantInventoryEditorProps } from './VariantInventoryEditor';
import BaseModal from './BaseModal';
import DeliveryShippingSheet from './DeliveryShippingSheet';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Boxes, X, Sparkles, Car, Package, MapPin, Truck, Scale, RefreshCw } from 'lucide-react-native';
import { Dropdown as ElementDropdown } from 'react-native-element-dropdown';
import { AppDropdown } from './ui/AppDropdown';
import { CollapsibleSection, StickyActionBar, ModernInput, SectionHeader, SimpleQuantityInput, Field, ChipsField, LocationDropdown } from './ListingEditor';
import InteractiveMapModal from './InteractiveMapModal';
import { black, grey400 } from 'react-native-paper/lib/typescript/styles/themes/v2/colors';
import { overlay } from 'react-native-paper';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL as ENV_API_BASE_URL } from '../config/env';
import { usePlatformPickerOverlay } from '../context/PlatformPickerOverlayContext';
import { PricingGuidanceCard } from './pricing/PricingGuidanceCard';
import { logger } from 'react-native-reanimated/lib/typescript/common';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';

const ACTION_BAR_HEIGHT = 80;
const ACTION_BAR_BOTTOM_OFFSET = 24;

export type PlatformsData = Record<string, any>;

const API_BASE_URL = ENV_API_BASE_URL;

type Props = {
  platforms: PlatformsData;
  updateCounter?: number; // Signal when platforms ref content changes
  isGenerationMode?: boolean; // Control whether to show generation-specific UI (overrides etc)
  images: string[];
  platformLocations?: Record<string, Array<{ id: string; name: string; connectionId: string; connectionName: string; platformType: string }>>;
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
  // Live external updates (green indicator for values changed while editing)
  externalUpdates?: Record<string, { value?: any; quantity?: number; price?: number; updatedAt: number }>;
  onAdoptExternalUpdate?: (key: string, value: any) => void;
  pendingImages?: string[];
  generatingPlatformKeys?: Set<string>;
  highlightedField?: string;
  highlightedPlatform?: string;
  onScrollToOffset?: (y: number) => void;
};

export type ListingEditorFormRef = { openPlatformPicker: () => void };

type Variant = {
  id: string;
  optionValues: Record<string, string>; // e.g., { Size: 'Small', Color: 'Red' }
  price?: number;
  image?: string;
  inventoryByLocation?: Record<string, { quantity: number; price?: number; image?: string; connectionId?: string }>;
};

type PlatformState = {
  title?: string;
  description?: string;
  tags?: string[];
  price?: number;
  aiRecommendedPrice?: number; // Legacy: single AI price
  aiPriceRecommendation?: { recommended: number; band?: number; low: number; high: number }; // From SerpAPI/scraped data
  weight?: number;
  weightUnit?: string;
  sku?: string;
  barcode?: string;
  brand?: string;
  vendor?: string;
  productCategoryId?: string;
  productCategory?: string;
  categoryId?: string;
  category?: string;
  categoryPath?: string;
  taxonomyConfidence?: number;
  taxonomySource?: string;
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
  deliveryMethod?: 'in_person' | 'shipping' | 'both';
  shippingCost?: string | number;

  // Facebook Marketplace pickup location
  pickupLocation?: {
    latitude?: number;
    longitude?: number;
    locationName?: string;
    deliveryMethod?: 'in_person' | 'shipping' | 'both';
  };
  condition?: 'new' | 'used' | 'refurbished' | 'like_new' | 'good' | 'fair' | 'for_parts';
  itemSpecifics?: Record<string, string>;
  conditionID?: number;
  estimatedDimensions?: { length: number; width: number; height: number; unit: string };
  estimatedWeight?: { value: number; unit: string };
  shippingTier?: string;
  shippingTierReason?: string;
  shippingOptions?: Record<string, string>;
};

type TaxonomyOption = {
  label: string;
  value: string;
  path?: string;
  isLeaf?: boolean;
  score?: number;
};

const EBAY_CONDITION_TO_GENERIC: Record<string, string> = {
  '1000': 'new', '1500': 'new', '1750': 'new',
  '2000': 'refurbished', '2010': 'refurbished', '2020': 'refurbished', '2030': 'refurbished', '2500': 'refurbished',
  '2750': 'like_new', '2990': 'like_new',
  '3000': 'used', '3010': 'fair', '4000': 'good', '5000': 'good', '6000': 'fair', '7000': 'for_parts',
};
function mapEbayConditionIdToGeneric(conditionId: string): string {
  return EBAY_CONDITION_TO_GENERIC[String(conditionId)] || 'good';
}

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

const SINGLE_LOCATION_PLATFORMS = new Set(['ebay']);

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

function ListingEditorFormInner({ platforms, updateCounter, images, pendingImages = [], platformLocations, onChangePlatforms, onChangeImages, onOpenFieldPanel, onOpenBarcodeScanner, onOpenImageCapture, onRegenerateField, onAddMissingField, getMissingFieldsCount, onGeneratePlatform, enableAIRefill, onSuggestVariants, onBoostListing, onToggleIgnorePlatform, isPlatformIgnored, isGenerationMode = false, externalUpdates, onAdoptExternalUpdate, generatingPlatformKeys, highlightedField, highlightedPlatform, onScrollToOffset }: Props, ref: React.Ref<ListingEditorFormRef>) {
  const isFocused = useIsFocused();
  const fieldYOffsets = useRef<Record<string, number>>({});
  const platformKeys = useMemo(() => {
    const keys = Object.keys(platforms || {}).filter((k) => typeof k === 'string' && k.trim().length > 0);
    console.log('[ListingEditorForm] platformKeys:', keys);
    return keys;
  }, [platforms]);

  const canonicalKey = useMemo(() => {
    // Prefer first platform that has locations (connected); avoid always preferring Shopify
    const keyWithLocs = platformKeys.find((pk) => (platformLocations || {})[pk]?.length > 0);
    const key = keyWithLocs || platformKeys[0] || 'shopify';
    console.log('[ListingEditorForm] canonicalKey:', key, 'from platformKeys:', platformKeys);
    return key;
  }, [platformKeys, platformLocations]);

  // Default to 'all' tab instead of first platform
  const [variantSearchQuery, setVariantSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('all');
  const [showAdditionalFields, setShowAdditionalFields] = useState<boolean>(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [optionEditorOpen, setOptionEditorOpen] = useState<boolean>(false);
  const [newOptionName, setNewOptionName] = useState<string>('');
  const [newOptionValues, setNewOptionValues] = useState<string[]>(['']);

  useEffect(() => {
    // Auto-scroll to highlighted field
    if (highlightedField && fieldYOffsets.current[highlightedField] !== undefined) {
      setTimeout(() => {
        onScrollToOffset?.(fieldYOffsets.current[highlightedField]);
      }, 300);
    }
  }, [highlightedField, activeTab]);

  const recordFieldLayout = (field: string) => (event: any) => {
    fieldYOffsets.current[field] = event.nativeEvent.layout.y;
  };

  const [allPlatformOptions, setAllPlatformOptions] = useState<Array<{ name: string; values: string[]; sources: string[] }>>([]);
  const [optionPresets, setOptionPresets] = useState<Array<{ name: string; values: string[] }>>([]);
  const [loadingPlatformOptions, setLoadingPlatformOptions] = useState<boolean>(false);
  const [openImagePickerFor, setOpenImagePickerFor] = useState<string | null>(null);
  const [taxonomyQueries, setTaxonomyQueries] = useState<Record<string, string>>({});
  const [taxonomyResults, setTaxonomyResults] = useState<Record<string, TaxonomyOption[]>>({});
  const [taxonomyLoading, setTaxonomyLoading] = useState<Record<string, boolean>>({});
  const taxonomySearchTimeoutRef = useRef<Record<string, any>>({});
  const [aspects, setAspects] = useState<Array<{ aspectName: string; isRequired: boolean; allowedValues: string[] }>>([]);
  const [aspectsLoading, setAspectsLoading] = useState<boolean>(false);
  const [ebayConditions, setEbayConditions] = useState<Array<{ conditionId: string; conditionName: string; description?: string }>>([]);
  const [ebayConditionsLoading, setEbayConditionsLoading] = useState<boolean>(false);
  const [pricingResearchLoading, setPricingResearchLoading] = useState<boolean>(false);
  const [pricingResearchModalVisible, setPricingResearchModalVisible] = useState<boolean>(false);
  const [pricingResearchResult, setPricingResearchResult] = useState<{
    low?: number; median?: number; high?: number; recommended?: number;
    samples?: Array<{ title: string; price: number; url?: string; quantitySold?: number; watchers?: number; estimatedDaysToSell?: number }>;
    timeToSell?: { fastSaleAvgDays?: number; recommendedAvgDays?: number; maxProfitAvgDays?: number; basis?: string };
    sampleCount?: number;
    sources?: Array<{ type: string; title?: string; url?: string }>;
    history?: { dataPoints: Array<{ date: string; median: number; low?: number; high?: number; sampleCount?: number }> };
    cachedAt?: string;
    error?: string;
  } | null>(null);
  const [shippingEstimateResult, setShippingEstimateResult] = useState<{
    estimatedMin: number;
    estimatedMax: number;
    midpoint: number;
    description?: string;
    error?: string;
    lowZoneCost?: number;
    midZoneCost?: number;
    highZoneCost?: number;
    expectedCost?: number;
  } | null>(null);
  const [shippingEstimateLoading, setShippingEstimateLoading] = useState<boolean>(false);
  const shippingEstimateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deliverySheetVisible, setDeliverySheetVisible] = useState(false);
  const [editableDimensions, setEditableDimensions] = useState<{ length: string; width: string; height: string }>({ length: '', width: '', height: '' });
  const [editableWeight, setEditableWeight] = useState('');
  const [editableWeightUnit, setEditableWeightUnit] = useState('lb');
  const preventTaxonomyAutoFetchRef = useRef<Set<string>>(new Set());
  const [variantImagePicker, setVariantImagePicker] = useState<{ variantId: string; open: boolean } | null>(null);
  const [localGeneratingPlatforms, setGeneratingPlatforms] = useState<Set<string>>(new Set());
  const platformPickerOverlay = usePlatformPickerOverlay();

  const generatingPlatforms = useMemo(() => {
    const combined = new Set(localGeneratingPlatforms);
    if (generatingPlatformKeys) {
      generatingPlatformKeys.forEach(k => combined.add(k));
    }
    return combined;
  }, [localGeneratingPlatforms, generatingPlatformKeys]);

  const [locationPickerVisible, setLocationPickerVisible] = useState<boolean>(false);

  const isShopifyGlobalLocation = (loc?: { id?: string; name?: string; platformKey?: string }) => {
    if (!loc) return false;
    const platform = (loc.platformKey || '').toLowerCase();
    if (platform !== 'shopify') return false;
    return true;
  };

  // Delete confirmation modal for option values
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    optionName: string;
    value: string;
  } | null>(null);

  // Handle confirmed deletion of option value
  const handleDeleteOptionValue = (optionName: string, value: string, deleteFromAll: boolean) => {
    const platformsToUpdate = deleteFromAll ? platformKeys : [activePlatformKey];
    const updatedPlatforms = { ...platforms };

    for (const pk of platformsToUpdate) {
      const pData = (updatedPlatforms[pk] || {}) as PlatformState;
      const options = (pData.options || []).map(o =>
        o.name === optionName
          ? { ...o, values: (o.values || []).filter((val: string) => val !== value) }
          : o
      );
      updatedPlatforms[pk] = { ...pData, options } as PlatformState;
    }

    onChangePlatforms(updatedPlatforms);
    setDeleteConfirmation(null);
    setTimeout(recomputeVariants, 0);
  };

  useImperativeHandle(ref, () => ({
    openPlatformPicker: () => platformPickerOverlay.show(),
  }), [platformPickerOverlay]);

  const lastPlatformRef = useRef<string>('');
  const lastOptionsRef = useRef<string>('');

  // 🟢 EXTERNAL UPDATES: Helper to check if a field was updated externally
  const hasExternalUpdate = useCallback((fieldKey: string): boolean => {
    if (!externalUpdates?.[fieldKey]) return false;
    const update = externalUpdates[fieldKey];
    // Highlight if updated within last 5 seconds
    return (Date.now() - update.updatedAt) < 5000;
  }, [externalUpdates]);

  // 🟢 EXTERNAL UPDATES: Inventory row – only the field that changed gets green border
  const hasExternalInventoryUpdateQuantity = useCallback((variantId: string, locationId: string): boolean => {
    const key = `inventory_${variantId}_${locationId}_quantity`;
    return hasExternalUpdate(key);
  }, [hasExternalUpdate]);
  const hasExternalInventoryUpdatePrice = useCallback((variantId: string, locationId: string): boolean => {
    const key = `inventory_${variantId}_${locationId}_price`;
    return hasExternalUpdate(key);
  }, [hasExternalUpdate]);

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
  const activePlatformKeyLower = activePlatformKey.toLowerCase();
  const activeData = useMemo<PlatformState>(() => (platforms[activePlatformKey] || {}) as PlatformState, [activePlatformKey, platforms, updateCounter]);
  const pricingResearchInput = useMemo(() => {
    for (const pk of platformKeys) {
      const p = platforms[pk] as any;
      const t = p?.title?.trim();
      if (t) return { title: t, categoryId: p?.categoryId, condition: p?.condition };
    }
    return null;
  }, [platformKeys, platforms]);
  const titleForPricingResearch = pricingResearchInput?.title ?? '';
  const supportsTaxonomy = activeTab !== 'all' && ['shopify', 'ebay'].includes(activePlatformKeyLower);
  const activeTaxonomyQuery = taxonomyQueries[activePlatformKeyLower] ?? '';

  const fetchTaxonomyOptions = useCallback(async (platformKey: string, query: string) => {
    const normalizedPlatform = platformKey.toLowerCase();
    const normalizedQuery = (query || '').trim();

    if (normalizedQuery.length < 2) {
      // Don't clear results if we just have a short query, keep previous suggestions
      // setTaxonomyResults(prev => ({ ...prev, [normalizedPlatform]: [] }));
      setTaxonomyLoading(prev => ({ ...prev, [normalizedPlatform]: false }));
      return;
    }

    setTaxonomyLoading(prev => ({ ...prev, [normalizedPlatform]: true }));

    try {
      const token = await ensureSupabaseJwt();
      const url = `${API_BASE_URL}/api/taxonomy/${normalizedPlatform}/search?q=${encodeURIComponent(normalizedQuery)}&limit=25&preferLeaf=true`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        console.error('[ListingEditorForm] Taxonomy search failed:', res.status);
        setTaxonomyResults(prev => ({ ...prev, [normalizedPlatform]: [] }));
        return;
      }

      const data = await res.json();
      const options: TaxonomyOption[] = Array.isArray(data)
        ? data.map((item: any) => ({
          label: item.path || item.name || item.platformCategoryId,
          value: item.platformCategoryId,
          path: item.path,
          isLeaf: item.isLeaf,
          score: item.score,
        }))
        : [];

      setTaxonomyResults(prev => ({ ...prev, [normalizedPlatform]: options }));
    } catch (error) {
      console.error('[ListingEditorForm] Taxonomy search error:', error);
      setTaxonomyResults(prev => ({ ...prev, [normalizedPlatform]: [] }));
    } finally {
      setTaxonomyLoading(prev => ({ ...prev, [normalizedPlatform]: false }));
    }
  }, []);

  // NEW: Suggest taxonomy based on product data (Title + Description)
  const suggestTaxonomy = useCallback(async (autoApply: boolean = false) => {
    if (!supportsTaxonomy || !activePlatformKeyLower) return;
    if (activeTab === 'all') return; // Only work on specific platform tabs

    // Prevent redundant auto-fetches
    if (autoApply && preventTaxonomyAutoFetchRef.current.has(activePlatformKeyLower)) {
      return;
    }

    const query = activeData.title || '';
    if (!query || query.length < 3) return;

    console.log(`[Taxonomy] Auto-suggesting for ${activePlatformKeyLower} using title: "${query}"`);

    setTaxonomyLoading(prev => ({ ...prev, [activePlatformKeyLower]: true }));

    try {
      const token = await ensureSupabaseJwt();
      const safeQuery = query.trim();
      console.log(`[Taxonomy] Auto-suggesting for ${activePlatformKeyLower} using query: "${safeQuery}"`);

      const categorySuggestion = (activeData as any).categorySuggestion || activeData.categoryPath || activeData.productCategory || activeData.category;
      const productType = (activeData as any).productType;
      const rawSources = Array.isArray((platforms as any)?.sources)
        ? (platforms as any).sources
        : Array.isArray((platforms as any)?.canonical?.sources)
          ? (platforms as any).canonical.sources
          : undefined;
      const sources = Array.isArray(rawSources)
        ? rawSources.slice(0, 4).map((item: any) => {
          if (typeof item === 'string') {
            return { url: item };
          }
          return {
            title: item?.title || item?.name,
            snippet: item?.snippet || item?.description,
            url: item?.url || item?.link,
            source: item?.source || item?.domain,
          };
        })
        : undefined;
      const sourceUrls = sources?.map((s: any) => s?.url).filter((u: any) => typeof u === 'string');

      const url = `${API_BASE_URL}/api/taxonomy/${activePlatformKeyLower}/suggest`;
      const payload = {
        query: safeQuery,
        title: activeData.title,
        description: activeData.description,
        brand: (activeData as any).brand,
        tags: activeData.tags,
        sources,
        sourceUrls,
        categorySuggestion,
        productType,
        preferLeaf: true,
        limit: 15,
        useLlm: true,
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to fetch suggestions');

      const data = await res.json();
      const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
      const options: TaxonomyOption[] = candidates.map((item: any) => ({
        label: item.path || item.name || item.platformCategoryId,
        value: item.platformCategoryId,
        path: item.path,
        isLeaf: item.isLeaf,
        score: item.score,
      }));

      setTaxonomyResults(prev => ({ ...prev, [activePlatformKeyLower]: options }));

      // Mark as fetched so we don't loop
      if (autoApply) preventTaxonomyAutoFetchRef.current.add(activePlatformKeyLower);

      // Auto-Save the best match if confidence is high (e.g. first result from search usually best)
      if (autoApply && data?.suggested) {
        const best = data.suggested;
        console.log(`[Taxonomy] Auto-applying best match: ${best.path || best.name}`);

        // Only apply if we don't have one yet
        const currentId = activePlatformKeyLower === 'shopify' ? activeData.productCategoryId : activeData.categoryId;
        const bestScore = typeof data?.confidence === 'number' ? data.confidence : (typeof best.score === 'number' ? best.score : 0);
        const minAutoScore = 0.7;
        if (!currentId && bestScore >= minAutoScore) {
          const updates: any = {};
          if (activePlatformKeyLower === 'shopify') {
            updates.productCategoryId = best.platformCategoryId || best.value;
            updates.productCategory = best.path || best.name;
            updates.categoryPath = best.path || best.name;
          } else {
            updates.categoryId = best.platformCategoryId || best.value;
            updates.category = best.path || best.name;
            updates.categoryPath = best.path || best.name;
          }
          updates.taxonomyConfidence = bestScore;
          updates.taxonomySource = data?.method || 'llm'; // Mark as AI/Auto source

          patchPlatform(prev => ({ ...prev, ...updates }));
        } else if (!currentId) {
          console.log(`[Taxonomy] Auto-apply skipped (score ${bestScore} < ${minAutoScore}).`);
        }
      }

    } catch (e) {
      console.error('[Taxonomy] Suggestion error:', e);
    } finally {
      setTaxonomyLoading(prev => ({ ...prev, [activePlatformKeyLower]: false }));
    }
  }, [activePlatformKeyLower, activeData.title, supportsTaxonomy, activeTab, platforms]); // Depend on platforms to get fresh data in patchPlatform callback context? No, patchPlatform uses ref or closure. But activeData updates.

  // Effect: Auto-suggest on mount or platform switch if missing
  useEffect(() => {
    if (!supportsTaxonomy) return;

    const platformKey = activePlatformKeyLower;
    // Debounce checks slightly
    const timer = setTimeout(() => {
      const currentId = platformKey === 'shopify' ? activeData.productCategoryId : activeData.categoryId;

      const confidence = typeof activeData.taxonomyConfidence === 'number' ? activeData.taxonomyConfidence : 0;
      if (!currentId && confidence < 0.8 && !preventTaxonomyAutoFetchRef.current.has(platformKey) && activeData.title) {
        suggestTaxonomy(true);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [supportsTaxonomy, activePlatformKeyLower, activeData.title, activeData.categoryId, activeData.productCategoryId]); // Re-run when these change

  useEffect(() => {
    if (!supportsTaxonomy) return;
    if (!activePlatformKeyLower) return;
    const platformKey = activePlatformKeyLower;

    // Only run SEARCH if user deliberately typed something (query is not empty/cleared)
    // If query is empty, we don't want to clear the "Suggested" results we might have got from auto-suggest.
    if (!activeTaxonomyQuery) return;

    if (taxonomySearchTimeoutRef.current[platformKey]) {
      clearTimeout(taxonomySearchTimeoutRef.current[platformKey]);
    }

    taxonomySearchTimeoutRef.current[platformKey] = setTimeout(() => {
      fetchTaxonomyOptions(platformKey, activeTaxonomyQuery);
    }, 350);

    return () => {
      if (taxonomySearchTimeoutRef.current[platformKey]) {
        clearTimeout(taxonomySearchTimeoutRef.current[platformKey]);
      }
    };
  }, [supportsTaxonomy, activePlatformKeyLower, activeTaxonomyQuery, fetchTaxonomyOptions]);

  // Fetch eBay aspects (Item Specifics) when category selected
  const fetchAspects = useCallback(async (categoryId: string) => {
    if (!categoryId || activePlatformKeyLower !== 'ebay') return;
    setAspectsLoading(true);
    try {
      const token = await ensureSupabaseJwt();
      const url = `${API_BASE_URL}/api/taxonomy/ebay/${encodeURIComponent(categoryId)}/aspects`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to fetch aspects');
      const data = await res.json();
      setAspects(Array.isArray(data) ? data : (data?.aspects || []));
    } catch (e) {
      console.error('[ListingEditorForm] Aspects fetch error:', e);
      setAspects([]);
    } finally {
      setAspectsLoading(false);
    }
  }, [activePlatformKeyLower]);

  // Fetch eBay conditions when eBay + category selected
  const fetchEbayConditions = useCallback(async (categoryId: string | undefined) => {
    if (activePlatformKeyLower !== 'ebay') return;
    setEbayConditionsLoading(true);
    try {
      const token = await ensureSupabaseJwt();
      const q = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : '';
      const url = `${API_BASE_URL}/api/ebay/conditions${q}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to fetch conditions');
      const data = await res.json();
      const conditions = data?.conditions || [];
      setEbayConditions(conditions);
    } catch (e) {
      console.error('[ListingEditorForm] eBay conditions fetch error:', e);
      setEbayConditions([]);
    } finally {
      setEbayConditionsLoading(false);
    }
  }, [activePlatformKeyLower]);

  useEffect(() => {
    if (activePlatformKeyLower !== 'ebay') return;
    const catId = activeData.categoryId;
    fetchEbayConditions(catId);
  }, [activePlatformKeyLower, activeData.categoryId, fetchEbayConditions]);

  useEffect(() => {
    if (activePlatformKeyLower !== 'ebay') return;
    const catId = activeData.categoryId;
    if (catId) fetchAspects(catId);
    else setAspects([]);
  }, [activePlatformKeyLower, activeData.categoryId, fetchAspects]);

  const fetchPricingResearch = useCallback(async () => {
    const input = pricingResearchInput;
    if (!input?.title) return;
    setPricingResearchLoading(true);
    setPricingResearchResult(null);
    try {
      const token = await ensureSupabaseJwt();
      const res = await fetch(`${API_BASE_URL}/api/ebay/pricing-research`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: input.title,
          categoryId: input.categoryId || undefined,
          condition: input.condition || undefined,
          limit: 20,
        }),
      });
      const data = await res.json();
      setPricingResearchResult(data);
      setPricingResearchModalVisible(true);
    } catch (e) {
      console.error('[ListingEditorForm] Pricing research error:', e);
      setPricingResearchResult({ error: (e as Error)?.message || 'Failed to research pricing' });
      setPricingResearchModalVisible(true);
    } finally {
      setPricingResearchLoading(false);
    }
  }, [pricingResearchInput]);

  const fetchShippingEstimate = useCallback(
    async (override?: { weight: string; weightUnit: string; estimatedDimensions?: { length: number; width: number; height: number } }) => {
      const weightVal = override ? parseFloat(override.weight) : (typeof activeData.weight === 'number' ? activeData.weight : parseFloat(String(activeData.weight ?? '')));
      const num = weightVal;
      if (!Number.isFinite(num) || num <= 0) {
        setShippingEstimateResult(null);
        return;
      }
      setShippingEstimateLoading(true);
      setShippingEstimateResult(null);
      try {
        const token = await ensureSupabaseJwt();
        const dims = override?.estimatedDimensions ?? (activeData as any).estimatedDimensions;
        const weightUnit = override?.weightUnit ?? (activeData.weightUnit || 'lb');
        const params = new URLSearchParams({
          weight: override ? override.weight : String(num),
          weightUnit,
        });
        if (dims?.length != null) params.set('length', String(dims.length));
        if (dims?.width != null) params.set('width', String(dims.width));
        if (dims?.height != null) params.set('height', String(dims.height));
        const res = await fetch(`${API_BASE_URL}/api/shipping/estimate?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.error && !data.estimatedMin) {
          setShippingEstimateResult({ estimatedMin: 0, estimatedMax: 0, midpoint: 0, error: data.error });
        } else if (typeof data.estimatedMin === 'number') {
          setShippingEstimateResult({
            estimatedMin: data.estimatedMin,
            estimatedMax: data.estimatedMax ?? data.estimatedMin,
            midpoint: data.midpoint ?? ((data.estimatedMin + (data.estimatedMax ?? data.estimatedMin)) / 2),
            description: data.description,
            lowZoneCost: data.lowZoneCost,
            midZoneCost: data.midZoneCost,
            highZoneCost: data.highZoneCost,
            expectedCost: data.expectedCost,
          });
        } else {
          setShippingEstimateResult(null);
        }
      } catch (e) {
        setShippingEstimateResult(null);
      } finally {
        setShippingEstimateLoading(false);
      }
    },
    [activeData.weight, activeData.weightUnit, (activeData as any).estimatedDimensions],
  );

  useEffect(() => {
    if (shippingEstimateDebounceRef.current) clearTimeout(shippingEstimateDebounceRef.current);
    const w = activeData.weight;
    const num = typeof w === 'number' ? w : parseFloat(String(w ?? ''));
    if (!Number.isFinite(num) || num <= 0) {
      setShippingEstimateResult(null);
      return;
    }
    shippingEstimateDebounceRef.current = setTimeout(() => {
      fetchShippingEstimate();
    }, 500);
    return () => {
      if (shippingEstimateDebounceRef.current) clearTimeout(shippingEstimateDebounceRef.current);
    };
  }, [activeData.weight, activeData.weightUnit, (activeData as any).estimatedDimensions, fetchShippingEstimate]);

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
      const variants = platformData?.variants || [];

      for (const loc of locs) {
        // Use COMPOSITE KEY: platformKey:locId to match the render lookup
        const compositeKey = `${platformKey}:${loc.id}`;

        // Sum quantities from ALL variants' inventoryByLocation for this location
        // This ensures consistency with the platform-specific tab view
        let totalQty = 0;
        for (const variant of variants) {
          const invAtLoc = variant.inventoryByLocation?.[loc.id];
          if (invAtLoc) {
            totalQty += invAtLoc.quantity || 0;
          }
        }

        // Fallback to locationQuantities if no variant data (backward compat)
        if (totalQty === 0 && platformData?.locationQuantities?.[loc.id]) {
          totalQty = platformData.locationQuantities[loc.id];
        }

        agg[compositeKey] = { platformKey, quantity: totalQty };
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
    shopify: ['title', 'sku', 'price', 'category'],
    square: ['title', 'sku', 'price'],
    amazon: ['title', 'sku', 'price'],
    ebay: ['title', 'price', 'category'],
    facebook: ['title', 'price'],
    clover: ['name', 'price'],
  }), []);
  const requiredFields = requiredByPlatform[activePlatformKey] || ['title', 'sku', 'price'];
  const ignoredForPublish = isPlatformIgnored?.(activePlatformKey) ?? false;
  const taxonomyOptions = taxonomyResults[activePlatformKeyLower] || [];
  const selectedCategoryId = activePlatformKeyLower === 'shopify'
    ? (activeData.productCategoryId || activeData.categoryId)
    : activeData.categoryId;
  const selectedCategoryPathRaw = activeData.categoryPath || activeData.productCategory || activeData.category;
  const selectedCategoryPath = selectedCategoryPathRaw?.replace(/^Root\s*[>›]\s*/i, '');
  const selectedCategoryLabel = selectedCategoryPath || selectedCategoryId;
  const selectedCategoryOption = selectedCategoryId
    ? { label: selectedCategoryLabel, value: selectedCategoryId, path: selectedCategoryPath }
    : null;
  const taxonomyDropdownData = selectedCategoryOption
    ? [selectedCategoryOption, ...taxonomyOptions.filter(opt => opt.value !== selectedCategoryOption.value)]
    : taxonomyOptions;
  const categoryRequired = requiredFields?.includes?.('category');
  const categoryMissing = categoryRequired && !selectedCategoryId;

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

  const collapseSingleLocationLocs = useCallback(
    <T extends { id: string; locationId?: string }>(platformKey: string, locs: T[]): T[] => {
      const key = platformKey.toLowerCase();
      if (!SINGLE_LOCATION_PLATFORMS.has(key) || locs.length <= 1) return locs;

      const platformData = platforms[key] as PlatformState | undefined;
      const usedLocIds = new Set<string>();

      if (platformData?.variants?.length) {
        platformData.variants.forEach(v => {
          Object.keys(v.inventoryByLocation || {}).forEach(id => usedLocIds.add(id));
        });
      }

      if (platformData?.locationQuantities) {
        Object.keys(platformData.locationQuantities).forEach(id => usedLocIds.add(id));
      }

      const pickPreferred = (list: T[]) => {
        const nonDefault = list.find(l => {
          const rawId = l.locationId || l.id;
          return rawId !== 'default' && !rawId.startsWith('default-');
        });
        return nonDefault || list[0];
      };

      if (usedLocIds.size > 0) {
        const matching = locs.filter(l => usedLocIds.has(l.locationId || l.id));
        if (matching.length > 0) {
          return [pickPreferred(matching)];
        }
      }

      return [pickPreferred(locs)];
    },
    [platforms]
  );

  const buildAllTabLocationId = useCallback(
    (loc: { platformKey: string; connectionId?: string; locationId: string }) =>
      `${loc.platformKey}::${loc.connectionId || 'unknown'}::${loc.locationId}`,
    []
  );

  // Get locations for the active platform - ALWAYS use platformLocations first (properly separated per-platform)
  const locations = useMemo(() => {
    const platformKey = activePlatformKey.toLowerCase();

    // FIRST: Try platformLocations prop which is correctly structured per-platform
    const platformLocsRaw = platformLocations?.[platformKey] || [];
    const platformLocs = collapseSingleLocationLocs(platformKey, platformLocsRaw);

    console.log(`[ListingEditorForm LOCS] platform=${platformKey}, platformLocsKeys=${Object.keys(platformLocations || {}).join(',')}, count=${platformLocs.length}`);

    if (platformLocs.length > 0) {
      return platformLocs.map((loc: any) => ({
        id: loc.id,
        locationId: loc.locationId || loc.id,
        name: loc.name || 'Unknown Location',
        platformType: loc.platformType || platformKey,
        connectionId: loc.connectionId,
        connectionName: loc.connectionName
      }));
    }

    // FALLBACK: Only use activeData.locations if platformLocations is empty
    // But FILTER by platform ID pattern to avoid pollution
    if (activeData.locations && activeData.locations.length > 0) {
      const filtered = activeData.locations.filter((loc: any) => {
        // Shopify IDs start with 'gid://shopify/'
        // Square IDs are short alphanumeric like 'LY3ETP80S0CFK'
        if (platformKey === 'shopify') {
          return loc.id?.startsWith('gid://shopify/');
        } else if (platformKey === 'square') {
          return !loc.id?.startsWith('gid://');
        }
        // For other platforms, include all
        return true;
      });

      const collapsed = collapseSingleLocationLocs(platformKey, filtered);
      if (collapsed.length > 0) {
        console.log(`[ListingEditorForm LOCS] Filtered ${activeData.locations.length} → ${collapsed.length} for ${platformKey}`);
        return collapsed.map((loc: any) => ({
          ...loc,
          locationId: loc.locationId || loc.id,
          platformType: loc.platformType || platformKey,
          connectionId: loc.connectionId,
          connectionName: loc.connectionName
        }));
      }
    }

    // Fallback to dummy data if no locations available
    return [{
      id: 'loc-default',
      locationId: 'loc-default',
      name: `${platformKey.charAt(0).toUpperCase() + platformKey.slice(1)} Default`,
      platformType: platformKey
    }];
  }, [activeData.locations, activePlatformKey, platformLocations, collapseSingleLocationLocs]);
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

    // CRITICAL: ALWAYS sync variants to ALL platforms when options change
    // This ensures consistency - user edits on any tab apply everywhere
    const platformsToUpdate = platformKeys;
    console.log('[recomputeVariants] Updating ALL platforms:', platformsToUpdate);

    // Build updated platforms object
    const updatedPlatforms = { ...platforms };

    for (const platformKey of platformsToUpdate) {
      const platformData = (platforms[platformKey] || {}) as PlatformState;
      const rawPlatformLocs = platformData.locations || platformLocations?.[platformKey.toLowerCase()] || [];
      const platformLocs = collapseSingleLocationLocs(platformKey, rawPlatformLocs);

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
          // INHERIT from locationQuantities if transitioning from non-variant product
          const baseQuantities = platformData.locationQuantities || {};
          const inventoryByLocation: Record<string, { quantity: number; price?: number; image?: string; connectionId?: string }> = {};

          // Initialize for default location (used by VARIANT_WITH_OPTIONS)
          // Inherit quantity from non-variant data if available
          inventoryByLocation['default'] = {
            quantity: baseQuantities['default'] ?? 0,
            price: platformData.price || activeData.price || 0,
          };

          // Also initialize for all known locations (used by LOCATION_VARIANT_WITH_OPTIONS)
          // Inherit quantities from non-variant data if available
          (platformLocs as Array<{ id: string }>).forEach(loc => {
            inventoryByLocation[loc.id] = {
              quantity: baseQuantities[loc.id] ?? 0,
              price: platformData.price || activeData.price || 0,
              connectionId: (loc as any).connectionId,
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
      // FIX: Always sync options to ensure consistency across platforms
      // Previously this only synced when activeTab === 'all', causing variants to not appear on eBay/Facebook tabs
      updatedPlatforms[platformKey] = {
        ...platformData,
        variants: nextVariants,
        options: opts
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
    const inventoryByLocation: Record<string, { quantity: number; price?: number; image?: string; connectionId?: string }> = {};
    inventoryByLocation['default'] = { quantity: 0, price: activeData.price || 0 };
    locations.forEach(loc => {
      inventoryByLocation[loc.id] = { quantity: 0, price: activeData.price || 0, connectionId: (loc as any).connectionId };
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
    patchPlatform(prev => {
      const next: PlatformState = {
        ...prev,
        locationQuantities: { ...(prev.locationQuantities || {}), [locId]: qty }
      };

      // 🔧 Flat product fix: keep variant inventoryByLocation in sync
      if (Array.isArray(prev.variants) && prev.variants.length > 0) {
        next.variants = prev.variants.map((v: any) => {
          const hasOptions = v.optionValues && Object.keys(v.optionValues).length > 0;
          if (hasOptions) return v;

          const inv = { ...(v.inventoryByLocation || {}) };
          const existing = inv[locId] || {};
          inv[locId] = {
            ...existing,
            quantity: qty,
            price: existing.price ?? v.price ?? prev.price
          };

          return { ...v, inventoryByLocation: inv };
        });
      }

      return next;
    });
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
  const addPlatform = async (platformKey: string, shouldGenerate: boolean = false) => {
    if (!platformKey) return;
    platformKey = platformKey.toLowerCase().trim();
    if (platformKeys.includes(platformKey)) return;

    if (shouldGenerate && onGeneratePlatform) {
      // Start generation process
      setGeneratingPlatforms(prev => new Set([...prev, platformKey]));

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
      setActiveTab(platformKey);
      setTimeout(recomputeVariants, 0);
    }
  };

  const handleStartConnectPlatform = useCallback((platform: string) => {
    platformPickerOverlay.hide();
    if (platform === 'csv') return;
    addPlatform(platform, true);
  }, [addPlatform, platformPickerOverlay.hide]);

  const handleStartConnectRef = useRef(handleStartConnectPlatform);
  handleStartConnectRef.current = handleStartConnectPlatform;

  useEffect(() => {
    if (!isFocused) return;
    const stableHandler = (platform: string) => handleStartConnectRef.current(platform);
    platformPickerOverlay.enableForScreen(stableHandler);
    return () => {
      platformPickerOverlay.disableForScreen();
    };
  }, [isFocused, platformPickerOverlay.enableForScreen, platformPickerOverlay.disableForScreen]);

  const removePlatform = (platformKey: string) => {
    if (!platformKey) return;
    const next = { ...platforms } as PlatformsData;
    delete (next as any)[platformKey];
    onChangePlatforms(next);
    if (activeTab === platformKey) setActiveTab('all');
  };

  const insets = useSafeAreaInsets();
  const bottomSafePadding = isGenerationMode ? ACTION_BAR_HEIGHT + ACTION_BAR_BOTTOM_OFFSET + insets.bottom + 16 : 20;

  return (
    <View style={{ paddingBottom: bottomSafePadding }}>
      {/* Media with Remove & Add Photo Management */}
      <View style={styles.mediaRow}>
        <ScrollView style={{ paddingVertical: 10 }} horizontal={true} showsHorizontalScrollIndicator={false}>
          {/* Images first - Cover (index 0) appears on left */}
          {/* Filter out empty/invalid URLs to prevent gray placeholder images */}
          {(images || []).filter((uri): uri is string => typeof uri === 'string' && uri.trim().length > 0).map((uri, i) => (
            <View key={`${uri}-${i}`} style={{ position: 'relative', marginRight: 8 }}>
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

          {/* Pending uploads (optimistic UI) */}
          {(pendingImages || []).filter((uri): uri is string => typeof uri === 'string' && uri.trim().length > 0).map((uri, i) => (
            <View key={`pending-${i}`} style={[styles.thumbWrap, { opacity: 0.6 }]}>
              <Image source={{ uri }} style={styles.thumb} />
              <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12 }]}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            </View>
          ))}

          {/* Single Add Photo button on the right (only show if under max photos) */}
          {(images?.length || 0) < 6 && (
            <TouchableOpacity
              style={[styles.thumbWrap, { backgroundColor: '#F3F4F6', borderStyle: 'dashed', borderColor: '#D1D5DB', borderWidth: 1 }]}
              onPress={() => onOpenImageCapture?.((uris) => {
                if (uris && uris.length > 0) {
                  onChangeImages?.([...(images || []), ...uris]);
                }
              })}
            >
              <View style={{ alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                <Icon name="plus" size={24} color="#9CA3AF" />
                <Text style={{ fontSize: 10, color: '#6B7280', marginTop: 4, fontWeight: '600' }}>Add Photo</Text>
              </View>
            </TouchableOpacity>
          )}
        </ScrollView>
        <Text style={styles.mediaHint}>Tap an image to set it as the cover</Text>
      </View>

      {/* Platform filter pills */}
      <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8 }}>
        {pills.map((key) => {
          if (key === 'all') {
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setActiveTab(key)}
                style={[styles.pill, activeTab === key && styles.pillActive]}
              >
                <Text style={[styles.pillText, activeTab === key && styles.pillTextActive]}>All</Text>
              </TouchableOpacity>
            );
          }
          
          const isReady = isPlatformReady((platforms as any)?.[key] || {}, key, []);
          const missingCount = getMissingFieldsCount ? getMissingFieldsCount(key) : 0;
          
          return (
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
              style={[
                styles.pill, 
                activeTab === key && styles.pillActive, 
                generatingPlatforms.has(key) && styles.pillGenerating, 
                { flexDirection: 'row', alignItems: 'center', gap: 6 }
              ]}
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
              
              {/* Readiness Indicator */}
              {!generatingPlatforms.has(key) && (
                isReady ? (
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', marginLeft: 2 }}>
                    <Icon name="check" size={10} color="#93C822" />
                  </View>
                ) : missingCount > 0 ? (
                  <View style={{ height: 16, minWidth: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center', marginLeft: 2 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#ef4444' }}>{missingCount}</Text>
                  </View>
                ) : null
              )}
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={styles.pillDashed} onPress={() => platformPickerOverlay.show()}>
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
      {/* Core fields (optimized for conversion) */}
      <View style={{ paddingTop: 18, gap: 9 }}>
        <View onLayout={recordFieldLayout('title')} style={highlightedField === 'title' ? { borderRadius: 8, borderWidth: 2, borderColor: '#ef4444', backgroundColor: '#FEF2F2', padding: 2 } : undefined}>
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
            externalUpdate={hasExternalUpdate('title')}
          />
        </View>

        <Field
          label="Description"
          value={activeData.description}
          multiline
          onChangeText={(t) => patchField('description', t)}
          onInfo={() => onOpenFieldPanel?.('description')}
          onRegenerate={enableAIRefill && activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'description') : undefined}
          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('description')}
          externalUpdate={hasExternalUpdate('description')}
        />

        <ChipsField
          label="Tags"
          valueArray={activeData.tags}
          onChangeArray={(arr) => patchField('tags', arr)}
          onInfo={() => onOpenFieldPanel?.('tags')}
          onRegenerate={enableAIRefill && activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'tags') : undefined}
          refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('tags')}
        />

        {supportsTaxonomy && (
          <View style={{ marginBottom: 12 }} onLayout={recordFieldLayout('category')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.fieldLabel}>Category{categoryRequired ? <Text style={{ color: '#ef4444' }}> *</Text> : null}</Text>
                {typeof activeData.taxonomyConfidence === 'number' && activeData.taxonomyConfidence >= 0.5 && (
                  <View style={{ backgroundColor: activeData.taxonomyConfidence > 0.8 ? 'rgba(147, 200, 34, 0.12)' : 'rgba(234, 179, 8, 0.12)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: activeData.taxonomyConfidence > 0.8 ? '#93C822' : '#ca8a04', fontSize: 10, fontWeight: '600' }}>
                      {['llm', 'groq', 'tree', 'rerank'].includes(activeData.taxonomySource || '') ? '✨ AI Match' : 'Suggested'} {Math.round(activeData.taxonomyConfidence * 100)}%
                    </Text>
                  </View>
                )}
              </View>

              {!activeData.category && (
                <TouchableOpacity
                  onPress={() => suggestTaxonomy(true)}
                  disabled={taxonomyLoading[activePlatformKeyLower]}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  {taxonomyLoading[activePlatformKeyLower] ? (
                    <ActivityIndicator size="small" color="#93C822" />
                  ) : (
                    <Sparkles size={14} color="#93C822" />
                  )}
                  <Text style={{ color: '#93C822', fontSize: 13, fontWeight: '600' }}>
                    {taxonomyLoading[activePlatformKeyLower] ? 'Finding...' : 'Auto-Find'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <AppDropdown
              style={[styles.input, { height: 50, paddingHorizontal: 12, borderColor: categoryMissing ? '#ef4444' : '#E5E7EB', borderWidth: 1 }]}
              data={taxonomyDropdownData.slice(0, 12)}
              maxHeight={280}
              value={selectedCategoryId}
              placeholder={`Search ${activePlatformKeyLower === 'shopify' ? 'Shopify' : 'eBay'} categories`}
              search
              searchPlaceholder="Type to search..."
              onChangeText={(text: string) => {
                setTaxonomyQueries(prev => ({ ...prev, [activePlatformKeyLower]: text }));
              }}
              renderItem={(item: TaxonomyOption) => (
                <View style={{ paddingVertical: 10, paddingHorizontal: 0, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#1F2937' }}>{(item.label || '').replace(/^Root\s*[>›]\s*/i, '')}</Text>
                    {item.score && item.score > 0.8 && (
                      <View style={{ backgroundColor: '#DCFCE7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                        <Text style={{ color: '#166534', fontSize: 10, fontWeight: '700' }}>BEST MATCH</Text>
                      </View>
                    )}
                  </View>
                  {item.path && item.path !== item.label && (
                    <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{item.path.replace(/^Root\s*[>›]\s*/i, '').replace(/ > /g, ' › ')}</Text>
                  )}
                </View>
              )}
              onChange={(item: any) => {
                const path = item.path || item.label || item.value;
                if (activePlatformKeyLower === 'shopify') {
                  patchPlatform(prev => ({
                    ...prev,
                    productCategoryId: item.value,
                    productCategory: path,
                    categoryPath: path,
                    taxonomyConfidence: item.score || 1.0, // Manual selection = 100% or source score
                    taxonomySource: 'manual'
                  }));
                } else {
                  patchPlatform(prev => ({
                    ...prev,
                    categoryId: item.value,
                    category: path,
                    categoryPath: path,
                    taxonomyConfidence: item.score || 1.0,
                    taxonomySource: 'manual'
                  }));
                }
              }}
            />

            {taxonomyLoading[activePlatformKeyLower] && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
                <ActivityIndicator size="small" color="#9CA3AF" />
                <Text style={{ fontSize: 12, color: '#6B7280' }}>Analyzing product to find best category...</Text>
              </View>
            )}

            {!taxonomyLoading[activePlatformKeyLower] && !selectedCategoryId && taxonomyDropdownData.length > 0 && (
              <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="information-outline" size={14} color="#6B7280" />
                <Text style={{ fontSize: 12, color: '#6B7280' }}>
                  Use the search or tap "Auto-Find" to detect category.
                </Text>
              </View>
            )}

            {/* Selected category indicator removed - the dropdown already shows the current selection */}

            {/* eBay Item Specifics - when category selected */}
            {activePlatformKeyLower === 'ebay' && selectedCategoryId && (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.fieldLabel}>Item Specifics</Text>
                {aspectsLoading ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 }}>
                    <ActivityIndicator size="small" color="#9CA3AF" />
                    <Text style={{ fontSize: 12, color: '#6B7280' }}>Loading required fields...</Text>
                  </View>
                ) : aspects.length > 0 ? (
                  <View style={{ gap: 12 }}>
                    {aspects.filter(a => a.isRequired).map((asp) => (
                      <View key={asp.aspectName}>
                        <Text style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>{asp.aspectName} *</Text>
                        {asp.allowedValues?.length > 0 ? (
                          <AppDropdown
                            style={[styles.input, { height: 44, paddingHorizontal: 10 }]}
                            data={asp.allowedValues.map(v => ({ label: v, value: v }))}
                            placeholder={`Select ${asp.aspectName}...`}
                            value={(activeData.itemSpecifics || {})[asp.aspectName]}
                            onChange={(item) => patchPlatform(prev => ({
                              ...prev,
                              itemSpecifics: { ...(prev.itemSpecifics || {}), [asp.aspectName]: item.value },
                            }))}
                          />
                        ) : (
                          <TextInput
                            style={[styles.input, { height: 44 }]}
                            placeholder={`Enter ${asp.aspectName}...`}
                            value={(activeData.itemSpecifics || {})[asp.aspectName] || ''}
                            onChangeText={(t) => patchPlatform(prev => ({
                              ...prev,
                              itemSpecifics: { ...(prev.itemSpecifics || {}), [asp.aspectName]: t },
                            }))}
                          />
                        )}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            )}
          </View>
        )}

        {/* AI Price with Confidence Bands - 3 pills: low (fast sale), recommended, high (max profit) */}
        {(() => {
          const apr = (activeData as any).aiPriceRecommendation;
          const legacy = (activeData as any).aiRecommendedPrice;
          const band = apr && typeof apr.low === 'number' && typeof apr.recommended === 'number' && typeof apr.high === 'number'
            ? { low: apr.low, recommended: apr.recommended, high: apr.high }
            : (typeof legacy === 'number' && legacy > 0
              ? { low: Math.round(legacy * 0.85 * 100) / 100, recommended: legacy, high: Math.round(legacy * 1.15 * 100) / 100 }
              : null);
          const currentPrice = Number((activeData as any).price) || 0;
          if (!band || band.recommended <= 0) return null;

          const applyPrice = (p: number) => {
            patchField('price', String(p.toFixed(2)));
          };

          const pillStyle = (isSelected: boolean) => ({
            flex: 1,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: isSelected ? '#93C822' : '#E5E7EB',
            backgroundColor: isSelected ? '#F0FFF4' : '#FFF',
            alignItems: 'center' as const,
          });

          return (
            <View style={{ backgroundColor: '#F0FFF4', borderRadius: 8, padding: 10, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#93C822' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Sparkles size={16} color="#93C822" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#3f6212' }}>Suggested Price</Text>
                  <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                    ${band.low.toFixed(0)} – ${band.high.toFixed(0)} (recommended ${band.recommended.toFixed(0)})
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={pillStyle(Math.abs(currentPrice - band.low) < 0.02)} onPress={() => applyPrice(band.low)}>
                  <Text style={{ fontSize: 10, color: '#6B7280', marginBottom: 2 }}>Fast sale</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1F2937' }}>${band.low.toFixed(2)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={pillStyle(Math.abs(currentPrice - band.recommended) < 0.02)} onPress={() => applyPrice(band.recommended)}>
                  <Text style={{ fontSize: 10, color: '#6B7280', marginBottom: 2 }}>Recommended</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1F2937' }}>${band.recommended.toFixed(2)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={pillStyle(Math.abs(currentPrice - band.high) < 0.02)} onPress={() => applyPrice(band.high)}>
                  <Text style={{ fontSize: 10, color: '#6B7280', marginBottom: 2 }}>Max profit</Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#1F2937' }}>${band.high.toFixed(2)}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })()}

        {/* Price field - custom row so Research Pricing sits on same line as label + (i) */}
        {(() => {
          const hasVariantsWithOptions = (activeData.options || []).length > 0 && (activeData.variants || []).length > 0;
          const allVariantsHavePrice = hasVariantsWithOptions && (activeData.variants || []).every((v: any) =>
            v.price != null && v.price !== '' && Number(v.price) > 0
          );
          const priceRequired = requiredFields?.includes?.('price') && !allVariantsHavePrice;
          const priceError = priceRequired && ((activeData as any).price == null || String((activeData as any).price) === '' || Number((activeData as any).price) === 0);
          const priceLabel = hasVariantsWithOptions ? 'Base Price (optional with variants)' : 'Price';
          const showResearchPricing = !!titleForPricingResearch;

          return (
            <View style={{ marginBottom: 12 }} onLayout={recordFieldLayout('price (either flat or all variants)')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 0 }}>
                  <Text style={styles.fieldLabel}>{priceLabel}{priceRequired ? <Text style={{ color: '#ef4444' }}> *</Text> : null}</Text>
                  {hasExternalUpdate('price') ? (
                    <View style={{ backgroundColor: 'rgba(52,199,89,0.15)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ color: '#059669', fontSize: 10, fontWeight: '600' }}>Updated</Text>
                    </View>
                  ) : Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('price') ? (
                    <View style={{ backgroundColor: 'rgba(147,200,34,0.12)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ color: '#3f6212', fontSize: 10 }}>Refilled</Text>
                    </View>
                  ) : null}
                  {enableAIRefill && activeTab !== 'all' && (
                    <TouchableOpacity onPress={() => onRegenerateField?.(activePlatformKey, 'price')} style={{ borderWidth: 1, borderColor: '#E5E5E5', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#fff' }}>
                      <Sparkles size={14} color={'#000'} />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {showResearchPricing && (
                    <TouchableOpacity onPress={fetchPricingResearch} disabled={pricingResearchLoading} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      {pricingResearchLoading ? <ActivityIndicator size="small" color="#93C822" /> : <Package size={14} color="#93C822" />}
                      <Text style={{ color: '#93C822', fontSize: 13, fontWeight: '600' }}>{pricingResearchLoading ? 'Researching...' : 'Research Pricing'}</Text>
                    </TouchableOpacity>
                  )}
                  {onOpenFieldPanel && (
                    <TouchableOpacity onPress={() => onOpenFieldPanel('price')}><Icon name="information-outline" size={18} color="#999999" /></TouchableOpacity>
                  )}
                </View>
              </View>
              <TextInput
                style={[
                  styles.input,
                  priceError ? { borderColor: '#ef4444' } : null,
                  hasExternalUpdate('price') ? { borderColor: '#93C822', borderWidth: 2 } : null,
                  highlightedField === 'price (either flat or all variants)' ? { borderColor: '#ef4444', borderWidth: 2, backgroundColor: '#FEF2F2' } : null
                ]}
                value={String((activeData as any).price ?? '')}
                onChangeText={(t) => patchField('price', t)}
                placeholder=""
                placeholderTextColor="#999999"
                keyboardType="decimal-pad"
              />
            </View>
          );
        })()}

        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', alignItems: 'flex-end', }}>
          <View style={{ flex: 1 }}>
            <Field label="Shipping Weight" value={String(activeData.weight ?? '')} onChangeText={(t) => patchField('weight', t)} onInfo={() => onOpenFieldPanel?.('weight')} />
          </View>
          <View style={{ width: 140, marginBottom: 12 }}>
            <AppDropdown
              style={[styles.input, { height: 50, paddingHorizontal: 12 }]}
              data={["oz", "lb", "g", "kg"].map(u => ({ label: u, value: u }))}
              placeholder="oz"
              value={activeData.weightUnit || 'oz'}
              onChange={(item) => patchField('weightUnit', item.value)}
            />
          </View>
        </View>

        <View onLayout={recordFieldLayout('sku')} style={highlightedField === 'sku' ? { borderRadius: 8, borderWidth: 2, borderColor: '#ef4444', backgroundColor: '#FEF2F2', padding: 2 } : undefined}>
          <Field
            label="SKU"
            required
            value={activeData.sku}
            onChangeText={(t) => patchField('sku', t)}
            onInfo={() => onOpenFieldPanel?.('sku')}
            onRegenerate={enableAIRefill && activeTab !== 'all' ? () => onRegenerateField?.(activePlatformKey, 'sku') : undefined}
            refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes('sku')}
            error={requiredFields?.includes?.('sku') && !activeData.sku}
            externalUpdate={hasExternalUpdate('sku')}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Barcode" value={activeData.barcode} onChangeText={(t) => patchField('barcode', t)} onInfo={() => onOpenFieldPanel?.('barcode')} externalUpdate={hasExternalUpdate('barcode')} />
          </View>
          <TouchableOpacity style={[styles.scanBtn, {}]} onPress={() => { (onOpenBarcodeScanner || (() => { }))((code: string) => patchField('barcode', code)); }}>
            <Icon name="qrcode-scan" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Condition - eBay uses category-specific conditions; others use generic */}
        <View style={{ marginBottom: 16 }}>
          <Text style={styles.fieldLabel}>Condition</Text>
          {activePlatformKeyLower === 'ebay' && ebayConditions.length > 0 ? (
            <AppDropdown
              style={[styles.modernInputWrapper, { paddingHorizontal: 12, height: 48, borderWidth: 1 }]}
              data={ebayConditionsLoading ? [] : ebayConditions.map(c => ({ label: c.conditionName, value: c.conditionId }))}
              placeholder={ebayConditionsLoading ? "Loading conditions..." : "Select condition..."}
              value={activeData.conditionID ? String(activeData.conditionID) : (ebayConditions[0]?.conditionId ?? '')}
              onChange={(item) => {
                const condId = parseInt(item.value, 10);
                const generic = mapEbayConditionIdToGeneric(item.value) as PlatformState['condition'];
                patchPlatform(prev => ({
                  ...prev,
                  conditionID: Number.isFinite(condId) ? condId : undefined,
                  condition: generic,
                }));
              }}
            />
          ) : (
            <AppDropdown
              style={[styles.modernInputWrapper, { paddingHorizontal: 12, height: 48, borderWidth: 1 }]}
              data={[
                { label: 'New', value: 'new' },
                { label: 'Like New', value: 'like_new' },
                { label: 'Good', value: 'good' },
                { label: 'Fair', value: 'fair' },
                { label: 'Used', value: 'used' },
                { label: 'Refurbished', value: 'refurbished' },
                { label: 'For Parts', value: 'for_parts' },
              ]}
              placeholder="Select condition..."
              value={activeData.condition || 'good'}
              onChange={item => patchField('condition', item.value)}
            />
          )}
        </View>

      </View>

      {/* Pricing Research Modal - stocks-style with chart, sources, accuracy */}
      <Modal visible={pricingResearchModalVisible} transparent animationType="slide">
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={() => setPricingResearchModalVisible(false)}>
          <Pressable style={{ backgroundColor: '#F2F2F7', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '90%' }} onPress={e => e.stopPropagation()}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2937' }}>Pricing research</Text>
              <TouchableOpacity onPress={() => setPricingResearchModalVisible(false)}>
                <Icon name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>
            {pricingResearchResult?.error ? (
              <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                <Text style={{ fontSize: 14, color: '#ef4444' }}>{pricingResearchResult.error}</Text>
              </View>
            ) : pricingResearchResult && typeof pricingResearchResult.low === 'number' ? (
              <ScrollView style={{ maxHeight: 620 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 28 }}>
                {/* The one shared pricing overview (same card as the add-product preview). */}
                <PricingGuidanceCard
                  headers="none"
                  pricing={pricingResearchResult}
                  onApplyPrice={(price) => {
                    const low = pricingResearchResult.low ?? 0;
                    const recommended = pricingResearchResult.recommended ?? pricingResearchResult.median ?? 0;
                    const high = pricingResearchResult.high ?? 0;
                    patchField('price', price.toFixed(2));
                    patchPlatform(prev => ({ ...prev, aiPriceRecommendation: { low, recommended, high } }));
                    setPricingResearchModalVisible(false);
                  }}
                />
              </ScrollView>
            ) : (
              <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                <Text style={{ fontSize: 14, color: '#6B7280' }}>Loading...</Text>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      {/* Variants: only for platforms that support variants */}
      {
        supportsVariants && (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={styles.sectionTitle}>Variants</Text>
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
            <View style={{ marginTop: 10 }}>
              {/* 1. Active Options List (Summary Cards) */}
              {((activeData.options || []).filter(o => (o.values || []).length > 0)).length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  {(activeData.options || []).filter(o => (o.values || []).length > 0).map((opt, idx) => (
                    <View key={`${opt.name}-${idx}`} style={styles.optionSummaryCard}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={styles.subtle}>{opt.name}</Text>
                        <TouchableOpacity
                          onPress={() => {
                            // Delete entire option
                            Alert.alert(
                              `Remove "${opt.name}"?`,
                              `This will remove the "${opt.name}" option and all associated variants.`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Delete', style: 'destructive', onPress: () => {
                                    patchPlatform(prev => {
                                      const options = (prev.options || []).filter(o => o.name !== opt.name);
                                      return { ...prev, options } as PlatformState;
                                    });
                                    setTimeout(recomputeVariants, 0);
                                  }
                                }
                              ]
                            );
                          }}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                          <Icon name="close" size={14} color="#9CA3AF" />
                        </TouchableOpacity>
                      </View>

                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {(opt.values || []).map(v => (
                          <View key={`${opt.name}-${v}`} style={[styles.optionChip, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                            {/* Option values in summary card are read-only except for delete */}
                            <TouchableOpacity onPress={() => {
                              setDeleteConfirmation({ optionName: opt.name, value: v });
                            }}>
                              <Icon name="close" size={10} color="#6B7280" />
                            </TouchableOpacity>
                            <Text style={{ color: '#000' }}>{v}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* 2. Editor OR Add Button */}
              {optionEditorOpen ? (
                <View style={[styles.card, { backgroundColor: '#fff', borderColor: '#e5e7eb', borderWidth: 1, padding: 16, borderRadius: 12 }]}>
                  <Text style={styles.fieldLabel}>Option Name</Text>

                  {/* Autocomplete Input for Name */}
                  <View style={{ zIndex: 10 }}>
                    <TextInput
                      style={[styles.input, { marginBottom: 8 }]}
                      value={newOptionName}
                      onChangeText={(text) => {
                        setNewOptionName(text);
                        setVariantSearchQuery(text);
                      }}
                      placeholder="eg: Size"
                      placeholderTextColor={"#999999"}
                    />

                    {/* Dropdown - only show if typing and matches exist */}
                    {newOptionName.length > 0 && allPlatformOptions.filter(o => o.name.toLowerCase().includes(newOptionName.toLowerCase()) && o.name.toLowerCase() !== newOptionName.toLowerCase()).length > 0 && (
                      <View style={{ position: 'absolute', top: 45, left: 0, right: 0, backgroundColor: '#fff', borderWidth: 1, borderColor: '#eee', borderRadius: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 5 }}>
                        {allPlatformOptions
                          .filter(o => o.name.toLowerCase().includes(newOptionName.toLowerCase()))
                          .slice(0, 3)
                          .map((option, idx) => (
                            <TouchableOpacity
                              key={`ac-editor-${option.name}-${idx}`}
                              style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
                              onPress={() => {
                                setNewOptionName(option.name);
                                // Prefill values but let user edit/add more
                                setNewOptionValues(option.values.length > 0 ? option.values : ['']);
                                setVariantSearchQuery(''); // Hide dropdown
                              }}
                            >
                              <Text style={{ fontWeight: '600', color: '#374151' }}>{option.name}</Text>
                              <Text style={{ fontSize: 10, color: '#6b7280' }}>
                                Includes: {option.values.slice(0, 2).join(', ')}...
                              </Text>
                            </TouchableOpacity>
                          ))}
                      </View>
                    )}
                  </View>

                  <Text style={[styles.fieldLabel, { marginTop: 10 }]}>Option Values</Text>
                  {newOptionValues.map((v, idx) => (
                    <View key={`opt-val-row-${idx}`} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                      <TextInput
                        style={[styles.input, { flex: 1, marginBottom: 0 }]}
                        value={v}
                        onChangeText={(t) => handleChangeOptionValue(idx, t)}
                        placeholder={idx === 0 ? 'eg: Small' : 'eg: Medium'}
                        placeholderTextColor={"#999999"}
                      />
                      {newOptionValues.length > 1 && (
                        <TouchableOpacity
                          onPress={() => setNewOptionValues(prev => prev.filter((_, i) => i !== idx))}
                          style={{ padding: 10, marginLeft: 4 }}
                        >
                          <Icon name="close" size={20} color="#9CA3AF" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity style={[styles.addInline, { marginTop: 12 }]} onPress={handleAddOptionValueRow}>
                    <Icon name="plus" size={16} color="#4B5563" />
                    <Text style={{ color: '#4B5563', marginLeft: 6 }}>Add another value</Text>
                  </TouchableOpacity>

                  {/* Editor Footer */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#f3f4f6' }}>
                    <TouchableOpacity
                      style={[styles.btnSecondary, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 16 }]}
                      onPress={() => {
                        setOptionEditorOpen(false);
                        setNewOptionName('');
                        setNewOptionValues(['']);
                      }}
                    >
                      <Text style={{ color: '#374151', fontWeight: '500' }}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.btnPrimary, { backgroundColor: '#84cc16', paddingHorizontal: 24, borderRadius: 8 }]}
                      onPress={() => {
                        handleDoneOption();
                        setOptionEditorOpen(false);
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '600' }}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={{
                    borderWidth: 1,
                    borderColor: '#E5E7EB',
                    borderStyle: 'dashed',
                    borderRadius: 8,
                    padding: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#F9FAFB'
                  }}
                  onPress={() => {
                    setNewOptionName('');
                    setNewOptionValues(['']);
                    setOptionEditorOpen(true);
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Icon name="plus" size={18} color="#6B7280" />
                    <Text style={{ color: '#6B7280', fontSize: 16, fontWeight: '500' }}>Add an option</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )
      }


      {/* ── Delivery & Shipping – Trigger card + unified bottom sheet ── */}
      {platformKeys.some(k => ['facebook', 'ebay', 'shopify'].includes(k.toLowerCase())) && (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.fieldLabel}>Listing Options</Text>
          <TouchableOpacity
            activeOpacity={0.8}
            style={{
              marginTop: 8,
              padding: 16,
              backgroundColor: '#fff',
              borderWidth: 1,
              borderColor: shippingEstimateResult && !shippingEstimateResult.error ? '#93C822' : '#E5E7EB',
              borderRadius: 12,
            }}
            onPress={() => {
              const dims = (activeData as any).estimatedDimensions;
              setEditableDimensions({
                length: dims?.length != null ? String(dims.length) : '',
                width: dims?.width != null ? String(dims.width) : '',
                height: dims?.height != null ? String(dims.height) : '',
              });
              setEditableWeight(String(activeData.weight ?? ''));
              setEditableWeightUnit(activeData.weightUnit || 'lb');
              setDeliverySheetVisible(true);
            }}
          >
            {/* Top row: icon + title + chevron */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(147,200,34,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                  <Truck size={20} color="#93C822" />
                </View>
                <View>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827' }}>Delivery & Shipping</Text>
                  <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>
                    {activePlatformKeyLower === 'facebook'
                      ? `Handoff: ${activeData.pickupLocation?.deliveryMethod === 'both' ? 'Pickup & Shipping' : activeData.pickupLocation?.deliveryMethod === 'in_person' ? 'Local pickup' : activeData.pickupLocation?.deliveryMethod === 'shipping' ? 'Shipping' : 'Not set'}`
                      : `Fulfillment: ${activeData.deliveryMethod === 'both' ? 'Pickup & Shipping' : activeData.deliveryMethod === 'in_person' ? 'Local pickup' : activeData.deliveryMethod === 'shipping' ? 'Shipping' : 'Not set'}`
                    }
                  </Text>
                </View>
              </View>
              <Icon name="chevron-right" size={20} color="#9CA3AF" />
            </View>

            {/* Shipping estimate summary row */}
            {(shippingEstimateLoading || shippingEstimateResult || (activeData.weight != null && Number(activeData.weight) > 0) || (activeData as any).estimatedDimensions) && (
              <View style={{
                marginTop: 12,
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: '#F3F4F6',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              }}>
                <View style={{
                  width: 32, height: 32, borderRadius: 8,
                  backgroundColor: shippingEstimateResult && !shippingEstimateResult.error ? 'rgba(147,200,34,0.12)' : '#F3F4F6',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Package size={16} color={shippingEstimateResult && !shippingEstimateResult.error ? '#93C822' : '#6B7280'} />
                </View>
                <View style={{ flex: 1 }}>
                  {shippingEstimateLoading ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <ActivityIndicator size="small" color="#93C822" />
                      <Text style={{ fontSize: 12, color: '#6B7280' }}>Estimating rates…</Text>
                    </View>
                  ) : shippingEstimateResult && typeof shippingEstimateResult.estimatedMin === 'number' && !shippingEstimateResult.error ? (
                    <>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: '#111827' }}>
                        {typeof shippingEstimateResult.expectedCost === 'number'
                          ? `Usually ~$${shippingEstimateResult.expectedCost.toFixed(1)} · Range $${shippingEstimateResult.estimatedMin.toFixed(1)}–$${shippingEstimateResult.estimatedMax.toFixed(1)}`
                          : `USPS Ground · $${shippingEstimateResult.estimatedMin.toFixed(2)}–$${shippingEstimateResult.estimatedMax.toFixed(2)}`}
                      </Text>
                      <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 1 }}>
                        {(activeData as any).estimatedDimensions
                          ? `${(activeData as any).estimatedDimensions.length}×${(activeData as any).estimatedDimensions.width}×${(activeData as any).estimatedDimensions.height} in`
                          : ''}
                        {(activeData as any).estimatedDimensions && activeData.weight ? ' · ' : ''}
                        {activeData.weight ? `${activeData.weight} ${activeData.weightUnit || 'lb'}` : ''}
                      </Text>
                    </>
                  ) : (
                    <Text style={{ fontSize: 12, color: '#9CA3AF' }}>
                      {!(activeData.weight != null && Number(activeData.weight) > 0)
                        ? 'Set weight & dimensions to estimate rates'
                        : (activeData as any).shippingTierReason || 'Tap to configure shipping'}
                    </Text>
                  )}
                </View>
              </View>
            )}
          </TouchableOpacity>

          <DeliveryShippingSheet
            visible={deliverySheetVisible}
            onClose={() => setDeliverySheetVisible(false)}
            platformKeys={platformKeys}
            platforms={platforms}
            patchField={patchField}
            patchPlatform={patchPlatform}
            onChangePlatforms={onChangePlatforms}
            activePlatformKey={activePlatformKey}
            shippingEstimateResult={shippingEstimateResult}
            shippingEstimateLoading={shippingEstimateLoading}
            fetchShippingEstimate={fetchShippingEstimate}
            editableDimensions={editableDimensions}
            setEditableDimensions={setEditableDimensions}
            editableWeight={editableWeight}
            setEditableWeight={setEditableWeight}
            editableWeightUnit={editableWeightUnit}
            setEditableWeightUnit={setEditableWeightUnit}
            onOpenLocationPicker={() => setLocationPickerVisible(true)}
            getActiveData={(pk: string) => (platforms[pk] || {})}
          />

          <InteractiveMapModal
            visible={locationPickerVisible}
            onClose={() => setLocationPickerVisible(false)}
            onSelect={(loc) => {
              if (activePlatformKeyLower === 'facebook') {
                patchField('pickupLocation', {
                  ...activeData.pickupLocation,
                  locationName: loc.name,
                  latitude: loc.lat,
                  longitude: loc.lng
                });
              }
              setLocationPickerVisible(false);
            }}
            initialLat={activePlatformKeyLower === 'facebook' ? activeData.pickupLocation?.latitude : undefined}
            initialLng={activePlatformKeyLower === 'facebook' ? activeData.pickupLocation?.longitude : undefined}
          />
        </View>
      )}

      {/* Delete Option Value Confirmation Modal */}
      <BaseModal
        visible={!!deleteConfirmation}
        onClose={() => setDeleteConfirmation(null)}
        showCloseButton={true}
        containerStyle={{ width: '85%', maxWidth: 340 }}
      >
        <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' }}>
          Remove "{deleteConfirmation?.value}"?
        </Text>
        <Text style={{ color: '#666', textAlign: 'center', marginBottom: 20 }}>
          This will remove the option and associated variants.
        </Text>
        <View style={{ gap: 12, width: '100%' }}>
          <TouchableOpacity
            style={{ backgroundColor: '#F3F4F6', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
            onPress={() => {
              if (deleteConfirmation) {
                handleDeleteOptionValue(deleteConfirmation.optionName, deleteConfirmation.value, false);
              }
            }}
          >
            <Text style={{ fontWeight: '500' }}>This Platform Only</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ backgroundColor: '#EF4444', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
            onPress={() => {
              if (deleteConfirmation) {
                handleDeleteOptionValue(deleteConfirmation.optionName, deleteConfirmation.value, true);
              }
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600' }}>All Platforms</Text>
          </TouchableOpacity>
        </View>
      </BaseModal>

      {/* Inventory summary (auto-decided per platform) */}
      <View style={styles.darkerCard}>
        <View style={{ marginVertical: 8, flexDirection: 'column', gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.sectionTitle}>Inventory{activeTab === 'all' ? ' (All Platforms)' : ''}</Text>
            {/* DEBUG: Log LocationDropdown condition */}
            {(() => {
              console.log(`[LocationDropdown DEBUG] activeTab=${activeTab}, selectedInventoryType=${selectedInventoryType}, shouldShow=${selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS' && activeTab !== 'all'}, locationsCount=${locations?.length}`);
              return null;
            })()}
            {/* Locations only for LOCATION_VARIANT_WITH_OPTIONS; NEVER show for VARIANT_WITH_OPTIONS or BASIC */}
            {selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS' && activeTab !== 'all' && (() => {
              // Filter locations to only show the active platform's locations
              const rawPlatformLocs = platformLocations?.[activePlatformKey.toLowerCase()] || [];
              const platformLocs = collapseSingleLocationLocs(activePlatformKey, rawPlatformLocs).map((loc: any) => ({
                id: loc.id,
                name: loc.name || 'Unknown Location',
                platformType: activePlatformKey.toLowerCase()
              }));
              console.log(`[LocationDropdown FILTERED] platform=${activePlatformKey}, count=${platformLocs.length}`);
              if (platformLocs.length === 0) return null;
              return (
                <LocationDropdown
                  locations={platformLocs}
                  selectedId={selectedLocationId}
                  onChange={(id) => {
                    console.log(`[LOC] Location changed from ${selectedLocationId} to ${id}`);
                    setSelectedLocationId(id);
                  }}
                />
              );
            })()}
          </View>

          {/* Copy inventory from another platform */}
          {activeTab !== 'all' && platformKeys.length > 1 && (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {/*
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
              ))} */}
              {/* Pricing capability indicator moved here */}
              <View style={{ marginLeft: 'auto', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, backgroundColor: activePlatformKey === 'shopify' ? '#E3F2FD' : '' }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: activePlatformKey === 'shopify' ? '#1976D2' : '' }}>
                  {activePlatformKey === 'shopify' ? 'Global Price' : ''}
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
          <>
            {/* Suggested Price Tag - Apply to All */}
            {activeTab === 'all' && (() => {
              // Get suggested price from any platform: prefer aiPriceRecommendation.recommended, else aiRecommendedPrice
              const suggestedPrice = (() => {
                for (const pk of platformKeys) {
                  const pd = platforms[pk] as PlatformState;
                  if (pd?.aiPriceRecommendation?.recommended) return pd.aiPriceRecommendation!.recommended;
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

              return suggestedPrice ? (
                <TouchableOpacity
                  onPress={applySuggestedPriceToAll}
                  style={{ backgroundColor: '#FFF', borderRadius: 8, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#rgb(201, 204, 210)', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                >
                  <Sparkles size={18} color="#000" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#000' }}>Our Suggested Price</Text>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#6B7280' }}>${suggestedPrice.toFixed(2)}</Text>
                  </View>
                  <View style={{ backgroundColor: '#93C822', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 12 }}>Apply to All</Text>
                  </View>
                </TouchableOpacity>
              ) : null;
            })()}

            {/* Use VariantInventoryEditor for both "All" and Specific Platform tabs */}
            {(() => {
              // 1. Build locations list based on active tab
              let allLocs: Array<{ id: string; locationId?: string; name: string; platformKey: string; connectionId?: string; connectionName?: string; isGlobal?: boolean }>;

              if (activeTab === 'all') {
                // All tab: show all locations from all platforms
                // Match the logic for NON-VARIANT case:
                // 1. Start with explicit locations from platformLocations
                const allLocsRaw = Object.entries(platformLocations || {}).flatMap(([pk, locs]) =>
                  (locs || []).map((l: any) => {
                    const locationId = l.locationId || l.id;
                    return {
                      ...l,
                      id: buildAllTabLocationId({ platformKey: pk, connectionId: l.connectionId, locationId }),
                      locationId,
                      platformKey: pk,
                      isGlobal: isShopifyGlobalLocation({ id: locationId, name: l.name, platformKey: pk })
                    };
                  })
                );

                // 2. ROBUSTNESS FIX: Only add virtual default for platforms that have at least one location in platformLocations (i.e. actually connected). Do not add a row for unconnected platforms (e.g. Shopify from platformSpecificData only).
                const platformsWithLocs = Object.keys(platforms).filter((pk) => (platformLocations || {})[pk]?.length > 0);
                platformsWithLocs.forEach(pk => {
                  const hasLocation = allLocsRaw.some(l => l.platformKey === pk);
                  if (!hasLocation) {
                    const locationId = `default-${pk}`;
                    allLocsRaw.push({
                      id: buildAllTabLocationId({ platformKey: pk, connectionId: undefined, locationId }),
                      locationId,
                      name: 'Default Location',
                      platformKey: pk,
                      isGlobal: isShopifyGlobalLocation({ id: locationId, name: 'Default Location', platformKey: pk })
                    });
                    console.log(`[ListingEditorForm] Auto-added virtual location for missing platform: ${pk}`);
                  }
                });

                const locsByPlatform = allLocsRaw.reduce<Record<string, Array<{ id: string; name: string; platformKey: string; isGlobal?: boolean }>>>((acc, loc) => {
                  if (!acc[loc.platformKey]) acc[loc.platformKey] = [];
                  acc[loc.platformKey].push(loc);
                  return acc;
                }, {});

                const collapsedAllLocsRaw = Object.entries(locsByPlatform).flatMap(([pk, locs]) =>
                  collapseSingleLocationLocs(pk, locs)
                );

                // Filter to unique location IDs - keep first occurrence
                const seenIds = new Set<string>();
                allLocs = collapsedAllLocsRaw.filter(loc => {
                  if (seenIds.has(loc.id)) {
                    console.warn(`[ListingEditorForm] Filtered duplicate location: ${loc.id} (${loc.name})`);
                    return false;
                  }
                  seenIds.add(loc.id);
                  return true;
                });
              } else {
                // Platform tab: filter to only this platform's locations
                const platformKey = activeTab.toLowerCase();
                const rawPlatformLocs = platformLocations?.[platformKey] || [];
                const platformLocs = collapseSingleLocationLocs(platformKey, rawPlatformLocs).map((l: any) => ({
                  ...l,
                  locationId: l.locationId || l.id
                }));

                // If dropdown is active (LOCATION_VARIANT_WITH_OPTIONS) and a location is selected,
                // filter to just that location
                if (selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS' && selectedLocationId) {
                  const selectedLoc = platformLocs.find((l: any) => l.id === selectedLocationId);
                  allLocs = selectedLoc
                    ? [{
                      id: selectedLoc.id,
                      locationId: selectedLoc.locationId || selectedLoc.id,
                      name: selectedLoc.name || 'Unknown',
                      platformKey,
                      connectionId: selectedLoc.connectionId,
                      isGlobal: isShopifyGlobalLocation({ id: selectedLoc.id, name: selectedLoc.name, platformKey })
                    }]
                    : platformLocs.map((l: any) => ({
                      ...l,
                      platformKey,
                      isGlobal: isShopifyGlobalLocation({ id: l.id, name: l.name, platformKey })
                    }));
                } else {
                  allLocs = platformLocs.map((l: any) => ({
                    ...l,
                    platformKey,
                    isGlobal: isShopifyGlobalLocation({ id: l.id, name: l.name, platformKey })
                  }));
                }
              }

              console.log(`[VariantInventoryEditor LOCS] activeTab=${activeTab}, selectedLocId=${selectedLocationId}, locsCount=${allLocs.length}`);

              // 2. Prepare Variants based on Active Tab
              let preparedVariants: VariantInventoryEditorProps['variants'] = [];

              if (activeTab === 'all') {
                const locsByPlatform = allLocs.reduce<Record<string, Array<{ id: string; locationId?: string; connectionId?: string }>>>((acc, loc) => {
                  if (!acc[loc.platformKey]) acc[loc.platformKey] = [];
                  acc[loc.platformKey].push(loc);
                  return acc;
                }, {});

                const locKeyMaps = Object.entries(locsByPlatform).reduce<Record<string, Map<string, string>>>((acc, [pk, locs]) => {
                  const map = new Map<string, string>();
                  locs.forEach(loc => {
                    const rawId = loc.locationId || loc.id;
                    const connId = loc.connectionId || '';
                    map.set(`${rawId}::${connId}`, loc.id);
                    if (!map.has(`${rawId}::`)) map.set(`${rawId}::`, loc.id);
                  });
                  acc[pk] = map;
                  return acc;
                }, {});

                // Aggregate variants from all platforms
                const variantMap = new Map<string, any>();

                platformKeys.forEach(pk => {
                  const pData = platforms[pk];
                  if (!pData || !pData.variants) return;

                  pData.variants.forEach((v: any) => {
                    // FIX: Use optionValues as the unique key to properly merge variants across platforms
                    // Using v.id causes duplicates when each platform has different IDs for same variant
                    const optionKey = Object.entries(v.optionValues || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => `${k}:${val}`).join('/') || v.sku || 'default';
                    const vId = optionKey;
                    const existing = variantMap.get(vId);

                    console.log(`[ListingEditorForm] Aggregating variant: platform=${pk}, optionKey=${optionKey}, existingEntry=${!!existing}`);

                    const inv: Record<string, { quantity: number; price?: number; image?: string; connectionId?: string }> = existing ? { ...existing.inventory } : {};
                    const platformPrice = typeof v.price === 'number' ? v.price : undefined;

                    // Add this platform's inventory data
                    const vInv = v.inventoryByLocation || {};
                    const locKeyMap = locKeyMaps[pk] || new Map<string, string>();
                    const priceByConnection = new Map<string, number>();

                    Object.entries(vInv).forEach(([locId, data]: [string, any]) => {
                      const connId = data?.connectionId;
                      if (connId && typeof data?.price === 'number' && !priceByConnection.has(connId)) {
                        priceByConnection.set(connId, data.price);
                      }
                      const compositeId = locKeyMap.get(`${locId}::${connId || ''}`) || locKeyMap.get(`${locId}::`) || locId;
                      inv[compositeId] = {
                        quantity: data.quantity,
                        price: data.price ?? platformPrice,
                        image: data.image,
                        connectionId: connId
                      };
                    });

                    // Ensure every location for this platform has a price fallback from this platform
                    const platformLocs = locsByPlatform[pk] || [];
                    platformLocs.forEach((loc) => {
                      const fallbackPrice = loc.connectionId && priceByConnection.has(loc.connectionId)
                        ? priceByConnection.get(loc.connectionId)
                        : platformPrice;

                      if (!inv[loc.id]) {
                        inv[loc.id] = { quantity: 0, price: fallbackPrice, connectionId: loc.connectionId };
                      } else if (inv[loc.id].price === undefined && fallbackPrice !== undefined) {
                        inv[loc.id] = { ...inv[loc.id], price: fallbackPrice };
                      }
                    });

                    variantMap.set(vId, {
                      id: vId,
                      name: Object.values(v.optionValues || {}).join(' / ') || v.title || v.sku || 'Variant',
                      image: v.image || existing?.image,
                      defaultPrice: v.price || existing?.defaultPrice,
                      inventory: inv
                    });
                  });
                });
                preparedVariants = Array.from(variantMap.values());

                // CRITICAL FIX: Filter out empty "Variant" placeholders when real named variants exist
                // This handles the case where a base variant with no optionValues is mixed with option variants
                const hasRealVariants = preparedVariants.some(v => v.name && v.name !== 'Variant' && v.name.trim() !== '');
                if (hasRealVariants) {
                  preparedVariants = preparedVariants.filter(v => v.name && v.name !== 'Variant' && v.name.trim() !== '');
                }

              } else {
                // Specific Platform
                const pData = activeData; // activeData is platforms[activeTab]
                if (pData && pData.variants) {
                  preparedVariants = pData.variants.map((v: any) => ({
                    id: v.id,
                    name: Object.values(v.optionValues || {}).join(' / ') || v.title || v.sku || 'Variant',
                    image: v.image,
                    defaultPrice: Number(v.price ?? pData.price ?? 0),
                    inventory: v.inventoryByLocation || {}
                  }));

                  // CRITICAL FIX: Filter out empty "Variant" placeholders when real named variants exist
                  const hasRealVariants = preparedVariants.some(v => v.name && v.name !== 'Variant' && v.name.trim() !== '');
                  if (hasRealVariants) {
                    preparedVariants = preparedVariants.filter(v => v.name && v.name !== 'Variant' && v.name.trim() !== '');
                  }
                }
              }

              // CRITICAL FIX: If no variants exist, create a virtual "Base Product" variant
              // This ensures ALL products (variant or not) show per-platform/location inventory
              if (preparedVariants.length === 0) {
                const baseVariant: VariantInventoryEditorProps['variants'][0] = {
                  id: '_base',
                  name: 'Base Product',
                  defaultPrice: Number(activeData.price ?? 0),
                  inventory: {},
                };

                // Populate inventory from locationQuantities (non-variant data)
                allLocs.forEach(loc => {
                  const rawLocationId = loc.locationId || loc.id;
                  const qty = (activeData.locationQuantities || {})[rawLocationId] ?? 0;
                  baseVariant.inventory[loc.id] = {
                    quantity: qty,
                    price: Number(activeData.price ?? 0),
                  };
                });

                // Fallback if no locations
                if (allLocs.length === 0) {
                  const defaultQty = (activeData.locationQuantities || {})['default'] ?? 0;
                  baseVariant.inventory['default'] = {
                    quantity: defaultQty,
                    price: Number(activeData.price ?? 0),
                  };
                }

                preparedVariants = [baseVariant];
                console.log('[ListingEditorForm] Injected Base Product variant for non-variant product');
              }

              // 3. Callback - per-location pricing for non-Shopify, global for Shopify
              const handleUpdateInventory = (variantId: string, locationId: string, field: 'quantity' | 'price', value: number) => {
                const resolvedLoc = allLocs.find(l => l.id === locationId);
                const rawLocationId = resolvedLoc?.locationId || locationId;
                const resolvedConnectionId = resolvedLoc?.connectionId;

                // HANDLE BASE PRODUCT (non-variant product)
                if (variantId === '_base') {
                  if (field === 'quantity') {
                    // Store per-location quantity in locationQuantities
                    setLocationQuantity(rawLocationId, value);
                  } else if (field === 'price') {
                    // Price changes update the base product price for this platform
                    patchPlatform(prev => ({ ...prev, price: value }));
                  }
                  return;
                }

                const nextPlatforms = { ...platforms };

                let targetPlatform = activeTab;
                if (activeTab === 'all') {
                  if (resolvedLoc) targetPlatform = resolvedLoc.platformKey;
                }

                const pData = nextPlatforms[targetPlatform];
                if (!pData) return;

                const isShopify = targetPlatform === 'shopify';
                const targetLoc = resolvedLoc && resolvedLoc.platformKey === targetPlatform ? resolvedLoc : allLocs.find(l => l.id === locationId && l.platformKey === targetPlatform);
                const isShopifyGlobal = isShopify && (targetLoc?.isGlobal || isShopifyGlobalLocation({ id: rawLocationId, name: targetLoc?.name, platformKey: targetPlatform }));

                // Helper to compute optionKey for a variant (used for matching in 'all' tab)
                const getOptionKey = (v: any) => Object.entries(v.optionValues || {})
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, val]) => `${k}:${val}`)
                  .join('/') || v.sku || 'default';

                // Update the target platform
                const newVariants = (pData.variants || []).map((v: any) => {
                  // CRITICAL FIX: In 'all' tab, variantId is an optionKey (e.g. 'State:Broken')
                  // In platform tabs, variantId is the actual variant ID
                  const matchesById = v.id === variantId;
                  const matchesByOptionKey = activeTab === 'all' && getOptionKey(v) === variantId;

                  if (matchesById || matchesByOptionKey) {
                    console.log(`[handleUpdateInventory] ✅ Matched variant: id=${v.id.slice(0, 8)}, optionKey=${getOptionKey(v)}, variantId=${variantId}, field=${field}, value=${value}, isShopify=${isShopify}`);

                    if (field === 'price') {
                      if (isShopify && isShopifyGlobal) {
                        // Shopify: GLOBAL price - update ALL SHOPIFY locations for this connection
                        const updatedInv = { ...(v.inventoryByLocation || {}) };
                        // Get ALL Shopify location IDs for the SAME connection (avoid cross-account bleed)
                        const shopifyLocs = allLocs.filter(l =>
                          l.platformKey === 'shopify' && (!resolvedConnectionId || l.connectionId === resolvedConnectionId)
                        );

                        // Apply price to ALL Shopify locations, creating entries if they don't exist
                        shopifyLocs.forEach(loc => {
                          const locId = loc.locationId || loc.id;
                          updatedInv[locId] = {
                            ...(updatedInv[locId] || {}),
                            connectionId: loc.connectionId ?? (updatedInv[locId] as any)?.connectionId,
                            price: value
                          };
                        });

                        console.log(`[ListingEditorForm] Shopify global price update: ${value}, synced to ${shopifyLocs.length} locations`);
                        console.log(`[ListingEditorForm] Updated inventoryByLocation prices:`, Object.entries(updatedInv).map(([k, v]: [string, any]) => `${k}=$${v.price}`).join(', '));
                        return {
                          ...v,
                          price: value,
                          inventoryByLocation: updatedInv
                        };
                      } else {
                        // Per-location price - only update THIS location
                        const oldInv = v.inventoryByLocation || {};
                        const oldLocData = oldInv[rawLocationId] || {};
                        return {
                          ...v,
                          inventoryByLocation: {
                            ...oldInv,
                            [rawLocationId]: {
                              ...oldLocData,
                              connectionId: oldLocData.connectionId ?? resolvedConnectionId,
                              price: value
                            }
                          }
                        };
                      }
                    }

                    // For quantity, only update the specific location (same for all platforms)
                    const oldInv = v.inventoryByLocation || {};
                    const oldLocData = oldInv[rawLocationId] || {};

                    return {
                      ...v,
                      inventoryByLocation: {
                        ...oldInv,
                        [rawLocationId]: {
                          ...oldLocData,
                          connectionId: oldLocData.connectionId ?? resolvedConnectionId,
                          [field]: value
                        }
                      }
                    };
                  }
                  return v;
                });

                nextPlatforms[targetPlatform] = { ...pData, variants: newVariants };

                // NOTE: Removed cross-platform price sync - prices are now independent per platform
                // Each platform manages its own pricing (Shopify=global, others=per-location)

                onChangePlatforms(nextPlatforms);
              };

              const handleSelectImage = (variantId: string) => {
                onOpenImageCapture?.(async (uris) => {
                  if (!uris || uris.length === 0) return;

                  const uri = uris[0];
                  const nextPlatforms = { ...platforms };

                  platformKeys.forEach(pk => {
                    const pd = nextPlatforms[pk];
                    if (pd && pd.variants) {
                      pd.variants = pd.variants.map((v: any) =>
                        v.id === variantId ? { ...v, image: uri } : v
                      );
                    }
                  });
                  onChangePlatforms(nextPlatforms);
                });
              };

              return (
                <VariantInventoryEditor
                  variants={preparedVariants}
                  locations={allLocs}
                  activeTab={activeTab === 'all' ? 'all' : activeTab}
                  isGenerationMode={true} // This is the GenerateDetailsScreen context
                  onUpdateInventory={handleUpdateInventory}
                  onSelectImage={handleSelectImage}
                  hasExternalUpdateQuantity={hasExternalInventoryUpdateQuantity}
                  hasExternalUpdatePrice={hasExternalInventoryUpdatePrice}
                />
              );
            })()}
          </>
        ) : (
          /* NON-VARIANT PRODUCT: Use VariantInventoryEditor with a virtual "Base Product" variant
           * This ensures all products (variant or not) have per-platform/location inventory fields
           */
          (() => {
            // Build locations list (same logic as variant case)
            let allLocs: Array<{ id: string; locationId?: string; name: string; platformKey: string; connectionId?: string; connectionName?: string; isGlobal?: boolean }>;

            if (activeTab === 'all') {
              // All tab: show all locations from all platforms
              const allLocsRaw = Object.entries(platformLocations || {}).flatMap(([pk, locs]) =>
                (locs || []).map((l: any) => {
                  const locationId = l.locationId || l.id;
                  return {
                    ...l,
                    id: buildAllTabLocationId({ platformKey: pk, connectionId: l.connectionId, locationId }),
                    locationId,
                    platformKey: pk,
                    isGlobal: isShopifyGlobalLocation({ id: locationId, name: l.name, platformKey: pk })
                  };
                })
              );

              // ROBUSTNESS FIX: Ensure every active platform has at least one location
              Object.keys(platforms).forEach(pk => {
                const hasLocation = allLocsRaw.some(l => l.platformKey === pk);
                if (!hasLocation) {
                  const locationId = `default-${pk}`;
                  allLocsRaw.push({
                    id: buildAllTabLocationId({ platformKey: pk, connectionId: undefined, locationId }),
                    locationId,
                    name: 'Default Location',
                    platformKey: pk,
                    isGlobal: isShopifyGlobalLocation({ id: locationId, name: 'Default Location', platformKey: pk })
                  });
                }
              });

              const locsByPlatform = allLocsRaw.reduce<Record<string, Array<{ id: string; name: string; platformKey: string; isGlobal?: boolean; locationId?: string }>>>((acc, loc) => {
                if (!acc[loc.platformKey]) acc[loc.platformKey] = [];
                acc[loc.platformKey].push(loc);
                return acc;
              }, {});

              const collapsedAllLocsRaw = Object.entries(locsByPlatform).flatMap(([pk, locs]) =>
                collapseSingleLocationLocs(pk, locs)
              );

              const seenIds = new Set<string>();
              allLocs = collapsedAllLocsRaw.filter(loc => {
                if (seenIds.has(loc.id)) return false;
                seenIds.add(loc.id);
                return true;
              });
            } else {
              // Platform tab: filter to only this platform's locations
              const platformKey = activeTab.toLowerCase();
              const rawPlatformLocs = platformLocations?.[platformKey] || [];
              const platformLocs = collapseSingleLocationLocs(platformKey, rawPlatformLocs).map((l: any) => ({
                ...l,
                locationId: l.locationId || l.id
              }));
              allLocs = platformLocs.map((l: any) => ({
                ...l,
                platformKey,
                isGlobal: isShopifyGlobalLocation({ id: l.id, name: l.name, platformKey })
              }));
            }

            // Create virtual "Base Product" variant with locationQuantities data
            const baseVariant = {
              id: '_base',
              name: 'Base Product',
              defaultPrice: Number(activeData.price ?? 0),
              inventory: {} as Record<string, { quantity: number; price?: number }>,
            };

            // Populate inventory from locationQuantities (per-location) or use base price
            allLocs.forEach(loc => {
              const rawLocationId = (loc as any).locationId || loc.id;
              const qty = (activeData.locationQuantities || {})[rawLocationId] ?? 0;
              baseVariant.inventory[loc.id] = {
                quantity: qty,
                price: Number(activeData.price ?? 0),
              };
            });

            // If no locations exist yet, create a default inventory entry
            if (allLocs.length === 0 && activeTab !== 'all') {
              const qty = (activeData.locationQuantities || {})['default'] ?? 0;
              baseVariant.inventory['default'] = {
                quantity: qty,
                price: Number(activeData.price ?? 0),
              };
            }

            const handleBaseInventoryUpdate = (variantId: string, locationId: string, field: 'quantity' | 'price', value: number) => {
              const resolvedLoc = allLocs.find(l => l.id === locationId);
              const rawLocationId = resolvedLoc?.locationId || locationId;
              if (field === 'quantity') {
                // Store per-location quantity in locationQuantities
                setLocationQuantity(rawLocationId, value);
              } else if (field === 'price') {
                // Price changes update the base product price
                patchPlatform(prev => ({ ...prev, price: value }));
              }
            };

            return (
              <VariantInventoryEditor
                variants={[baseVariant]}
                activeTab={activeTab}
                locations={allLocs.length > 0 ? allLocs : [{ id: 'default', name: 'Default', platformKey: activeTab }]}
                isGenerationMode={isGenerationMode}
                onUpdateInventory={handleBaseInventoryUpdate}
                hasExternalUpdateQuantity={hasExternalInventoryUpdateQuantity}
                hasExternalUpdatePrice={hasExternalInventoryUpdatePrice}
              />
            );
          })()
        )}



      </View>
      {/* Additional fields basic toggle */}
      {
        activeTab !== 'all' && (
          <>
            <TouchableOpacity style={styles.toggleRow} onPress={() => setShowAdditionalFields(v => !v)}>
              <Icon name={showAdditionalFields ? 'chevron-down' : 'chevron-right'} size={18} color="#000" />
              <Text style={styles.sectionTitle}>Additional Fields</Text>
            </TouchableOpacity>
            {
              showAdditionalFields && (
                <>
                  {(() => {
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
                        <View style={{ padding: 16, alignItems: 'center' }}>
                          <Text style={{ color: '#aaa', fontStyle: 'italic' }}>No additional fields found.</Text>
                        </View>
                      );
                    }

                    return (
                      <View style={{ marginTop: 10, gap: 12 }}>
                        {additionalFields.map(([key, value]) => {
                          const isArray = Array.isArray(value);
                          const isObject = typeof value === 'object' && !isArray;
                          const displayValue = isObject ? JSON.stringify(value, null, 2) :
                            isArray ? value.join(', ') : String(value);

                          return (
                            <View key={key}>
                              <Field
                                label={key}
                                value={displayValue}
                                onChangeText={(t) => {
                                  // Simple string patch for generic fields
                                  patchPlatform(prev => ({ ...prev, [key]: t } as any));
                                }}
                                onInfo={() => onOpenFieldPanel?.(key)}
                                onRegenerate={enableAIRefill && onRegenerateField ? () => onRegenerateField(activePlatformKey, key) : undefined}
                                refilled={Array.isArray((platforms as any)[activePlatformKey]?.__refilled) && (platforms as any)[activePlatformKey].__refilled.includes(key)}
                              />
                            </View>
                          );
                        })}
                      </View>
                    );
                  })()}
                </>
              )
            }


          </>
        )
      }

    </View>
  );
}

export default forwardRef<ListingEditorFormRef, Props>(ListingEditorFormInner);


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
  // --- STYLES REFACTOR ---
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modernInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffffff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  modernInputFocused: {
    borderColor: '#93C822',
    backgroundColor: '#FFFFFF',
    shadowColor: '#93C822',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  modernInputDisabled: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
  },
  modernTextInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingVertical: 12, // Ensure good touch target
    height: '100%',
  },
  sectionHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  sectionIconBg: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  // Keep existing styles but update where needed
  input: {
    // Deprecated in favor of modernInputWrapper but keeping for legacy
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
    backgroundColor: '#fff',
    color: '#000',
  },
  addTagBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  tagChip: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  optionChip: { backgroundColor: '#E5E5E5', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  dropdown: { backgroundColor: 'white', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownMenu: { backgroundColor: 'white', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, marginTop: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3 },
  dropdownItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  scanBtn: { backgroundColor: '#93C822', width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: -18 },
  sectionTitle: { color: '#000', fontWeight: '700' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18 },
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
    gap: 8,
  },
  addMissingFieldText: {
    color: '#71717A',
    fontSize: 14,
    fontWeight: '600',
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
