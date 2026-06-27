import React, { useEffect, useMemo, useState, forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput, Modal, Pressable, FlatList, SectionList, Alert, ActivityIndicator, Dimensions, Linking, Platform } from 'react-native';
import { isPlatformReady, getMissingPlatformFields, hasPlatformPrice } from '../utils/platformRequirements';
import { Paths, Directory, File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import VariantInventoryEditor, { InventoryItemData, VariantInventoryEditorProps } from './VariantInventoryEditor';
import BaseModal from './BaseModal';
import DeliveryShippingSheet from './DeliveryShippingSheet';
import { VoiceRecorder } from './VoiceRecorder';
import PlatformLogo from './PlatformLogo';
import { getPlatform } from '../config/platforms';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Boxes, X, Sparkles, Car, Package, MapPin, Truck, Scale, RefreshCw, ChevronRight, ChevronDown, ChevronLeft, Plus, Check, ArrowRight, AlertTriangle } from 'lucide-react-native';
import { getListingQuality } from '../utils/listingQuality';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Dropdown as ElementDropdown } from 'react-native-element-dropdown';
import { AppDropdown } from './ui/AppDropdown';
import { AppMenuSelect } from './ui/AppMenuSelect';
import { CollapsibleSection, StickyActionBar, ModernInput, SectionHeader, SimpleQuantityInput, ChipsField, LocationDropdown } from './ListingEditor';
import FieldSheet from './ListingEditor/FieldSheet';
import FieldRow from './ListingEditor/FieldRow';
import SheetTextField from './ListingEditor/SheetTextField';
import { getRequiredFieldUnion } from '../utils/fieldVisibility';
import InteractiveMapModal from './InteractiveMapModal';
import { black, grey400 } from 'react-native-paper/lib/typescript/styles/themes/v2/colors';
import { overlay } from 'react-native-paper';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL as ENV_API_BASE_URL } from '../config/env';
import { usePlatformPickerOverlay } from '../context/PlatformPickerOverlayContext';
import { PricingGuidanceCard } from './pricing/PricingGuidanceCard';
import { CHAT_COLORS, CHAT_FONT } from '../design/chatGlass';
import { logger } from 'react-native-reanimated/lib/typescript/common';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { createLogger } from '../utils/logger';
const log = createLogger('ListingEditorForm');


const ACTION_BAR_HEIGHT = 80;
const ACTION_BAR_BOTTOM_OFFSET = 24;

export type PlatformsData = Record<string, any>;

const API_BASE_URL = ENV_API_BASE_URL;

// Module-level pricing-research cache. Keyed by the request inputs so reopening
// the sheet for the same item serves the previous result instantly instead of
// clearing to a loading state and re-hitting the network every time. Survives
// modal close/reopen and component remounts within the session.
const PRICING_RESEARCH_CACHE = new Map<string, { data: any; ts: number }>();
const PRICING_RESEARCH_TTL = 30 * 60 * 1000; // 30 min — refetch only if older
const pricingCacheKey = (input: { title: string; categoryId?: string; condition?: string }) =>
  `${input.title}|${input.categoryId ?? ''}|${input.condition ?? ''}`.trim().toLowerCase();

// Coerce any saved price (which may be a non-numeric string, '', or 'NaN') to a finite
// number, defaulting to 0. Prevents the "$NaN" the inventory editor showed for base products.
const toPrice = (v: any): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// Full-screen Steps wizard (one field per screen, progress + Next).
const wizStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { width: "100%", flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 44 },
  headerBtn: { minWidth: 48, height: 44, justifyContent: 'center' },
  stepCount: { fontSize: 13, fontWeight: '700', color: CHAT_COLORS.dim },
  doneText: { fontSize: 15, fontWeight: '700', color: BRAND_PRIMARY, textAlign: 'right' },
  progress: { flex: 1, flexDirection: 'row', gap: 4, paddingHorizontal: 16, marginTop: 4, marginBottom: 8 },
  seg: { flex: 1,  height: 4, borderRadius: 2 },
  body: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  headline: { fontSize: 26, fontWeight: '800', color: CHAT_COLORS.ink, marginBottom: 18, letterSpacing: -0.3 },
  footer: { paddingHorizontal: 20, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EEF0F2' },
  nextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 16, backgroundColor: BRAND_PRIMARY },
  nextText: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F1F2F4' },
  qIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  qLabel: { fontSize: 15, fontWeight: '600', color: CHAT_COLORS.ink },
  qHint: { fontSize: 13, fontWeight: '600', color: '#BA7517' },
});

// Styles for the row→sheet redesign (clickable detail rows + focused field sheets).
const rowStyles = StyleSheet.create({
  detailsCard: {
    backgroundColor: CHAT_COLORS.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    overflow: 'hidden',
  },
  rowScanBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: CHAT_COLORS.bubble,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  moreToggleText: {
    fontSize: 14,
    fontFamily: CHAT_FONT.semibold,
    color: CHAT_COLORS.dim,
  },
  gapCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(186,117,23,0.10)',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  gapDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#BA7517' },
  gapCtaText: { fontSize: 14, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#BA7517' },
  priceInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: CHAT_COLORS.brand,
    borderRadius: 14,
    paddingHorizontal: 16,
    height: 64,
  },
  priceCurrency: {
    fontSize: 22,
    fontFamily: CHAT_FONT.medium,
    color: CHAT_COLORS.dim,
    marginRight: 6,
  },
  priceInput: {
    flex: 1,
    fontSize: 30,
    fontFamily: CHAT_FONT.bold,
    color: CHAT_COLORS.ink,
    padding: 0,
  },
  researchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    alignSelf: 'flex-start',
  },
  researchBtnText: {
    color: CHAT_COLORS.brandDeep,
    fontSize: 14,
    fontFamily: CHAT_FONT.semibold,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: CHAT_FONT.semibold,
    color: CHAT_COLORS.dim,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  groupLabel: {
    fontSize: 11,
    fontFamily: CHAT_FONT.semibold,
    color: CHAT_COLORS.dim,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 4,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 4,
  },
  radioRowSel: {
    backgroundColor: CHAT_COLORS.brandSoft,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: CHAT_COLORS.faint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioOuterSel: {
    borderColor: CHAT_COLORS.brand,
  },
  radioInner: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: CHAT_COLORS.brand,
  },
  radioLabel: {
    fontSize: 16,
    fontFamily: CHAT_FONT.medium,
    color: CHAT_COLORS.ink,
  },
  sheetFootnote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  sheetFootnoteText: {
    fontSize: 12,
    fontFamily: CHAT_FONT.regular,
    color: CHAT_COLORS.dim,
    flex: 1,
  },
});

type Props = {
  platforms: PlatformsData;
  updateCounter?: number; // Signal when platforms ref content changes
  isGenerationMode?: boolean; // Control whether to show generation-specific UI (overrides etc)
  images: string[];
  platformLocations?: Record<string, Array<{ id: string; name: string; connectionId: string; connectionName: string; platformType: string }>>;
  onChangePlatforms: (next: PlatformsData) => void;
  onChangeImages?: (next: string[]) => void;
  onOpenBarcodeScanner?: (onResult: (code: string) => void) => void;
  onOpenImageCapture?: (onResult: (uris: string[]) => void) => void;
  onAddMissingField?: (platformKey: string) => void;
  getMissingFieldsCount?: (platformKey: string) => number;
  onGeneratePlatform?: (platformKey: string) => Promise<void>;
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
  /** Total deduped required-missing fields across platforms — shown as a badge on the All pill. */
  allMissingCount?: number;
  /** Invoked when the Steps wizard reaches its final "Ready to publish" step — hands off to
   *  the parent's publish flow (pre-publish quality check → publish modal). */
  onRequestPublish?: () => void;
};

export type ListingEditorFormRef = {
  openPlatformPicker: () => void;
  /** Open a specific field's edit sheet (optionally on a given platform tab). Used by the
   *  action-bar "needs you" pill and the missing-fields checklist to jump straight to the gap. */
  openFieldSheet: (field: string, platform?: string) => void;
  /** Steps mode: walk the listing's key fields in the full-screen wizard. */
  startStepsWalk: () => void;
  /** Open the full-screen wizard over the empty required fields. Pass an explicit field
   *  list (e.g. from the parent's cross-platform missing-field count) so the wizard walks
   *  exactly those; omit to use the active tab's own computed gaps. */
  startFixGaps: (fields?: string[]) => void;
};

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

// Platform labels resolve from the canonical registry (config/platforms.ts) via
// getPlatform(). The old local PLATFORM_META map (stale 6-entry copy) was removed.

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

