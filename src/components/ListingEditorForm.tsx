import React, { useEffect, useMemo, useState, forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput, Modal, Pressable, FlatList, SectionList, Alert, ActivityIndicator } from 'react-native';
import { isPlatformReady, getMissingPlatformFields, hasPlatformPrice } from '../utils/platformRequirements';
import { Paths, Directory, File } from 'expo-file-system/next';
import * as ImagePicker from 'expo-image-picker';
import VariantInventoryEditor, { InventoryItemData, VariantInventoryEditorProps } from './VariantInventoryEditor';
import BaseModal from './BaseModal';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Boxes, X, Sparkles, Car, Package, MapPin, Truck } from 'lucide-react-native';
import { Dropdown as ElementDropdown } from 'react-native-element-dropdown';
import InteractiveMapModal from './InteractiveMapModal';
import { black, grey400 } from 'react-native-paper/lib/typescript/styles/themes/v2/colors';
import { overlay } from 'react-native-paper';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';

export type PlatformsData = Record<string, any>;

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

  // Facebook Marketplace pickup location
  pickupLocation?: {
    latitude?: number;
    longitude?: number;
    locationName?: string;
    deliveryMethod?: 'in_person' | 'shipping' | 'both';
  };
  condition?: 'new' | 'used' | 'refurbished' | 'like_new' | 'good' | 'fair';
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

// --- MODERN UI COMPONENTS ---

