import React, { useMemo, useState, useEffect, useRef } from 'react';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Image, FlatList, Alert } from 'react-native';
import { CameraView } from 'expo-camera';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import ItemJobsModal from '../components/ItemJobsModal';
import PyramidGrid from '../components/PyramidGrid';
import { getPlatformRequirements } from '../utils/platformRequirements';
import { Boxes, X, Sparkles, Pencil, ArrowLeft } from 'lucide-react-native';
import BottomActionBar from '../components/BottomActionBar';
import ListingEditorForm from '../components/ListingEditorForm';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { hydratePlatformsFromBackend, normalizeForListingEditor, isEmpty } from '../utils/platformDataHydration';
import { isPlatformReady, getMissingPlatformFields, hasPlatformPrice } from '../utils/platformRequirements';
import { Paths, Directory, File } from 'expo-file-system/next';
import * as ImagePicker from 'expo-image-picker';

// Feature flag to hide AI refill functionality
const ENABLE_AI_REFILL_FEATURES = false;

// Platform metadata for UI display
const PLATFORM_META: Record<string, { label: string; icon: string }> = {
  shopify: { label: 'Shopify', icon: 'shopping' },
  amazon: { label: 'Amazon', icon: 'amazon' },
  ebay: { label: 'eBay', icon: 'shopping' },
  clover: { label: 'Clover', icon: 'leaf' },
  square: { label: 'Square', icon: 'square-outline' },
  facebook: { label: 'Facebook', icon: 'facebook' },
  whatnot: { label: 'Whatnot', icon: 'shopping' },
  depop: { label: 'Depop', icon: 'shopping' },
};

type Props = StackScreenProps<AppStackParamList, 'GenerateDetailsScreen'>;

type GeneratedPlatformDetails = Record<string, any>;
type GeneratedResult = {
  productIndex: number;
  productId?: string;
  variantId?: string;
  platforms: GeneratedPlatformDetails;
  sourceImageUrl?: string;
  processingTimeMs?: number;
  source?: string;
};

// Platform field schema for hierarchical structure
const PLATFORM_FIELD_SCHEMA: Record<string, any> = {
  shopify: {
    // Core product fields
    title: { type: 'string', label: 'Title', required: true },
    description: { type: 'string', label: 'Description', multiline: true },
    vendor: { type: 'string', label: 'Vendor' },
    productCategory: { type: 'string', label: 'Product Category' },
    productType: { type: 'string', label: 'Product Type' },
    tags: { type: 'array', label: 'Tags' },
    status: { type: 'select', label: 'Status', options: ['active', 'draft', 'archived'] },
    // Variant structure
    variants: {
      type: 'array',
      label: 'Variants',
      schema: {
        option1_name: { type: 'string', label: 'Option 1 Name' },
        option1_value: { type: 'string', label: 'Option 1 Value' },
        option2_name: { type: 'string', label: 'Option 2 Name' },
        option2_value: { type: 'string', label: 'Option 2 Value' },
        option3_name: { type: 'string', label: 'Option 3 Name' },
        option3_value: { type: 'string', label: 'Option 3 Value' },
        sku: { type: 'string', label: 'SKU' },
        barcode: { type: 'string', label: 'Barcode' },
        price: { type: 'number', label: 'Price' },
        compareAtPrice: { type: 'number', label: 'Compare At Price' },
        costPerItem: { type: 'number', label: 'Cost Per Item' },
        chargeTax: { type: 'boolean', label: 'Charge Tax' },
        taxCode: { type: 'string', label: 'Tax Code' },
        inventoryTracker: { type: 'string', label: 'Inventory Tracker' },
        inventoryQuantity: { type: 'number', label: 'Inventory Quantity' },
        continueSellingWhenOutOfStock: { type: 'boolean', label: 'Continue Selling When Out Of Stock' },
        weightValueGrams: { type: 'number', label: 'Weight Value (Grams)' },
        requiresShipping: { type: 'boolean', label: 'Requires Shipping' },
        fulfillmentService: { type: 'string', label: 'Fulfillment Service' },
        variantImageURL: { type: 'string', label: 'Variant Image URL' }
      }
    },
    // Images structure
    images: {
      type: 'array',
      label: 'Images',
      schema: {
        productImageURL: { type: 'string', label: 'Product Image URL' },
        imagePosition: { type: 'number', label: 'Image Position' },
        imageAltText: { type: 'string', label: 'Image Alt Text' }
      }
    },
    publishedOnOnlineStore: { type: 'boolean', label: 'Published On Online Store' },
    giftCard: { type: 'boolean', label: 'Gift Card' },
    // SEO structure
    seo: {
      type: 'object',
      label: 'SEO',
      schema: {
        seoTitle: { type: 'string', label: 'SEO Title' },
        seoDescription: { type: 'string', label: 'SEO Description', multiline: true }
      }
    },
    // Google Shopping structure
    googleShopping: {
      type: 'object',
      label: 'Google Shopping',
      schema: {
        googleProductCategory: { type: 'string', label: 'Google Product Category' },
        gender: { type: 'select', label: 'Gender', options: ['Unisex', 'Male', 'Female'] },
        ageGroup: { type: 'select', label: 'Age Group', options: ['Adult', 'Kids', 'Toddler', 'Infant', 'Newborn'] },
        mpn: { type: 'string', label: 'MPN' },
        adWordsGrouping: { type: 'string', label: 'AdWords Grouping' },
        adWordsLabels: { type: 'string', label: 'AdWords Labels' },
        condition: { type: 'select', label: 'Condition', options: ['new', 'refurbished', 'used'] },
        customProduct: { type: 'boolean', label: 'Custom Product' },
        customLabel0: { type: 'string', label: 'Custom Label 0' },
        customLabel1: { type: 'string', label: 'Custom Label 1' },
        customLabel2: { type: 'string', label: 'Custom Label 2' },
        customLabel3: { type: 'string', label: 'Custom Label 3' },
        customLabel4: { type: 'string', label: 'Custom Label 4' }
      }
    }
  },
  amazon: {
    sku: { type: 'string', label: 'SKU', required: true },
    productId: { type: 'string', label: 'Product ID' },
    productIdType: { type: 'select', label: 'Product ID Type', options: ['UPC', 'EAN', 'ASIN'] },
    title: { type: 'string', label: 'Title', required: true },
    brand: { type: 'string', label: 'Brand' },
    manufacturer: { type: 'string', label: 'Manufacturer' },
    description: { type: 'string', label: 'Description', multiline: true },
    bullet_points: { type: 'array', label: 'Bullet Points' },
    search_terms: { type: 'array', label: 'Search Terms' },
    price: { type: 'number', label: 'Price', required: true },
    quantity: { type: 'number', label: 'Quantity' },
    mainImageURL: { type: 'string', label: 'Main Image URL' },
    otherImageURLs: { type: 'array', label: 'Other Image URLs' },
    categorySuggestion: { type: 'string', label: 'Category Suggestion' },
    amazonProductType: { type: 'select', label: 'Amazon Product Type', options: ['BEAUTY', 'KITCHEN', 'TOOLS_AND_HOME_IMPROVEMENT', 'CLOTHING_SHOES_AND_JEWELRY', 'COLLECTIBLES', 'BOOKS', 'HEALTH_PERSONAL_CARE', 'ELECTRONICS', 'SPORTS_OUTDOORS', 'TOYS_AND_GAMES'] },
    condition: { type: 'select', label: 'Condition', options: ['New', 'Refurbished', 'Used'] }
  },
  ebay: {
    action: { type: 'string', label: 'Action' },
    customLabel: { type: 'string', label: 'Custom Label' },
    category: { type: 'string', label: 'Category' },
    storeCategory: { type: 'string', label: 'Store Category' },
    title: { type: 'string', label: 'Title', required: true },
    subtitle: { type: 'string', label: 'Subtitle' },
    relationship: { type: 'string', label: 'Relationship' },
    relationshipDetails: { type: 'string', label: 'Relationship Details' },
    scheduleTime: { type: 'string', label: 'Schedule Time' },
    conditionID: { type: 'number', label: 'Condition ID' },
    conditionDetails: {
      type: 'object',
      label: 'Condition Details',
      schema: {
        professionalGrader: { type: 'string', label: 'Professional Grader' },
        grade: { type: 'string', label: 'Grade' },
        certificationNumber: { type: 'string', label: 'Certification Number' },
        cardCondition: { type: 'string', label: 'Card Condition' }
      }
    },
    itemSpecifics: { type: 'object', label: 'Item Specifics' },
    media: {
      type: 'object',
      label: 'Media',
      schema: {
        picURL: { type: 'string', label: 'Picture URL' },
        galleryType: { type: 'string', label: 'Gallery Type' },
        videoID: { type: 'string', label: 'Video ID' }
      }
    },
    description: { type: 'string', label: 'Description', multiline: true },
    listingDetails: {
      type: 'object',
      label: 'Listing Details',
      schema: {
        format: { type: 'select', label: 'Format', options: ['FixedPrice', 'Auction'] },
        duration: { type: 'string', label: 'Duration' },
        startPrice: { type: 'number', label: 'Start Price' },
        buyItNowPrice: { type: 'number', label: 'Buy It Now Price' },
        bestOfferEnabled: { type: 'boolean', label: 'Best Offer Enabled' },
        bestOfferAutoAcceptPrice: { type: 'number', label: 'Best Offer Auto Accept Price' },
        minimumBestOfferPrice: { type: 'number', label: 'Minimum Best Offer Price' },
        quantity: { type: 'number', label: 'Quantity' },
        immediatePayRequired: { type: 'boolean', label: 'Immediate Pay Required' },
        location: { type: 'string', label: 'Location' }
      }
    },
    shippingDetails: {
      type: 'object',
      label: 'Shipping Details',
      schema: {
        shippingType: { type: 'string', label: 'Shipping Type' },
        dispatchTimeMax: { type: 'number', label: 'Dispatch Time Max' },
        promotionalShippingDiscount: { type: 'boolean', label: 'Promotional Shipping Discount' },
        shippingDiscountProfileID: { type: 'string', label: 'Shipping Discount Profile ID' },
        services: {
          type: 'array',
          label: 'Services',
          schema: {
            option: { type: 'string', label: 'Option' },
            cost: { type: 'number', label: 'Cost' }
          }
        }
      }
    },
    returnPolicy: {
      type: 'object',
      label: 'Return Policy',
      schema: {
        returnsAcceptedOption: { type: 'string', label: 'Returns Accepted Option' },
        returnsWithinOption: { type: 'string', label: 'Returns Within Option' },
        refundOption: { type: 'string', label: 'Refund Option' },
        shippingCostPaidByOption: { type: 'string', label: 'Shipping Cost Paid By Option' },
        additionalDetails: { type: 'string', label: 'Additional Details', multiline: true }
      }
    }
  },
  facebook: {
    id: { type: 'string', label: 'ID' },
    title: { type: 'string', label: 'Title', required: true },
    description: { type: 'string', label: 'Description', multiline: true },
    availability: { type: 'select', label: 'Availability', options: ['in stock', 'out of stock', 'preorder'] },
    condition: { type: 'select', label: 'Condition', options: ['new', 'refurbished', 'used'] },
    price: { type: 'string', label: 'Price' },
    link: { type: 'string', label: 'Link' },
    image_link: { type: 'string', label: 'Image Link' },
    brand: { type: 'string', label: 'Brand' },
    google_product_category: { type: 'string', label: 'Google Product Category' },
    categorySuggestion: { type: 'string', label: 'Category Suggestion' }
  },
  square: {
    object: {
      type: 'object',
      label: 'Object',
      schema: {
        type: { type: 'string', label: 'Type' },
        id: { type: 'string', label: 'ID' },
        itemData: {
          type: 'object',
          label: 'Item Data',
          schema: {
            name: { type: 'string', label: 'Name', required: true },
            description: { type: 'string', label: 'Description', multiline: true },
            categorySuggestion: { type: 'string', label: 'Category Suggestion' },
            gtin: { type: 'string', label: 'GTIN' },
            variations: {
              type: 'array',
              label: 'Variations',
              schema: {
                type: { type: 'string', label: 'Type' },
                id: { type: 'string', label: 'ID' },
                itemVariationData: {
                  type: 'object',
                  label: 'Item Variation Data',
                  schema: {
                    sku: { type: 'string', label: 'SKU' },
                    name: { type: 'string', label: 'Name' },
                    pricingType: { type: 'string', label: 'Pricing Type' },
                    priceMoney: {
                      type: 'object',
                      label: 'Price Money',
                      schema: {
                        amount: { type: 'number', label: 'Amount' },
                        currency: { type: 'string', label: 'Currency' }
                      }
                    }
                  }
                }
              }
            },
            locations: { type: 'string', label: 'Locations' }
          }
        }
      }
    }
  },
  clover: {
    name: { type: 'string', label: 'Name', required: true },
    price: { type: 'number', label: 'Price', required: true },
    priceType: { type: 'string', label: 'Price Type' },
    sku: { type: 'string', label: 'SKU' },
    category: {
      type: 'object',
      label: 'Category',
      schema: {
        name: { type: 'string', label: 'Name' }
      }
    },
    modifierGroups: { type: 'array', label: 'Modifier Groups' },
    availability: { type: 'select', label: 'Availability', options: ['in stock', 'out of stock'] },
    brand: { type: 'string', label: 'Brand' }
  },
  whatnot: {
    category: { type: 'string', label: 'Category' },
    subCategory: { type: 'string', label: 'Sub Category' },
    title: { type: 'string', label: 'Title', required: true },
    description: { type: 'string', label: 'Description', multiline: true },
    quantity: { type: 'number', label: 'Quantity' },
    type: { type: 'string', label: 'Type' },
    price: { type: 'number', label: 'Price', required: true },
    shippingProfile: { type: 'string', label: 'Shipping Profile' },
    offerable: { type: 'boolean', label: 'Offerable' },
    hazmat: { type: 'string', label: 'Hazmat' },
    condition: { type: 'string', label: 'Condition' },
    costPerItem: { type: 'number', label: 'Cost Per Item' },
    sku: { type: 'string', label: 'SKU' },
    imageUrls: { type: 'array', label: 'Image URLs' }
  }
};