function ListingEditorFormInner({ platforms, updateCounter, images, pendingImages = [], platformLocations, onChangePlatforms, onChangeImages, onOpenBarcodeScanner, onOpenImageCapture, onAddMissingField, getMissingFieldsCount, onGeneratePlatform, onToggleIgnorePlatform, isPlatformIgnored, isGenerationMode = false, externalUpdates, onAdoptExternalUpdate, generatingPlatformKeys, highlightedField, highlightedPlatform, onScrollToOffset, allMissingCount, onRequestPublish }: Props, ref: React.Ref<ListingEditorFormRef>) {
  const isFocused = useIsFocused();
  const fieldYOffsets = useRef<Record<string, number>>({});
  const platformKeys = useMemo(() => {
    const keys = Object.keys(platforms || {}).filter((k) => typeof k === 'string' && k.trim().length > 0);
    log.debug('[ListingEditorForm] platformKeys:', keys);
    return keys;
  }, [platforms]);

  const canonicalKey = useMemo(() => {
    // Prefer first platform that has locations (connected); avoid always preferring Shopify
    const keyWithLocs = platformKeys.find((pk) => (platformLocations || {})[pk]?.length > 0);
    const key = keyWithLocs || platformKeys[0] || 'shopify';
    log.debug('[ListingEditorForm] canonicalKey:', key, 'from platformKeys:', platformKeys);
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
  // Which field's edit sheet is open (row → sheet redesign). null = none.
  const [openField, setOpenField] = useState<string | null>(null);
  // Declared early (used by the imperative handle below); body assigned later where
  // supportsTaxonomy + the gap-queue refs are in scope.
  const startStepsWalkRef = useRef<() => void>(() => {});
  const startFixGapsRef = useRef<(fields?: string[]) => void>(() => {});
  // Full-screen Steps wizard (replaces the old open-sheets-one-by-one walk).
  const [wizardOpen, setWizardOpen] = useState(false);
  const [categoryVoiceOpen, setCategoryVoiceOpen] = useState(false);
  const [wizardSteps, setWizardSteps] = useState<string[]>([]);
  const [wizardIdx, setWizardIdx] = useState(0);
  // Which variant ("size") tab is selected inside the Photos sheet. null → manage the
  // shared set. Set when the seller taps a specific variant's photo in the inventory row.
  const [photoSizeTab, setPhotoSizeTab] = useState<string | null>(null);
  // "More details" expander for the publish-optional long-tail fields.
  const [moreOpen, setMoreOpen] = useState<boolean>(false);

  useEffect(() => {
    // Auto-scroll to highlighted field
    if (highlightedField && fieldYOffsets.current[highlightedField] !== undefined) {
      setTimeout(() => {
        onScrollToOffset?.(fieldYOffsets.current[highlightedField]);
      }, 300);
    }
  }, [highlightedField, activeTab]);

  // NOTE: opening a field's sheet from a "needs you" jump is event-driven via the
  // imperative openFieldSheet ref (called on an explicit tap), NOT a highlightedField
  // effect — otherwise the sheet would auto-pop on screen entry whenever a required
  // field is empty. highlightedField still drives the quiet auto-scroll above + the
  // per-row error state.

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
  // Suggested-price pills only appear once the price field is focused (not always-on).
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
    openFieldSheet: (field: string, platform?: string) => {
      let plat = platform;
      // Category only renders on a taxonomy platform tab (Shopify/eBay), never on 'all' —
      // so jumping to it from Overview must switch to one, else it's a dead tap.
      if (!plat && field === 'category') {
        plat = ['shopify', 'ebay'].find((k) => (platforms as any)[k]) || undefined;
      }
      if (plat) {
        const key = String(plat).toLowerCase();
        if (key && (platforms as any)[key]) setActiveTab(key);
      }
      const map: Record<string, string> = {
        'price (either flat or all variants)': 'price',
        title: 'title', sku: 'sku', category: 'category', description: 'description',
        barcode: 'barcode', weight: 'weight', tags: 'tags', condition: 'condition',
      };
      setOpenField(map[field] || field);
    },
    startStepsWalk: () => startStepsWalkRef.current(),
    startFixGaps: (fields?: string[]) => startFixGapsRef.current(fields),
  }), [platformPickerOverlay, platforms]);

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
    log.debug('[ListingEditorForm] activeTab effect', { canonicalKey, activeTab, platformKeys });
    // Always allow 'all' tab
    if (activeTab === 'all') return;
    // If current platform tab is valid, keep it
    const activeExists = platformKeys.includes(activeTab);
    if (!activeExists && activeTab !== canonicalKey) {
      log.debug('[ListingEditorForm] activeTab invalid → switching to all');
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
        log.error('[ListingEditorForm] Taxonomy search failed:', res.status);
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
      log.error('[ListingEditorForm] Taxonomy search error:', error);
      setTaxonomyResults(prev => ({ ...prev, [normalizedPlatform]: [] }));
    } finally {
      setTaxonomyLoading(prev => ({ ...prev, [normalizedPlatform]: false }));
    }
  }, []);

  // NEW: Suggest taxonomy based on product data (Title + Description)
  const suggestTaxonomy = useCallback(async (autoApply: boolean = false, force: boolean = false) => {
    if (!supportsTaxonomy || !activePlatformKeyLower) return;
    if (activeTab === 'all') return; // Only work on specific platform tabs

    // Prevent redundant auto-fetches — but a manual "Auto-find" tap (force) ALWAYS re-runs,
    // even after the silent auto-suggest already marked this platform as fetched.
    if (autoApply && !force && preventTaxonomyAutoFetchRef.current.has(activePlatformKeyLower)) {
      return;
    }

    const query = activeData.title || '';
    if (!query || query.length < 3) return;

    log.debug(`[Taxonomy] Auto-suggesting for ${activePlatformKeyLower} using title: "${query}"`);

    setTaxonomyLoading(prev => ({ ...prev, [activePlatformKeyLower]: true }));

    try {
      const token = await ensureSupabaseJwt();
      const safeQuery = query.trim();
      log.debug(`[Taxonomy] Auto-suggesting for ${activePlatformKeyLower} using query: "${safeQuery}"`);

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

      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      const taxonomyUrl = `${API_BASE_URL}/api/taxonomy/${activePlatformKeyLower}/suggest`;
      const taxonomyPayload = {
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
      // eBay: resolve via eBay's own (authoritative + cached) Taxonomy API so the result is
      // always a real leaf category at high confidence. Fall back to the local taxonomy
      // resolver if that endpoint is unavailable (e.g. backend not deployed yet) so category
      // never silently breaks. Shopify always uses the local resolver.
      let res: Response | undefined;
      if (activePlatformKeyLower === 'ebay') {
        res = await fetch(`${API_BASE_URL}/api/ebay/category-suggest`, {
          method: 'POST', headers, body: JSON.stringify({ query: safeQuery, title: activeData.title, limit: 15 }),
        }).catch(() => undefined);
      }
      if (!res || !res.ok) {
        res = await fetch(taxonomyUrl, { method: 'POST', headers, body: JSON.stringify(taxonomyPayload) });
      }

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

      // Auto-pick the best match so the seller never has to hunt for a category. The silent
      // auto-run is conservative (only fills a blank, decent confidence); a manual "Auto-find"
      // tap (force) applies the top result even at lower confidence and overwrites what's there.
      const best = data?.suggested || candidates[0];
      if ((autoApply || force) && best) {
        log.debug(`[Taxonomy] Auto-applying best match: ${best.path || best.name}`);

        const currentId = activePlatformKeyLower === 'shopify' ? activeData.productCategoryId : activeData.categoryId;
        const bestScore = typeof data?.confidence === 'number' ? data.confidence : (typeof best.score === 'number' ? best.score : 0);
        // A manual "Auto-find" tap (force) ALWAYS applies the top candidate — the backend
        // sometimes returns good matches with no numeric score, and the old `bestScore >= 0.3`
        // gate silently dropped those (the seller tapped and nothing happened). The silent
        // auto-run still respects the confidence threshold so it only fills a blank when sure.
        if (force || (!currentId && bestScore >= 0.55)) {
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
          log.debug(`[Taxonomy] Auto-apply skipped (score ${bestScore} < 0.55).`);
        }
      }

    } catch (e) {
      log.error('[Taxonomy] Suggestion error:', e);
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

  // Resolve a real taxonomy id for ONE platform (ANY platform, not just the active tab),
  // returning the category fields to merge. The generator only emits a free-text
  // categorySuggestion, so without this the dropdown stays blank / shows a non-selectable
  // value and only the tab the user opens ever gets a category.
  const resolvedTaxonomyRef = useRef<Set<string>>(new Set());
  const resolveTaxonomyForPlatform = useCallback(async (platformKey: string): Promise<{ platformKey: string; updates: any } | null> => {
    const lk = platformKey.toLowerCase();
    if (!['shopify', 'ebay'].includes(lk)) return null;
    const pdata: any = (platforms as any)?.[platformKey] || {};
    const query = String(pdata.title || '').trim();
    if (query.length < 3) return null;
    const currentId = lk === 'shopify' ? (pdata.productCategoryId || pdata.categoryId) : pdata.categoryId;
    if (currentId) return null;
    try {
      const token = await ensureSupabaseJwt();
      const categorySuggestion = pdata.categorySuggestion || pdata.categoryPath || pdata.productCategory || pdata.category;
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const taxonomyBody = JSON.stringify({
        query, title: pdata.title, description: pdata.description, brand: pdata.brand,
        tags: pdata.tags, categorySuggestion, productType: pdata.productType,
        preferLeaf: true, limit: 15, useLlm: true,
      });
      // eBay → authoritative eBay Taxonomy API (real leaf, high confidence), falling back to
      // the local resolver if it's unavailable (e.g. backend not deployed yet). Shopify → local.
      let res: Response | undefined;
      if (lk === 'ebay') {
        res = await fetch(`${API_BASE_URL}/api/ebay/category-suggest`, {
          method: 'POST', headers, body: JSON.stringify({ query, title: pdata.title, limit: 15 }),
        }).catch(() => undefined);
      }
      if (!res || !res.ok) {
        res = await fetch(`${API_BASE_URL}/api/taxonomy/${lk}/suggest`, { method: 'POST', headers, body: taxonomyBody });
      }
      if (!res.ok) return null;
      const data = await res.json();
      const best = data?.suggested;
      const bestScore = typeof data?.confidence === 'number' ? data.confidence : (typeof best?.score === 'number' ? best.score : 0);
      if (!best || bestScore < 0.7) return null;
      const updates: any = lk === 'shopify'
        ? { productCategoryId: best.platformCategoryId || best.value, productCategory: best.path || best.name, categoryPath: best.path || best.name }
        : { categoryId: best.platformCategoryId || best.value, category: best.path || best.name, categoryPath: best.path || best.name };
      updates.taxonomyConfidence = bestScore;
      updates.taxonomySource = data?.method || 'llm';
      return { platformKey, updates };
    } catch (e) {
      log.error('[Taxonomy] per-platform resolve error', e);
      return null;
    }
  }, [platforms]);

  // Auto-resolve category for ALL connected taxonomy platforms after generation (one-shot per
  // platform). Single merged, category-only write so concurrent resolves can't clobber.
  useEffect(() => {
    const toResolve = platformKeys.filter((pk) => {
      const lk = pk.toLowerCase();
      if (!['shopify', 'ebay'].includes(lk)) return false;
      const pdata: any = (platforms as any)?.[pk] || {};
      const id = lk === 'shopify' ? (pdata.productCategoryId || pdata.categoryId) : pdata.categoryId;
      return !id && !!pdata.title && !resolvedTaxonomyRef.current.has(lk);
    });
    if (toResolve.length === 0) return;
    toResolve.forEach((pk) => resolvedTaxonomyRef.current.add(pk.toLowerCase()));
    let cancelled = false;
    (async () => {
      const results = await Promise.all(toResolve.map((pk) => resolveTaxonomyForPlatform(pk)));
      if (cancelled) return;
      const valid = results.filter(Boolean) as Array<{ platformKey: string; updates: any }>;
      if (valid.length === 0) return;
      const partial: Record<string, any> = {};
      for (const { platformKey, updates } of valid) partial[platformKey] = updates;
      onChangePlatforms(partial as any);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformKeys, (platforms as any)?.shopify?.title, (platforms as any)?.ebay?.title]);

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
      log.error('[ListingEditorForm] Aspects fetch error:', e);
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
      log.error('[ListingEditorForm] eBay conditions fetch error:', e);
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

    // Serve a recent cached result instantly — open the sheet with the previous
    // result and skip the network round-trip / loading flash entirely.
    const key = pricingCacheKey(input);
    const cached = PRICING_RESEARCH_CACHE.get(key);
    if (cached && Date.now() - cached.ts < PRICING_RESEARCH_TTL) {
      setPricingResearchResult(cached.data);
      setPricingResearchModalVisible(true);
      return;
    }

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
      if (data && !data.error) PRICING_RESEARCH_CACHE.set(key, { data, ts: Date.now() });
      setPricingResearchResult(data);
      setPricingResearchModalVisible(true);
    } catch (e) {
      log.error('[ListingEditorForm] Pricing research error:', e);
      setPricingResearchResult({ error: (e as Error)?.message || 'Failed to research pricing' });
      setPricingResearchModalVisible(true);
    } finally {
      setPricingResearchLoading(false);
    }
  }, [pricingResearchInput]);

  // Auto-load sold-comps pricing research the moment the Price step appears — in the
  // bottom sheet (openField) AND the full-screen wizard — so the going-rate bar + recent
  // comps are there waiting, instead of hiding behind a "See what it sells for" tap.
  useEffect(() => {
    const onPriceStep = openField === 'price' || (wizardOpen && wizardSteps[wizardIdx] === 'price');
    if (onPriceStep && titleForPricingResearch && !pricingResearchResult && !pricingResearchLoading) {
      fetchPricingResearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openField, wizardOpen, wizardIdx, wizardSteps, titleForPricingResearch]);

  // The Category editor only renders on a taxonomy platform tab (Shopify/eBay), never on
  // 'all'. When the wizard reaches the Category step from the 'all' tab, switch to the
  // taxonomy platform that's actually missing a category — otherwise it shows the dead
  // "No category needed." fallback.
  useEffect(() => {
    if (!(wizardOpen && wizardSteps[wizardIdx] === 'category')) return;
    if (activeTab !== 'all') return;
    const needsCat = (k: string) => {
      const pd: any = (platforms as any)[k];
      if (!pd) return false;
      return k === 'shopify' ? !pd.productCategoryId : !pd.categoryId;
    };
    const target = ['shopify', 'ebay'].find(needsCat) || ['shopify', 'ebay'].find((k) => (platforms as any)[k]);
    if (target) setActiveTab(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOpen, wizardIdx, wizardSteps, activeTab]);

  // Barcodes are scanned, not typed — when the Barcode step opens (wizard OR sheet) with no
  // code yet, open the scanner straight away. No second tap on a tiny "Scan" button.
  const barcodeAutoScanRef = useRef(false);
  useEffect(() => {
    const onBarcode = openField === 'barcode' || (wizardOpen && wizardSteps[wizardIdx] === 'barcode');
    if (!onBarcode) { barcodeAutoScanRef.current = false; return; }
    if (barcodeAutoScanRef.current || (activeData as any).barcode || !onOpenBarcodeScanner) return;
    barcodeAutoScanRef.current = true;
    const t = setTimeout(() => onOpenBarcodeScanner((code: string) => patchField('barcode', code)), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openField, wizardOpen, wizardIdx, wizardSteps]);

  const fetchShippingEstimate = useCallback(
    async (override?: { weight: string; weightUnit: string; estimatedDimensions?: { length: number; width: number; height: number } }) => {
      // Fall back to the AI's estimated weight (shipping vision) when the seller hasn't
      // set one yet — so a freshly generated item shows a shipping estimate without a tap.
      const ew = (activeData as any).estimatedWeight;
      const ownWeight = typeof activeData.weight === 'number' ? activeData.weight : parseFloat(String(activeData.weight ?? ''));
      const fallbackWeight = (Number.isFinite(ownWeight) && ownWeight > 0)
        ? ownWeight
        : (ew && Number(ew.value) > 0 ? Number(ew.value) : NaN);
      const num = override ? parseFloat(override.weight) : fallbackWeight;
      if (!Number.isFinite(num) || num <= 0) {
        setShippingEstimateResult(null);
        return;
      }
      setShippingEstimateLoading(true);
      setShippingEstimateResult(null);
      try {
        const token = await ensureSupabaseJwt();
        const dims = override?.estimatedDimensions ?? (activeData as any).estimatedDimensions;
        const weightUnit = override?.weightUnit ?? (activeData.weightUnit || ew?.unit || 'lb');
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
    [activeData.weight, activeData.weightUnit, (activeData as any).estimatedDimensions, (activeData as any).estimatedWeight],
  );

  useEffect(() => {
    if (shippingEstimateDebounceRef.current) clearTimeout(shippingEstimateDebounceRef.current);
    const ew = (activeData as any).estimatedWeight;
    const ownW = typeof activeData.weight === 'number' ? activeData.weight : parseFloat(String(activeData.weight ?? ''));
    const num = (Number.isFinite(ownW) && ownW > 0) ? ownW : (ew && Number(ew.value) > 0 ? Number(ew.value) : NaN);
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
  }, [activeData.weight, activeData.weightUnit, (activeData as any).estimatedDimensions, (activeData as any).estimatedWeight, fetchShippingEstimate]);

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
  // SKU is required everywhere — it's anorha's cross-platform sync link key (autoLinkBy: sku),
  // and it's enforced in the registry too (publish-readiness / gap pill / wizard all agree).
  const requiredByPlatform: Record<string, string[]> = useMemo(() => ({
    shopify: ['title', 'sku', 'price', 'category'],
    square: ['title', 'sku', 'price'],
    amazon: ['title', 'sku', 'price'],
    ebay: ['title', 'sku', 'price', 'category'],
    facebook: ['title', 'sku', 'price'],
    clover: ['name', 'sku', 'price'],
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

  // ── Fix-the-gaps + Steps wizard ─────────────────────────────────────────
  // Both open a real full-screen wizard (renderStepsWizard) — Steps walks the key
  // fields, Fix-gaps walks only the empty required ones. One field per full step.
  const computeGaps = (): string[] => {
    const d: any = activeData;
    const gaps: string[] = [];
    if (requiredFields?.includes?.('title') && !d.title) gaps.push('title');
    const hasVariantsPriced = ((d.options || []).length > 0 && (d.variants || []).length > 0)
      && (d.variants || []).every((v: any) => v.price != null && v.price !== '' && Number(v.price) > 0);
    const priceEmpty = d.price == null || String(d.price) === '' || Number(d.price) === 0;
    if (requiredFields?.includes?.('price') && !hasVariantsPriced && priceEmpty) gaps.push('price');
    if (requiredFields?.includes?.('sku') && !d.sku) gaps.push('sku');
    if (categoryRequired && !selectedCategoryId) gaps.push('category');
    return gaps;
  };
  const openWizard = (steps: string[]) => {
    if (!steps.length) return;
    setWizardSteps(steps);
    setWizardIdx(0);
    setWizardOpen(true);
  };
  // The wizard's LAST field step's button is "Publish" → hands off to the publish settings.
  // No separate review/overview step — the quality check already leads the Steps walk, so a
  // second one at the end is redundant (per the seller's ask).
  const startFixGaps = (fields?: string[]) => {
    const steps = fields && fields.length ? fields : computeGaps();
    if (!steps.length) return;
    openWizard(steps);
  };
  startFixGapsRef.current = startFixGaps;
  startStepsWalkRef.current = () => openWizard([
    '__quality__', 'title', 'price',
    ...(supportsTaxonomy ? ['category'] : []),
    'condition', 'sku', 'tags',
  ]);

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

  // Like patchField but writes several keys in ONE onChangePlatforms call. Calling
  // patchField then patchPlatform back-to-back both read the same stale `platforms`
  // closure, so the second write clobbered the first (e.g. the price chip set the price
  // and then the band write reset it — the chip appeared to do nothing).
  const patchFields = (patch: Record<string, any>) => {
    if (activeTab === 'all') {
      const next = { ...platforms };
      for (const platformKey of platformKeys) {
        next[platformKey] = { ...(platforms[platformKey] || {}), ...patch };
      }
      onChangePlatforms(next);
    } else {
      const keyToEdit = activePlatformKey;
      const next = { ...platforms, [keyToEdit]: { ...(platforms[keyToEdit] || {}), ...patch } };
      onChangePlatforms(next);
    }
  };

  const patchPlatform = (updater: (prev: PlatformState) => PlatformState) => {
    const prev = (platforms[activePlatformKey] || {}) as PlatformState;
    const nextPlatform = updater(prev);
    log.debug(`[PATCH] ${activePlatformKey}: variants before=${(prev.variants || []).length}, after=${(nextPlatform.variants || []).length}`);
    if (nextPlatform.variants?.length) {
      log.debug(`[PATCH] First variant inv keys:`, Object.keys(nextPlatform.variants[0]?.inventoryByLocation || {}));
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

    log.debug(`[ListingEditorForm LOCS] platform=${platformKey}, platformLocsKeys=${Object.keys(platformLocations || {}).join(',')}, count=${platformLocs.length}`);

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
        log.debug(`[ListingEditorForm LOCS] Filtered ${activeData.locations.length} → ${collapsed.length} for ${platformKey}`);
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
      log.debug(`[LOC-RESET] selectedLocationId ${selectedLocationId} no longer valid! Resetting to ${firstValidLoc}`);
      setSelectedLocationId(firstValidLoc);
    }
  }, [locations]);

  // Debug logging for inventory state (after locations are defined)
  log.debug('[ListingEditorForm] Inventory state:', {
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
    log.debug('[recomputeVariants] Starting variant recomputation for', activePlatformKey, 'activeTab:', activeTab);
    const opts = (activeData.options || []).filter(o => Array.isArray(o.values) && o.values.length);
    log.debug('[recomputeVariants] Options:', opts);

    if (!opts.length) {
      log.debug('[recomputeVariants] No options, clearing variants');
      patchPlatform(prev => ({ ...prev, variants: [] }));
      return;
    }

    const names = opts.map(o => o.name);
    const vals = opts.map(o => o.values);
    const combos = cartesian(vals);
    log.debug('[recomputeVariants] Generated', combos.length, 'variant combinations');

    // CRITICAL: ALWAYS sync variants to ALL platforms when options change
    // This ensures consistency - user edits on any tab apply everywhere
    const platformsToUpdate = platformKeys;
    log.debug('[recomputeVariants] Updating ALL platforms:', platformsToUpdate);

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

          log.debug(`[recomputeVariants] Created new variant for ${platformKey}:`, id);
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

    log.debug('[recomputeVariants] Updating', platformsToUpdate.length, 'platforms with variants');
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
    log.debug('[Options useEffect] Running for platform:', activePlatformKey, 'options:', activeData.options);
    const cleaned = normalizeOptions(activeData.options);
    log.debug('[Options useEffect] Normalized options:', cleaned);

    if (JSON.stringify(cleaned) !== JSON.stringify(activeData.options || [])) {
      log.debug('[Options useEffect] Options changed, updating platform');
      patchPlatform(prev => ({ ...prev, options: cleaned }));
    }

    // CRITICAL FIX: Only recompute variants if OPTIONS changed, not just platform
    const optionsJson = JSON.stringify(activeData.options || []);
    const platformChanged = lastPlatformRef.current !== activePlatformKey;
    const optionsChanged = lastOptionsRef.current !== optionsJson;

    log.debug('[Options useEffect] Changes detected:', { platformChanged, optionsChanged, hasPreviousPlatform: !!lastPlatformRef.current, prevOptions: lastOptionsRef.current, currentOptions: optionsJson });

    // ONLY recompute if options actually changed, NOT on platform switch
    if (optionsChanged && (optionsJson !== '[]' || lastOptionsRef.current !== '[]')) {
      // Options truly changed (not just switching to empty options)
      log.debug('[Options useEffect] Scheduling recomputeVariants (options actually changed)');
      setTimeout(recomputeVariants, 0);
    } else if (platformChanged && lastPlatformRef.current) {
      // Just switching platforms - DON'T recompute, preserve variants from current platform
      log.debug('[Options useEffect] Platform switched - NOT recomputing variants (preserving data)');
    } else if (!lastPlatformRef.current) {
      // First load of ANY platform
      log.debug('[Options useEffect] First load - recomputing variants');
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

      log.debug('[fetchAllPlatformOptions] ⚡ Querying PlatformOptions directly from DB (no API call)...');

      // Step 1: Get active connections for this user
      const { data: connections, error: connError } = await supabase
        .from('PlatformConnections')
        .select('Id')
        .eq('UserId', user.id)
        .eq('IsEnabled', true);

      if (connError || !connections || connections.length === 0) {
        log.debug('[fetchAllPlatformOptions] No active connections found');
        setAllPlatformOptions([]);
        setOptionPresets([]);
        return;
      }

      const connectionIds = connections.map(c => c.Id);
      log.debug('[fetchAllPlatformOptions] Found', connectionIds.length, 'active connections');

      // Step 2: Query PlatformOptions for these connections
      const { data: platformOptions, error } = await supabase
        .from('PlatformOptions')
        .select('Name, Values, Source')
        .in('PlatformConnectionId', connectionIds);

      if (error) {
        log.error('[fetchAllPlatformOptions] DB query error:', error);
        return;
      }

      log.debug('[fetchAllPlatformOptions] Retrieved', platformOptions?.length || 0, 'raw options from DB');

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

      log.debug('[fetchAllPlatformOptions] ✅ Loaded', formatted.length, 'deduplicated platform options from DB in <1s');
      setAllPlatformOptions(formatted);
      setOptionPresets(formatted); // Reuse as presets too
    } catch (error) {
      log.error('[fetchAllPlatformOptions] Error:', error);
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
    log.debug(`[INV] setVariantAtLocation START - variant: ${variantId}, location: ${locId}, field: ${field}, value: ${value}`);
    patchPlatform(prev => {
      const variants = (prev.variants || []).map(v => {
        if (v.id !== variantId) return v;

        log.debug(`[INV] Found variant ${variantId}, current inventoryByLocation keys:`, Object.keys(v.inventoryByLocation || {}));

        const inv = { ...(v.inventoryByLocation || {}) };
        if (!inv[locId]) {
          log.debug(`[INV] ⚠️  Location ${locId} missing! Creating new entry`);
          inv[locId] = { quantity: 0, price: 0 };
        }

        const oldVal = inv[locId][field];
        inv[locId] = { ...inv[locId], [field]: value };

        log.debug(`[INV] Updated ${field}: ${oldVal} → ${value} at location ${locId}`);
        log.debug(`[INV] After update, inventoryByLocation keys:`, Object.keys(inv));

        return { ...v, inventoryByLocation: inv };
      });
      return { ...prev, variants };
    });
  };

  // NEW: Set global variant price (does not touch per-location quantities)
  const setVariantPrice = (variantId: string, price: number) => {
    log.debug(`[PRICE] setVariantPrice START - variant: ${variantId}, price: ${price}`);
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
        log.error('Platform generation failed:', error);
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

  // ── Row→sheet redesign helpers ───────────────────────────────────────────
  // The detail rows (a tappable summary of each field) + the focused field sheets
  // they open. All editing routes through the SAME handlers as before
  // (patchField / patchPlatform / fetchPricingResearch / taxonomy / etc.) — the
  // sheets just relocate the editors out of the inline form. Nothing is dropped.
  const refilledIncludes = (k: string) =>
    Array.isArray((platforms as any)[activePlatformKey]?.__refilled) &&
    (platforms as any)[activePlatformKey].__refilled.includes(k);

  const conditionDisplay = (() => {
    if (activePlatformKeyLower === 'ebay' && (activeData as any).conditionID) {
      const c = ebayConditions.find((cc: any) => String(cc.conditionId) === String((activeData as any).conditionID));
      if (c) return c.conditionName;
    }
    const v = (activeData as any).condition;
    const map: Record<string, string> = { new: 'New', like_new: 'Like New', good: 'Good', fair: 'Fair', used: 'Used', refurbished: 'Refurbished', for_parts: 'For Parts' };
    return v ? (map[v] || v) : null;
  })();

  // camelCase / snake_case → "Title Case" for arbitrary platform field labels.
  const humanizeKey = (k: string) =>
    k.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()).trim();

  // Every field already shown as a dedicated row/sheet (or handled elsewhere) — excluded from
  // the generic "additional fields" rows so nothing double-renders and no JSON blob appears.
  const STANDARD_FIELD_KEYS = new Set([
    'title', 'description', 'tags', 'price', 'weight', 'weightUnit', 'sku', 'barcode', 'images', 'imageUris',
    'options', 'variants', 'locations', 'locationQuantities', 'inventoryType', 'condition', 'conditionID',
    'category', 'categoryId', 'productCategoryId', 'productCategory', 'categoryPath', 'taxonomyConfidence',
    'taxonomySource', 'itemSpecifics', 'brand', 'vendor', 'compareAtPrice', 'productType', 'seoTitle',
    'seoDescription', 'seo', 'aiPriceRecommendation', 'aiRecommendedPrice', 'pickupLocation', 'deliveryMethod',
    'shippingCost', 'shippingOptions', 'shippingTier', 'estimatedDimensions', 'estimatedWeight', 'imageUrls',
    '__refilled', '__variantSuggestions', '_rawResponse', '_parseError', '_extractedJson',
  ]);

  // Any remaining platform-specific string/number fields, as clean rows folded INTO the
  // MORE DETAILS card (only when present). On the All tab `activeData` is the canonical
  // platform, so the All card shows its extras; a platform tab shows that platform's extras.
  const renderAdditionalRows = () => {
    const extra = Object.entries(activeData || {}).filter(([k, v]) =>
      !STANDARD_FIELD_KEYS.has(k) && !k.startsWith('_') && v != null && (typeof v === 'string' || typeof v === 'number')
    );
    if (extra.length === 0) return null;
    return (
      <>
        {extra.map(([k, v]) => (
          <FieldRow key={`extra-${k}`} label={humanizeKey(k)} value={String(v)} placeholder="Add" onPress={() => setOpenField(`extra:${k}`)} />
        ))}
      </>
    );
  };

  // Long-tail detail rows shown inline under MORE DETAILS (no JSON, no tap-to-expand).
  const renderExtraDetailRows = () => {
    const compareAt = (activeData as any).compareAtPrice;
    const productType = (activeData as any).productType;
    const seoTitle = (activeData as any).seoTitle ?? (activeData as any).seo?.seoTitle;
    const seoDescription = (activeData as any).seoDescription ?? (activeData as any).seo?.seoDescription;
    const photoCount = (images || []).filter(Boolean).length;
    return (
      <>
        <FieldRow label="Photos" value={photoCount ? `${photoCount} photo${photoCount > 1 ? 's' : ''}` : null} placeholder="Add photos" onPress={() => setOpenField('photos')} />
        <FieldRow label="Compare-at price" value={compareAt != null && String(compareAt) !== '' ? `$${compareAt}` : null} placeholder="Optional" onPress={() => setOpenField('compareAtPrice')} />
        <FieldRow label="Product type" value={productType} placeholder="Optional" onPress={() => setOpenField('productType')} />
        <FieldRow label="SEO title" value={seoTitle} placeholder="Optional" onPress={() => setOpenField('seoTitle')} />
        <FieldRow label="SEO description" value={seoDescription} placeholder="Optional" onPress={() => setOpenField('seoDescription')} last />
      </>
    );
  };

  const renderDetailsCard = () => {
    const fieldVis = getRequiredFieldUnion(platformKeys);
    const showDescriptionTop = fieldVis.required.includes('description') || !!((activeData as any).description && String((activeData as any).description).trim());
    const hasVariantsWithOptions = ((activeData as any).options || []).length > 0 && ((activeData as any).variants || []).length > 0;
    const allVariantsHavePrice = hasVariantsWithOptions && ((activeData as any).variants || []).every((v: any) => v.price != null && v.price !== '' && Number(v.price) > 0);
    // When every variant is priced, show a min–max RANGE instead of a confusing single
    // "base price". The scalar price stays editable underneath (platforms still send it).
    const variantPrices = ((activeData as any).variants || []).map((v: any) => Number(v.price)).filter((n: number) => Number.isFinite(n) && n > 0);
    const priceRange = allVariantsHavePrice && variantPrices.length ? { min: Math.min(...variantPrices), max: Math.max(...variantPrices) } : null;
    const rangeDisplay = priceRange ? (priceRange.min === priceRange.max ? `$${priceRange.min.toFixed(2)}` : `$${priceRange.min.toFixed(2)} – $${priceRange.max.toFixed(2)}`) : null;
    const priceRequired = requiredFields?.includes?.('price') && !allVariantsHavePrice;
    const priceError = priceRequired && ((activeData as any).price == null || String((activeData as any).price) === '' || Number((activeData as any).price) === 0);
    const titleError = requiredFields?.includes?.('title') && !(activeData as any).title;
    const skuError = requiredFields?.includes?.('sku') && !(activeData as any).sku;
    const categoryDisplay = (activeData as any).categoryPath || (activeData as any).category || (activeData as any).productCategory || null;
    const priceVal = (activeData as any).price;
    const priceDisplay = priceVal != null && String(priceVal) !== '' ? `$${priceVal}` : null;
    const tagsArr = Array.isArray((activeData as any).tags) ? (activeData as any).tags : [];

    return (
      <View style={{ paddingTop: 18 }}>
        {/* The "N fields need you" signal lives only in the header now (single source of
            truth for the count); the in-form banner was removed to avoid a mismatch. */}
        <View style={rowStyles.detailsCard}>
          <View onLayout={recordFieldLayout('title')}>
            <FieldRow label="Title" layout="stacked" required value={(activeData as any).title} placeholder="Add a title" error={!!titleError} externalUpdate={hasExternalUpdate('title')} refilled={refilledIncludes('title')} onPress={() => setOpenField('title')} />
          </View>
          <FieldRow label="Description" layout="stacked" value={(activeData as any).description} placeholder="Add a description" externalUpdate={hasExternalUpdate('description')} refilled={refilledIncludes('description')} onPress={() => setOpenField('description')} />

          <View onLayout={recordFieldLayout('price (either flat or all variants)')}>
            <FieldRow label={rangeDisplay ? 'Price range' : (hasVariantsWithOptions ? 'Base price' : 'Price')} layout="stacked" required={!!priceRequired} value={rangeDisplay ?? priceDisplay} placeholder="Set a price" error={!!priceError} externalUpdate={hasExternalUpdate('price')} refilled={refilledIncludes('price')} onPress={() => setOpenField('price')} />
          </View>
          <View onLayout={recordFieldLayout('sku')}>
            <FieldRow label="SKU" required value={(activeData as any).sku} placeholder="Add a SKU" error={!!skuError} externalUpdate={hasExternalUpdate('sku')} refilled={refilledIncludes('sku')} onPress={() => setOpenField('sku')} />
          </View>
          {supportsTaxonomy && (
            <View onLayout={recordFieldLayout('category')}>
              {/* Only a hard error when truly empty — a found suggestion (categoryDisplay,
                  pending id resolution) shows calmly, not as a red alarm. */}
              <FieldRow label="Category" value={categoryDisplay} placeholder={categoryRequired ? 'Add a category' : 'Optional'} required={!!categoryRequired} error={!!categoryMissing && !categoryDisplay} onPress={() => setOpenField('category')} />
            </View>
          )}
          <FieldRow label="Condition" value={conditionDisplay} placeholder="Select condition" onPress={() => setOpenField('condition')} />
          <FieldRow
            label="Barcode"
            value={(activeData as any).barcode}
            placeholder="Add or scan"
            externalUpdate={hasExternalUpdate('barcode')}
            onPress={() => setOpenField('barcode')}
            trailing={
              <TouchableOpacity
                style={rowStyles.rowScanBtn}
                onPress={() => { (onOpenBarcodeScanner || (() => { }))((code: string) => patchField('barcode', code)); }}
              >
                <Icon name="qrcode-scan" size={18} color={CHAT_COLORS.dim} />
              </TouchableOpacity>
            }
          />
          <FieldRow label="Tags" value={tagsArr.length ? `${tagsArr.length} tag${tagsArr.length > 1 ? 's' : ''}` : null} placeholder="Add tags" refilled={refilledIncludes('tags')} onPress={() => setOpenField('tags')} last />
        </View>

        {/* More details — collapsed by default behind a Show all / Show less toggle so the
            form opens short. Every optional, non-money-mover field lives here; the seller
            reveals the long-tail only when they actually want it. */}
        <TouchableOpacity style={rowStyles.moreToggle} activeOpacity={0.6} onPress={() => setMoreOpen((v) => !v)}>
          <Text style={[rowStyles.groupLabel, { marginTop: 0, marginBottom: 0, marginLeft: 0 }]}>MORE DETAILS</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={rowStyles.moreToggleText}>{moreOpen ? 'Show less' : 'Show all'}</Text>
            <Icon name={moreOpen ? 'chevron-up' : 'chevron-down'} size={18} color={CHAT_COLORS.dim} />
          </View>
        </TouchableOpacity>
        {moreOpen && (
          <View style={rowStyles.detailsCard}>
            <FieldRow label="Brand" value={(activeData as any).brand || (activeData as any).vendor} placeholder="Add brand" onPress={() => setOpenField('brand')} />
            <FieldRow label="Weight" value={(activeData as any).weight ? `${(activeData as any).weight} ${(activeData as any).weightUnit || 'oz'}` : null} placeholder="Add weight" onPress={() => setOpenField('weight')} />
            {renderExtraDetailRows()}
          </View>
        )}
      </View>
    );
  };

  // ── Steps wizard: one field per full screen (NOT a bottom sheet) ─────────
  const STEP_META: Record<string, string> = {
    __quality__: 'Quick check',
    title: 'Name it',
    description: 'Describe it',
    price: "What's it worth?",
    category: 'Category',
    condition: 'Condition',
    sku: 'SKU',
    barcode: 'Barcode',
    tags: 'Tags',
    weight: 'Weight',
    photos: 'Photos',
  };

  // The focused editor for a single wizard step. Reuses the same field
  // components as the sheets; price/category/condition are focused variants.
  // ── Smart (AI) category editor — shared by the wizard step + the field sheet ──
  // Surfaces the taxonomy engine's RANKED candidates with their confidence scores (a real
  // best-match + a couple of alternates), instead of a flat keyword list where everything
  // looked like a "perfect match". Typing refines via the same ranked search.
  const renderCategoryEditor = (): React.ReactNode => {
    if (!supportsTaxonomy) {
      const hasTaxPlat = ['shopify', 'ebay'].some((k) => (platforms as any)[k]);
      if (hasTaxPlat) return <ActivityIndicator size="small" color={BRAND_PRIMARY} style={{ marginTop: 8 }} />;
      return <Text style={{ color: CHAT_COLORS.dim, fontSize: 14 }}>No category needed.</Text>;
    }
    const d: any = activeData;
    const catLower = activePlatformKeyLower;
    const isShopify = catLower === 'shopify';
    const currentId = isShopify ? d.productCategoryId : d.categoryId;
    const detected: string | null = d.categoryPath || d.category || d.productCategory || null;
    const loading = !!taxonomyLoading[catLower];
    const cleanPath = (p: any) => String(p || '').replace(/^Root\s*[>›]\s*/i, '').replace(/\s*[>›]\s*/g, ' › ').trim();
    const leafOf = (item: any) => {
      const parts = cleanPath(item?.path || item?.label || item?.value).split(' › ');
      return parts[parts.length - 1] || item?.label || 'Category';
    };
    const apply = (item: any) => {
      const path = item.path || item.label || item.value;
      if (isShopify) patchPlatform((prev) => ({ ...prev, productCategoryId: item.value, productCategory: path, categoryPath: path, taxonomyConfidence: item.score || 1.0, taxonomySource: 'manual' }));
      else patchPlatform((prev) => ({ ...prev, categoryId: item.value, category: path, categoryPath: path, taxonomyConfidence: item.score || 1.0, taxonomySource: 'manual' }));
      setTaxonomyQueries((prev) => ({ ...prev, [catLower]: '' }));
    };
    const conf = (s: any) => (typeof s === 'number' ? `${Math.round(s * 100)}%` : '');
    // Searching → the ranked search hits; otherwise the auto-suggested candidates.
    const searching = !!activeTaxonomyQuery && taxonomyDropdownData.length > 0;
    const ranked: any[] = (searching ? taxonomyDropdownData : (taxonomyResults[catLower] || [])).slice().sort((a: any, b: any) => (b?.score || 0) - (a?.score || 0));
    const best = ranked[0];
    const alts = ranked.slice(1, 3);
    return (
      <View>
        {/* Describe-it search — type, or say it (voice → fills the query → ranked match) */}
        {categoryVoiceOpen ? (
          <VoiceRecorder
            apiBaseUrl={API_BASE_URL}
            getAuthToken={ensureSupabaseJwt}
            onTranscription={(t) => { setTaxonomyQueries((prev) => ({ ...prev, [catLower]: t })); setCategoryVoiceOpen(false); }}
            onCancel={() => setCategoryVoiceOpen(false)}
          />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, paddingHorizontal: 14, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 13, backgroundColor: '#FFFFFF' }}>
              <Icon name="magnify" size={18} color="#9CA3AF" />
              <TextInput
                style={{ flex: 1, fontSize: 15, color: '#111827', paddingVertical: 0 }}
                value={activeTaxonomyQuery}
                onChangeText={(text) => setTaxonomyQueries((prev) => ({ ...prev, [catLower]: text }))}
                placeholder="Describe it — a few words"
                placeholderTextColor="#9CA3AF"
              />
              {loading ? <ActivityIndicator size="small" color="#9CA3AF" /> : null}
            </View>
            <TouchableOpacity onPress={() => setCategoryVoiceOpen(true)} activeOpacity={0.85} style={{ width: 50, height: 50, borderRadius: 13, backgroundColor: BRAND_PRIMARY, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="microphone" size={20} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity onPress={() => suggestTaxonomy(true, true)} disabled={loading} style={[rowStyles.researchBtn, { marginTop: 12, marginBottom: 4 }]}>
          {loading ? <ActivityIndicator size="small" color={BRAND_PRIMARY} /> : <Sparkles size={15} color={BRAND_PRIMARY} />}
          <Text style={rowStyles.researchBtnText}>{loading ? 'Finding the best match…' : (detected ? 'Re-detect from photo + title' : 'Auto-find')}</Text>
        </TouchableOpacity>

        {/* Best match (AI, ranked by confidence) */}
        {best ? (
          <TouchableOpacity activeOpacity={0.85} onPress={() => apply(best)} style={{ marginTop: 10, gap: 8, backgroundColor: '#F2F8E3', borderWidth: 1.5, borderColor: BRAND_PRIMARY, borderRadius: 16, padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ backgroundColor: BRAND_PRIMARY, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}><Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.4 }}>BEST</Text></View>
              <View style={{ flex: 1 }} />
              {conf(best.score) ? <Text style={{ color: CHAT_COLORS.brandDeep, fontFamily: CHAT_FONT.bold, fontSize: 15, fontWeight: '800' }}>{conf(best.score)}</Text> : null}
              {!searching && (cleanPath(detected) === cleanPath(best.path || best.label)) ? <Icon name="check-circle" size={18} color={BRAND_PRIMARY} /> : null}
            </View>
            <Text style={{ color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold, fontSize: 18, fontWeight: '800' }}>{leafOf(best)}</Text>
            <Text style={{ color: CHAT_COLORS.dim, fontSize: 12 }} numberOfLines={2}>{cleanPath(best.path || best.label)}</Text>
          </TouchableOpacity>
        ) : detected ? (
          <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CHAT_COLORS.brandSoft, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: BRAND_PRIMARY, alignItems: 'center', justifyContent: 'center' }}><Check size={14} color="#FFFFFF" /></View>
            <Text style={{ flex: 1, color: CHAT_COLORS.ink, fontSize: 14, fontWeight: '600' }}>{cleanPath(detected)}</Text>
          </View>
        ) : null}

        {/* Ranked alternates — a couple, not a billion */}
        {alts.length > 0 ? (
          <View style={{ marginTop: 10, gap: 8 }}>
            {alts.map((item: any, i: number) => (
              <TouchableOpacity key={`${item.value}-${i}`} activeOpacity={0.85} onPress={() => apply(item)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 13, padding: 13 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: CHAT_COLORS.ink, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{leafOf(item)}</Text>
                  <Text style={{ color: CHAT_COLORS.dim, fontSize: 12 }} numberOfLines={1}>{cleanPath(item.path || item.label)}</Text>
                </View>
                {conf(item.score) ? <Text style={{ color: '#9CA3AF', fontFamily: CHAT_FONT.bold, fontSize: 13, fontWeight: '700' }}>{conf(item.score)}</Text> : null}
                <ChevronRight size={17} color="#C4C4BD" />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
    );
  };

  const renderStepEditor = (field: string): React.ReactNode => {
    const d: any = activeData;
    switch (field) {
      case '__quality__': {
        const q = getListingQuality({ canonical: d, photoCount: (images || []).filter(Boolean).length });
        return (
          <View style={{ gap: 10 }}>
            {q.rows.map((r) => (
              <View key={r.key} style={wizStyles.qRow}>
                <View style={[wizStyles.qIcon, { backgroundColor: r.ok ? CHAT_COLORS.brandSoft : '#FBF1DF' }]}>
                  {r.ok ? <Check size={15} color={BRAND_PRIMARY} /> : <AlertTriangle size={14} color="#BA7517" />}
                </View>
                <Text style={wizStyles.qLabel}>{r.label}</Text>
                <View style={{ flex: 1 }} />
                {!r.ok ? <Text style={wizStyles.qHint}>{r.hint}</Text> : null}
              </View>
            ))}
          </View>
        );
      }
      case 'title':
        return <SheetTextField value={d.title} onChangeText={(t) => patchField('title', t)} multiline autoFocus placeholder="Product title" maxLength={80} showCount />;
      case 'description':
        return <SheetTextField value={d.description} onChangeText={(t) => patchField('description', t)} multiline autoFocus placeholder="Describe it…" />;
      case 'sku':
        return <SheetTextField value={d.sku} onChangeText={(t) => patchField('sku', t)} autoFocus placeholder="e.g. LAV-04" />;
      case 'barcode':
        return (
          <View>
            <SheetTextField value={d.barcode} onChangeText={(t) => patchField('barcode', t)} autoFocus placeholder="UPC / EAN" />
            <TouchableOpacity style={rowStyles.researchBtn} onPress={() => { (onOpenBarcodeScanner || (() => { }))((code: string) => patchField('barcode', code)); }}>
              <Icon name="qrcode-scan" size={16} color={BRAND_PRIMARY} />
              <Text style={rowStyles.researchBtnText}>Scan barcode</Text>
            </TouchableOpacity>
          </View>
        );
      case 'tags':
        return <ChipsField label="Tags" hideLabel valueArray={d.tags} onChangeArray={(arr) => patchField('tags', arr)} />;
      case 'photos': {
        const count = (images || []).filter(Boolean).length;
        return (
          <View>
            <Text style={{ fontSize: 14, color: CHAT_COLORS.dim, marginBottom: 14 }}>{count > 0 ? `${count} photo${count > 1 ? 's' : ''} added` : 'No photos yet — buyers need to see it.'}</Text>
            <TouchableOpacity style={rowStyles.researchBtn} onPress={() => (onOpenImageCapture || (() => { }))((uris: string[]) => onChangeImages?.([...(images || []).filter(Boolean), ...uris]))}>
              <Icon name="camera-plus-outline" size={16} color={BRAND_PRIMARY} />
              <Text style={rowStyles.researchBtnText}>Add photos</Text>
            </TouchableOpacity>
          </View>
        );
      }
      case 'price': {
        const currentPrice = Number(d.price) || 0;
        return (
          <View>
            <View style={rowStyles.priceInputWrap}>
              <Text style={rowStyles.priceCurrency}>$</Text>
              <TextInput style={rowStyles.priceInput} value={String(d.price ?? '')} onChangeText={(t) => patchField('price', t)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={CHAT_COLORS.faint} autoFocus />
            </View>
            {pricingResearchResult && typeof pricingResearchResult.low === 'number' ? (
              <View style={{ marginTop: 16 }}>
                <PricingGuidanceCard
                  headers="none"
                  pricing={pricingResearchResult}
                  currentPrice={currentPrice}
                  onApplyPrice={(price) => {
                    const low = pricingResearchResult.low ?? 0;
                    const recommended = pricingResearchResult.recommended ?? pricingResearchResult.median ?? 0;
                    const high = pricingResearchResult.high ?? 0;
                    patchFields({ price: price.toFixed(2), aiPriceRecommendation: { low, recommended, high } });
                  }}
                />
              </View>
            ) : titleForPricingResearch ? (
              <TouchableOpacity onPress={fetchPricingResearch} disabled={pricingResearchLoading} style={rowStyles.researchBtn}>
                {pricingResearchLoading ? <ActivityIndicator size="small" color={BRAND_PRIMARY} /> : <Package size={15} color={BRAND_PRIMARY} />}
                <Text style={rowStyles.researchBtnText}>{pricingResearchLoading ? 'Researching…' : 'See what it sells for'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      }
      case 'condition':
        return (
          <View style={{ gap: 8 }}>
            {activePlatformKeyLower === 'ebay' && ebayConditions.length > 0 ? (
              ebayConditionsLoading ? (
                <ActivityIndicator color={BRAND_PRIMARY} style={{ marginVertical: 16 }} />
              ) : (
                ebayConditions.map((c: any) => {
                  const sel = String(d.conditionID || ebayConditions[0]?.conditionId) === String(c.conditionId);
                  return (
                    <TouchableOpacity
                      key={c.conditionId}
                      style={[rowStyles.radioRow, sel && rowStyles.radioRowSel]}
                      onPress={() => {
                        const condId = parseInt(String(c.conditionId), 10);
                        const generic = mapEbayConditionIdToGeneric(String(c.conditionId)) as PlatformState['condition'];
                        patchPlatform((prev) => ({ ...prev, conditionID: Number.isFinite(condId) ? condId : undefined, condition: generic }));
                      }}
                    >
                      <View style={[rowStyles.radioOuter, sel && rowStyles.radioOuterSel]}>{sel && <View style={rowStyles.radioInner} />}</View>
                      <Text style={rowStyles.radioLabel}>{c.conditionName}</Text>
                    </TouchableOpacity>
                  );
                })
              )
            ) : (
              ([{ label: 'New', value: 'new' }, { label: 'Like New', value: 'like_new' }, { label: 'Good', value: 'good' }, { label: 'Fair', value: 'fair' }, { label: 'Used', value: 'used' }, { label: 'Refurbished', value: 'refurbished' }, { label: 'For Parts', value: 'for_parts' }] as any[]).map((opt) => {
                const sel = (d.condition || 'good') === opt.value;
                return (
                  <TouchableOpacity key={opt.value} style={[rowStyles.radioRow, sel && rowStyles.radioRowSel]} onPress={() => patchField('condition', opt.value)}>
                    <View style={[rowStyles.radioOuter, sel && rowStyles.radioOuterSel]}>{sel && <View style={rowStyles.radioInner} />}</View>
                    <Text style={rowStyles.radioLabel}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        );
      case 'category':
        return renderCategoryEditor();
      default:
        return <SheetTextField value={String(d[field] ?? '')} onChangeText={(t) => patchField(field, t)} autoFocus />;
    }
  };

  const renderStepsWizard = () => {
    if (!wizardOpen || wizardSteps.length === 0) return null;
    const total = wizardSteps.length;
    const idx = Math.min(wizardIdx, total - 1);
    const field = wizardSteps[idx];
    const isLast = idx === total - 1;
    const headline = STEP_META[field] || field;
    const close = () => { setWizardOpen(false); setPricingResearchModalVisible(false); };
    const goBack = () => setWizardIdx((i) => Math.max(0, i - 1));
    const goNext = () => { if (isLast) close(); else setWizardIdx((i) => Math.min(total - 1, i + 1)); };
    // The last field step's button publishes: close the wizard, then (after it slides away)
    // hand off to the parent's publish settings (which platforms + publish).
    const goPublish = () => { close(); setTimeout(() => onRequestPublish?.(), 320); };
    return (
      <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
        <View style={[wizStyles.screen, { paddingTop: insets.top + 4 }]}>
          <View style={wizStyles.header}>
            {/* Back to the previous step (or exit on the first); "Exit" always leaves the wizard. */}
            <TouchableOpacity onPress={idx === 0 ? close : goBack} style={wizStyles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <ChevronLeft size={22} color={CHAT_COLORS.ink} />
            </TouchableOpacity>
            <Text style={wizStyles.stepCount}>{idx + 1} / {total}</Text>
            <View style={[wizStyles.progress, { flex: 1 }]}>
              {wizardSteps.map((s, i) => (
                <View key={`${s}-${i}`} style={[wizStyles.seg, { backgroundColor: i <= idx ? BRAND_PRIMARY : '#E9EBEF' }]} />
              ))}
            </View>
            <TouchableOpacity onPress={close} style={wizStyles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={wizStyles.doneText}>Exit</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView style={{ flex: 1 }} contentContainerStyle={wizStyles.body} keyboardShouldPersistTaps="handled">
            <Text style={wizStyles.headline}>{headline}</Text>
            {renderStepEditor(field)}
          </ScrollView>
          <View style={[wizStyles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <TouchableOpacity onPress={isLast ? goPublish : goNext} style={wizStyles.nextBtn} activeOpacity={0.9}>
              <Text style={wizStyles.nextText}>{isLast ? 'Publish' : 'Next'}</Text>
              {!isLast && <ArrowRight size={18} color="#FFFFFF" />}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  const renderFieldSheets = () => {
    const platformBadge = activeTab === 'all' ? 'All channels' : (getPlatform(activePlatformKey)?.label || activePlatformKey);
    const scopeText = activeTab === 'all' ? 'Changes everywhere' : `Only ${getPlatform(activePlatformKey)?.label || activePlatformKey}`;
    const currentPrice = Number((activeData as any).price) || 0;

    return (
      <>
        {/* Title */}
        <FieldSheet visible={openField === 'title'} title="Title" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)}>
          <SheetTextField value={(activeData as any).title} onChangeText={(t) => patchField('title', t)} multiline autoFocus placeholder="Product title" helper="A clear, specific name sells best" maxLength={80} showCount scope={scopeText} externalUpdate={hasExternalUpdate('title')} />
        </FieldSheet>

        {/* Description */}
        <FieldSheet visible={openField === 'description'} title="Description" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)}>
          <SheetTextField value={(activeData as any).description} onChangeText={(t) => patchField('description', t)} multiline autoFocus placeholder="Describe the item, its condition, and what's included…" scope={scopeText} externalUpdate={hasExternalUpdate('description')} />
        </FieldSheet>

        {/* SKU */}
        <FieldSheet visible={openField === 'sku'} title="SKU" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)}>
          <SheetTextField value={(activeData as any).sku} onChangeText={(t) => patchField('sku', t)} autoFocus placeholder="e.g. LAV-04" helper="Your internal code to track this item" scope={scopeText} externalUpdate={hasExternalUpdate('sku')} />
        </FieldSheet>

        {/* Barcode */}
        <FieldSheet visible={openField === 'barcode'} title="Barcode" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)}>
          <SheetTextField value={(activeData as any).barcode} onChangeText={(t) => patchField('barcode', t)} autoFocus placeholder="UPC / EAN / code128" scope={scopeText} externalUpdate={hasExternalUpdate('barcode')} />
          <TouchableOpacity style={rowStyles.researchBtn} onPress={() => { (onOpenBarcodeScanner || (() => { }))((code: string) => patchField('barcode', code)); }}>
            <Icon name="qrcode-scan" size={16} color={BRAND_PRIMARY} />
            <Text style={rowStyles.researchBtnText}>Scan barcode</Text>
          </TouchableOpacity>
        </FieldSheet>

        {/* Tags — sheet title is the only heading (ChipsField label hidden), taller sheet. */}
        <FieldSheet visible={openField === 'tags'} title="Tags" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)} saveLabel="Done" minHeightPct={66}>
          <ChipsField label="Tags" hideLabel valueArray={(activeData as any).tags} onChangeArray={(arr) => patchField('tags', arr)} refilled={refilledIncludes('tags')} />
        </FieldSheet>

        {/* Price — number + sold-comps research (never a bare number to defend) */}
        <FieldSheet visible={openField === 'price'} title="Price" badge={platformBadge} onClose={() => { setOpenField(null); setPricingResearchModalVisible(false); }} onSave={() => { setOpenField(null); setPricingResearchModalVisible(false); }}>
          <View style={rowStyles.priceInputWrap}>
            <Text style={rowStyles.priceCurrency}>$</Text>
            <TextInput style={rowStyles.priceInput} value={String((activeData as any).price ?? '')} onChangeText={(t) => patchField('price', t)} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={CHAT_COLORS.faint} autoFocus />
          </View>


          {pricingResearchResult && typeof pricingResearchResult.low === 'number' ? (
            <View style={{ marginTop: 16 }}>
              <PricingGuidanceCard
                headers="none"
                pricing={pricingResearchResult}
                currentPrice={currentPrice}
                onApplyPrice={(price) => {
                  const low = pricingResearchResult.low ?? 0;
                  const recommended = pricingResearchResult.recommended ?? pricingResearchResult.median ?? 0;
                  const high = pricingResearchResult.high ?? 0;
                  // One atomic write: price + band together, so the price isn't clobbered.
                  patchFields({ price: price.toFixed(2), aiPriceRecommendation: { low, recommended, high } });
                }}
              />
            </View>
          ) : titleForPricingResearch ? (
            <TouchableOpacity onPress={fetchPricingResearch} disabled={pricingResearchLoading} style={rowStyles.researchBtn}>
              {pricingResearchLoading ? <ActivityIndicator size="small" color={BRAND_PRIMARY} /> : <Package size={15} color={BRAND_PRIMARY} />}
              <Text style={rowStyles.researchBtnText}>{pricingResearchLoading ? 'Researching…' : 'See what it sells for'}</Text>
            </TouchableOpacity>
          ) : null}
        </FieldSheet>

        {/* Category — AI ranked best-match + alternates (shared with the wizard). */}
        {supportsTaxonomy && (
          <FieldSheet visible={openField === 'category'} title="Category" badge={activePlatformKeyLower === 'shopify' ? 'Shopify' : 'eBay'} badgeTone="neutral" onClose={() => setOpenField(null)} onSave={() => setOpenField(null)} saveLabel="Done">
            {renderCategoryEditor()}
            {activePlatformKeyLower === 'ebay' && selectedCategoryId && (
              <View style={{ marginTop: 16 }}>
                <Text style={rowStyles.sectionLabel}>Item Specifics</Text>
                {aspectsLoading ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 }}>
                    <ActivityIndicator size="small" color="#9CA3AF" />
                    <Text style={{ fontSize: 12, color: '#6B7280' }}>Loading required fields...</Text>
                  </View>
                ) : aspects.length > 0 ? (
                  <View style={{ gap: 12 }}>
                    {aspects.filter((a) => a.isRequired).map((asp) => (
                      <View key={asp.aspectName}>
                        <Text style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>{asp.aspectName} *</Text>
                        {asp.allowedValues?.length > 0 ? (
                          <AppDropdown
                            style={[styles.input, { height: 44, paddingHorizontal: 10 }]}
                            data={asp.allowedValues.map((v) => ({ label: v, value: v }))}
                            placeholder={`Select ${asp.aspectName}...`}
                            value={((activeData as any).itemSpecifics || {})[asp.aspectName]}
                            onChange={(item) => patchPlatform((prev) => ({ ...prev, itemSpecifics: { ...(prev.itemSpecifics || {}), [asp.aspectName]: item.value } }))}
                          />
                        ) : (
                          <TextInput
                            style={[styles.input, { height: 44 }]}
                            placeholder={`Enter ${asp.aspectName}...`}
                            value={((activeData as any).itemSpecifics || {})[asp.aspectName] || ''}
                            onChangeText={(t) => patchPlatform((prev) => ({ ...prev, itemSpecifics: { ...(prev.itemSpecifics || {}), [asp.aspectName]: t } }))}
                          />
                        )}
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            )}
          </FieldSheet>
        )}

        {/* Condition — radio picker */}
        <FieldSheet visible={openField === 'condition'} title="Condition" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)} saveLabel="Done">
          {activePlatformKeyLower === 'ebay' && ebayConditions.length > 0 ? (
            ebayConditionsLoading ? (
              <ActivityIndicator color={BRAND_PRIMARY} style={{ marginVertical: 16 }} />
            ) : (
              ebayConditions.map((c: any) => {
                const sel = String((activeData as any).conditionID || ebayConditions[0]?.conditionId) === String(c.conditionId);
                return (
                  <TouchableOpacity
                    key={c.conditionId}
                    style={[rowStyles.radioRow, sel && rowStyles.radioRowSel]}
                    onPress={() => {
                      const condId = parseInt(String(c.conditionId), 10);
                      const generic = mapEbayConditionIdToGeneric(String(c.conditionId)) as PlatformState['condition'];
                      patchPlatform((prev) => ({ ...prev, conditionID: Number.isFinite(condId) ? condId : undefined, condition: generic }));
                      setOpenField(null);
                    }}
                  >
                    <View style={[rowStyles.radioOuter, sel && rowStyles.radioOuterSel]}>{sel && <View style={rowStyles.radioInner} />}</View>
                    <Text style={rowStyles.radioLabel}>{c.conditionName}</Text>
                  </TouchableOpacity>
                );
              })
            )
          ) : (
            ([{ label: 'New', value: 'new' }, { label: 'Like New', value: 'like_new' }, { label: 'Good', value: 'good' }, { label: 'Fair', value: 'fair' }, { label: 'Used', value: 'used' }, { label: 'Refurbished', value: 'refurbished' }, { label: 'For Parts', value: 'for_parts' }] as any[]).map((opt) => {
              const sel = ((activeData as any).condition || 'good') === opt.value;
              return (
                <TouchableOpacity key={opt.value} style={[rowStyles.radioRow, sel && rowStyles.radioRowSel]} onPress={() => { patchField('condition', opt.value); setOpenField(null); }}>
                  <View style={[rowStyles.radioOuter, sel && rowStyles.radioOuterSel]}>{sel && <View style={rowStyles.radioInner} />}</View>
                  <Text style={rowStyles.radioLabel}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })
          )}
          {platformKeys.length > 0 && (
            <View style={[rowStyles.sheetFootnote, { marginTop: 12 }]}>
              <Icon name="information-outline" size={14} color={CHAT_COLORS.dim} />
              <Text style={rowStyles.sheetFootnoteText}>
                Each channel ({platformKeys.map((pk) => getPlatform(pk)?.label || pk).join(', ')}) maps this to its own condition grade.
              </Text>
            </View>
          )}
        </FieldSheet>

        {/* Weight */}
        <FieldSheet visible={openField === 'weight'} title="Weight" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)}>
          <SheetTextField value={String((activeData as any).weight ?? '')} onChangeText={(t) => patchField('weight', t)} keyboardType="decimal-pad" autoFocus placeholder="0" helper="Used for shipping estimates" />
          <View style={{ marginTop: 16 }}>
            <Text style={rowStyles.sectionLabel}>Unit</Text>
            <AppMenuSelect options={["oz", "lb", "g", "kg"].map((u) => ({ label: u, value: u }))} placeholder="oz" value={(activeData as any).weightUnit || 'oz'} onChange={(value) => patchField('weightUnit', value)} menuWidth={160} />
          </View>
        </FieldSheet>

        {/* Brand */}
        <FieldSheet visible={openField === 'brand'} title="Brand" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)}>
          <SheetTextField value={(activeData as any).brand ?? (activeData as any).vendor ?? ''} onChangeText={(t) => patchField('brand', t)} autoFocus placeholder="e.g. Adidas" scope={scopeText} />
        </FieldSheet>

        {/* Compare-at price */}
        <FieldSheet visible={openField === 'compareAtPrice'} title="Compare-at price" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)}>
          <SheetTextField value={String((activeData as any).compareAtPrice ?? '')} onChangeText={(t) => patchField('compareAtPrice', t)} keyboardType="decimal-pad" autoFocus placeholder="0.00" helper="Original price shown struck-through" />
        </FieldSheet>

        {/* Product type */}
        <FieldSheet visible={openField === 'productType'} title="Product type" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)}>
          <SheetTextField value={(activeData as any).productType ?? ''} onChangeText={(t) => patchField('productType', t)} autoFocus placeholder="e.g. Sneakers" scope={scopeText} />
        </FieldSheet>

        {/* SEO title */}
        <FieldSheet visible={openField === 'seoTitle'} title="SEO title" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)}>
          <SheetTextField value={(activeData as any).seoTitle ?? (activeData as any).seo?.seoTitle ?? ''} onChangeText={(t) => patchField('seoTitle', t)} autoFocus placeholder="Search-result title" helper="How it appears in search results" />
        </FieldSheet>

        {/* SEO description */}
        <FieldSheet visible={openField === 'seoDescription'} title="SEO description" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)}>
          <SheetTextField value={(activeData as any).seoDescription ?? (activeData as any).seo?.seoDescription ?? ''} onChangeText={(t) => patchField('seoDescription', t)} multiline autoFocus placeholder="Search-result description" helper="The snippet shown under the title in search results" />
        </FieldSheet>

        {/* Photos — grid with cover, add, remove (the inline strip's full editor) */}
        <FieldSheet visible={openField === 'photos'} title="Photos" badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)} saveLabel="Done">
          {(() => {
            const validImages = (images || []).filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
            const hasVariants = supportsVariants && Array.isArray((activeData as any).variants) && (activeData as any).variants.length > 0;
            const vlist = hasVariants ? ((activeData as any).variants as any[]) : [];
            const useForAll = (activeData as any).useImagesForAllVariants !== false;
            const perSize = hasVariants && !useForAll;
            const activeTabId = perSize
              ? (vlist.some((v: any) => v.id === photoSizeTab) ? photoSizeTab : vlist[0]?.id)
              : null;
            const activeVariant = perSize ? vlist.find((v: any) => v.id === activeTabId) : null;
            const sizeName = activeVariant
              ? (Object.values(activeVariant.optionValues || {}).join(' / ') || activeVariant.sku || 'this size')
              : '';
            // In per-size mode the "cover" is that variant's chosen image; otherwise it's the first shared photo.
            const coverUri = perSize ? (activeVariant?.image || validImages[0]) : validImages[0];
            const setSizeCover = (uri: string) => {
              if (!activeVariant) return;
              patchPlatform((prev) => ({ ...prev, variants: (prev.variants || []).map((x: any) => x.id === activeVariant.id ? { ...x, image: uri } : x) }));
            };

            return (
              <>
                {/* Size tabs — only when picking a cover per size */}
                {perSize && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {vlist.map((v: any) => {
                      const vName = Object.values(v.optionValues || {}).join(' / ') || v.sku || 'Variant';
                      const selected = v.id === activeTabId;
                      return (
                        <TouchableOpacity
                          key={v.id}
                          onPress={() => setPhotoSizeTab(v.id)}
                          activeOpacity={0.85}
                          style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: selected ? '#111827' : '#FFF', borderWidth: selected ? 0 : 1, borderColor: '#E5E7EB' }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '700', color: selected ? '#FFF' : '#3F3F46' }}>{vName}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* Photo grid — tap promotes to cover (shared) or sets this size's cover (per-size) */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {validImages.map((uri, i) => {
                    const isCover = uri === coverUri;
                    return (
                      <View key={`${uri}-${i}`} style={{ position: 'relative' }}>
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => {
                            if (perSize) { setSizeCover(uri); return; }
                            if (i <= 0) return;
                            const next = validImages.slice();
                            const [chosen] = next.splice(i, 1);
                            next.unshift(chosen);
                            onChangeImages?.(next);
                          }}
                        >
                          <Image source={{ uri }} style={{ width: 96, height: 96, borderRadius: 14, borderWidth: isCover ? 2 : 1, borderColor: isCover ? BRAND_PRIMARY : '#E5E7EB' }} />
                          {isCover && (
                            <View style={{ position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Icon name="star" size={11} color="#fff" />
                              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>Cover</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                        {/* Removing a photo affects the shared set — hidden while assigning a per-size cover */}
                        {!perSize && (
                          <TouchableOpacity
                            onPress={() => onChangeImages?.(validImages.filter((_, idx) => idx !== i))}
                            style={{ position: 'absolute', top: -7, right: -7, width: 24, height: 24, borderRadius: 12, backgroundColor: '#EF4444', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <Icon name="close" size={12} color="#fff" />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                  <TouchableOpacity
                    style={{ width: 96, height: 96, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#C4C4BD', backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center', gap: 3 }}
                    onPress={() => onOpenImageCapture?.((uris) => {
                      if (uris && uris.length > 0) {
                        onChangeImages?.([...validImages, ...uris]);
                        if (perSize && activeVariant && uris[0]) setSizeCover(uris[0]);
                      }
                    })}
                  >
                    <Icon name="plus" size={22} color="#A1A1AA" />
                    <Text style={{ fontSize: 11, color: '#A1A1AA', fontWeight: '600' }}>Add</Text>
                  </TouchableOpacity>
                </View>

                <View style={[rowStyles.sheetFootnote, { marginTop: 13 }]}>
                  <Icon name="information-outline" size={14} color={CHAT_COLORS.dim} />
                  <Text style={rowStyles.sheetFootnoteText}>
                    {perSize ? `Tap a photo to set the cover for ${sizeName}` : 'Tap a photo to make it the cover · ✕ to remove'}
                  </Text>
                </View>

                {/* Use these photos for all sizes */}
                {hasVariants && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F9FAFB', borderRadius: 13, paddingVertical: 13, paddingHorizontal: 14, marginTop: 16 }}>
                    <Icon name="content-copy" size={15} color="#5D7E16" />
                    <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '600', color: '#374151' }}>Use these photos for all sizes</Text>
                    <TouchableOpacity
                      onPress={() => patchPlatform((prev) => ({ ...prev, useImagesForAllVariants: !useForAll }))}
                      style={{ width: 46, height: 28, borderRadius: 999, padding: 3, backgroundColor: useForAll ? BRAND_PRIMARY : '#E5E7EB' }}
                      activeOpacity={0.85}
                    >
                      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignSelf: useForAll ? 'flex-end' : 'flex-start' }} />
                    </TouchableOpacity>
                  </View>
                )}
              </>
            );
          })()}
        </FieldSheet>

        {/* Generic additional platform field (status, seoDescription, etc.) */}
        {!!openField && openField.startsWith('extra:') && (() => {
          const key = openField.slice(6);
          return (
            <FieldSheet visible title={humanizeKey(key)} badge={platformBadge} onClose={() => setOpenField(null)} onSave={() => setOpenField(null)}>
              <SheetTextField value={String((activeData as any)[key] ?? '')} onChangeText={(t) => patchPlatform((prev) => ({ ...prev, [key]: t }))} autoFocus placeholder="Value" scope={scopeText} />
            </FieldSheet>
          );
        })()}
      </>
    );
  };

  return (
    <View style={{ paddingBottom: bottomSafePadding }}>
      {/* Media — drag to reorder, tap to set cover, ✕ to remove */}
      {(() => {
        // Canonical, de-noised list. All mutations operate on this and emit the result,
        // so empty/garbage URLs are dropped rather than shifting indexes.
        // Drop empties AND de-dupe — a repeated URI rendered a phantom "extra" gray tile.
        const validImages = (images || [])
          .filter((uri): uri is string => typeof uri === 'string' && uri.trim().length > 0)
          .filter((uri, i, arr) => arr.indexOf(uri) === i);
        const validPending = (pendingImages || [])
          .filter((uri): uri is string => typeof uri === 'string' && uri.trim().length > 0)
          .filter((uri) => !validImages.includes(uri))
          .filter((uri, i, arr) => arr.indexOf(uri) === i);
        return (
          <View style={styles.mediaRow}>
            {/* Horizontal strip as a plain ScrollView. The old DraggableFlatList reserved a
                phantom drag-placeholder slot (~one tile wide) even with a single photo, which
                left a big blank gap before "Add Photo". Tap-to-cover + ✕-remove are kept. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 14, alignItems: 'center' }}
            >
              {validImages.map((uri, i) => (
                <View key={`${uri}-${i}`} style={{ position: 'relative', marginRight: 8 }}>
                  <TouchableOpacity
                    style={[styles.thumbWrap, i === 0 && styles.thumbCover]}
                    onPress={() => {
                      // Tap promotes to cover (index 0)
                      if (i <= 0) return;
                      const next = validImages.slice();
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
                    onPress={() => onChangeImages?.(validImages.filter((_, idx) => idx !== i))}
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
              {validPending.map((uri, i) => (
                <View key={`pending-${i}`} style={[styles.thumbWrap, { opacity: 0.6, marginRight: 8 }]}>
                  <Image source={{ uri }} style={styles.thumb} />
                  <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12 }]}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                </View>
              ))}

              {/* Single Add Photo button (only show if under max photos). marginRight:0 so it's flush. */}
              {validImages.length < 6 && (
                <TouchableOpacity
                  style={[styles.thumbWrap, { backgroundColor: '#F3F4F6', borderStyle: 'dashed', borderColor: '#D1D5DB', borderWidth: 1, marginRight: 0 }]}
                  onPress={() => onOpenImageCapture?.((uris) => {
                    if (uris && uris.length > 0) {
                      onChangeImages?.([...validImages, ...uris]);
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
            <Text style={styles.mediaHint}>Tap a photo to make it the cover · ✕ to remove</Text>
          </View>
        );
      })()}

      {/* Platform filter pills */}
      <ScrollView horizontal={true} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8 }}>
        {pills.map((key) => {
          if (key === 'all') {
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setActiveTab(key)}
                style={[styles.pill, activeTab === key && styles.pillActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
              >
                <Text style={[styles.pillText, activeTab === key && styles.pillTextActive]}>All</Text>
                {allMissingCount && allMissingCount > 0 ? (
                  <View style={{ height: 16, minWidth: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: '#ef4444' }}>{allMissingCount}</Text>
                  </View>
                ) : null}
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
                    log.error('Generate platform on tap failed:', e);
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
                getPlatform(key) ? <PlatformLogo type={key} size={12} /> : null
              )}
              <Text style={[styles.pillText, activeTab === key && styles.pillTextActive, generatingPlatforms.has(key) && styles.pillTextGenerating]}>
                {getPlatform(key)?.label || key}
                {generatingPlatforms.has(key) && ' (Generating...)'}
              </Text>
              
              {/* Only a needs-attention badge — no "complete" checkmark when done. */}
              {!generatingPlatforms.has(key) && missingCount > 0 ? (
                <View style={{ height: 16, minWidth: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center', marginLeft: 2 }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#ef4444' }}>{missingCount}</Text>
                </View>
              ) : null}
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
      {/* Details — clickable rows; each opens its focused field sheet */}
      {renderDetailsCard()}
      {renderFieldSheets()}
      {renderStepsWizard()}

      {/* Pricing Research Modal - stocks-style with chart, sources, accuracy.
          Suppressed while the Price sheet is open — that sheet inlines the same card. */}
      <Modal visible={pricingResearchModalVisible && openField !== 'price' && !wizardOpen} transparent animationType="slide">
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={() => setPricingResearchModalVisible(false)}>
          <Pressable style={{ backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%', paddingHorizontal: 16, paddingBottom: 8 }} onPress={e => e.stopPropagation()}>
            <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 999, backgroundColor: '#E5E7EB', marginTop: 8, marginBottom: 4 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, paddingBottom: 12 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2937' }}>Pricing research</Text>
              <TouchableOpacity onPress={() => setPricingResearchModalVisible(false)}>
                <Icon name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>
            {pricingResearchResult?.error ? (
              <View style={{ paddingBottom: 20 }}>
                <Text style={{ fontSize: 14, color: '#ef4444' }}>{pricingResearchResult.error}</Text>
              </View>
            ) : pricingResearchResult && typeof pricingResearchResult.low === 'number' ? (
              <ScrollView style={{ maxHeight: 620 }} contentContainerStyle={{ paddingHorizontal: 0, paddingBottom: 28 }}>
                {/* The one shared pricing overview (same card as the add-product preview). */}
                <PricingGuidanceCard
                  headers="none"
                  pricing={pricingResearchResult}
                  currentPrice={Number((activeData as any).price) || 0}
                  onApplyPrice={(price) => {
                    const low = pricingResearchResult.low ?? 0;
                    const recommended = pricingResearchResult.recommended ?? pricingResearchResult.median ?? 0;
                    const high = pricingResearchResult.high ?? 0;
                    patchFields({ price: price.toFixed(2), aiPriceRecommendation: { low, recommended, high } });
                    setPricingResearchModalVisible(false);
                  }}
                />
              </ScrollView>
            ) : (
              <View style={{ paddingBottom: 20 }}>
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
          <Text style={styles.fieldLabel}>Shipping</Text>
          <TouchableOpacity
            activeOpacity={0.8}
            style={{
              marginTop: 8,
              padding: 14,
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: '#F1F2F4',
              borderRadius: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
            onPress={() => {
              const dims = (activeData as any).estimatedDimensions;
              setEditableDimensions({
                length: dims?.length != null ? String(dims.length) : '',
                width: dims?.width != null ? String(dims.width) : '',
                height: dims?.height != null ? String(dims.height) : '',
              });
              const ewInit = (activeData as any).estimatedWeight;
              const wInit = (activeData.weight != null && String(activeData.weight) !== '' && Number(activeData.weight) > 0) ? activeData.weight : (ewInit?.value ?? '');
              setEditableWeight(String(wInit ?? ''));
              setEditableWeightUnit(activeData.weightUnit || ewInit?.unit || 'lb');
              setDeliverySheetVisible(true);
            }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(147,200,34,0.10)', alignItems: 'center', justifyContent: 'center' }}>
              <Truck size={20} color="#5C9A1B" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#111827' }} numberOfLines={1}>
                {(() => {
                  const dims = (activeData as any).estimatedDimensions;
                  const dimsStr = dims ? `${dims.length}×${dims.width}×${dims.height} in` : '';
                  const wStr = activeData.weight ? `${activeData.weight} ${activeData.weightUnit || 'lb'}` : '';
                  const detail = [dimsStr, wStr].filter(Boolean).join(' · ');
                  return detail ? `Shipping (${detail})` : 'Shipping';
                })()}
              </Text>
              <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }} numberOfLines={1}>
                {shippingEstimateLoading
                  ? 'Estimating rates…'
                  : (shippingEstimateResult && typeof shippingEstimateResult.estimatedMin === 'number' && !shippingEstimateResult.error)
                    ? (typeof shippingEstimateResult.expectedCost === 'number'
                        ? `Usually ~$${shippingEstimateResult.expectedCost.toFixed(1)} · Range $${shippingEstimateResult.estimatedMin.toFixed(1)}–$${shippingEstimateResult.estimatedMax.toFixed(1)}`
                        : `USPS Ground · $${shippingEstimateResult.estimatedMin.toFixed(2)}–$${shippingEstimateResult.estimatedMax.toFixed(2)}`)
                    : (activeData.deliveryMethod === 'in_person' ? 'Local pickup' : 'Tap to set up shipping')}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color="#9CA3AF" />
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

      {/* Additional platform fields now render as rows inside the MORE DETAILS card. */}

      {/* Inventory — last section, sits directly above Active Listings (per UJK-0) */}
      <View style={styles.darkerCard}>
        <View style={{ marginVertical: 8, flexDirection: 'column', gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: '#666666' }}>Inventory</Text>
            {/* DEBUG: Log LocationDropdown condition */}
            {(() => {
              log.debug(`[LocationDropdown DEBUG] activeTab=${activeTab}, selectedInventoryType=${selectedInventoryType}, shouldShow=${selectedInventoryType === 'LOCATION_VARIANT_WITH_OPTIONS' && activeTab !== 'all'}, locationsCount=${locations?.length}`);
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
              log.debug(`[LocationDropdown FILTERED] platform=${activePlatformKey}, count=${platformLocs.length}`);
              if (platformLocs.length === 0) return null;
              return (
                <LocationDropdown
                  locations={platformLocs}
                  selectedId={selectedLocationId}
                  onChange={(id) => {
                    log.debug(`[LOC] Location changed from ${selectedLocationId} to ${id}`);
                    setSelectedLocationId(id);
                  }}
                />
              );
            })()}
          </View>

          {/* PRICE · ALL CHANNELS — the canonical price + Change all (opens the Price sheet)
          {(() => {
            const pv = (activeData as any).price;
            const priceText = pv != null && String(pv) !== '' ? `$${pv}` : 'Set a price';
            return (
              <TouchableOpacity style={styles.priceAllChannels} onPress={() => setOpenField('price')} activeOpacity={0.7}>
                <View>
                  <Text style={styles.priceAllChannelsLabel}>PRICE · ALL CHANNELS</Text>
                  <Text style={styles.priceAllChannelsValue}>{priceText}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Text style={styles.priceAllChannelsChange}>Change all</Text>
                  <ChevronRight size={16} color={CHAT_COLORS.dim} />
                </View>
              </TouchableOpacity>
            );
          })()}
          */}

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
                    {getPlatform(platformKey)?.label || platformKey}
                  </Text>
                </TouchableOpacity>
              ))} */}
              {/* Global Price badge removed — no special "global card" for Shopify;
                  inventory is structured the same on every platform tab. */}
            </View>
          )}
        </View>

        {(() => {
          log.debug('[Inventory Render] supportsVariants:', supportsVariants, 'variants count:', (activeData.variants || []).length);
          return null;
        })()}
        {supportsVariants ? (
          <>
            {/* Suggested price is offered on-demand inside the Price sheet (no autofill,
                no "Apply to All" banner here) — the seller pulls a suggestion when ready. */}

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
                    log.debug(`[ListingEditorForm] Auto-added virtual location for missing platform: ${pk}`);
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
                    log.warn(`[ListingEditorForm] Filtered duplicate location: ${loc.id} (${loc.name})`);
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

              log.debug(`[VariantInventoryEditor LOCS] activeTab=${activeTab}, selectedLocId=${selectedLocationId}, locsCount=${allLocs.length}`);

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

                    log.debug(`[ListingEditorForm] Aggregating variant: platform=${pk}, optionKey=${optionKey}, existingEntry=${!!existing}`);

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
                    image: v.image || images?.[0],
                    sku: v.sku,
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
                  image: images?.[0],
                  sku: (activeData as any).sku,
                  defaultPrice: toPrice(activeData.price),
                  inventory: {},
                };

                // Populate inventory from locationQuantities (non-variant data)
                allLocs.forEach(loc => {
                  const rawLocationId = loc.locationId || loc.id;
                  const qty = (activeData.locationQuantities || {})[rawLocationId] ?? 0;
                  baseVariant.inventory[loc.id] = {
                    quantity: qty,
                    price: toPrice(activeData.price),
                  };
                });

                // Fallback if no locations
                if (allLocs.length === 0) {
                  const defaultQty = (activeData.locationQuantities || {})['default'] ?? 0;
                  baseVariant.inventory['default'] = {
                    quantity: defaultQty,
                    price: toPrice(activeData.price),
                  };
                }

                preparedVariants = [baseVariant];
                log.debug('[ListingEditorForm] Injected Base Product variant for non-variant product');
              }

              // 3. Callback - per-location pricing for non-Shopify, global for Shopify
              const handleUpdateInventory = (variantId: string, locationId: string, field: 'quantity' | 'price', value: number) => {
                if (field === 'price') value = toPrice(value); // never let a NaN price enter platform data
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

                // If the seller edits inventory for an enabled platform that has no data yet
                // (e.g. Amazon enabled but never hydrated), seed it from the canonical platform
                // so the edit actually applies instead of being silently dropped.
                let pData = nextPlatforms[targetPlatform];
                if (!pData) {
                  const src: any = nextPlatforms[canonicalKey] || activeData || {};
                  pData = { ...src };
                  nextPlatforms[targetPlatform] = pData;
                }

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
                    log.debug(`[handleUpdateInventory] ✅ Matched variant: id=${v.id.slice(0, 8)}, optionKey=${getOptionKey(v)}, variantId=${variantId}, field=${field}, value=${value}, isShopify=${isShopify}`);

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

                        log.debug(`[ListingEditorForm] Shopify global price update: ${value}, synced to ${shopifyLocs.length} locations`);
                        log.debug(`[ListingEditorForm] Updated inventoryByLocation prices:`, Object.entries(updatedInv).map(([k, v]: [string, any]) => `${k}=$${v.price}`).join(', '));
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

              // Tapping a variant's photo opens the SHARED Photos sheet (same one the top
              // "Photos" row opens) so uploads route through the persist+publish path. The
              // old per-row write matched on v.id and silently no-op'd for the virtual
              // "_base" product, which is why photos "never stuck".
              const handleSelectImage = (variantId: string) => {
                setPhotoSizeTab(variantId && variantId !== '_base' ? variantId : null);
                setOpenField('photos');
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
              image: images?.[0] as string | undefined,
              sku: (activeData as any).sku as string | undefined,
              defaultPrice: toPrice(activeData.price),
              inventory: {} as Record<string, { quantity: number; price?: number }>,
            };

            // Populate inventory from locationQuantities (per-location) or use base price
            allLocs.forEach(loc => {
              const rawLocationId = (loc as any).locationId || loc.id;
              const qty = (activeData.locationQuantities || {})[rawLocationId] ?? 0;
              baseVariant.inventory[loc.id] = {
                quantity: qty,
                price: toPrice(activeData.price),
              };
            });

            // If no locations exist yet, create a default inventory entry
            if (allLocs.length === 0 && activeTab !== 'all') {
              const qty = (activeData.locationQuantities || {})['default'] ?? 0;
              baseVariant.inventory['default'] = {
                quantity: qty,
                price: toPrice(activeData.price),
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

    </View>
  );
}

export default forwardRef<ListingEditorFormRef, Props>(ListingEditorFormInner);

const styles = StyleSheet.create({
  mediaRow: { paddingVertical: 10, borderBottomColor: '#E5E5E5', borderBottomWidth: 1, paddingBottom: 10, marginBottom: 10, gap: 8 },
  thumbWrap: { width: 86, height: 86, borderRadius: 8, overflow: 'hidden', marginRight: 8, borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: '100%' },
  addThumb: { borderStyle: 'dashed' },
  thumbCover: { borderColor: BRAND_PRIMARY, borderWidth: 2 },
  coverBadge: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, flexDirection: 'row', alignItems: 'center' },
  mediaHint: { textAlign: 'center', color: '#71717A', marginTop: 6 },
  pill: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF', marginRight: 8 },
  pillActive: { backgroundColor: BRAND_PRIMARY, borderColor: BRAND_PRIMARY },
  pillText: { color: '#3F3F46', fontWeight: '500' },
  pillTextActive: { color: '#FFFFFF', fontWeight: '700' },
  pillDashed: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: '#D1D5DB', marginRight: 8 },
  // Flattened: sections are borderless now (stripped-down look).
  card: { marginTop: 16, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB', padding: 14 },
  darkerCard: { marginTop: 16, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#F1F2F4', padding: 12 },
  priceAllChannels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  priceAllChannelsLabel: { fontSize: 10.5, fontWeight: '700', color: '#71717A', letterSpacing: 0.5 },
  priceAllChannelsValue: { fontSize: 18, fontWeight: '700', color: '#18181B', marginTop: 2 },
  priceAllChannelsChange: { fontSize: 13, fontWeight: '600', color: '#5D7E16' },
  // --- STYLES REFACTOR ---
  fieldLabel: {
    fontSize: 12,
    fontFamily: CHAT_FONT.semibold,
    color: CHAT_COLORS.dim,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modernInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CHAT_COLORS.white,
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    minHeight: 58,
  },
  modernInputFocused: {
    borderColor: BRAND_PRIMARY,
    backgroundColor: '#FFFFFF',
    shadowColor: BRAND_PRIMARY,
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
    fontFamily: CHAT_FONT.regular,
    color: CHAT_COLORS.ink,
    paddingVertical: 14, // Ensure good touch target
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
    fontFamily: CHAT_FONT.bold,
    color: CHAT_COLORS.ink,
  },
  // Keep existing styles but update where needed
  input: {
    // Shared input/dropdown surface — chat-input feel (rounded, roomy).
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    paddingVertical: 19,
    paddingHorizontal: 14,
    borderRadius: 16,
    fontSize: 15,
    fontFamily: CHAT_FONT.regular,
    backgroundColor: CHAT_COLORS.white,
    color: CHAT_COLORS.ink,
  },
  // Suggested-price pills (focus-gated, below the price field).
  priceHint: { color: CHAT_COLORS.dim, fontSize: 12, fontFamily: CHAT_FONT.regular, marginTop: 8 },
  addTagBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  tagChip: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  optionChip: { backgroundColor: '#E5E5E5', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  dropdown: { backgroundColor: CHAT_COLORS.white, borderWidth: 1, borderColor: CHAT_COLORS.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownMenu: { backgroundColor: CHAT_COLORS.white, borderWidth: 1, borderColor: CHAT_COLORS.border, borderRadius: 16, marginTop: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3 },
  dropdownItem: { paddingVertical: 14, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  scanBtn: { backgroundColor: CHAT_COLORS.brand, width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: -18 },
  // Unified with fieldLabel so section headers (Variants / Inventory) match the
  // rest of the field labels — one consistent size.
  sectionTitle: { fontSize: 12, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.dim, textTransform: 'uppercase', letterSpacing: 0.5 },
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
  btnPrimary: { backgroundColor: BRAND_PRIMARY, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
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
    borderColor: BRAND_PRIMARY,
    backgroundColor: 'rgba(147,200,34,0.05)',
    marginTop: 4,
  },
  suggestionBox: { borderWidth: 1, borderColor: '#E5E5E5', borderStyle: 'dashed', borderRadius: 10, padding: 12, marginTop: 10, backgroundColor: '#FAFAFA' },
  suggestionChip: { borderWidth: 1, borderColor: '#E5E5E5', borderStyle: 'dashed', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  suggestRow: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 4 },
  suggestChip: { flex: 1, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6, borderRadius: 10, borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: '#FAFAFA' },
  suggestChipHi: { borderColor: BRAND_PRIMARY, backgroundColor: 'rgba(147,200,34,0.08)' },
  suggestChipLabel: { fontSize: 11, color: '#6B7280', marginBottom: 2 },
  suggestChipPrice: { fontSize: 14, fontWeight: '600', color: '#111' },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
});