const CollapsibleSection = ({
  title,
  icon,
  children,
  defaultOpen = true,
  rightAction,
  errorCount = 0
}: {
  title: string,
  icon?: any,
  children: React.ReactNode,
  defaultOpen?: boolean,
  rightAction?: React.ReactNode,
  errorCount?: number
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
      <TouchableOpacity
        activeOpacity={0.7}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 16,
          backgroundColor: '#fff',
          justifyContent: 'space-between'
        }}
        onPress={() => setIsOpen(v => !v)}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <SectionHeader title={title} icon={icon} />
          {errorCount > 0 && (
            <View style={{ backgroundColor: '#FECACA', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
              <Text style={{ color: '#DC2626', fontSize: 10, fontWeight: '700' }}>{errorCount} MISSING</Text>
            </View>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {rightAction}
          <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#9CA3AF" />
        </View>
      </TouchableOpacity>

      {isOpen && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <View style={{ height: 1, backgroundColor: '#F3F4F6', marginBottom: 16 }} />
          {children}
        </View>
      )}
    </View>
  );
};

/* Sticky Bottom Action Bar Component */
const StickyActionBar = ({ onSave, onPublish }: { onSave?: () => void, onPublish?: () => void }) => {
  return (
    <View style={{
      position: 'absolute',
      bottom: 20,
      left: 16,
      right: 16,
      backgroundColor: '#fff',
      borderRadius: 100,
      padding: 8,
      paddingHorizontal: 12,
      flexDirection: 'row',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 8,
      borderWidth: 1,
      borderColor: '#E5E7EB',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <TouchableOpacity onPress={onSave} style={{ padding: 10 }}>
        <Text style={{ fontWeight: '600', color: '#4B5563' }}>Save Draft</Text>
      </TouchableOpacity>
      <View style={{ height: 20, width: 1, backgroundColor: '#E5E7EB' }} />
      <TouchableOpacity onPress={onPublish} style={{ padding: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontWeight: '700', color: '#93C822' }}>Publish Now</Text>
        <Icon name="arrow-right" size={16} color="#93C822" />
      </TouchableOpacity>
    </View>
  )
}

const ModernInput = ({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  icon,
  rightRight, // Element to render on right
  disabled
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: any;
  icon?: any;
  rightRight?: React.ReactNode;
  disabled?: boolean;
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const IconComp = icon;

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[
        styles.fieldLabel,
        isFocused && { color: '#93C822' } // Brand color on focus
      ]}>
        {label}
      </Text>
      <View style={[
        styles.modernInputWrapper,
        isFocused && styles.modernInputFocused,
        disabled && styles.modernInputDisabled,
        multiline && { height: 'auto', minHeight: 100 }
      ]}>
        {IconComp && (
          <View style={{ marginRight: 10 }}>
            <IconComp size={18} color={isFocused ? '#93C822' : '#9CA3AF'} />
          </View>
        )}
        <TextInput
          style={[styles.modernTextInput, multiline && { height: 100, textAlignVertical: 'top', paddingTop: 8 }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          multiline={multiline}
          keyboardType={keyboardType}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          editable={!disabled}
        />
        {rightRight}
      </View>
    </View>
  );
};

const SectionHeader = ({ title, icon, rightAction }: { title: string, icon?: any, rightAction?: React.ReactNode }) => {
  const IconComp = icon;
  return (
    <View style={styles.sectionHeaderContainer}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {IconComp && (
          <View style={styles.sectionIconBg}>
            <IconComp size={16} color="#4B5563" />
          </View>
        )}
        <Text style={styles.sectionHeaderTitle}>{title}</Text>
      </View>
      {rightAction}
    </View>
  );
};

function ListingEditorFormInner({ platforms, updateCounter, images, pendingImages = [], platformLocations, onChangePlatforms, onChangeImages, onOpenFieldPanel, onOpenBarcodeScanner, onOpenImageCapture, onRegenerateField, onAddMissingField, getMissingFieldsCount, onGeneratePlatform, enableAIRefill, onSuggestVariants, onBoostListing, onToggleIgnorePlatform, isPlatformIgnored, isGenerationMode = false, externalUpdates, onAdoptExternalUpdate }: Props, ref: React.Ref<ListingEditorFormRef>) {
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
  const [variantSearchQuery, setVariantSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<string>('all');
  const [showAdditionalFields, setShowAdditionalFields] = useState<boolean>(false);
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
  const [locationPickerVisible, setLocationPickerVisible] = useState<boolean>(false);

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
    openPlatformPicker: () => setShowPlatformPicker(true),
  }), []);

  const lastPlatformRef = useRef<string>('');
  const lastOptionsRef = useRef<string>('');

  // 🟢 EXTERNAL UPDATES: Helper to check if a field was updated externally
  const hasExternalUpdate = useCallback((fieldKey: string): boolean => {
    if (!externalUpdates?.[fieldKey]) return false;
    const update = externalUpdates[fieldKey];
    // Highlight if updated within last 5 seconds
    return (Date.now() - update.updatedAt) < 5000;
  }, [externalUpdates]);

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

  // Get locations for the active platform - ALWAYS use platformLocations first (properly separated per-platform)
  const locations = useMemo(() => {
    const platformKey = activePlatformKey.toLowerCase();

    // FIRST: Try platformLocations prop which is correctly structured per-platform
    const platformLocs = platformLocations?.[platformKey] || [];

    console.log(`[ListingEditorForm LOCS] platform=${platformKey}, platformLocsKeys=${Object.keys(platformLocations || {}).join(',')}, count=${platformLocs.length}`);

    if (platformLocs.length > 0) {
      return platformLocs.map((loc: any) => ({
        id: loc.id,
        name: loc.name || 'Unknown Location',
        platformType: loc.platformType || platformKey
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

      if (filtered.length > 0) {
        console.log(`[ListingEditorForm LOCS] Filtered ${activeData.locations.length} → ${filtered.length} for ${platformKey}`);
        return filtered.map((loc: any) => ({
          ...loc,
          platformType: loc.platformType || platformKey
        }));
      }
    }

    // Fallback to dummy data if no locations available
    return [{ id: 'loc-default', name: 'Default Location', platformType: platformKey }];
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

    // CRITICAL: ALWAYS sync variants to ALL platforms when options change
    // This ensures consistency - user edits on any tab apply everywhere
    const platformsToUpdate = platformKeys;
    console.log('[recomputeVariants] Updating ALL platforms:', platformsToUpdate);

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
    <View style={{ paddingBottom: isGenerationMode ? 120 : 20 }}>
      {/* Media with Remove & Add Photo Management */}
      <View style={styles.mediaRow}>
        <ScrollView style={{ paddingVertical: 10 }} horizontal={true} showsHorizontalScrollIndicator={false}>
          {/* Images first - Cover (index 0) appears on left */}
          {(images || []).map((uri, i) => (
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
          {(pendingImages || []).map((uri, i) => (
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
        {pills.map((key) => (
          key === 'all' ? (
            <TouchableOpacity
              key={key}
              onPress={() => setActiveTab(key)}
              style={[
                styles.pill,
                activeTab === key && { backgroundColor: '#3B82F6', borderColor: '#3B82F6' }
              ]}
            >
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
          externalUpdate={hasExternalUpdate('title')}
        />

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
                    externalUpdate={hasExternalUpdate('price')}
                  />

                </View>

                {/*
                <ElementDropdown
                  style={[styles.input, { height: 50, paddingHorizontal: 12 }]}
                  containerStyle={{
                    backgroundColor: 'white',
                    borderRadius: 12,
                    marginTop: 4,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.1,
                    shadowRadius: 12,
                    elevation: 5,
                    padding: 4,
                    borderWidth: 0
                  }}
                  itemContainerStyle={{ borderRadius: 8, marginVertical: 2, paddingHorizontal: 8 }}
                  itemTextStyle={{ fontSize: 14, color: '#374151' }}
                  selectedTextStyle={{ fontSize: 14, color: '#000', fontWeight: '500' }}
                  activeColor="#F0F9FF"
                  placeholderStyle={{ fontSize: 14, color: '#9CA3AF' }}
                  iconStyle={{ width: 20, height: 20, tintColor: '#6B7280' }}
                  data={["USD", "CAD", "EUR", "GBP"].map(c => ({ label: c, value: c }))}
                  labelField="label"
                  valueField="value"
                  placeholder="USD"
                  value={(activeData as any).currency || 'USD'}
                  onChange={(item) => patchField('currency', item.value)}
                />
                */}
              </View>
            </View>
          );
        })()}

        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', alignItems: 'flex-end', }}>
          <View style={{ flex: 1 }}>
            <Field label="Shipping Weight" value={String(activeData.weight ?? '')} onChangeText={(t) => patchField('weight', t)} onInfo={() => onOpenFieldPanel?.('weight')} />
          </View>
          <View style={{ width: 140, marginBottom: 12 }}>
            <ElementDropdown
              style={[styles.input, { height: 50, paddingHorizontal: 12 }]}
              containerStyle={{
                backgroundColor: 'white',
                borderRadius: 12,
                marginTop: 4,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.1,
                shadowRadius: 12,
                elevation: 5,
                padding: 4,
                borderWidth: 0
              }}
              itemContainerStyle={{ borderRadius: 8, marginVertical: 2, paddingHorizontal: 8 }}
              itemTextStyle={{ fontSize: 14, color: '#374151' }}
              selectedTextStyle={{ fontSize: 14, color: '#000', fontWeight: '500' }}
              activeColor="#F0F9FF"
              placeholderStyle={{ fontSize: 14, color: '#9CA3AF' }}
              iconStyle={{ width: 20, height: 20, tintColor: '#6B7280' }}
              data={["oz", "lb", "g", "kg"].map(u => ({ label: u, value: u }))}
              labelField="label"
              valueField="value"
              placeholder="oz"
              value={activeData.weightUnit || 'oz'}
              onChange={(item) => patchField('weightUnit', item.value)}
            />
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
          externalUpdate={hasExternalUpdate('sku')}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Barcode" value={activeData.barcode} onChangeText={(t) => patchField('barcode', t)} onInfo={() => onOpenFieldPanel?.('barcode')} externalUpdate={hasExternalUpdate('barcode')} />
          </View>
          <TouchableOpacity style={[styles.scanBtn, {}]} onPress={() => { (onOpenBarcodeScanner || (() => { }))((code: string) => patchField('barcode', code)); }}>
            <Icon name="qrcode-scan" size={20} color="#fff" />
          </TouchableOpacity>
        </View>


      </View>


      {/* Variants: only for platforms that support variants */}
      {supportsVariants && (
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


      {/* Facebook Marketplace Settings */}
      {
        activePlatformKey === 'facebook' && (
          <View style={styles.card}>
            <SectionHeader title="Facebook Settings" icon={FacebookSvg} />

            {/* Condition - Dropdown Style */}
            <View style={{ marginBottom: 20 }}>
              <Text style={styles.fieldLabel}>Condition</Text>
              <ElementDropdown
                style={[styles.modernInputWrapper, { paddingHorizontal: 12, height: 48, borderWidth: 1 }]} // Match ModernInput
                containerStyle={{
                  backgroundColor: 'white',
                  borderRadius: 12,
                  marginTop: 4,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.1,
                  shadowRadius: 12,
                  elevation: 5,
                  padding: 4,
                  borderWidth: 0
                }}
                itemContainerStyle={{
                  borderRadius: 8,
                  marginVertical: 2,
                  paddingHorizontal: 8
                }}
                itemTextStyle={{ fontSize: 14, color: '#374151' }}
                selectedTextStyle={{ fontSize: 14, color: '#000', fontWeight: '500' }}
                activeColor="#F0F9FF"
                placeholderStyle={{ fontSize: 14, color: '#9CA3AF' }}
                iconStyle={{ width: 20, height: 20, tintColor: '#6B7280' }}
                data={[
                  { label: 'New', value: 'new' },
                  { label: 'Like New', value: 'like_new' },
                  { label: 'Good', value: 'good' },
                  { label: 'Fair', value: 'fair' },
                  { label: 'Used', value: 'used' },
                  { label: 'Refurbished', value: 'refurbished' },
                ]}
                maxHeight={260}
                labelField="label"
                valueField="value"
                placeholder="Select condition..."
                value={activeData.condition}
                onChange={item => {
                  patchField('condition', item.value);
                }}
              />
            </View>

            {/* Delivery Method */}
            <View style={{ marginBottom: 20 }}>
              <Text style={styles.fieldLabel}>Handoff Method</Text>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                {(['in_person', 'shipping', 'both'] as const).map((method) => {
                  const isActive = activeData.pickupLocation?.deliveryMethod === method;
                  const config = {
                    in_person: { label: 'Pickup', icon: Car },
                    shipping: { label: 'Shipping', icon: Package },
                    both: { label: 'Both', icon: Truck },
                  }[method];

                  const IconComp = config.icon;

                  return (
                    <TouchableOpacity
                      key={method}
                      activeOpacity={0.8}
                      style={{
                        flex: 1,
                        backgroundColor: isActive ? 'rgba(147,200,34,0.1)' : '#F9FAFB',
                        borderRadius: 12,
                        paddingVertical: 14,
                        alignItems: 'center',
                        borderWidth: 1.5,
                        borderColor: isActive ? '#93C822' : '#E5E7EB',
                      }}
                      onPress={() => patchField('pickupLocation', {
                        ...activeData.pickupLocation,
                        deliveryMethod: method
                      })}
                    >
                      <IconComp size={24} color={isActive ? '#93C822' : '#6B7280'} strokeWidth={2} />
                      <Text style={{
                        marginTop: 8,
                        color: isActive ? '#93C822' : '#374151',
                        fontSize: 13,
                        fontWeight: isActive ? '700' : '600',
                      }}>
                        {config.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Location - Map Interaction */}
            {(activeData.pickupLocation?.deliveryMethod === 'in_person' || activeData.pickupLocation?.deliveryMethod === 'both') && (
              <View>
                <Text style={styles.fieldLabel}>Pickup Location</Text>

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={{
                    marginTop: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 16,
                    paddingHorizontal: 16,
                    backgroundColor: '#fff',
                    borderWidth: 1,
                    borderColor: '#E5E5E5',
                    borderRadius: 12,
                  }}
                  onPress={() => setLocationPickerVisible(true)}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(147,200,34,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                    <MapPin size={18} color="#93C822" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      color: activeData.pickupLocation?.locationName ? '#111827' : '#9CA3AF',
                      fontSize: 15,
                      fontWeight: activeData.pickupLocation?.locationName ? '600' : '400'
                    }}>
                      {activeData.pickupLocation?.locationName || 'Tap to set location...'}
                    </Text>
                    {activeData.pickupLocation?.locationName && (
                      <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                        {activeData.pickupLocation.latitude?.toFixed(4)}, {activeData.pickupLocation.longitude?.toFixed(4)}
                      </Text>
                    )}
                  </View>
                  <View style={{ backgroundColor: '#F3F4F6', padding: 6, borderRadius: 8 }}>
                    <Icon name="chevron-right" size={20} color="#9CA3AF" />
                  </View>
                </TouchableOpacity>

                <InteractiveMapModal
                  visible={locationPickerVisible}
                  onClose={() => setLocationPickerVisible(false)}
                  onSelect={(loc) => {
                    patchField('pickupLocation', {
                      ...activeData.pickupLocation,
                      locationName: loc.name,
                      latitude: loc.lat,
                      longitude: loc.lng
                    });
                    setLocationPickerVisible(false);
                  }}
                  initialLat={activeData.pickupLocation?.latitude}
                  initialLng={activeData.pickupLocation?.longitude}
                />

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
              </View>
            )}
          </View>
        )
      }

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
              const platformLocs = (platformLocations?.[activePlatformKey.toLowerCase()] || []).map((loc: any) => ({
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
                  {activePlatformKey === 'shopify' ? 'Global Price' : 'Per-Location Pricing'}
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

              return suggestedPrice ? (
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
              ) : null;
            })()}

            {/* Use VariantInventoryEditor for both "All" and Specific Platform tabs */}
            {(() => {
              // 1. Build locations list based on active tab
              let allLocs: Array<{ id: string; name: string; platformKey: string }>;

              if (activeTab === 'all') {
                // All tab: show all locations from all platforms
                // CRITICAL FIX: Deduplicate by location id to prevent duplicate React keys
                const allLocsRaw = Object.entries(platformLocations || {}).flatMap(([pk, locs]) =>
                  (locs || []).map((l: any) => ({ ...l, platformKey: pk }))
                );
                // Filter to unique location IDs - keep first occurrence
                const seenIds = new Set<string>();
                allLocs = allLocsRaw.filter(loc => {
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
                const platformLocs = platformLocations?.[platformKey] || [];

                // If dropdown is active (LOCATION_VARIANT_WITH_OPTIONS) and a location is selected,
                // filter to just that location
                if (selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS' && selectedLocationId) {
                  const selectedLoc = platformLocs.find((l: any) => l.id === selectedLocationId);
                  allLocs = selectedLoc
                    ? [{ id: selectedLoc.id, name: selectedLoc.name || 'Unknown', platformKey }]
                    : platformLocs.map((l: any) => ({ ...l, platformKey }));
                } else {
                  allLocs = platformLocs.map((l: any) => ({ ...l, platformKey }));
                }
              }

              console.log(`[VariantInventoryEditor LOCS] activeTab=${activeTab}, selectedLocId=${selectedLocationId}, locsCount=${allLocs.length}`);

              // 2. Prepare Variants based on Active Tab
              let preparedVariants: VariantInventoryEditorProps['variants'] = [];

              if (activeTab === 'all') {
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

                    const inv: Record<string, { quantity: number; price?: number; image?: string }> = existing ? { ...existing.inventory } : {};

                    // Add this platform's inventory data
                    const vInv = v.inventoryByLocation || {};
                    Object.entries(vInv).forEach(([locId, data]: [string, any]) => {
                      inv[locId] = {
                        quantity: data.quantity,
                        price: data.price,
                        image: data.image
                      };
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

              // 3. Callback - per-location pricing for non-Shopify, global for Shopify
              const handleUpdateInventory = (variantId: string, locationId: string, field: 'quantity' | 'price', value: number) => {
                const nextPlatforms = { ...platforms };

                let targetPlatform = activeTab;
                if (activeTab === 'all') {
                  const loc = allLocs.find(l => l.id === locationId);
                  if (loc) targetPlatform = loc.platformKey;
                }

                const pData = nextPlatforms[targetPlatform];
                if (!pData) return;

                const isShopify = targetPlatform === 'shopify';

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
                      if (isShopify) {
                        // Shopify: GLOBAL price - update ALL SHOPIFY locations for this connection
                        const updatedInv = { ...(v.inventoryByLocation || {}) };
                        // Get ALL Shopify location IDs from allLocs (the known locations for this platform)
                        const shopifyLocIds = allLocs.filter(l => l.platformKey === 'shopify').map(l => l.id);

                        // Apply price to ALL Shopify locations, creating entries if they don't exist
                        shopifyLocIds.forEach(locId => {
                          updatedInv[locId] = {
                            ...(updatedInv[locId] || {}),
                            price: value
                          };
                        });

                        console.log(`[ListingEditorForm] Shopify global price update: ${value}, synced to ${shopifyLocIds.length} locations: ${shopifyLocIds.join(', ')}`);
                        console.log(`[ListingEditorForm] Updated inventoryByLocation prices:`, Object.entries(updatedInv).map(([k, v]: [string, any]) => `${k}=$${v.price}`).join(', '));
                        return {
                          ...v,
                          price: value,
                          inventoryByLocation: updatedInv
                        };
                      } else {
                        // Non-Shopify (Square, Clover): PER-LOCATION price - only update THIS location
                        const oldInv = v.inventoryByLocation || {};
                        const oldLocData = oldInv[locationId] || {};
                        return {
                          ...v,
                          inventoryByLocation: {
                            ...oldInv,
                            [locationId]: {
                              ...oldLocData,
                              price: value
                            }
                          }
                        };
                      }
                    }

                    // For quantity, only update the specific location (same for all platforms)
                    const oldInv = v.inventoryByLocation || {};
                    const oldLocData = oldInv[locationId] || {};

                    return {
                      ...v,
                      inventoryByLocation: {
                        ...oldInv,
                        [locationId]: {
                          ...oldLocData,
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
                />
              );
            })()}
          </>
        ) : (
          <SimpleQuantityInput
            quantity={(activeData.locationQuantities || {})['default'] ?? 0}
            onChangeQuantity={(qty) => setLocationQuantity('default', qty)}
          />
        )}

      </View>



      {/* Additional fields basic toggle */}
      {/* Additional fields basic toggle - Hidden on All tab */}
      {activeTab !== 'all' && (
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
      )}

      {/* Sticky Action Footer */}
      {/* <StickyActionBar onSave={() => console.log('Save')} onPublish={() => console.log('Publish')} /> */}

    </View >
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



function Field({ label, value, onChangeText, multiline, keyboardType, onInfo, required, onRegenerate, refilled, error, externalUpdate }: { label: string; value?: string; onChangeText?: (t: string) => void; multiline?: boolean; keyboardType?: any; onInfo?: () => void; required?: boolean; onRegenerate?: () => void; refilled?: boolean; error?: boolean; externalUpdate?: boolean }) {
  // Use local state with uncontrolled input to prevent re-render issues
  const [localValue, setLocalValue] = useState(value ?? '');
  const timeoutRef = React.useRef<any>(null);

  // 🟢 Green border style for external updates
  const externalUpdateStyle = externalUpdate ? {
    borderColor: '#34C759', // iOS green
    borderWidth: 2,
  } : null;

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
          {externalUpdate ? (
            <View style={{ backgroundColor: 'rgba(52,199,89,0.15)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#059669', fontSize: 10, fontWeight: '600' }}>Updated</Text>
            </View>
          ) : refilled ? (
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
          externalUpdateStyle, // 🟢 Green border for external updates (overrides error if both present)
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

// Logo map for platform types
const platformLogoMap: Record<string, any> = {
  shopify: ShopifySvg,
  amazon: AmazonSvg,
  facebook: FacebookSvg,
  ebay: EbaySvg,
  clover: CloverSvg,
  square: SquareSvg
};

// Enhanced dropdown with platform logos for locations
function LocationDropdown({
  locations,
  selectedId,
  onChange
}: {
  locations: Array<{ id: string; name: string; platformType: string }>;
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = locations.find(l => l.id === selectedId) || locations[0];
  const Logo = selected ? platformLogoMap[selected.platformType] : null;

  console.log(`[LocationDropdown RENDER] selectedId=${selectedId}, selected=${selected?.name}, locCount=${locations.length}, hasLogo=${!!Logo}, items=${locations.map(l => l.name).join(', ')}`);

  return (
    <View style={{ position: 'relative', zIndex: open ? 1000 : 1, minWidth: 160 }}>
      <TouchableOpacity
        style={[styles.dropdown, { minWidth: 150, maxWidth: 200 }]}
        onPress={() => setOpen(o => !o)}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          {Logo && <Logo width={16} height={16} />}
          <Text style={{ color: '#000', fontSize: 13, flexShrink: 1 }} numberOfLines={1} ellipsizeMode="tail">
            {selected?.name || 'Select Location'}
          </Text>
        </View>
        <Icon name="chevron-down" size={18} color="#000" style={{ marginLeft: 4 }} />
      </TouchableOpacity>
      {open && (
        <View style={[styles.dropdownMenu, { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, marginTop: 0, maxHeight: 200 }]}>
          <ScrollView nestedScrollEnabled>
            {locations.map(loc => {
              const LocLogo = platformLogoMap[loc.platformType];
              return (
                <TouchableOpacity
                  key={loc.id}
                  style={[styles.dropdownItem, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
                  onPress={() => { onChange(loc.id); setOpen(false); }}
                >
                  {LocLogo && <LocLogo width={16} height={16} />}
                  <Text style={{ color: '#000', flex: 1 }} numberOfLines={1}>{loc.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
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
    backgroundColor: '#F9FAFB',
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