// Helper function to group versions by match job ID, showing latest as primary
const groupVersionsByMatchId = (versions: Array<{ id: string; jobId: string; createdAt: string; platforms: any; sources?: Array<{ url: string; usedForFields?: string[] }>; matchJobId?: string; source?: string }>): Array<{ id: string; jobId: string; createdAt: string; platforms: any; sources?: Array<{ url: string; usedForFields?: string[] }>; matchJobId?: string; source?: string; versionCount?: number; allVersions?: Array<any> }> => {
  if (!Array.isArray(versions)) return [];

  // Group by match job ID
  const grouped = versions.reduce((acc, version) => {
    const key = version.matchJobId || 'no-match-id';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(version);
    return acc;
  }, {} as Record<string, typeof versions>);

  // For each group, return the latest version as primary with version count
  const result = Object.entries(grouped).map(([matchJobId, versionGroup]) => {
    // Sort by creation date (newest first)
    const sortedVersions = versionGroup.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latestVersion = sortedVersions[0];

    return {
      ...latestVersion,
      versionCount: sortedVersions.length,
      allVersions: sortedVersions // Store all versions for access
    };
  });

  // Sort results by creation date (newest first)
  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

// REMOVED - Now using unified hydration utilities from platformDataHydration.ts

function GenerateDetailsScreen({ route, navigation }: Props) {
  // Support both direct props and nested { response: {...} }
  const params: any = (route.params || {}) as any;
  const jobId = params.jobId ?? params.response?.jobId;
  const matchJobId = params.matchJobId ?? params.response?.matchJobId;
  const statusParam = params.status ?? params.response?.status;
  const resultsParam = params.results ?? params.response?.results;
  const summaryParam = params.summary ?? params.response?.summary;
  const completedAtParam = params.completedAt ?? params.response?.completedAt;

  const [fetched, setFetched] = useState(false);
  const [jobData, setJobData] = useState<{ status?: string; results?: GeneratedResult[]; summary?: any; completedAt?: string } | null>(null);
  const [dbImages, setDbImages] = useState<Record<string, string[]>>({});

  // If we only get a jobId, fetch the job payload from Supabase once
  useEffect(() => {
    if (!jobId) return;
    if ((Array.isArray(resultsParam) && resultsParam.length > 0) || fetched) return;
    let canceled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('generate_jobs')
          .select('status, results, summary, completed_at')
          .eq('job_id', jobId)
          .maybeSingle();
        if (error) return;
        if (!canceled && data) {
          setJobData({
            status: data.status,
            results: Array.isArray(data.results) ? data.results : [],
            summary: data.summary,
            completedAt: data.completed_at,
          });
        }
      } catch { }
      finally {
        if (!canceled) setFetched(true);
      }
    })();
    return () => { canceled = true };
  }, [jobId, resultsParam, fetched]);

  const status = jobData?.status ?? statusParam;
  const results = jobData?.results ?? resultsParam;
  const summary = jobData?.summary ?? summaryParam;
  const completedAt = jobData?.completedAt ?? completedAtParam;

  // Fetch user-uploaded images from ProductImages table (like PastScansScreen does)
  useEffect(() => {
    if (!results || results.length === 0) return;
    let canceled = false;
    (async () => {
      try {
        const variantIds = results.map((r: any) => r.variantId).filter(Boolean);
        if (variantIds.length === 0) return;

        const { data: variants, error } = await supabase
          .from('ProductVariants')
          .select(`
            Id,
            ProductImages!ProductImages_ProductVariantId_fkey ( ImageUrl, Position )
          `)
          .in('Id', variantIds);

        if (error || !variants || canceled) return;

        const imageMap: Record<string, string[]> = {};
        variants.forEach((variant: any) => {
          const sortedImages = variant.ProductImages
            ?.sort((a: any, b: any) => (a.Position || 0) - (b.Position || 0))
            ?.map((img: any) => img.ImageUrl) || [];
          if (sortedImages.length > 0) {
            imageMap[variant.Id] = sortedImages;
          }
        });

        if (!canceled) {
          console.log('[GEN-DETAILS] Loaded ProductImages from DB:', imageMap);
          setDbImages(imageMap);
        }
      } catch (err) {
        console.error('[GEN-DETAILS] Failed to load ProductImages:', err);
      }
    })();
    return () => { canceled = true };
  }, [(route.params as any)?.variantId, results === null ? null : results]);

  // Debug (safe)
  console.log('[GEN-DETAILS] route.params keys:', Object.keys((route.params || {}) as any));
  console.log('[GEN-DETAILS] jobId:', jobId, 'status:', status);
  console.log('[GEN-DETAILS] results raw:', Array.isArray(results) ? `len=${results.length}` : typeof results);

  const first: GeneratedResult | null = useMemo(() => (Array.isArray(results) && results.length > 0 ? results[0] : null), [results]);

  // Prefer user-captured images: 1) from ProductImages DB, 2) from params, 3) fallback to scraped
  const userImagesByIndex: Record<number, string[]> = useMemo(() => {
    const map: Record<number, string[]> = {};

    // Priority 1: ProductImages from database (actual user photos)
    if (Object.keys(dbImages).length > 0 && Array.isArray(results)) {
      results.forEach((r, idx) => {
        if (r.variantId && dbImages[r.variantId]) {
          map[idx] = dbImages[r.variantId];
          console.log(`[userImagesByIndex] Using DB images for index ${idx}:`, dbImages[r.variantId]);
        }
      });
    }

    // Priority 2: Images passed via navigation params
    const fromParams = (route.params as any)?.userImagesByIndex;
    if (fromParams && typeof fromParams === 'object') {
      Object.keys(fromParams).forEach(key => {
        const idx = parseInt(key, 10);
        if (!isNaN(idx) && !map[idx]) {
          map[idx] = fromParams[key];
        }
      });
    }

    // Priority 3: Fallback to scraped sourceImageUrl ONLY if no user images found
    (Array.isArray(results) ? results : []).forEach((r, i) => {
      if (!map[i]) {
        const url = (r as any)?.sourceImageUrl;
        if (url && typeof url === 'string' && !url.includes('firecrawl') && !url.includes('serpapi')) {
          map[i] = [url];
        }
      }
    });

    return map;
  }, [results, dbImages, route.params]);

  // ========== CRITICAL FIX: useRef for data persistence + auto-save ==========
  const [updateCounter, setUpdateCounter] = useState(0);
  const platformsRef = useRef<GeneratedPlatformDetails>({});
  const [, forceUpdate] = useState({});
  const debounceTimerRef = useRef<any>(null);
  const lastHydratedJobRef = useRef<string | null>(null);
  const lastSavedRef = useRef<string>('');

  const updatePlatforms = (updater: (prev: GeneratedPlatformDetails) => GeneratedPlatformDetails) => {
    platformsRef.current = updater(platformsRef.current);
    forceUpdate({}); // Trigger re-render
    setUpdateCounter(c => c + 1); // Signal content change
    console.log('[GEN-DETAILS] Updated platforms, triggering auto-save...');
  };

  // Get displayedPlatforms from ref (for render)
  // Just use the ref directly - it's stable and mutations won't cause renders
  const displayedPlatforms = platformsRef.current;
  useEffect(() => {
    if (!first || !first.platforms) return;

    // Only hydrate if this is new data (different jobId)
    const currentJobId = jobId || JSON.stringify(first.platforms).slice(0, 50);
    if (lastHydratedJobRef.current === currentJobId) {
      console.log('[GEN-DETAILS] Skipping re-hydration - same job');
      return;
    }

    const rawPlatforms = first.platforms;
    console.log('[GEN-DETAILS] Hydrating new data. JobId:', currentJobId);
    console.log('[GEN-DETAILS] Raw platforms from backend:', rawPlatforms);

    // Normalize each platform for ListingEditorForm compatibility
    const normalized: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawPlatforms)) {
      normalized[key] = normalizeForListingEditor(value);
    }

    console.log('[GEN-DETAILS] Normalized platforms:', Object.keys(normalized));

    // CRITICAL: If backend didn't send shopify, create it from first available platform
    // This ensures canonicalKey (which prefers shopify) has data to display
    if (!normalized.shopify && Object.keys(normalized).length > 0) {
      const firstPlatformKey = Object.keys(normalized)[0];
      const firstPlatformData = normalized[firstPlatformKey];
      console.log('[GEN-DETAILS] Backend missing shopify - creating canonical from:', firstPlatformKey);

      // Create shopify with core fields from first platform
      // Handle various image field names across platforms
      const imageUrls = firstPlatformData.images ||
        firstPlatformData.imageUrls ||
        firstPlatformData.imageUrl ||
        firstPlatformData.image_link ||
        firstPlatformData.picURL ||
        (first.sourceImageUrl ? [first.sourceImageUrl] : []);

      normalized.shopify = {
        title: firstPlatformData.title || firstPlatformData.name || '',
        description: firstPlatformData.description || '',
        price: typeof firstPlatformData.price === 'string'
          ? parseFloat(firstPlatformData.price.replace(/[^0-9.]/g, '')) || 0
          : (firstPlatformData.price || 0),
        sku: firstPlatformData.sku || '',
        barcode: firstPlatformData.barcode || '',
        weight: firstPlatformData.weight || 0,
        weightUnit: firstPlatformData.weightUnit || 'kg',
        tags: firstPlatformData.tags || [],
        images: Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []),
      };
    }

    // Hydrate into platformsRef (preserves user edits)
    const hydrated = hydratePlatformsFromBackend(normalized, platformsRef.current);
    console.log('[GEN-DETAILS] Hydrated platforms:', Object.keys(hydrated));
    updatePlatforms(() => hydrated);

    lastHydratedJobRef.current = currentJobId;
  }, [first, jobId]);


  // ========== AUTO-SAVE DEBOUNCE: Save to /api/products/drafts every 2s idle ==========
  useEffect(() => {
    const variantId = (route.params as any)?.variantId || first?.variantId;
    if (!variantId || !platformsRef.current || Object.keys(platformsRef.current).length === 0) {
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
        const token = await ensureSupabaseJwt();

        if (!baseUrl || !token) {
          console.log('[GEN-DETAILS AutoSave] Missing baseUrl or token, skipping');
          return;
        }

        const currentData = JSON.stringify(platformsRef.current);
        if (currentData === lastSavedRef.current) {
          console.log('[GEN-DETAILS AutoSave] No changes, skipping save');
          return;
        }

        const response = await fetch(`${baseUrl}/api/products/drafts/${variantId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            draftData: platformsRef.current
          })
        });

        if (response.ok) {
          lastSavedRef.current = currentData;
          console.log('[GEN-DETAILS AutoSave] ✅ Draft auto-saved successfully');
        } else {
          const errorText = await response.text();
          console.error('[GEN-DETAILS AutoSave] ❌ Failed to auto-save draft:', response.status, errorText);
        }
      } catch (error) {
        console.error('[GEN-DETAILS AutoSave] ❌ Error auto-saving draft:', error);
      }
    }, 2000);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [displayedPlatforms, first?.variantId, route.params]);
  const platformKeys: string[] = useMemo(() => Object.keys(displayedPlatforms as Record<string, any>), [displayedPlatforms]);
  const [jobsModalVisible, setJobsModalVisible] = useState(false);
  const [userGenerateJobs, setUserGenerateJobs] = useState<Array<{ jobId: string; status: string; createdAt: string; completedAt?: string }>>([]);
  const [checklist, setChecklist] = useState<Record<string, { missing: string[]; ready: boolean }>>({});
  const [versionsSheetOpen, setVersionsSheetOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{ id: string; jobId: string; createdAt: string; platforms: any; sources?: Array<{ url: string; usedForFields?: string[] }>; matchJobId?: string; source?: string; versionCount?: number; allVersions?: Array<any> }>>([]);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [versionsTab, setVersionsTab] = useState<'versions' | 'sources'>('versions');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isFilling, setIsFilling] = useState(false);
  const [recentlyFilledByPlatform, setRecentlyFilledByPlatform] = useState<Record<string, string[]>>({});
  const [fillSelectedFields, setFillSelectedFields] = useState<string[]>([
    'title', 'description', 'price', 'barcode'
  ]);
  const [lastFillCount, setLastFillCount] = useState<number>(0);
  const [refilledFieldsByPlatform, setRefilledFieldsByPlatform] = useState<Record<string, string[]>>({});
  const [fillOverlayOpen, setFillOverlayOpen] = useState<boolean>(false);
  const [missingFieldsModalOpen, setMissingFieldsModalOpen] = useState<boolean>(false);
  const [selectedMissingPlatform, setSelectedMissingPlatform] = useState<string>('');
  const [fieldSearchQuery, setFieldSearchQuery] = useState<string>('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'Core Fields': false,
    'SEO': false,
    'Google Shopping': false,
    'Listing Details': false,
    'Shipping Details': false,
    'Return Policy': false
  });
  // Regenerate modal state
  const [regenModalOpen, setRegenModalOpen] = useState(false);
  const [regenPlatformKey, setRegenPlatformKey] = useState<string | null>(null);
  const [regenFieldKey, setRegenFieldKey] = useState<string | null>(null);
  const [regenText, setRegenText] = useState<string>('');
  const [regenVersions, setRegenVersions] = useState<Array<{ label: string; text: string }>>([]);
  const [regenActiveVersion, setRegenActiveVersion] = useState(0);
  const [regenSubmitting, setRegenSubmitting] = useState(false);
  const [regenAutoRun, setRegenAutoRun] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [allConnections, setAllConnections] = useState<any[]>([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Record<string, string>>({});
  const [platformLocations, setPlatformLocations] = useState<Record<string, Array<{ id: string; name: string; connectionId: string; connectionName: string }>>>({});
  const [mediaGallery, setMediaGallery] = useState<string[]>([]);
  const [mediaModalVisible, setMediaModalVisible] = useState(false);
  const [selectedVariantForMedia, setSelectedVariantForMedia] = useState<string | null>(null);

  // Fetch connections and locations on mount
  useEffect(() => {
    (async () => {
      try {
        const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
        const token = await ensureSupabaseJwt();
        if (!baseUrl || !token) return;

        const connRes = await fetch(`${baseUrl}/api/platform-connections`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        let connections = connRes.ok ? await connRes.json() : [];
        setAllConnections(connections);

        // ⚡ OPTIMIZED: Query PlatformLocations directly from DB instead of calling sync endpoint
        console.log('[GenerateDetails] ⚡ Loading locations directly from PlatformLocations table...');

        const connectionIds = connections.map((c: any) => c.Id);
        if (connectionIds.length === 0) {
          console.log('[GenerateDetails] No connections found');
          setPlatformLocations({});
          return;
        }

        // Query PlatformLocations directly from Supabase
        const { data: platformLocs, error } = await supabase
          .from('PlatformLocations')
          .select('PlatformConnectionId, PlatformLocationId, Name')
          .in('PlatformConnectionId', connectionIds);

        if (error) {
          console.error('[GenerateDetails] Failed to query PlatformLocations:', error);
          setPlatformLocations({});
          return;
        }

        console.log('[GenerateDetails] ✅ Retrieved', platformLocs?.length || 0, 'locations from DB in <1s');

        // Build map: connectionId -> location objects
        const locsByConnection = new Map<string, Array<{ id: string; name: string }>>();
        for (const loc of platformLocs || []) {
          if (!locsByConnection.has(loc.PlatformConnectionId)) {
            locsByConnection.set(loc.PlatformConnectionId, []);
          }
          locsByConnection.get(loc.PlatformConnectionId)!.push({
            id: loc.PlatformLocationId,
            name: loc.Name || 'Unnamed Location'
          });
        }

        // Extract locations by platform type
        const locsByPlatform: Record<string, Array<{ id: string; name: string; connectionId: string; connectionName: string }>> = {};
        for (const conn of connections) {
          const platform = conn.PlatformType?.toLowerCase();
          if (!platform || !conn.IsEnabled) continue;

          const locs = locsByConnection.get(conn.Id) || [];
          if (!locsByPlatform[platform]) locsByPlatform[platform] = [];

          for (const loc of locs) {
            locsByPlatform[platform].push({
              ...loc,
              connectionId: conn.Id,
              connectionName: conn.DisplayName || conn.PlatformType
            });
          }
        }

        console.log('[GenerateDetails] Built platform locations:', Object.keys(locsByPlatform).map(p => `${p}: ${locsByPlatform[p].length} locs`));
        setPlatformLocations(locsByPlatform);
      } catch (e) {
        console.error('Failed to fetch connections/locations:', e);
      }
    })();
  }, []);

  useEffect(() => {
    if (regenModalOpen && regenAutoRun && !regenSubmitting) {
      // small delay to allow modal layout before firing
      const t = setTimeout(() => {
        submitRegenerateField();
        setRegenAutoRun(false);
      }, 150);
      return () => clearTimeout(t);
    }
  }, [regenModalOpen, regenAutoRun, regenSubmitting]);

  // Try to pull items list from params if provided; fallback to single
  const items = useMemo(() => {
    const raw = ((route.params as any)?.items || []) as Array<{ index: number; title?: string; thumb?: string; matchesCount?: number; matchJobId?: string }>;
    const normalized = (Array.isArray(raw) ? raw : []).map((it, i) => ({
      index: it.index ?? i,
      title: it.title ?? `Item ${i + 1}`,
      thumb: it.thumb ?? '',
      matchesCount: it.matchesCount ?? 0,
      matchJobId: it.matchJobId ?? matchJobId, // Fallback to global matchJobId if not specified per item
    }));
    if (normalized.length) return normalized;
    // Build from results if items not passed
    const fallback = Array.isArray(results) ? results.map((r, i) => ({
      index: r.productIndex ?? i,
      title: `Item ${i + 1}`,
      thumb: r.sourceImageUrl || '',
      matchesCount: 0,
      matchJobId: matchJobId // Use global matchJobId for fallback items
    })) : [];
    if (fallback.length) return fallback;
    return [{
      index: first?.productIndex ?? 0,
      title: 'Item 1',
      thumb: first?.sourceImageUrl || '',
      matchesCount: 0,
      matchJobId: matchJobId // Use global matchJobId for single item
    }];
  }, [route.params, first, results, matchJobId]);

  const jobMap = ((route.params as any)?.jobMap || {}) as Record<number, { jobId: string; status?: string }>;
  // Derive quick lookups for presence of jobs
  const hasGenerateForIndex = useMemo(() => (idx: number) => Boolean(jobMap[idx]?.jobId), [jobMap]);

  // Navigation state for modal integration (like MatchSelectionScreen)
  const [currentProductIndex, setCurrentProductIndex] = useState((first?.productIndex as number) ?? (items[0]?.index || 0));
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [ignoredPlatforms, setIgnoredPlatforms] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [bottomNavState, setBottomNavState] = useState<'empty' | 'selection' | 'template' | 'platform'>('empty');
  const [itemGenerateJobs, setItemGenerateJobs] = useState<Record<number, { jobId: string; status?: string }>>(jobMap || {});

  // Decide which platforms to publish and compute inventory per platform for confirmation
  const platformsToPublish = useMemo<string[]>(() => {
    if (selectedPlatforms.length) return selectedPlatforms;
    const ready = Object.entries(checklist || {}).filter(([, v]) => v?.ready).map(([k]) => k);
    if (ready.length) return ready;
    return Object.keys(displayedPlatforms || {});
  }, [selectedPlatforms, checklist, displayedPlatforms]);

  const effectivePlatformsToPublish = useMemo<string[]>(() => {
    return platformsToPublish.filter(p => !ignoredPlatforms.includes(p));
  }, [platformsToPublish, ignoredPlatforms]);

  const quantityByPlatformComputed = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const key of platformsToPublish) {
      const p: any = (displayedPlatforms as any)?.[key] || {};
      let total = 0;
      if (Array.isArray(p.variants) && p.variants.length) {
        for (const v of p.variants) {
          const inv = v?.inventoryByLocation;
          if (inv && typeof inv === 'object') {
            Object.values(inv).forEach((loc: any) => {
              const q = Number(loc?.quantity ?? 0);
              if (!Number.isNaN(q)) total += q;
            });
          }
        }
      }
      if (total === 0) {
        const candidates = [p.quantity, p.inventoryQuantity, p?.listingDetails?.quantity, p?.locationQuantities?.default];
        for (const c of candidates) {
          if (typeof c === 'number' && !Number.isNaN(c)) { total = c; break; }
        }
      }
      out[key] = total || 0;
    }
    return out;
  }, [platformsToPublish, displayedPlatforms]);
  // Update checklist when displayed platforms change (using flexible pricing)
  useEffect(() => {
    const next: Record<string, { missing: string[]; ready: boolean }> = {};

    for (const key of Object.keys(displayedPlatforms)) {
      const data = displayedPlatforms[key] || {};
      const missing: string[] = [];

      // Title is required
      if (isEmpty(data.title)) {
        missing.push('title');
      }

      // SKU is required
      if (isEmpty(data.sku)) {
        missing.push('sku');
      }

      // Price: flexible (flat OR all variants)
      if (!hasPlatformPrice(data)) {
        missing.push('price');
      }

      // Images (optional but good practice)
      // Not blocking, just informational

      next[key] = { missing, ready: missing.length === 0 };
    }

    setChecklist(next);
  }, [displayedPlatforms]);

  // Fetch versions when sheet opens
  useEffect(() => {
    if (!versionsSheetOpen) return;

    // Try to get versions from generate jobs related to this match
    const productId = (route.params as any)?.productId || first?.productId || null;
    const variantId = (route.params as any)?.variantId || first?.variantId || null;
    const currentMatchJobId = matchJobId;

    (async () => {
      try {
        // First try to get versions from the backend API
        const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
        if (baseUrl && productId) {
          const token = await ensureSupabaseJwt();
          const res = await fetch(`${baseUrl}/api/products/generate/versions?productId=${encodeURIComponent(productId)}${variantId ? `&variantId=${encodeURIComponent(variantId)}` : ''}&limit=20&offset=0`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              // Group versions by match job ID and show latest version as primary
              const groupedVersions = groupVersionsByMatchId(data);
              setVersions(groupedVersions);
              return;
            }
          }
        }

        // Fallback: get all generate jobs and filter by current match context
        const token = await ensureSupabaseJwt();
        const { data: generateJobs, error } = await supabase
          .from('generate_jobs')
          .select('job_id, status, created_at, results, match_job_id')
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(50); // Increased limit to get more versions for grouping

        if (!error && generateJobs) {
          const relatedVersions = generateJobs
            .filter(job => {
              // Include jobs that either have the same match_job_id or contain results for the same product
              return job.match_job_id === currentMatchJobId ||
                (Array.isArray(job.results) && job.results.some((r: any) =>
                  r.productId === productId || r.productIndex === first?.productIndex
                ));
            })
            .map(job => ({
              id: job.job_id,
              jobId: job.job_id,
              createdAt: job.created_at,
              platforms: job.results?.[0]?.platforms || {},
              matchJobId: job.match_job_id,
              source: job.results?.[0]?.source || 'generated'
            }));

          // Group versions by match job ID  
          const groupedVersions = groupVersionsByMatchId(relatedVersions);
          setVersions(groupedVersions);
        }
      } catch (e) {
        console.error('Error fetching versions:', e);
      }
    })();
  }, [versionsSheetOpen, first, route.params, matchJobId]);

  // Fetch user's generate jobs for modal display (counts and last generated timestamps)
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
        if (!baseUrl) return;
        const token = await ensureSupabaseJwt();
        const res = await fetch(`${baseUrl}/api/products/generate/jobs?limit=50`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!canceled && Array.isArray(data?.jobs)) {
          const jobs = data.jobs.map((j: any) => ({ jobId: j.jobId, status: j.status, createdAt: j.createdAt, completedAt: j.completedAt }));
          setUserGenerateJobs(jobs);

          // Update itemGenerateJobs with the latest job data for each product index
          const jobsByIndex: Record<number, { jobId: string; status?: string }> = {};

          // First, include any jobs passed in via jobMap
          Object.entries(jobMap || {}).forEach(([indexStr, jobInfo]) => {
            const idx = parseInt(indexStr, 10);
            if (!isNaN(idx)) {
              jobsByIndex[idx] = jobInfo;
            }
          });

          // Then add jobs from the API response
          jobs.forEach((job: any) => {
            // For generate jobs, we need to fetch results to map to indices
            // For now, if current jobId matches, map to current product index
            if (job.jobId === jobId) {
              const currentIdx = (first?.productIndex as number) ?? 0;
              jobsByIndex[currentIdx] = { jobId: job.jobId, status: job.status };
            }
          });

          console.log('[GenerateDetails] Updated jobsByIndex:', jobsByIndex);
          setItemGenerateJobs(jobsByIndex);
        }
      } catch { }
    })();
    return () => { canceled = true };
  }, []);

  // Helper: compute overall readiness with flexible pricing
  // Compute which platforms are ready to publish
  const readyPlatforms = useMemo(() => {
    return platformKeys.filter(platformKey => {
      const platformData = (displayedPlatforms as any)?.[platformKey] || {};
      return isPlatformReady(platformData, platformKey, ignoredPlatforms);
    });
  }, [displayedPlatforms, platformKeys, ignoredPlatforms]);

  const canPublish = useMemo(() => readyPlatforms.length > 0, [readyPlatforms]);

  // Helper: get missing fields for a platform
  const getMissingFields = (platformKey: string) => {
    const schema = PLATFORM_FIELD_SCHEMA[platformKey] || {};
    const currentData = displayedPlatforms[platformKey] || {};
    const missing: Array<{ path: string; label: string; type: string; required?: boolean }> = [];

    const checkFields = (obj: any, data: any, prefix = '') => {
      Object.entries(obj).forEach(([key, fieldDef]: [string, any]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        const value = data?.[key];
        const isEmpty = value === undefined || value === null ||
          (typeof value === 'string' && value.trim() === '') ||
          (Array.isArray(value) && value.length === 0);

        if (fieldDef.type === 'object' && fieldDef.schema) {
          // Nested object - check recursively
          checkFields(fieldDef.schema, value || {}, path);
        } else if (fieldDef.type === 'array' && fieldDef.schema) {
          // Array with schema - check if empty or missing
          if (isEmpty) {
            missing.push({
              path,
              label: fieldDef.label || key,
              type: fieldDef.type,
              required: fieldDef.required
            });
          }
        } else if (isEmpty) {
          // Simple field
          missing.push({
            path,
            label: fieldDef.label || key,
            type: fieldDef.type,
            required: fieldDef.required
          });
        }
      });
    };

    checkFields(schema, currentData);
    return missing;
  };

  // Helper: search and filter fields
  const getFilteredFields = (platformKey: string) => {
    const schema = PLATFORM_FIELD_SCHEMA[platformKey] || {};
    const query = fieldSearchQuery.toLowerCase();
    const filtered: Array<{ path: string; label: string; type: string; required?: boolean; group?: string }> = [];

    const searchFields = (obj: any, prefix = '', group = '') => {
      Object.entries(obj).forEach(([key, fieldDef]: [string, any]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        const label = fieldDef.label || key;

        if (fieldDef.type === 'object' && fieldDef.schema) {
          // Group header
          if (!query || label.toLowerCase().includes(query) || key.toLowerCase().includes(query)) {
            const groupName = group ? `${group} > ${label}` : label;
            searchFields(fieldDef.schema, path, groupName);
          }
        } else {
          // Individual field
          if (!query || label.toLowerCase().includes(query) || key.toLowerCase().includes(query)) {
            filtered.push({
              path,
              label,
              type: fieldDef.type,
              required: fieldDef.required,
              group: group || 'Core Fields'
            });
          }
        }
      });
    };

    searchFields(schema);
    return filtered;
  };

  // Helper: add field to platform
  const addFieldToPlatform = (platformKey: string, fieldPath: string) => {
    const pathParts = fieldPath.split('.');
    const schema = PLATFORM_FIELD_SCHEMA[platformKey] || {};

    // Navigate to the field definition
    let fieldDef = schema;
    for (const part of pathParts.slice(0, -1)) {
      fieldDef = fieldDef[part]?.schema || fieldDef[part] || {};
    }
    const finalField = fieldDef[pathParts[pathParts.length - 1]];

    // Determine default value based on field type
    let defaultValue: any;
    if (finalField?.type) {
      switch (finalField.type) {
        case 'string':
          defaultValue = '';
          break;
        case 'number':
          defaultValue = 0;
          break;
        case 'boolean':
          defaultValue = false;
          break;
        case 'array':
          defaultValue = [];
          break;
        case 'object':
          defaultValue = {};
          break;
        case 'select':
          defaultValue = finalField.options?.[0] || '';
          break;
        default:
          defaultValue = '';
      }
    } else {
      // If no field definition found, default to empty string (this allows adding any field)
      defaultValue = '';
    }

    // Set the field value in the platform data
    updatePlatforms(prev => {
      const next = { ...prev };
      const platformData = { ...(next[platformKey] || {}) };

      // For simple fields (no dots), add directly to platform
      if (pathParts.length === 1) {
        platformData[fieldPath] = defaultValue;
      } else {
        // Navigate to the correct nested location and set the value
        let current = platformData;
        for (const part of pathParts.slice(0, -1)) {
          if (!current[part] || typeof current[part] !== 'object') {
            current[part] = {};
          }
          current = current[part];
        }
        current[pathParts[pathParts.length - 1]] = defaultValue;
      }

      next[platformKey] = platformData;
      return next;
    });

    setMissingFieldsModalOpen(false);
  };

  // Field panel open handler
  const handleOpenFieldPanel = (fieldKey: string) => {
    setSelectedFieldKey(fieldKey);
    setVersionsTab('versions');
    setVersionsSheetOpen(true);
  };

  // Build publish/save payloads from displayed data
  const buildPlatformPayload = () => {
    // canonical: prefer "shopify" as base, else first platform
    const keys = Object.keys(displayedPlatforms || {});
    const canonicalKey = keys.includes('shopify') ? 'shopify' : keys[0];
    const canonical = (displayedPlatforms?.[canonicalKey] || {}) as any;

    // Helper to parse numeric fields
    const parseNumeric = (raw: any): number | undefined => {
      if (raw === undefined || raw === null || raw === '') return undefined;
      if (typeof raw === 'number') return raw >= 0 ? raw : undefined;
      const cleaned = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
      return Number.isFinite(cleaned) && cleaned >= 0 ? cleaned : undefined;
    };

    const payload = {
      platformDetails: {
        canonical: {
          title: canonical.title || '',
          sku: String(canonical.sku || `DRAFT-${(first?.productId || '').slice(0, 8)}`),
          price: (() => {
            const raw = (canonical as any).price;
            if (typeof raw === 'number') return raw;
            const cleaned = parseFloat(String(raw ?? '').replace(/[^0-9.]/g, ''));
            return Number.isFinite(cleaned) ? cleaned : 0;
          })(),
          description: canonical.description || '',
          compareAtPrice: parseNumeric(canonical.compareAtPrice),
          barcode: canonical.barcode || undefined,
          weight: parseNumeric(canonical.weight),
          weightUnit: canonical.weightUnit || undefined,
          tags: Array.isArray(canonical.tags) ? canonical.tags : undefined,
          vendor: canonical.vendor || undefined,
          productType: canonical.productType || undefined,
          status: canonical.status || undefined,
          brand: canonical.brand || undefined,
          condition: canonical.condition || undefined,
          categorySuggestion: canonical.categorySuggestion || undefined,
          // SEO fields
          seoTitle: canonical.seo?.seoTitle || canonical.seoTitle || undefined,
          seoDescription: canonical.seo?.seoDescription || canonical.seoDescription || undefined,
          // Shipping fields
          requiresShipping: canonical.requiresShipping !== undefined ? canonical.requiresShipping : undefined,
          // Inventory tracking fields
          inventoryQuantity: parseNumeric(canonical.inventoryQuantity),
          tracked: canonical.tracked !== undefined ? canonical.tracked : undefined,
          inventoryTracker: canonical.inventoryTracker || undefined,
          // Variant options (if single variant with options)
          selectedOptions: Array.isArray(canonical.selectedOptions) ? canonical.selectedOptions : undefined,
          // Variant structure (if variants array exists)
          variants: Array.isArray(canonical.variants) && canonical.variants.length > 0
            ? canonical.variants.map((v: any) => {
              // Handle both modern format (optionValues: {Size: '2TB'}) and legacy format (option1_name, option1_value)
              let optionFields: any = {};

              if (v.optionValues && typeof v.optionValues === 'object') {
                // Modern format: { Size: '2TB', Color: 'Black' }
                // Convert to legacy format for backend
                console.log('[buildPlatformPayload] Converting modern optionValues to legacy format:', v.optionValues);
                const entries = Object.entries(v.optionValues);
                entries.forEach(([name, value], idx) => {
                  if (idx === 0) {
                    optionFields.option1_name = name;
                    optionFields.option1_value = value;
                  } else if (idx === 1) {
                    optionFields.option2_name = name;
                    optionFields.option2_value = value;
                  } else if (idx === 2) {
                    optionFields.option3_name = name;
                    optionFields.option3_value = value;
                  }
                });
              } else {
                // Legacy format already present
                optionFields.option1_name = v.option1_name || undefined;
                optionFields.option1_value = v.option1_value || undefined;
                optionFields.option2_name = v.option2_name || undefined;
                optionFields.option2_value = v.option2_value || undefined;
                optionFields.option3_name = v.option3_name || undefined;
                optionFields.option3_value = v.option3_value || undefined;
              }

              return {
                ...optionFields,
                sku: v.sku || undefined,
                barcode: v.barcode || undefined,
                price: parseNumeric(v.price),
                compareAtPrice: parseNumeric(v.compareAtPrice),
                costPerItem: parseNumeric(v.costPerItem),
                inventoryQuantity: parseNumeric(v.inventoryQuantity),
                inventoryTracker: v.inventoryTracker || undefined,
                tracked: v.tracked !== undefined ? v.tracked : undefined,
                requiresShipping: v.requiresShipping !== undefined ? v.requiresShipping : undefined,
                weightValueGrams: parseNumeric(v.weightValueGrams),
                inventoryByLocation: v.inventoryByLocation || undefined,
              };
            })
            : undefined,
        },
        // ALSO send platform-specific data to preserve original generated fields
        // Backend will prefer platform-specific over canonical
        ...Object.keys(displayedPlatforms || {}).reduce((acc, platformKey) => {
          const platformData = (displayedPlatforms as any)[platformKey];
          if (platformData && typeof platformData === 'object') {
            acc[platformKey] = platformData;
          }
          return acc;
        }, {} as Record<string, any>),
      },
      media: (() => {
        // CRITICAL: Use userImagesByIndex which prioritizes: 1) DB images, 2) params, 3) scraped fallback
        const imgs = new Set<string>();

        // First, collect from displayed platforms (preserves user edits in the form)
        for (const k of Object.keys(displayedPlatforms || {})) {
          const p = (displayedPlatforms as any)[k] || {};
          const arr = p.images || p.imageUris || [];
          if (Array.isArray(arr)) {
            arr.forEach((u: string) => {
              if (typeof u === 'string' && u && !u.includes('firecrawl') && !u.includes('serpapi')) {
                imgs.add(u);
              }
            });
          }
        }

        // Add user images from computed userImagesByIndex (includes DB images!)
        const idx = (first?.productIndex as number) ?? 0;
        const userImages = userImagesByIndex[idx] || [];
        userImages.forEach((u: string) => {
          if (typeof u === 'string' && u) {
            imgs.add(u);
          }
        });

        const imageUris = Array.from(imgs);
        console.log('[buildPlatformPayload] Using user images (DB + params):', imageUris);
        return { imageUris, coverImageIndex: 0 };
      })(),
      selectedPlatformsToPublish: Object.keys(displayedPlatforms || {}),
    };

    return payload;
  };

  const fillTheRest = async () => {
    if (isFilling || !ENABLE_AI_REFILL_FEATURES) return;
    try {
      setIsFilling(true);
      const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || first?.productId;
      const variantId = (route.params as any)?.variantId || first?.variantId;
      if (!baseUrl || !productId || !variantId || !token) return;

      const payload = buildPlatformPayload();
      const selectedPlatforms = Object.keys(displayedPlatforms || {});

      const res = await fetch(`${baseUrl}/api/products/generate-details`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          imageUris: payload.media.imageUris,
          coverImageIndex: payload.media.coverImageIndex,
          selectedPlatforms,
          selectedMatch: null,
          enhancedWebData: null,
        })
      });
      if (!res.ok) return;
      const data = await res.json();
      const gen = (data?.generatedDetails || data || {}) as any;
      const genPlatforms = (gen.platforms || {}) as Record<string, any>;

      const mergeFields = ['title', 'description', 'tags', 'price', 'weight', 'weightUnit', 'sku', 'barcode', 'images', 'options', 'seoTitle', 'seoDescription'];
      const next = { ...displayedPlatforms } as any;
      const changedMap: Record<string, string[]> = {};
      for (const k of Object.keys(genPlatforms)) {
        const incoming = genPlatforms[k] || {};
        const curr = next[k] || {};
        const merged: any = { ...curr };
        for (const f of mergeFields) {
          if (!fillSelectedFields.includes(f)) continue;
          const currVal = curr?.[f];
          const incomingVal = incoming?.[f];
          const isEmpty = (v: any) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
          if (isEmpty(currVal) && incomingVal !== undefined) {
            merged[f] = Array.isArray(incomingVal) ? [...incomingVal] : incomingVal;
            if (!changedMap[k]) changedMap[k] = [];
            changedMap[k].push(f);
          }
        }
        next[k] = merged;
      }
      updatePlatforms(next);
      setRecentlyFilledByPlatform(changedMap);
      // Track refilled fields per platform for pill badges
      setRefilledFieldsByPlatform(prev => {
        const merged: Record<string, string[]> = { ...prev };
        for (const k of Object.keys(changedMap)) {
          const prevArr = merged[k] || [];
          merged[k] = Array.from(new Set([...prevArr, ...changedMap[k]]));
        }
        return merged;
      });
      // write into platform state so ListingEditorForm can render badge without screen prop threading
      updatePlatforms(prev => {
        const out: any = { ...prev };
        for (const k of Object.keys(changedMap)) {
          out[k] = { ...(out[k] || {}), __refilled: Array.from(new Set([...((out[k]?.__refilled) || []), ...changedMap[k]])) };
        }
        return out;
      });
    } catch { }
    finally {
      setIsFilling(false);
    }
  };

  const regenerateField = async (platformKey: string, fieldKey: string) => {
    if (!ENABLE_AI_REFILL_FEATURES) return;
    setRegenPlatformKey(platformKey);
    setRegenFieldKey(fieldKey);
    // Seed versions with current text as Version 1
    const currentVal = ((displayedPlatforms as any)?.[platformKey] || {})[fieldKey];
    const baseText = Array.isArray(currentVal) ? currentVal.join(', ') : (currentVal ?? '');
    setRegenVersions([{ label: 'Version 1', text: String(baseText) }]);
    setRegenActiveVersion(0);
    setRegenText('');
    setRegenModalOpen(true);
    // If field is empty, auto-run regenerate when modal opens
    const isEmpty = baseText === '' || baseText == null;
    setRegenAutoRun(isEmpty);
  };

  const submitRegenerateField = async () => {
    try {
      setRegenSubmitting(true);
      const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || first?.productId;
      const variantId = (route.params as any)?.variantId || first?.variantId;
      if (!baseUrl || !productId || !variantId || !regenPlatformKey || !regenFieldKey || !token) return;
      const payload = buildPlatformPayload();

      const submit = await fetch(`${baseUrl}/api/products/regenerate/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generateJobId: jobId,
          products: [{
            productIndex: currentProductIndex,
            productId,
            variantId,
            regenerateType: 'specific_fields',
            targetPlatform: regenPlatformKey,
            targetFields: [regenFieldKey],
            userQuery: regenText,
            customPrompt: regenText,
            imageUrls: payload.media.imageUris,
          }],
          options: { useExistingScrapedData: true }
        })
      });
      if (!submit.ok) throw new Error('regenerate submit failed');
      const submitJson = await submit.json();
      const regenJobId = submitJson?.jobId;

      const resultPayload = await pollRegenerateUntilDone(regenJobId, token || undefined);
      const resultArray = Array.isArray(resultPayload?.results) ? resultPayload.results : [];
      const matched = resultArray.find((r: any) => r.productIndex === currentProductIndex) || resultArray[0];
      const incomingPlatform = (matched?.platforms || {})[regenPlatformKey] || {};
      if (incomingPlatform && Object.prototype.hasOwnProperty.call(incomingPlatform, regenFieldKey)) {
        const newText = Array.isArray(incomingPlatform[regenFieldKey!]) ? (incomingPlatform[regenFieldKey!] as any[]).join(', ') : String(incomingPlatform[regenFieldKey!]);
        setRegenVersions(prev => [...prev, { label: `Version ${prev.length + 1}`, text: newText }]);
        setRegenActiveVersion(prev => prev + 1);
        updatePlatforms(prev => ({
          ...prev,
          [regenPlatformKey]: (() => {
            const curr = prev?.[regenPlatformKey] || {} as any;
            const __refilled = Array.from(new Set([...(curr.__refilled || []), regenFieldKey!]));
            return {
              ...curr,
              [regenFieldKey!]: Array.isArray(incomingPlatform[regenFieldKey!]) ? [...incomingPlatform[regenFieldKey!]] : incomingPlatform[regenFieldKey!],
              __refilled,
            };
          })()
        }));
        setRefilledFieldsByPlatform(prev => ({
          ...prev,
          [regenPlatformKey]: Array.from(new Set([...(prev[regenPlatformKey] || []), regenFieldKey!]))
        }));
      }
    } catch (e) {
      console.error('Regenerate field failed:', e);
    } finally {
      setRegenSubmitting(false);
    }
  };

  const doSaveDraft = async () => {
    console.log('[doSaveDraft] Starting draft save...');
    try {
      const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || first?.productId;
      const variantId = (route.params as any)?.variantId || first?.variantId;
      if (!baseUrl || !productId || !variantId || !token) {
        console.log('[doSaveDraft] Missing required data');
        return;
      }

      const payload = buildPlatformPayload();
      console.log('[doSaveDraft] Saving payload:', JSON.stringify(payload, null, 2));

      const res = await fetch(`${baseUrl}/api/products/publish`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          publishIntent: 'SAVE_SSSYNC_DRAFT',
          platformDetails: payload.platformDetails,
          media: payload.media,
          selectedPlatformsToPublish: [],
        })
      });

      if (res.ok) {
        console.log('[doSaveDraft] Draft saved successfully');

        // Fetch the updated variant data from the database to show the saved values
        const { data: updatedVariant, error: fetchError } = await supabase
          .from('ProductVariants')
          .select('*')
          .eq('Id', variantId)
          .single();

        if (!fetchError && updatedVariant) {
          console.log('[doSaveDraft] Fetched updated variant:', updatedVariant);

          // Update the displayed platforms with the saved data
          // This ensures the UI reflects what's actually in the database
          const canonicalKey = platformKeys.includes('shopify') ? 'shopify' : platformKeys[0];
          if (canonicalKey && displayedPlatforms[canonicalKey]) {
            updatePlatforms(prev => ({
              ...prev,
              [canonicalKey]: {
                ...prev[canonicalKey],
                title: updatedVariant.Title || prev[canonicalKey]?.title,
                sku: updatedVariant.Sku || prev[canonicalKey]?.sku,
                price: updatedVariant.Price ?? prev[canonicalKey]?.price,
                description: updatedVariant.Description || prev[canonicalKey]?.description,
                barcode: updatedVariant.Barcode || prev[canonicalKey]?.barcode,
                weight: updatedVariant.Weight ?? prev[canonicalKey]?.weight,
                weightUnit: updatedVariant.WeightUnit || prev[canonicalKey]?.weightUnit,
              }
            }));
          }
        }

        // Show success message briefly before navigating
        alert('Draft saved successfully!');
        navigation.goBack();
      } else {
        const errorText = await res.text();
        console.error('[doSaveDraft] Draft save failed:', errorText);
        alert(`Failed to save draft: ${errorText}`);
      }
    } catch (err) {
      console.error('[doSaveDraft] Error saving draft:', err);
      alert('Failed to save draft. Please try again.');
    }
  };

  const doPublish = async () => {
    console.log('doPublish - Starting publish flow');
    console.log('displayedPlatforms:', JSON.stringify(displayedPlatforms, null, 2));
    console.log('readyPlatforms:', readyPlatforms);
    console.log('platformKeys:', platformKeys);

    try {
      const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
      const token = await ensureSupabaseJwt();
      if (!baseUrl || !token) {
        console.log('doPublish - Missing baseUrl or token');
        return;
      }

      const payload = buildPlatformPayload();
      const canonical = payload.platformDetails?.canonical || {};
      console.log('doPublish - Canonical payload:', canonical);

      // Validate readiness with flexible pricing
      const missingByPlatform: Record<string, string[]> = {};

      for (const platform of readyPlatforms) {
        const platformKey = String(platform).toLowerCase();
        const platformData = (payload.platformDetails as any)?.[platformKey] || {};
        const missing = getMissingPlatformFields(platformData, platformKey);

        if (missing.length > 0) {
          console.log(`doPublish - ${platformKey} missing fields:`, missing);
          missingByPlatform[platformKey] = missing;
        } else {
          console.log(`doPublish - ${platformKey} is ready to publish`);
        }
      }
      console.log('doPublish - Missing by platform:', missingByPlatform);

      if (Object.keys(missingByPlatform).length) {
        const lines = Object.entries(missingByPlatform).map(([plat, fields]) =>
          `${PLATFORM_META[plat]?.label || plat}: Missing ${fields.join(', ')}`
        );
        alert(`Cannot publish yet!\n\n${lines.join('\n')}\n\nPlease fill in all required fields.`);
        return;
      }

      // Fetch connections for ready platforms
      const connRes = await fetch(`${baseUrl}/api/platform-connections`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const connections = connRes.ok ? await connRes.json() : [];
      setAllConnections(connections);

      // Extract locations from connections
      const locsByPlatform: Record<string, Array<{ id: string; name: string; connectionId: string; connectionName: string }>> = {};
      for (const conn of connections) {
        const platform = conn.PlatformType?.toLowerCase();
        if (!platform || !conn.IsEnabled) continue;

        const platformData = conn.PlatformSpecificData || {};
        const locations = platformData.locations || [];

        if (!locsByPlatform[platform]) locsByPlatform[platform] = [];

        for (const loc of locations) {
          locsByPlatform[platform].push({
            id: loc.id || loc.gid || '',
            name: loc.name || 'Unnamed Location',
            connectionId: conn.Id,
            connectionName: conn.DisplayName || conn.PlatformType
          });
        }
      }
      setPlatformLocations(locsByPlatform);

      // Auto-select first connection for each ready platform
      const autoSelected: Record<string, string> = {};
      for (const platform of readyPlatforms) {
        const platformConns = connections.filter((c: any) =>
          c.PlatformType?.toLowerCase() === platform.toLowerCase() && c.IsEnabled
        );
        if (platformConns.length > 0) {
          autoSelected[platform] = platformConns[0].Id;
        }
      }
      setSelectedConnectionIds(autoSelected);

      // Show modal
      setPublishModalOpen(true);

    } catch (err) {
      console.error('Error in doPublish:', err);
      alert('Failed to prepare publish. Please try again.');
    }
  };

  // Upload local image URIs to Supabase and return public URLs
  const uploadLocalImagesToSupabase = async (localUris: string[]): Promise<string[]> => {
    const publicUrls: string[] = [];
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      for (const localUri of localUris) {
        // Skip if already a public URL
        if (localUri.startsWith('http://') || localUri.startsWith('https://')) {
          publicUrls.push(localUri);
          continue;
        }

        try {
          console.log('[UPLOAD] Uploading image:', localUri);
          const parsedPath = Paths.parse(localUri);
          const srcFile = new File(new Directory(parsedPath.dir), parsedPath.base);
          const bytes = await srcFile.bytes();

          const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

          const { data, error } = await supabase.storage
            .from('product-images')
            .upload(fileName, bytes, {
              contentType: 'image/jpeg',
              cacheControl: '3600',
            });

          if (error) {
            console.error('[UPLOAD] Supabase upload error:', error);
            continue; // Skip this image but continue with others
          }

          const { data: urlData } = supabase.storage
            .from('product-images')
            .getPublicUrl(fileName);

          const publicUrl = urlData.publicUrl;
          console.log('[UPLOAD] Successfully uploaded to:', publicUrl);
          publicUrls.push(publicUrl);
        } catch (err) {
          console.error('[UPLOAD] Failed to upload image:', localUri, err);
        }
      }
    } catch (err) {
      console.error('[UPLOAD] Upload batch failed:', err);
    }
    return publicUrls;
  };

  const confirmAndPublish = async () => {
    try {
      console.log('[confirmAndPublish] Starting publish...');
      setPublishModalOpen(false);
      const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || first?.productId;
      const variantId = (route.params as any)?.variantId || first?.variantId;
      console.log('[confirmAndPublish] Got IDs:', { productId, variantId, baseUrl: !!baseUrl, token: !!token });
      if (!baseUrl || !productId || !variantId || !token) {
        console.log('[confirmAndPublish] Missing required data, aborting');
        return;
      }

      const rawPayload = buildPlatformPayload();

      // Upload local images to Supabase before publishing
      console.log('[confirmAndPublish] Uploading local images...');
      const uploadedImageUris = await uploadLocalImagesToSupabase(rawPayload.media.imageUris || []);
      console.log('[confirmAndPublish] Uploaded images:', uploadedImageUris);

      // Replace local URIs with uploaded public URLs
      const payload = {
        ...rawPayload,
        media: {
          ...rawPayload.media,
          imageUris: uploadedImageUris,
        },
      };

      const canonical = payload.platformDetails?.canonical || {};

      // Expand "ALL" selections to actual connection IDs
      const actualConnectionIds: Record<string, string[]> = {};
      const accountNamesList: string[] = [];

      for (const [platform, selection] of Object.entries(selectedConnectionIds)) {
        const platformConns = allConnections.filter((c: any) =>
          c.PlatformType?.toLowerCase() === platform.toLowerCase() && c.IsEnabled
        );

        if (selection === 'ALL') {
          actualConnectionIds[platform] = platformConns.map((c: any) => c.Id);
          accountNamesList.push(...platformConns.map((c: any) => c.DisplayName));
        } else {
          actualConnectionIds[platform] = [selection];
          const conn = platformConns.find((c: any) => c.Id === selection);
          if (conn) accountNamesList.push(conn.DisplayName);
        }
      }

      const platformsToPublish = Object.keys(actualConnectionIds);

      const publishPayload = {
        productId,
        variantId,
        publishIntent: 'PUBLISH_PLATFORM_LIVE',
        platformDetails: payload.platformDetails,
        media: payload.media,
        selectedPlatformsToPublish: platformsToPublish,
        connectionIds: actualConnectionIds,
      };

      console.log('[confirmAndPublish] Publishing to:', platformsToPublish);
      console.log('[confirmAndPublish] Connection IDs:', actualConnectionIds);
      console.log('[confirmAndPublish] Canonical data being sent:', JSON.stringify(payload.platformDetails.canonical, null, 2));
      console.log('[confirmAndPublish] Full payload:', JSON.stringify(publishPayload, null, 2));

      const publishRes = await fetch(`${baseUrl}/api/products/publish`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(publishPayload),
      });

      console.log('[confirmAndPublish] Response status:', publishRes.status);

      if (!publishRes.ok) {
        const errorText = await publishRes.text();
        console.error('Publish failed:', errorText);

        // Parse error for better user messaging
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.statusCode === 409 && errorJson.details?.sku) {
            alert(`SKU "${errorJson.details.sku}" is already in use by another product. Please change the SKU and try again.`);
          } else {
            alert(`Failed to publish: ${errorJson.message || errorText}`);
          }
        } catch {
          alert(`Failed to publish: ${errorText}`);
        }

        // Don't clear data on error - user can fix and retry
        return;
      }

      const imageUrl = (() => {
        const idx = typeof payload.media?.coverImageIndex === 'number' ? payload.media.coverImageIndex : 0;
        const arr = Array.isArray(payload.media?.imageUris) ? payload.media.imageUris : [];
        return arr[idx] || first?.sourceImageUrl || '';
      })();

      navigation.navigate('PublishConfirmation', {
        productId,
        variantId,
        title: canonical.title,
        description: canonical.description,
        price: Number(canonical.price || 0),
        imageUrl,
        platforms: platformsToPublish,
        accountNames: accountNamesList,
        quantityByPlatform: quantityByPlatformComputed,
        origin: 'generate',
        sourcePlatform: platformsToPublish[0] || 'shopify',
      } as any);

    } catch (err) {
      console.error('Error in confirmAndPublish:', err);
      alert('Failed to publish. Please try again.');
    }
  };

  const pollRegenerateUntilDone = async (regenJobId: string, token?: string) => {
    const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
    if (!baseUrl) return null;
    for (let i = 0; i < 40; i++) {
      try {
        const auth = token || await ensureSupabaseJwt();
        const r = await fetch(`${baseUrl}/api/products/regenerate/status/${regenJobId}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : undefined });
        const s = await r.json();
        if (s?.status === 'completed') {
          const rr = await fetch(`${baseUrl}/api/products/regenerate/results/${regenJobId}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : undefined });
          if (rr.ok) return await rr.json();
          return null;
        }
        if (s?.status === 'failed' || s?.status === 'cancelled') return null;
      } catch { }
      await new Promise(res => setTimeout(res, 1200));
    }
    return null;
  };

  const generatePlatform = async (platformKey: string) => {
    try {
      const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || first?.productId;
      const variantId = (route.params as any)?.variantId || first?.variantId;
      if (!baseUrl || !productId || !variantId || !token) return;



      const payload = buildPlatformPayload();
      const submit = await fetch(`${baseUrl}/api/products/regenerate/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generateJobId: jobId,
          products: [{
            productIndex: (first?.productIndex as number) ?? 0,
            productId,
            variantId,
            regenerateType: 'entire_platform',
            targetPlatform: platformKey,
            imageUrls: payload.media.imageUris,
          }],
          options: { useExistingScrapedData: true }
        })
      });
      if (!submit.ok) throw new Error(`Platform generation failed: ${submit.status}`);
      const submitJson = await submit.json();
      const regenJobId = submitJson?.jobId;
      const resultPayload = await pollRegenerateUntilDone(regenJobId, token || undefined);
      const resultArray = Array.isArray(resultPayload?.results) ? resultPayload.results : [];
      const matched = resultArray.find((r: any) => (typeof r.productIndex === 'number' ? r.productIndex : 0) === ((first?.productIndex as number) ?? 0)) || resultArray[0];
      const generatedPlatforms = (matched?.platforms || {}) as Record<string, any>;

      if (generatedPlatforms && generatedPlatforms[platformKey]) {
        // Update displayed platforms with the new generated data
        const normalized = normalizeForListingEditor(generatedPlatforms[platformKey]);
        updatePlatforms(prev =>
          hydratePlatformsFromBackend({ [platformKey]: normalized }, prev)
        );
      }
    } catch (error) {
      console.error('Platform generation failed:', error);
      throw error;
    }
  };

  const suggestVariants = async (platformKey: string) => {
    try {
      const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || first?.productId;
      const variantId = (route.params as any)?.variantId || first?.variantId;
      if (!baseUrl || !productId || !variantId || !token) return;
      const payload = buildPlatformPayload();
      const submit = await fetch(`${baseUrl}/api/products/regenerate/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generateJobId: jobId,
          products: [{
            productIndex: currentProductIndex,
            productId,
            variantId,
            regenerateType: 'specific_fields',
            targetPlatform: platformKey,
            targetFields: ['variants'],
            userQuery: 'Suggest variants from images and description. Return optionsSuggestions as {name, values} and variantExamples.',
            customPrompt: 'Suggest variants from images and description. Return optionsSuggestions as {name, values} and variantExamples.',
            imageUrls: payload.media.imageUris,
          }],
          options: { useExistingScrapedData: true }
        })
      });
      if (!submit.ok) throw new Error('variant suggest submit failed');
      const submitJson = await submit.json();
      const regenJobId = submitJson?.jobId;
      const resultPayload = await pollRegenerateUntilDone(regenJobId, token || undefined);
      const resultArray = Array.isArray(resultPayload?.results) ? resultPayload.results : [];
      const matched = resultArray.find((r: any) => r.productIndex === currentProductIndex) || resultArray[0];
      const canonical = (matched?.platforms || {}).canonical;
      if (canonical?.optionsSuggestions) {
        updatePlatforms(prev => ({
          ...prev,
          [platformKey]: {
            ...(prev as any)[platformKey],
            __variantSuggestions: canonical.optionsSuggestions
          }
        }));
      }
    } catch (e) {
      console.error('Suggest variants failed:', e);
    }
  };

  const boostListing = async (platformKey: string, kind: 'boost' | 'advanced') => {
    try {
      const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || first?.productId;
      const variantId = (route.params as any)?.variantId || first?.variantId;
      if (!baseUrl || !productId || !variantId || !token) return;
      const payload = buildPlatformPayload();
      const fieldGroups: Record<string, string[]> = {
        boost: ['tags', 'categorySuggestion', 'brand', 'seoTitle', 'seoDescription'],
        advanced: ['googleShopping', 'itemSpecifics', 'returnPolicy', 'shippingDetails']
      };
      const targetFields = fieldGroups[kind] || [];
      const userQuery = kind === 'boost'
        ? 'Boost listing for conversion and SEO. Add persuasive tags, category suggestions, brand if known, and SEO title/description.'
        : 'Fill advanced/other listing fields accurately from context. Keep optional fields helpful and consistent.';
      const submit = await fetch(`${baseUrl}/api/products/regenerate/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generateJobId: jobId,
          products: [{
            productIndex: currentProductIndex,
            productId,
            variantId,
            regenerateType: 'specific_fields',
            targetPlatform: platformKey,
            targetFields,
            userQuery,
            customPrompt: userQuery,
            imageUrls: payload.media.imageUris,
          }],
          options: { useExistingScrapedData: true }
        })
      });
      if (!submit.ok) throw new Error('boost submit failed');
      const submitJson = await submit.json();
      const regenJobId = submitJson?.jobId;
      const resultPayload = await pollRegenerateUntilDone(regenJobId, token || undefined);
      const resultArray = Array.isArray(resultPayload?.results) ? resultPayload.results : [];
      const matched = resultArray.find((r: any) => r.productIndex === currentProductIndex) || resultArray[0];
      const incomingPlatform = (matched?.platforms || {})[platformKey] || {};
      const normalized = normalizeForListingEditor(incomingPlatform);
      updatePlatforms(prev =>
        hydratePlatformsFromBackend({ [platformKey]: normalized }, prev)
      );
    } catch (e) {
      console.error('Boost listing failed:', e);
    }
  };

  // ========== PHASE 2.6: Media Gallery Handlers ==========
  const handlePickImage = async () => {
    try {
      // Request permissions first (like AddProductScreen)
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'We need access to your photo library to upload images.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        aspect: [4, 3],
        quality: 0.8, // Match AddProductScreen quality
      });

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];

        // Upload to Supabase (like AddProductScreen does)
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            Alert.alert('User not authenticated');
            return;
          }

          // Read bytes using File API (Expo SDK 54+)
          const parsedPath = Paths.parse(asset.uri);
          const srcFile = new File(new Directory(parsedPath.dir), parsedPath.base);
          const bytes = await srcFile.bytes();

          // Create file name in user's folder
          const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

          const { data, error } = await supabase.storage
            .from('product-images')
            .upload(fileName, bytes, {
              contentType: 'image/jpeg',
              cacheControl: '3600',
            });

          if (error) {
            console.error('[Phase2 Media] Upload error:', error);
            Alert.alert('Failed to upload image to storage');
            return;
          }

          // Get public URL
          const { data: urlData } = supabase.storage
            .from('product-images')
            .getPublicUrl(fileName);

          const publicUrl = urlData.publicUrl;
          console.log('[Phase2 Media] Image uploaded:', publicUrl);

          // Add to media gallery
          setMediaGallery(prev => [...prev, publicUrl]);

        } catch (uploadError) {
          console.error('[Phase2 Media] Failed to upload image:', uploadError);
          Alert.alert('Failed to upload image');
        }
      }
    } catch (error) {
      console.error('[Phase2 Media] Error picking image:', error);
      Alert.alert('Failed to pick image');
    }
  };

  const handleRemoveMedia = (index: number) => {
    const removedUrl = mediaGallery[index];
    setMediaGallery(prev => prev.filter((_, i) => i !== index));
    console.log('[Phase2 Media] Image removed at index:', index, 'URL:', removedUrl);
  };

  const handleSetVariantPhoto = (imageUrl: string) => {
    if (!selectedVariantForMedia) {
      Alert.alert('No variant selected');
      return;
    }

    console.log('[Phase2 Media] Set variant', selectedVariantForMedia, 'photo to:', imageUrl);
    setSelectedVariantForMedia(null);
  };

  // ========== LOAD DRAFT ON MOUNT (when reopening saved item) ==========
  useEffect(() => {
    const variantId = (route.params as any)?.variantId;
    const hasResults = Array.isArray(results) && results.length > 0;
    const hasPlatformData = Object.keys(platformsRef.current).length > 0;

    // Only load draft if:
    // 1. We have a variantId
    // 2. platformsRef is still empty (not already hydrated from results or previous load)
    // NOTE: We now load draft even if results exist, because user might have edited after generation
    if (!variantId || hasPlatformData) {
      console.log('[GEN-DETAILS DraftLoad] Skipping - variantId:', !!variantId, 'hasPlatformData:', hasPlatformData);
      return;
    }

    let canceled = false;
    (async () => {
      try {
        const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
        const token = await ensureSupabaseJwt();

        if (!baseUrl || !token) {
          console.log('[GEN-DETAILS DraftLoad] Missing baseUrl or token, skipping');
          return;
        }

        console.log('[GEN-DETAILS DraftLoad] ⏳ Loading draft for variant:', variantId);
        const response = await fetch(`${baseUrl}/api/products/drafts/${variantId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn('[GEN-DETAILS DraftLoad] ❌ Failed to load draft:', response.status, errorText);
          return;
        }

        const draftResponse = await response.json();
        const currentDraft = draftResponse?.currentDraft;

        if (!currentDraft || !currentDraft.DraftData) {
          console.log('[GEN-DETAILS DraftLoad] No draft data found');
          return;
        }

        if (!canceled) {
          console.log('[GEN-DETAILS DraftLoad] ✅ Loaded draft:', currentDraft.DraftData);
          // Restore the draft data into platformsRef
          platformsRef.current = currentDraft.DraftData;
          lastSavedRef.current = JSON.stringify(currentDraft.DraftData);
          forceUpdate({}); // Trigger re-render with restored data
        }
      } catch (error) {
        console.error('[GEN-DETAILS DraftLoad] ❌ Error loading draft:', error);
      }
    })();

    return () => { canceled = true };
  }, [(route.params as any)?.variantId, results]);


  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={{ position: 'absolute', top: -32, right: 16, zIndex: 4000, flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={() => setVersionsSheetOpen(true)} style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5' }}>
            <Text style={{ color: '#000', fontWeight: '600' }}>•••</Text>
          </TouchableOpacity>
        </View>
        {/* Back button and Current Jobs buttons */}
        <View style={{ position: 'absolute', top: -32, left: 16, zIndex: 4000, flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={() => {
              // Navigate back to past scans page
              navigation.goBack();
            }}
            style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.9)', minHeight: 34, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5', flexDirection: 'row', alignItems: 'center' }}
          >
            <Icon name="arrow-left" size={18} color={'#000'} />
            <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Back</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setJobsModalVisible(true)} style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.9)', minHeight: 34, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5', flexDirection: 'row', alignItems: 'center' }}>
            <Boxes size={18} color={'#000'} />
            <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Current Jobs</Text>
          </TouchableOpacity>
        </View>

        <ScrollView>
          {first ? (

            <>


              {/* Editor form that matches the product page design */}
              <ListingEditorForm
                platforms={displayedPlatforms}
                updateCounter={updateCounter}
                images={(userImagesByIndex[(first?.productIndex as number) ?? 0] || [first?.sourceImageUrl || '']).filter(Boolean)}
                platformLocations={platformLocations}
                onChangePlatforms={(next) => {
                  console.log('[GEN-DETAILS] onChangePlatforms received - deep merge to preserve all data');
                  // DEEP merge: preserve all existing fields while updating changed ones
                  // This preserves user edits AND keeps all loaded backend data
                  updatePlatforms(prev => {
                    const merged = { ...prev };
                    for (const [platformKey, platformData] of Object.entries(next)) {
                      const prevPlatform = prev[platformKey] || {};

                      // Deep merge platform data
                      merged[platformKey] = {
                        ...prevPlatform,
                        ...platformData
                      };

                      // CRITICAL: Preserve variant inventoryByLocation when merging variants array
                      if (Array.isArray(platformData?.variants) && Array.isArray(prevPlatform.variants)) {
                        merged[platformKey].variants = platformData.variants.map((newVariant: any) => {
                          const prevVariant = prevPlatform.variants?.find((v: any) => v.id === newVariant.id);
                          if (prevVariant?.inventoryByLocation) {
                            return {
                              ...newVariant,
                              inventoryByLocation: {
                                ...prevVariant.inventoryByLocation,
                                ...(newVariant.inventoryByLocation || {})
                              }
                            };
                          }
                          return newVariant;
                        });
                      }
                    }
                    console.log('[GEN-DETAILS] Deep merged platforms, keys:', Object.keys(merged));
                    return merged;
                  });
                }}
                onOpenFieldPanel={handleOpenFieldPanel}
                onRegenerateField={ENABLE_AI_REFILL_FEATURES ? regenerateField : undefined}
                onOpenBarcodeScanner={(onResult) => {
                  setScannerOpen(true);
                  // handler stored on closure
                  (GenerateDetailsScreen as any)._scannerResultHandler = onResult;
                }}
                onOpenImageCapture={(done) => {
                  // Use AddProduct camera flow; pass a callback for captured images (photos only)
                  (route as any).navigation?.navigate?.('AddProduct', { firstPhotos: [], bulkItems: [], captureOnly: true, onDone: (uris: string[]) => done(uris) } as any);
                }}
                onAddMissingField={(platformKey: string) => {
                  setSelectedMissingPlatform(platformKey);
                  setFieldSearchQuery('');
                  setMissingFieldsModalOpen(true);
                }}
                getMissingFieldsCount={(platformKey: string) => getMissingFields(platformKey).length}
                onGeneratePlatform={generatePlatform}
                enableAIRefill={ENABLE_AI_REFILL_FEATURES}
                onSuggestVariants={suggestVariants}
                onBoostListing={boostListing}
                isGenerationMode={true}
              />
            </>
          ) : (
            <Text style={styles.meta}>No results</Text>
          )}
        </ScrollView>



        <ItemJobsModal
          visible={jobsModalVisible}
          onClose={() => setJobsModalVisible(false)}
          items={items}
          currentIndex={currentProductIndex}
          scanColor={() => '#10B981'}
          matchColor={() => '#10B981'}
          detailsColor={(idx) => {
            const s = itemGenerateJobs[idx]?.status;
            if (s === 'completed') return '#93C822';
            if (s === 'failed') return '#e11d48';
            if (s) return '#FFD700';
            return '#4B5563';
          }}
          detailsEnabled={(idx) => !!itemGenerateJobs[idx]?.jobId}
          countLabel={'Generations'}
          getSecondaryText={(idx) => {
            const jid = itemGenerateJobs[idx]?.jobId;
            const rec = jid ? userGenerateJobs.find(j => j.jobId === jid) : null;
            if (!rec) return null;
            if (rec.status === 'completed') return 'Generated';
            if (rec.status === 'failed') return 'Generation failed';
            if (rec.status === 'processing' || rec.status === 'queued') return 'Generating…';
            const date = rec.completedAt || rec.createdAt;
            return date ? `Last: ${new Date(date).toLocaleString()}` : null;
          }}
          onQuickGenerate={async (idx) => {
            try {
              // TODO: Implement quick generate for this specific item
              // For now, navigate back to match selection to start the flow
              setCurrentProductIndex(idx);
              setJobsModalVisible(false);
              (route as any).navigation?.navigate?.('MatchSelectionScreen', { focusIndex: idx, items, jobMap: itemGenerateJobs } as any);
            } catch (e) {
              console.error('Quick generate failed:', e);
            }
          }}
          onPickScan={(idx) => {
            setCurrentProductIndex(idx);
            setSelectedIndices([]);
            setSelectedPlatforms([]);
            setSelectedTemplate(null);
            setJobsModalVisible(false);
            setBottomNavState('empty');
          }}
          onPickMatch={(idx) => {
            // Jump to match selection for this item, use specific match job id for that item
            const selectedItem = items.find(item => item.index === idx);
            const itemMatchJobId = selectedItem?.matchJobId || matchJobId; // Fallback to global if not found
            setCurrentProductIndex(idx);
            setJobsModalVisible(false);
            (route as any).navigation?.navigate?.('MatchSelectionScreen', {
              jobId: itemMatchJobId,
              focusIndex: idx,
              items,
              jobMap: itemGenerateJobs
            } as any);
          }}
          onPickDetails={(idx) => {
            const jid = itemGenerateJobs[idx]?.jobId;
            if (jid) {
              setCurrentProductIndex(idx);
              setJobsModalVisible(false);
              // Navigate via LoadingScreen to show proper loading state
              (route as any).navigation?.navigate?.('LoadingScreen', {
                processType: 'generate',
                payload: { jobId: jid, firstPhotos: [] },
                onCompleteRoute: {
                  screen: 'GenerateDetailsScreen',
                  params: {
                    jobId: jid,
                    items,
                    jobMap: itemGenerateJobs,
                    focusIndex: idx
                  }
                }
              } as any);
            }
          }}
        />

      </ScrollView>
      <View style={{ backgroundColor: 'white', paddingBottom: 24 }}>
        <BottomActionBar
          primaryLabel={
            canPublish
              ? `Publish to ${readyPlatforms.length} platform${readyPlatforms.length === 1 ? '' : 's'}`
              : 'Publish listing (not ready)'
          }
          primaryDisabled={!canPublish}
          onPrimary={doPublish}
          secondaryLabel={'Save draft'}
          onSecondary={doSaveDraft}
        />
      </View>


      {!!lastFillCount && ENABLE_AI_REFILL_FEATURES && (
        <View style={{ position: 'absolute', bottom: 96, left: 16, right: 16, backgroundColor: 'rgba(17,17,17,0.92)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Filled {lastFillCount} field{lastFillCount === 1 ? '' : 's'}</Text>
        </View>
      )}
      {fillOverlayOpen && ENABLE_AI_REFILL_FEATURES && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 6000 }} pointerEvents="box-none">
          <TouchableOpacity activeOpacity={1} onPress={() => setFillOverlayOpen(false)} style={{ height: 8 }} />
          <View style={{ backgroundColor: '#fff', borderBottomLeftRadius: 14, borderBottomRightRadius: 14, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#E5E5E5' }}>
            <Text style={{ color: '#000', fontWeight: '700', marginBottom: 8 }}>Choose fields to fill</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {['title', 'description', 'tags', 'price', 'sku', 'barcode', 'seoTitle', 'seoDescription', 'options'].map((f) => {
                const selected = fillSelectedFields.includes(f);
                return (
                  <TouchableOpacity key={f} onPress={() => setFillSelectedFields(prev => selected ? prev.filter(x => x !== f) : [...prev, f])} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: selected ? '#93C822' : '#E5E5E5', backgroundColor: selected ? 'rgba(147,200,34,0.08)' : '#fff', marginRight: 8, marginBottom: 8 }}>
                    <Text style={{ color: '#000' }}>{f}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 4, alignItems: "center" }}>
              <TouchableOpacity onPress={() => setFillOverlayOpen(false)} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 }}>
                <Text style={{ color: '#000' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setFillOverlayOpen(false); fillTheRest(); }} style={{ backgroundColor: '#93C822', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Sparkles size={16} color={'#111'} />
                <Text style={{ color: '#000', fontWeight: '700' }}>Fill selected</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
      {scannerOpen && (
        <View style={styles.scannerDockFull} pointerEvents="box-none">
          <View style={styles.scannerFullBleed}>
            <CameraView
              style={{ width: '100%', height: 240 }}
              facing={'back'}
              onBarcodeScanned={(result: any) => {
                const code = result?.data || result?.rawValue;
                if (code && (GenerateDetailsScreen as any)._scannerResultHandler) {
                  (GenerateDetailsScreen as any)._scannerResultHandler(code);
                  setScannerOpen(false);
                  (GenerateDetailsScreen as any)._scannerResultHandler = null;
                }
              }}
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'] }}
            />
            <TouchableOpacity onPress={() => { setScannerOpen(false); (GenerateDetailsScreen as any)._scannerResultHandler = null; }} style={styles.scannerCloseFull}>
              <Text style={{ color: '#fff', fontSize: 28 }}>×</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {versionsSheetOpen && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setVersionsSheetOpen(false)}
            style={styles.versionsBackdrop}
          />
          <View style={styles.versionsSheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={() => setVersionsTab('versions')} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: versionsTab === 'versions' ? '#93C822' : '#E5E5E5', backgroundColor: versionsTab === 'versions' ? 'rgba(147,200,34,0.08)' : '#fff' }}>
                  <Text style={{ color: '#000', fontWeight: '600' }}>Versions</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setVersionsTab('sources')} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: versionsTab === 'sources' ? '#93C822' : '#E5E5E5', backgroundColor: versionsTab === 'sources' ? 'rgba(147,200,34,0.08)' : '#fff' }}>
                  <Text style={{ color: '#000', fontWeight: '600' }}>Sources</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity onPress={() => setVersionsSheetOpen(false)} accessibilityLabel="Close versions panel" style={{ padding: 6 }}>
                  <X size={20} color={'#000'} />
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={{ marginTop: 12 }}>
              {versionsTab === 'versions' ? (
                versions.length === 0 ? (
                  <Text style={{ color: '#666' }}>No versions recorded yet.</Text>
                ) : versions.map((v, index) => {
                  const isCurrentVersion = v.jobId === jobId;
                  const platformCount = Object.keys(v.platforms || {}).length;
                  const hasMultipleVersions = (v.versionCount || 1) > 1;

                  return (
                    <View key={v.id} style={{ marginBottom: 8 }}>
                      {/* Main version card */}
                      <TouchableOpacity
                        onPress={() => {
                          // Normalize and hydrate the version data
                          const normalized: Record<string, any> = {};
                          for (const [key, value] of Object.entries(v.platforms || {})) {
                            normalized[key] = normalizeForListingEditor(value);
                          }
                          updatePlatforms(prev => hydratePlatformsFromBackend(normalized, prev));
                          setVersionsSheetOpen(false);
                        }}
                        style={[
                          {
                            borderWidth: 1,
                            borderColor: isCurrentVersion ? '#93C822' : '#E5E5E5',
                            backgroundColor: isCurrentVersion ? 'rgba(147,200,34,0.05)' : '#fff',
                            borderRadius: 10,
                            padding: 12,
                          }
                        ]}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                          <Text style={{ color: '#000', fontWeight: '600', flex: 1 }}>
                            Match from {new Date(v.createdAt).toLocaleDateString()}
                            {isCurrentVersion && <Text style={{ color: '#93C822' }}> (Current)</Text>}
                            {hasMultipleVersions && (
                              <Text style={{ color: '#666', fontWeight: '400' }}> • {v.versionCount} versions</Text>
                            )}
                          </Text>
                          <Text style={{ color: '#666', fontSize: 12 }}>
                            {new Date(v.createdAt).toLocaleDateString()}
                          </Text>
                        </View>

                        <Text style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>
                          Latest: {new Date(v.createdAt).toLocaleTimeString()}
                        </Text>

                        {platformCount > 0 ? (
                          <Text style={{ color: '#000', fontSize: 13 }}>
                            {platformCount} platform{platformCount !== 1 ? 's' : ''}: {Object.keys(v.platforms || {}).map(k => PLATFORM_META[k]?.label || k).join(', ')}
                          </Text>
                        ) : (
                          <Text style={{ color: '#999', fontSize: 13, fontStyle: 'italic' }}>No platform data</Text>
                        )}

                        {v.matchJobId && (
                          <Text style={{ color: '#666', fontSize: 11, marginTop: 4 }}>
                            Match ID: {v.matchJobId.slice(0, 8)}...
                          </Text>
                        )}
                      </TouchableOpacity>

                      {/* Show all versions if multiple exist */}
                      {hasMultipleVersions && Array.isArray(v.allVersions) && (
                        <View style={{ marginTop: 8, marginLeft: 16 }}>
                          <Text style={{ color: '#666', fontSize: 12, marginBottom: 6 }}>All versions for this match:</Text>
                          {v.allVersions.map((version: any, versionIndex: number) => {
                            const isCurrentSubVersion = version.jobId === jobId;
                            const versionPlatformCount = Object.keys(version.platforms || {}).length;

                            return (
                              <TouchableOpacity
                                key={version.id}
                                onPress={() => {
                                  // Normalize and hydrate the version data
                                  const normalized: Record<string, any> = {};
                                  for (const [key, value] of Object.entries(version.platforms || {})) {
                                    normalized[key] = normalizeForListingEditor(value);
                                  }
                                  updatePlatforms(prev => hydratePlatformsFromBackend(normalized, prev));
                                  setVersionsSheetOpen(false);
                                }}
                                style={{
                                  borderWidth: 1,
                                  borderColor: isCurrentSubVersion ? '#93C822' : '#E5E5E5',
                                  backgroundColor: isCurrentSubVersion ? 'rgba(147,200,34,0.05)' : '#F8F9FA',
                                  borderRadius: 8,
                                  padding: 8,
                                  marginBottom: 4
                                }}
                              >
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Text style={{ color: '#000', fontSize: 13, fontWeight: '600' }}>
                                    Version {(v.allVersions?.length || 0) - versionIndex}
                                    {isCurrentSubVersion && <Text style={{ color: '#93C822' }}> (Current)</Text>}
                                  </Text>
                                  <Text style={{ color: '#666', fontSize: 11 }}>
                                    {new Date(version.createdAt).toLocaleTimeString()}
                                  </Text>
                                </View>

                                {versionPlatformCount > 0 && (
                                  <Text style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
                                    {versionPlatformCount} platforms: {Object.keys(version.platforms || {}).map(k => PLATFORM_META[k]?.label || k).join(', ')}
                                  </Text>
                                )}

                                {version.source && (
                                  <Text style={{ color: '#666', fontSize: 10, marginTop: 2 }}>
                                    Source: {version.source}
                                  </Text>
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })
              ) : (
                <View>
                  {!selectedFieldKey ? (
                    <Text style={{ color: '#666' }}>Tap the info icon next to a field to view sources for that field.</Text>
                  ) : (
                    <>
                      <Text style={{ color: '#000', fontWeight: '700', marginBottom: 6 }}>Sources for "{selectedFieldKey}"</Text>
                      {(() => {
                        const rows: Array<{ url: string }> = [];
                        for (const v of versions) {
                          const src = (v.sources || []).filter(s => !s.usedForFields || s.usedForFields.includes(selectedFieldKey));
                          src.forEach(s => rows.push({ url: s.url }));
                        }
                        const unique = Array.from(new Set(rows.map(r => r.url)));
                        return unique.length === 0 ? (
                          <Text style={{ color: '#666' }}>No recorded field-level sources.</Text>
                        ) : unique.map(u => (
                          <View key={u} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                            <Text style={{ color: '#000' }}>{u}</Text>
                          </View>
                        ));
                      })()}
                    </>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </>
      )}
      {missingFieldsModalOpen && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setMissingFieldsModalOpen(false)}
            style={styles.modalBackdrop}
          />
          <View style={styles.missingFieldsModal}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#000' }}>Add Missing Field</Text>
              <TouchableOpacity onPress={() => setMissingFieldsModalOpen(false)}>
                <X size={24} color={'#000'} />
              </TouchableOpacity>
            </View>

            {/* Search field */}
            <View style={{ marginBottom: 16 }}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search fields..."
                value={fieldSearchQuery}
                onChangeText={setFieldSearchQuery}
              />
            </View>

            {/* Platform info */}
            <Text style={{ fontSize: 14, color: '#666', marginBottom: 12 }}>
              Platform: {PLATFORM_META[selectedMissingPlatform]?.label || selectedMissingPlatform}
            </Text>

            <ScrollView style={{ maxHeight: 400 }}>
              {(() => {
                const filteredFields = getFilteredFields(selectedMissingPlatform);
                const missingFields = getMissingFields(selectedMissingPlatform);
                const missingPaths = new Set(missingFields.map(f => f.path));

                // Group fields by their group
                const groupedFields: Record<string, Array<{ path: string; label: string; type: string; required?: boolean }>> = {};
                filteredFields.forEach(field => {
                  const group = field.group || 'Core Fields';
                  if (!groupedFields[group]) groupedFields[group] = [];
                  groupedFields[group].push(field);
                });

                return Object.entries(groupedFields).map(([groupName, fields]) => (
                  <View key={groupName} style={{ marginBottom: 16 }}>
                    <TouchableOpacity
                      onPress={() => setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }))}
                      style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}
                    >
                      <Icon name={expandedGroups[groupName] ? 'chevron-down' : 'chevron-right'} size={18} color="#666" />
                      <Text style={{ fontSize: 16, fontWeight: '600', color: '#000', marginLeft: 4 }}>{groupName}</Text>
                    </TouchableOpacity>

                    {expandedGroups[groupName] && fields.map(field => {
                      const isMissing = missingPaths.has(field.path);
                      const isCurrentlyEmpty = !displayedPlatforms[selectedMissingPlatform]?.[field.path];

                      return (
                        <TouchableOpacity
                          key={field.path}
                          onPress={() => addFieldToPlatform(selectedMissingPlatform, field.path)}
                          style={[
                            styles.fieldOption,
                            isMissing && styles.missingFieldOption
                          ]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontWeight: '600', color: '#000' }}>
                              {field.label}
                              {field.required && <Text style={{ color: '#ef4444' }}> *</Text>}
                            </Text>
                            <Text style={{ fontSize: 12, color: '#666' }}>
                              {field.type} • {field.path}
                            </Text>
                          </View>
                          {isMissing && (
                            <View style={styles.missingBadge}>
                              <Text style={{ fontSize: 10, color: '#ef4444' }}>Missing</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ));
              })()}
            </ScrollView>

            <TouchableOpacity
              onPress={() => setMissingFieldsModalOpen(false)}
              style={styles.modalCancelButton}
            >
              <Text style={{ color: '#000', fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
      {/* Regenerate modal */}
      {regenModalOpen && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setRegenModalOpen(false)}
            style={styles.modalBackdrop}
          />
          <View style={[styles.missingFieldsModal, { left: 0, right: 0, borderRadius: 16, backgroundColor: "#FFF" }]}>

            {/* Modal Header */}
            <View style={{ flex: 1, flexDirection: 'row', alignContent: "center", alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Pencil size={16} color={'#000'} />
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#000', alignItems: 'center', gap: 3 }}>
                  Editing This Field
                </Text>

              </View>


              <TouchableOpacity style={[styles.btnSecondary, { flexDirection: "row", backgroundColor: "#FFF", }]} onPress={() => setRegenModalOpen(false)}>
                <Icon name="arrow-left" size={18} color={'#000'} />
                <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Back</Text>
              </TouchableOpacity>



            </View>


            {/* Current Field Card */}
            <View style={{ flexDirection: "column", borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: "#FFF", borderRadius: 10, marginBottom: 20, gap: 8, boxShadow: "offsetX: 3, color: black, " }}>

              <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-around", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5 }}>

                <Text style={{ flex: 1, justifyContent: "flex-start", color: '#71717A' }}>
                  <Text style={{ color: '#000', fontWeight: '600', textTransform: "capitalize" }}>{regenFieldKey} • {regenPlatformKey}</Text>
                </Text>


                {/* Version switcher with arrows */}
                <View style={{ flex: 1, justifyContent: "flex-end", flexDirection: 'row', alignItems: 'center', gap: 8, }}>
                  <TouchableOpacity onPress={() => setRegenActiveVersion(v => Math.max(0, v - 1))} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, padding: 6 }}>
                    <Icon name="chevron-left" size={18} color="#000" />
                  </TouchableOpacity>
                  <Text style={{ color: '#000', fontWeight: '600' }}>{regenVersions[regenActiveVersion]?.label || 'Version'}</Text>
                  <TouchableOpacity onPress={() => setRegenActiveVersion(v => Math.min(regenVersions.length - 1, v + 1))} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, backgroundColor: "#71717A", padding: 6 }}>
                    <Icon name="chevron-right" size={18} color="#FFF" />
                  </TouchableOpacity>
                </View>

              </View>


              {/* Original/current text area (read-only) */}
              <View style={{ flex: 1, marginHorizontal: 8, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 10, marginBottom: 10, backgroundColor: '#FAFAFA' }}>
                <Text style={{ color: '#000' }}>
                  {regenVersions[regenActiveVersion]?.text || ''}
                </Text>
              </View>


            </View>

            {/* Prompt presets - horizontal scroll at same width as input below */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ paddingRight: 6 }}>
              {['Fill missing', 'More casual', 'More corporate', 'More direct', 'Translate'].map(p => (
                <TouchableOpacity key={p} onPress={() => setRegenText(t => (t ? `${t} ${p}` : p))} style={{ marginRight: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: "#FFF", }}>
                  <Text style={{ color: '#000' }}>{p}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: "#FFF", }}>
              {/* Instruction input */}
              <TextInput
                style={[styles.input, { borderColor: "transparent", minHeight: 120, textAlignVertical: 'top' }]}
                value={regenText}
                onChangeText={setRegenText}
                placeholder="How do you want to edit this?"
                multiline
              />

              {/* Actions */}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 }}>
                <TouchableOpacity style={[styles.blackBtnPrimary, regenSubmitting && { opacity: 0.7, backgroundColor: "#000" }]} disabled={regenSubmitting} onPress={submitRegenerateField}>
                  <Text style={{ color: '#fff' }}>{regenSubmitting ? 'Generating…' : <Icon name="arrow-right" size={18} color={'#FFF'} />}</Text>
                </TouchableOpacity>
              </View>



            </View>

          </View>
        </>
      )}

      {/* Publish Confirmation Modal */}
      {publishModalOpen && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '90%', maxHeight: '80%' }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#000', marginBottom: 16 }}>Review & Publish</Text>

            <ScrollView style={{ maxHeight: 400 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#666', marginBottom: 12 }}>Publishing to {readyPlatforms.length} platform(s)</Text>

              {/* Summary */}
              <View style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginBottom: 16 }}>
                <Text style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Product: {buildPlatformPayload().platformDetails?.canonical?.title || 'Untitled'}</Text>
                <Text style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>SKU: {buildPlatformPayload().platformDetails?.canonical?.sku || 'N/A'}</Text>
                <Text style={{ fontSize: 12, color: '#666' }}>Price: ${buildPlatformPayload().platformDetails?.canonical?.price || 0}</Text>
              </View>

              {/* Platform Account Selection */}
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#000', marginBottom: 8 }}>Select Accounts</Text>
              {readyPlatforms.map((platform) => {
                const platformConns = allConnections.filter((c: any) =>
                  c.PlatformType?.toLowerCase() === platform.toLowerCase() && c.IsEnabled
                );
                const selectedConnId = selectedConnectionIds[platform];
                const allSelected = selectedConnId === 'ALL';

                return (
                  <View key={platform} style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#666', marginBottom: 4 }}>
                      {PLATFORM_META[platform]?.label || platform}
                    </Text>
                    {platformConns.length === 0 ? (
                      <Text style={{ fontSize: 12, color: '#F00', fontStyle: 'italic' }}>No connections available</Text>
                    ) : (
                      <View style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8 }}>
                        {/* Ensure default selection is 'ALL' if not set */}
                        {(() => {
                          // If no selection for this platform, default to 'ALL'
                          if (selectedConnId === undefined) {
                            setTimeout(() => {
                              setSelectedConnectionIds(prev => {
                                // Only set if still undefined (avoid race)
                                if (prev[platform] === undefined) {
                                  return { ...prev, [platform]: 'ALL' };
                                }
                                return prev;
                              });
                            }, 0);
                          }
                          return null;
                        })()}

                        {/* All option */}
                        {platformConns.length > 1 && (
                          <TouchableOpacity
                            onPress={() => setSelectedConnectionIds(prev => ({ ...prev, [platform]: 'ALL' }))}
                            style={{
                              padding: 12,
                              backgroundColor: allSelected ? '#F0F9FF' : '#FFF',
                              borderBottomWidth: 1,
                              borderBottomColor: '#E5E5E5',
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <Text style={{ fontSize: 14, color: '#000', fontWeight: '600', flex: 1 }}>All Accounts ({platformConns.length})</Text>
                            {allSelected && <Icon name="check-circle" size={18} color="#93C822" />}
                          </TouchableOpacity>
                        )}
                        {/* Individual accounts */}
                        {platformConns.map((conn: any) => (
                          <TouchableOpacity
                            key={conn.Id}
                            onPress={() => setSelectedConnectionIds(prev => ({ ...prev, [platform]: conn.Id }))}
                            style={{
                              padding: 12,
                              backgroundColor: selectedConnId === conn.Id ? '#F0F9FF' : '#FFF',
                              borderBottomWidth: 1,
                              borderBottomColor: '#E5E5E5',
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <Text style={{ fontSize: 14, color: '#000', flex: 1 }}>{conn.DisplayName}</Text>
                            {selectedConnId === conn.Id && <Icon name="check-circle" size={18} color="#93C822" />}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            {/* Actions */}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => setPublishModalOpen(false)}
                style={{ flex: 1, paddingVertical: 12, backgroundColor: '#F5F5F5', borderRadius: 8, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#666' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmAndPublish}
                style={{ flex: 1, paddingVertical: 12, backgroundColor: '#93C822', borderRadius: 8, alignItems: 'center' }}
                disabled={Object.keys(selectedConnectionIds).length === 0}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#FFF' }}>
                  Publish to {(() => {
                    let total = 0;
                    for (const [platform, selection] of Object.entries(selectedConnectionIds)) {
                      if (selection === 'ALL') {
                        const platformConns = allConnections.filter((c: any) =>
                          c.PlatformType?.toLowerCase() === platform.toLowerCase() && c.IsEnabled
                        );
                        total += platformConns.length;
                      } else {
                        total += 1;
                      }
                    }
                    return total;
                  })()} Account(s)
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
      {/* Media Gallery Modal */}
      {mediaModalVisible && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setMediaModalVisible(false)}
            style={styles.modalBackdrop}
          />
          <View style={[styles.missingFieldsModal, { left: 0, right: 0, borderRadius: 16, backgroundColor: "#FFF", maxHeight: '80%' }]}>
            {/* Modal Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E5E5E5' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#000' }}>Media Gallery</Text>
              <TouchableOpacity style={[styles.btnSecondary, { backgroundColor: "#FFF" }]} onPress={() => setMediaModalVisible(false)}>
                <Icon name="close" size={20} color={'#000'} />
              </TouchableOpacity>
            </View>

            {/* Media Gallery Display */}
            <ScrollView style={{ marginBottom: 16, maxHeight: 300 }}>
              {mediaGallery.length === 0 ? (
                <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 32 }}>
                  <Icon name="image-off" size={48} color="#CCC" />
                  <Text style={{ color: '#666', marginTop: 12, fontSize: 14 }}>No images yet. Tap "Add Photos" to get started.</Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {mediaGallery.map((imageUrl, index) => (
                    <View key={index} style={{ position: 'relative', width: '30%', aspectRatio: 1 }}>
                      <Image source={{ uri: imageUrl }} style={{ width: '100%', height: '100%', borderRadius: 8 }} />
                      <TouchableOpacity
                        onPress={() => handleRemoveMedia(index)}
                        style={{ position: 'absolute', top: -8, right: -8, width: 28, height: 28, borderRadius: 14, backgroundColor: '#FF4444', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Icon name="close" size={16} color="#FFF" />
                      </TouchableOpacity>
                      <View style={{ position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                        <Text style={{ color: '#FFF', fontSize: 12 }}>{index + 1}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>

            {/* Actions */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={handlePickImage}
                style={{ flex: 1, paddingVertical: 12, backgroundColor: '#93C822', borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
              >
                <Icon name="image-plus" size={18} color="#FFF" />
                <Text style={{ color: '#FFF', fontWeight: '600' }}>Add Photos</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMediaModalVisible(false)}
                style={{ flex: 1, paddingVertical: 12, backgroundColor: '#F5F5F5', borderRadius: 8, alignItems: 'center' }}
              >
                <Text style={{ color: '#000', fontWeight: '600' }}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

export default GenerateDetailsScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: "20%" },
  content: { padding: 16, paddingBottom: 140 },
  heading: { color: '#000', fontSize: 24, fontWeight: '700', marginBottom: 6 },
  subheading: { color: '#000', fontSize: 18, fontWeight: '600', marginBottom: 4 },
  meta: { color: '#000', marginBottom: 4 },
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 12 },
  section: { marginTop: 8 },
  platform: { color: '#000', fontWeight: '700', marginBottom: 4 },
  field: { color: '#000', marginBottom: 2 },
  versionsBackdrop: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.2)' },
  versionsSheet: { position: 'absolute', top: 0, right: 0, bottom: 0, width: '70%', backgroundColor: '#fff', borderLeftColor: '#E5E5E5', borderLeftWidth: 1, paddingVertical: 70, paddingHorizontal: 20 },
  // Docked scanner close to the notch / bezel
  scannerDock: { position: 'absolute', top: 6, left: 56, right: 56, zIndex: 5000 },
  scannerCard: { backgroundColor: '#000', borderRadius: 18, borderWidth: 2, borderColor: '#111', overflow: 'hidden' },
  scannerClose: { position: 'absolute', top: 14, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  // Full-bleed variant that hugs the top bezel
  scannerDockFull: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5000 },
  scannerFullBleed: { backgroundColor: '#000', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, overflow: 'hidden' },
  scannerCloseFull: { position: 'absolute', top: 100, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  // Missing fields modal
  modalBackdrop: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 6000 },
  missingFieldsModal: {
    position: 'absolute',
    top: '18%',
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 32,
    padding: 20,
    maxHeight: '80%',
    zIndex: 6001
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16
  },
  fieldOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, marginBottom: 8, backgroundColor: '#fff' },
  missingFieldOption: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  missingBadge: { backgroundColor: '#fecaca', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  modalCancelButton: { marginTop: 16, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnSecondary: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: '#93C822', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  blackBtnPrimary: { backgroundColor: '#000', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },

  // Platform picker modal styles
  platformPickerModal: { position: 'absolute', top: '15%', left: 16, right: 16, backgroundColor: '#fff', borderRadius: 16, padding: 20, maxHeight: '70%', zIndex: 6001 },
  platformPill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, backgroundColor: '#fff' },
  generatePlatformPill: { borderColor: '#93C822', backgroundColor: 'rgba(147,200,34,0.05)' },
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
  addTagBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  tagChip: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  fieldLabel: { color: '#71717A', fontWeight: '600', marginBottom: 6, fontSize: 12, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: '#000' },
  sectionTitle: { color: '#000', fontWeight: '700' },
  subtle: { color: '#71717A', marginTop: 4 },
});