import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, Switch, FlatList } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';
import ListingEditorForm, { ListingEditorFormRef } from '../components/ListingEditorForm';
import BottomActionBar from '../components/BottomActionBar';
import ExpoBarcodeScanner from '../components/ExpoBarcodeScanner';
import { CameraView } from 'expo-camera';
import Card from '../components/Card';
import PlaceholderImage from '../components/PlaceholderImage';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { createCanonicalBase } from '../utils/platformDataHydration';
import {
  ProductVariant,
  PlatformProductMapping,
  InventoryLevel,
  getLegendStateObservables,
  PlatformConnection
} from '../utils/SupaLegend';
import { observer } from '@legendapp/state/react';
import * as ImagePicker from 'expo-image-picker';
import { useCollaboration } from '../hooks/useCollaboration';
import LoadingOverlay from '../components/LoadingOverlay';
// Base URL for API
const SSSYNC_API_BASE_URL = 'https://api.sssync.app';

// Toggle to use manual save via BottomActionBar
const ENABLE_AUTOSAVE = false;

// 🚨 CRITICAL: ProductDetail should be READ-ONLY
// It should ONLY read from cached database data (Supabase + PlatformSpecificData)
// It should NEVER make platform API calls like sync-locations
// Platform syncing should only happen during import/setup, then updates via webhooks

// Enhanced interfaces
interface ProductDetailNavigationProps {
  goBack: () => void;
  navigate: (screen: string, params?: any) => void;
}

interface ProductDetailRouteProps {
  params: {
    item?: ProductVariant;
    productId?: string;
  };
}

interface ActivityLogEntry {
  Id: string;
  Timestamp: string;
  EventType: string;
  Status: string;
  Message: string;
  Details?: any;
}

interface EditFormData {
  Title: string;
  Description: string;
  Price: number;
  CompareAtPrice?: number;
  Sku: string;
  Barcode?: string;
  Weight?: number;
  WeightUnit?: string;
  RequiresShipping: boolean;
  IsTaxable: boolean;
  TaxCode?: string;
}

interface InventoryLocationWithPlatform {
  id: string;
  locationId: string;
  locationName: string;
  platformConnectionId: string;
  platformName: string;
  platformType: string;
  quantity: number;
}

interface GroupedInventoryLocations {
  [platformName: string]: {
    platformType: string;
    platformConnectionId: string;
    displayName: string;
    locations: InventoryLocationWithPlatform[];
  };
}

// SVG logo helpers
const platformSvgMap: Record<string, React.FC<any>> = {
  shopify: ShopifySvg,
  square: SquareSvg,
  clover: CloverSvg,
  amazon: AmazonSvg,
  ebay: EbaySvg,
  facebook: FacebookSvg,
};

function getPlatformLogoComponent(platformType?: string) {
  const type = (platformType || '').toLowerCase();
  const found = Object.entries(platformSvgMap).find(([key]) => type.includes(key));
  return found ? found[1] : null;
}

const ProductDetailScreen = observer(
  ({ route, navigation }: { route: ProductDetailRouteProps; navigation: ProductDetailNavigationProps }) => {
    const theme = useTheme();
    const passedItem = route.params?.item;
    const productId = route.params?.productId || passedItem?.Id;

    // 🚨 DEBUG: Intercept all fetch calls from this component
    React.useEffect(() => {
      const originalFetch = window.fetch;
      window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const url = input?.toString() || '';
        if (url.includes('sync-locations')) {
          console.error('[ProductDetail] 🚨 DETECTED sync-locations call from ProductDetail:', url, init);
          // Don't actually make the call - this is forbidden in ProductDetail
          return Promise.reject(new Error('sync-locations calls are forbidden in ProductDetail'));
        }
        if (url.includes('/api/platform-connections/') && url.includes('/sync')) {
          console.warn('[ProductDetail] ⚠️ Platform sync call detected:', url);
        }
        return originalFetch.call(this, input as RequestInfo, init);
      };
      return () => {
        window.fetch = originalFetch;
      };
    }, []);

    // State management
    const [detailedItem, setDetailedItem] = useState<ProductVariant | undefined | null>(passedItem);
    const [mappings, setMappings] = useState<PlatformProductMapping[]>([]);
    const [groupedInventory, setGroupedInventory] = useState<GroupedInventoryLocations>({});
    const [connections, setConnections] = useState<PlatformConnection[]>([]);
    const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(!passedItem);
    
    // Modal states
    const [isActivityModalVisible, setIsActivityModalVisible] = useState(false);
    const [isBarcodeScannerVisible, setIsBarcodeScannerVisible] = useState(false);
    const [isImagePickerVisible, setIsImagePickerVisible] = useState(false);
    const [isDangerZoneVisible, setIsDangerZoneVisible] = useState(false);
    
    // Auto-save state (no more manual editing mode)
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaveTime, setLastSaveTime] = useState<number>(0);
    const [isUploadingImages, setIsUploadingImages] = useState(false);
    const listingEditorRef = useRef<ListingEditorFormRef | null>(null);

    

    // ========== CRITICAL FIX: useRef for data persistence + auto-save ==========
    const [updateCounter, setUpdateCounter] = useState(0);
    const [displayedPlatforms, setDisplayedPlatforms] = useState<Record<string, any>>({});
    const [, forceUpdate] = useState({});
    const lastHydratedItemRef = useRef<string | null>(null);
    const lastSavedRef = useRef<string>('');

    // Get displayedPlatforms from ref (for render)
    // const displayedPlatforms = platformsRef.current; // This line is removed

    const updatePlatforms = (updater: (prev: Record<string, any>) => Record<string, any>) => {
      setDisplayedPlatforms(updater);
      forceUpdate({}); // Trigger re-render
      setUpdateCounter(c => c + 1); // Signal content change
      console.log('[ProductDetail] Updated platforms, triggering auto-save...');
    };

    // Collaboration state
    const collaboration = useCollaboration();
    const [isLockedByOther, setIsLockedByOther] = useState(false);
    const [lockOwner, setLockOwner] = useState<string | null>(null);

    // Phase 2: Draft state for auto-save and versioning
    const [draftData, setDraftData] = useState<Record<string, any> | null>(null);
    const [isLoadingDraft, setIsLoadingDraft] = useState(false);
    const [draftVersions, setDraftVersions] = useState<Array<{ id: string; createdAt: string; platforms: any; publishedPlatforms?: string[] }>>([]);

    // Current form data (now live)
    const [formData, setFormData] = useState<EditFormData>({
      Title: '',
      Description: '',
      Price: 0,
      CompareAtPrice: 0,
      Sku: '',
      Barcode: '',
      Weight: 0,
      WeightUnit: 'kg',
      RequiresShipping: true,
      IsTaxable: true,
      TaxCode: '',
    });

    // State for sync status
    const [syncStatus, setSyncStatus] = useState<any>(null);
    const [fetchErrors, setFetchErrors] = useState<string[]>([]);

    // State for sync loading
     const [isSyncing, setIsSyncing] = useState(false);

    // Helper function to get proper location names from platform data
    const getLocationName = useCallback((level: InventoryLevel, connection: PlatformConnection, mapping?: PlatformProductMapping): string => {
      // Try to get location name from mapping's platform-specific data
      if (mapping?.PlatformSpecificData && typeof mapping.PlatformSpecificData === 'object') {
        const mappingData = mapping.PlatformSpecificData as any;
        if (mappingData.locationName) {
          return mappingData.locationName;
        }
      }
      
      // Try to get location name from connection's platform-specific data
      if (connection.PlatformSpecificData && typeof connection.PlatformSpecificData === 'object') {
        const connectionData = connection.PlatformSpecificData as any;
        if (connectionData.locations && Array.isArray(connectionData.locations)) {
          const location = connectionData.locations.find((loc: any) => 
            loc.id === level.PlatformLocationId || loc.gid === level.PlatformLocationId
          );
          if (location?.name) {
            return location.name;
          }
        }
      }

      // Default based on platform type and location ID
      const platformType = connection.PlatformType?.toLowerCase() || '';
      if (platformType.includes('shopify')) {
        return level.PlatformLocationId === 'gid://shopify/Location/1' ? 'Main Location' : 
               `Location ${level.PlatformLocationId?.split('/').pop() || ''}`;
      } else if (platformType.includes('square')) {
        return 'Main Location';
      } else if (platformType.includes('clover')) {
        return 'Main Location';
      }
      
      return `Location ${level.PlatformLocationId || 'Unknown'}`;
    }, []);

    // Load platform connections and organize inventory with realtime updates
    const loadPlatformData = useCallback(async () => {
      if (!detailedItem) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        console.log('Loading platform data for product:', detailedItem.Id);

        // Load all platform connections for the user
        const { data: connectionsData, error: connectionsError } = await supabase
          .from('PlatformConnections')
          .select('*')
          .eq('UserId', user.id)
          .eq('IsEnabled', true);

        if (connectionsError) {
          console.error('Error loading platform connections:', connectionsError);
          return;
        }

        const platformConnections = connectionsData as PlatformConnection[];
        console.log('Loaded platform connections:', platformConnections.length);

        // NOTE: Location syncing is handled elsewhere (e.g., when connections are created)
        // to avoid excessive API calls. We rely on cached location data in PlatformSpecificData.

        setConnections(platformConnections);

        // Load inventory levels for this product
        const { data: inventoryData, error: inventoryError } = await supabase
          .from('InventoryLevels')
          .select('*')
          .eq('ProductVariantId', detailedItem.Id);

        if (inventoryError) {
          console.error('Error loading inventory levels:', inventoryError);
        } else {
          console.log('Loaded inventory levels:', inventoryData?.length || 0);
        }

        // ⚡ OPTIMIZED: Load locations from PlatformLocations table instead of PlatformSpecificData
        const connectionIds = platformConnections.map(c => c.Id);
        const locations: Array<{ id: string; name: string; connectionId: string; connectionName: string }> = [];
        
        if (connectionIds.length > 0) {
          const { data: platformLocs, error: locError } = await supabase
            .from('PlatformLocations')
            .select('PlatformConnectionId, PlatformLocationId, Name')
            .in('PlatformConnectionId', connectionIds);
          
          if (locError) {
            console.error('Error loading platform locations:', locError);
          } else {
            platformLocs?.forEach(loc => {
              const conn = platformConnections.find(c => c.Id === loc.PlatformConnectionId);
              if (conn) {
                locations.push({
                  id: loc.PlatformLocationId,
                  name: loc.Name || 'Unnamed Location',
                  connectionId: loc.PlatformConnectionId,
                  connectionName: conn.DisplayName || conn.PlatformType
                });
              }
            });
            console.log('[ProductDetail] ✅ Loaded', locations.length, 'locations from DB in <1s');
          }
        }

        console.log('Built locations:', locations.length);

        // Load platform mappings to get the correct platform data
        const { data: mappingsData, error: mappingsError } = await supabase
          .from('PlatformProductMappings')
          .select('*')
          .eq('ProductVariantId', detailedItem.Id);

        if (mappingsError) {
          console.error('Error loading platform mappings:', mappingsError);
        } else {
          console.log('Loaded platform mappings:', mappingsData?.length || 0);
        }

        setMappings(mappingsData as PlatformProductMapping[] || []);

        // Group inventory by platform with proper names
        const grouped: GroupedInventoryLocations = {};
        
        // If we have inventory data, group it
        if (inventoryData && inventoryData.length > 0) {
          inventoryData.forEach((level: InventoryLevel) => {
            const connection = platformConnections.find(conn => conn.Id === level.PlatformConnectionId);
            if (!connection) {
              console.warn('No connection found for inventory level:', level.PlatformConnectionId);
              return;
            }

            const mapping = mappingsData?.find(m => m.PlatformConnectionId === level.PlatformConnectionId);
            
            // Use DisplayName first, then fall back to a constructed name
            const platformName = connection.DisplayName || `${connection.PlatformType} Account`;
            const locationName = getLocationName(level, connection, mapping);

            if (!grouped[platformName]) {
              grouped[platformName] = {
                platformType: connection.PlatformType,
                platformConnectionId: connection.Id,
                displayName: platformName,
                locations: []
              };
            }

            grouped[platformName].locations.push({
              id: level.Id || `${level.PlatformConnectionId}-${level.PlatformLocationId}`,
              locationId: level.PlatformLocationId || 'default',
              locationName,
              platformConnectionId: level.PlatformConnectionId,
              platformName,
              platformType: connection.PlatformType,
              quantity: level.Quantity || 0
            });
          });
        } else {
          // If no inventory data, still show connected platforms with zero inventory
          platformConnections.forEach(connection => {
            const mapping = mappingsData?.find(m => m.PlatformConnectionId === connection.Id);
            if (mapping) { // Only show platforms that have mappings for this product
              const platformName = connection.DisplayName || `${connection.PlatformType} Account`;
              grouped[platformName] = {
                platformType: connection.PlatformType,
                platformConnectionId: connection.Id,
                displayName: platformName,
                locations: [{
                  id: `${connection.Id}-default`,
                  locationId: 'default',
                  locationName: 'Main Location',
                  platformConnectionId: connection.Id,
                  platformName,
                  platformType: connection.PlatformType,
                  quantity: 0
                }]
              };
            }
          });
        }

        console.log('Grouped inventory:', Object.keys(grouped).length, 'platforms');
        setGroupedInventory(grouped);

        // Store mappings for hydration useEffect
        setMappings(mappingsData as PlatformProductMapping[] || []);

      } catch (error) {
        console.error('Error loading platform data:', error);
      }
    }, [detailedItem, getLocationName]);

    // Load additional product details (images, tags, variants, etc.) - consolidated like PastScansScreen
    const loadProductDetails = useCallback(async () => {
      if (!detailedItem) return;

      try {
        console.log('[ProductDetail] Loading consolidated product details for:', detailedItem.Id);

        // Load full product with variants and images like PastScansScreen does
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: products, error: productsError } = await supabase
          .from('Products')
          .select(`
            Id,
            UserId,
            IsArchived,
            CreatedAt,
            UpdatedAt,
            OrgId,
            ProductVariants!inner (
              Id,
              ProductId,
              Title,
              Description,
              Price,
              CompareAtPrice,
              Sku,
              Barcode,
              Weight,
              WeightUnit,
              Options,
              Metadata,
              IsTaxable,
              RequiresShipping,
              TaxCode,
              OnShopify,
              OnSquare,
              OnClover,
              OnAmazon,
              OnEbay,
              OnFacebook,
              PrimaryImageUrl,
              CreatedAt,
              UpdatedAt,
              ProductImages!ProductImages_ProductVariantId_fkey (
                Id,
                ImageUrl,
                AltText,
                Position
              )
            )
          `)
          .eq('Id', detailedItem.ProductId)
          .eq('UserId', user.id)
          .single();

        if (productsError) {
          console.error('[ProductDetail] Error loading product details:', productsError);
          return;
        }

        if (!products?.ProductVariants?.[0]) {
          console.warn('[ProductDetail] No variant found for product');
          return;
        }

        const variant = products.ProductVariants[0];
        const sortedImages = variant.ProductImages
          ?.sort((a: any, b: any) => (a.Position || 0) - (b.Position || 0))
          ?.map((img: any) => img.ImageUrl) || [];

        console.log('[ProductDetail] Loaded variant with', sortedImages.length, 'images and options:', variant.Options);

        // Update detailedItem with full data - DO NOT call setEditPlatforms here
        // The hydration useEffect will handle populating editPlatforms when detailedItem changes
        const enrichedItem = {
          ...detailedItem,
          ...variant,
          ImageUrls: sortedImages,
          // Include all the fields we need
          Options: variant.Options || {},
          Metadata: variant.Metadata || {},
          IsTaxable: variant.IsTaxable,
          RequiresShipping: variant.RequiresShipping,
          TaxCode: variant.TaxCode,
          PrimaryImageUrl: variant.PrimaryImageUrl,
        };

        setDetailedItem(enrichedItem);

        // Update form data with all available fields
        setFormData({
          Title: enrichedItem.Title || '',
          Description: enrichedItem.Description || '',
          Price: enrichedItem.Price || 0,
          CompareAtPrice: enrichedItem.CompareAtPrice || 0,
          Sku: enrichedItem.Sku || '',
          Barcode: enrichedItem.Barcode || '',
          Weight: enrichedItem.Weight || 0,
          WeightUnit: enrichedItem.WeightUnit || 'kg',
          RequiresShipping: enrichedItem.RequiresShipping !== false,
          IsTaxable: enrichedItem.IsTaxable !== false,
          TaxCode: enrichedItem.TaxCode || '',
        });

      } catch (error) {
        console.error('[ProductDetail] Error in loadProductDetails:', error);
      }
    }, [detailedItem]);

    // Helper to build platform locations from connections
    const buildPlatformLocations = useCallback(() => {
      // ⚡ OPTIMIZED: Build from already-loaded grouped inventory state
      // No additional Supabase query needed - data was already fetched in loadPlatformData
      const locsByPlatform: Record<string, Array<{ id: string; name: string; connectionId: string; connectionName: string }>> = {};
      
      // Build from groupedInventory which contains all locations already loaded from DB
      Object.values(groupedInventory).forEach(platformGroup => {
        const platform = platformGroup.platformType?.toLowerCase();
        if (!platform) return;
        
        if (!locsByPlatform[platform]) locsByPlatform[platform] = [];
        
        platformGroup.locations.forEach(loc => {
          // Avoid duplicates
          const exists = locsByPlatform[platform].some(l => l.id === loc.id);
          if (!exists) {
            locsByPlatform[platform].push({
              id: loc.id,
              name: loc.locationName || 'Unnamed Location',
              connectionId: loc.platformConnectionId,
              connectionName: platformGroup.displayName
            });
          }
        });
      });
      
      return locsByPlatform;
    }, [groupedInventory]);

    // Auto-save function with proper API call
    const performAutoSave = useCallback(async () => {
      if (!detailedItem || !hasUnsavedChanges) {
        console.log('[ProductDetail] Skipping auto-save: no item or no changes');
        return;
      }

      console.log('[ProductDetail] Starting auto-save for product:', detailedItem.Id);
      setIsSaving(true);
      try {
        const token = await ensureSupabaseJwt();

        if (!token) {
          console.error('No authentication token available');
          return;
        }

        // CRITICAL FIX: Use displayedPlatforms data from ListingEditorForm, not just formData
        // Extract canonical data from shopify platform (or first available)
        const canonicalKey = Object.keys(displayedPlatforms).includes('shopify') ? 'shopify' : Object.keys(displayedPlatforms)[0];
        const canonical = displayedPlatforms[canonicalKey] || {};
        
        // Prepare update data - using the correct API structure from the backend
        const updateData = {
          Title: canonical.title || formData.Title,
          Description: canonical.description || formData.Description,
          Price: canonical.price !== undefined ? Number(canonical.price) : formData.Price,
          CompareAtPrice: canonical.compareAtPrice !== undefined ? Number(canonical.compareAtPrice) : formData.CompareAtPrice,
          Sku: canonical.sku || formData.Sku,
          Barcode: canonical.barcode || formData.Barcode,
          Weight: canonical.weight !== undefined ? Number(canonical.weight) : formData.Weight,
          WeightUnit: canonical.weightUnit || formData.WeightUnit,
          RequiresShipping: canonical.requiresShipping !== undefined ? canonical.requiresShipping : formData.RequiresShipping,
          IsTaxable: formData.IsTaxable,
          TaxCode: formData.TaxCode,
          // IMPORTANT: Include platform-specific data (variants, options, tags, etc)
          PlatformSpecificData: displayedPlatforms,
          Tags: canonical.tags || [],
          Vendor: canonical.vendor,
          ProductType: canonical.productType,
        };

        console.log('Auto-saving product with full platform data:', detailedItem.Id, updateData);

        // Update in our API
        const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
          throw new Error(errorData.message || `Failed to update product. Status: ${response.status}`);
        }

        // 🚨 WARNING: This pushes updates TO platforms (outbound), which is OK for ProductDetail
        // But we should NEVER pull/sync data FROM platforms in ProductDetail (inbound calls)
        console.log('[ProductDetail] Pushing product updates to mapped platforms');
        try {
          const token2 = token;
          const baseUrl = SSSYNC_API_BASE_URL;
          // Get connections for this user to find platforms for this product
          const connRes = await fetch(`${baseUrl}/api/platform-connections`, { headers: { Authorization: `Bearer ${token2}` } });
          const userConnections = connRes.ok ? await connRes.json() : [];
          // Find mappings for this variant to know which connections to target
          const mapRes = await fetch(`${baseUrl}/api/platform-product-mappings?productVariantId=${encodeURIComponent(detailedItem.Id)}`, { headers: { Authorization: `Bearer ${token2}` } });
          const maps = mapRes.ok ? await mapRes.json() : [];
          console.log(`[ProductDetail] Found ${maps.length} platform mappings to update`);
          for (const m of maps) {
            const conn = (userConnections || []).find((c:any)=> c.Id === m.PlatformConnectionId);
            if (!conn) continue;
            const platform = (conn.PlatformType || '').toLowerCase();
            // Minimal canonical to update price/title
            const product = { Title: updateData.Title, Description: updateData.Description };
            const variants = [{ Id: m.ProductVariantId, Sku: updateData.Sku, Price: updateData.Price, Barcode: updateData.Barcode, Title: updateData.Title }];
            console.log(`[ProductDetail] Updating ${platform} product ${m.PlatformProductId}`);
            await fetch(`${baseUrl}/api/catalog/${platform}/connections/${conn.Id}/products/${m.PlatformProductId}`, {
              method: 'PUT',
              headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ product, variants })
            }).catch((error) => console.warn(`[ProductDetail] Failed to update ${platform}:`, error));
          }
        } catch (error) {
          console.warn('[ProductDetail] Error pushing updates to platforms:', error);
        }

        // Also update Supabase directly for immediate UI updates
        const { error: supabaseError } = await supabase
          .from('ProductVariants')
          .update(updateData)
          .eq('Id', detailedItem.Id);

        if (supabaseError) {
          console.warn('Supabase update failed, but API succeeded:', supabaseError);
        }

        // Update local state
        const updatedItem = { ...detailedItem, ...updateData };
        setDetailedItem(updatedItem);
        setHasUnsavedChanges(false);
        setLastSaveTime(Date.now());

        console.log('Product auto-saved successfully');

      } catch (error) {
        console.error('Auto-save failed:', error);
        // Don't show alert for auto-save failures, just log them
      } finally {
        setIsSaving(false);
      }
    }, [detailedItem, formData, hasUnsavedChanges, displayedPlatforms]);

    // Handle form changes with auto-save
    const handleFormChange = useCallback((field: keyof EditFormData, value: any) => {
      setDetailedItem(prev => {
        const updated = { ...prev, [field]: value };
        setHasUnsavedChanges(true);
        return updated;
      });
    }, []);

    // Update inventory quantity with auto-save using the correct API endpoint
    const updateInventoryQuantity = useCallback(async (
      platformConnectionId: string, 
      locationId: string, 
      quantity: number
    ) => {
      try {
        const token = await ensureSupabaseJwt();

        if (!token || !detailedItem) return;

        // Use the correct API structure from the backend
        const updateData = {
          updates: [{
            platformConnectionId,
            locationId,
            quantity,
          }]
        };

        const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}/inventory`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateData),
        });

        if (!response.ok) {
          throw new Error(`Failed to update inventory: ${response.status}`);
        }

        // Update local state immediately
        setGroupedInventory(prev => {
          const updated = { ...prev };
          Object.keys(updated).forEach(platformName => {
            const platform = updated[platformName];
            if (platform.platformConnectionId === platformConnectionId) {
              platform.locations = platform.locations.map(loc => 
                loc.locationId === locationId ? { ...loc, quantity } : loc
              );
            }
          });
          return updated;
        });

        console.log('Inventory updated successfully');

      } catch (error) {
        console.error('Failed to update inventory:', error);
        Alert.alert('Error', 'Failed to update inventory. Please try again.');
      }
    }, [detailedItem]);

    // Image management functions
    const pickImagesFromLibrary = async () => {
      try {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Please grant camera roll permissions to add images.');
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: true,
          quality: 0.8,
          aspect: [1, 1],
        });

        if (!result.canceled && result.assets) {
          setIsUploadingImages(true);
          const uploadedUrls = await uploadImagesToSupabase(result.assets);
          await addImagesToProduct(uploadedUrls);
          setIsUploadingImages(false);
        }
      } catch (error) {
        console.error('Error picking images:', error);
        setIsUploadingImages(false);
        Alert.alert('Error', 'Failed to pick images. Please try again.');
      }
    };

    const uploadImagesToSupabase = async (assets: ImagePicker.ImagePickerAsset[]): Promise<string[]> => {
      const uploadedUrls: string[] = [];
      
      for (const asset of assets) {
        try {
          const response = await fetch(asset.uri);
          const blob = await response.blob();
          
          const fileExt = asset.uri.split('.').pop() || 'jpg';
          const fileName = `${detailedItem?.Id}-${Date.now()}.${fileExt}`;
          const filePath = `product-images/${fileName}`;

          const { data, error } = await supabase.storage
            .from('product-media')
            .upload(filePath, blob);

          if (error) {
            console.error('Upload error:', error);
            continue;
          }

          const { data: publicUrlData } = supabase.storage
            .from('product-media')
            .getPublicUrl(filePath);

          uploadedUrls.push(publicUrlData.publicUrl);
        } catch (error) {
          console.error('Error uploading image:', error);
        }
      }

      return uploadedUrls;
    };

    const addImagesToProduct = async (imageUrls: string[]) => {
      if (!detailedItem || imageUrls.length === 0) return;

      try {
        const currentImages = detailedItem.ImageUrls || [];
        const updatedImages = [...currentImages, ...imageUrls];

        const updateData = { ImageUrls: updatedImages };

        // Update via API
        const token = await ensureSupabaseJwt();

        if (token) {
          const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData),
          });

          if (!response.ok) {
            throw new Error('Failed to update product images');
          }
        }

        // Update local state
        setDetailedItem(prev => prev ? { ...prev, ImageUrls: updatedImages } : prev);
        
        Alert.alert('Success', `Added ${imageUrls.length} image(s) to product`);
      } catch (error) {
        console.error('Error adding images to product:', error);
        Alert.alert('Error', 'Failed to add images to product. Please try again.');
      }
    };

    const removeImage = async (imageIndex: number) => {
      if (!detailedItem || !detailedItem.ImageUrls) return;

      try {
        const updatedImages = detailedItem.ImageUrls.filter((_, index) => index !== imageIndex);
        const updateData = { ImageUrls: updatedImages };

        // Update via API
        const session = await supabase.auth.getSession();
        const token = session?.data.session?.access_token;

        if (token) {
          const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData),
          });

          if (!response.ok) {
            throw new Error('Failed to update product images');
          }
        }

        // Update local state
        setDetailedItem(prev => prev ? { ...prev, ImageUrls: updatedImages } : prev);
        
        Alert.alert('Success', 'Image removed from product');
      } catch (error) {
        console.error('Error removing image:', error);
        Alert.alert('Error', 'Failed to remove image. Please try again.');
      }
    };

    const reorderImages = async (nextImageUrls: string[]) => {
      if (!detailedItem) return;
      try {
        const session = await supabase.auth.getSession();
        const token = session?.data.session?.access_token;
        const updateData = { ImageUrls: nextImageUrls };
        if (token) {
          const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData),
          });
          if (!response.ok) throw new Error('Failed to reorder images');
        }
        setDetailedItem(prev => prev ? { ...prev, ImageUrls: nextImageUrls } : prev);
        setHasUnsavedChanges(false);
      } catch (error) {
        console.error('Error reordering images:', error);
      }
    };

    // In the delete handler
    const handleDelete = () => {
      Alert.alert(
        'Confirm Delete',
        'This action cannot be undone. Do you want to archive or hard delete?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Archive', onPress: () => archiveProduct() },
          { text: 'Hard Delete', style: 'destructive', onPress: () => hardDeleteProduct() },
        ]
      );
    };

    // Add functions
    const archiveProduct = async () => {
      try {
        const token = await ensureSupabaseJwt();
        await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}/archive`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        navigation.goBack();
      } catch (error) {
        // handle
      }
    };

    const hardDeleteProduct = async () => {
      // similar for delete
    };

    // Load initial data
    useEffect(() => {
      if (!productId) {
        console.error('No Product ID found');
        setIsLoading(false);
        setDetailedItem(null);
        return;
      }

      const observables = getLegendStateObservables();
      if (!observables?.productVariants$) {
        console.error("[ProductDetailScreen] Legend-State observables not available.");
        setIsLoading(false);
        setDetailedItem(null);
        return;
      }

      const { productVariants$ } = observables;
      const itemData = productVariants$[productId].get();
      
      if (itemData) {
        setDetailedItem(itemData);
        setFormData({
          Title: itemData.Title || '',
          Description: itemData.Description || '',
          Price: itemData.Price || 0,
          CompareAtPrice: itemData.CompareAtPrice || 0,
          Sku: itemData.Sku || '',
          Barcode: itemData.Barcode || '',
          Weight: itemData.Weight || 0,
          WeightUnit: itemData.WeightUnit || 'kg',
          RequiresShipping: itemData.RequiresShipping !== false,
          IsTaxable: itemData.IsTaxable !== false,
          TaxCode: itemData.TaxCode || '',
        });
        setIsLoading(false);
      } else if (!passedItem) {
        setIsLoading(true);
        const timeoutId = setTimeout(() => {
          if (!productVariants$[productId].get()) {
            console.warn(`Product with ID ${productId} not found after timeout.`);
            setDetailedItem(null);
            setIsLoading(false);
          }
        }, 3000);
        return () => clearTimeout(timeoutId);
      }
    }, [productId, passedItem]);

    // Load platform data when product is available
    useEffect(() => {
      if (detailedItem) {
        console.log('[ProductDetail] Loading data for product:', detailedItem.Id);
        loadPlatformData();
        loadProductDetails(); // Load additional product data
      }
    }, [detailedItem?.Id]); // Only depend on item ID to prevent loops

    // Populate form fields from detailedItem when it loads
    useEffect(() => {
      if (!detailedItem) return;

      // Populate formData
      setFormData(prev => ({
        ...prev,
        Title: detailedItem.Title || '',
        Description: detailedItem.Description || '',
        Price: detailedItem.Price ? Number(detailedItem.Price) : 0,
        CompareAtPrice: detailedItem.CompareAtPrice ? Number(detailedItem.CompareAtPrice) : undefined,
        Sku: detailedItem.Sku || '',
        Barcode: detailedItem.Barcode || '',
        Weight: detailedItem.Weight ? Number(detailedItem.Weight) : 0,
        WeightUnit: detailedItem.WeightUnit || 'kg',
        RequiresShipping: detailedItem.RequiresShipping !== false,
        IsTaxable: detailedItem.IsTaxable !== false,
        TaxCode: (detailedItem as any).TaxCode || '',
      }));

      // Also populate displayedPlatforms with base canonical data
      const canonicalBase = {
        title: detailedItem.Title || '',
        sku: detailedItem.Sku || '',
        barcode: detailedItem.Barcode || '',
        price: detailedItem.Price ? Number(detailedItem.Price) : 0,
        compareAtPrice: detailedItem.CompareAtPrice ? Number(detailedItem.CompareAtPrice) : undefined,
        weight: detailedItem.Weight ? Number(detailedItem.Weight) : 0,
        description: detailedItem.Description || '',
        requiresShipping: detailedItem.RequiresShipping !== false,
        isTaxable: detailedItem.IsTaxable !== false,
      };

      setDisplayedPlatforms({ shopify: canonicalBase });
    }, [detailedItem?.Id]); // Only run when product changes

    // Phase 2: Load drafts from backend (after hydration)
    useEffect(() => {
      if (!detailedItem || !Object.keys(displayedPlatforms).length === 0) return;

      let canceled = false;
      setIsLoadingDraft(true);

      (async () => {
        try {
          const token = await ensureSupabaseJwt();
          const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || SSSYNC_API_BASE_URL;

          if (!token) {
            console.log('[ProductDetail] No auth token for draft loading');
            return;
          }

          const response = await fetch(`${baseUrl}/api/products/drafts/${detailedItem.Id}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });

          if (response.ok) {
            const data = await response.json();
            if (!canceled) {
              console.log('[ProductDetail] ✅ Loaded draft data');
              setDraftData(data.currentDraft?.draftData || null);
              setDraftVersions(data.versions || []);

              // Only use draft data if it enhances the published data (has more fields)
              if (data.currentDraft?.draftData) {
                console.log('[ProductDetail] Evaluating draft data:', Object.keys(data.currentDraft.draftData));

                // Check if draft data is actually more complete than published data
                const draftHasMoreData = Object.values(data.currentDraft.draftData).some((platformData: any) =>
                  platformData && (
                    platformData.title ||
                    platformData.price ||
                    platformData.weight ||
                    (platformData.variants && platformData.variants.length > 0)
                  )
                );

                if (draftHasMoreData) {
                  console.log('[ProductDetail] Draft has meaningful data, merging...');

                  // Deep merge draft changes onto existing published data
                  const mergedPlatforms = { ...displayedPlatforms };
                  for (const [platformKey, draftPlatformData] of Object.entries(data.currentDraft.draftData)) {
                    if (mergedPlatforms[platformKey]) {
                      // Merge platform data
                      mergedPlatforms[platformKey] = {
                        ...mergedPlatforms[platformKey],
                        ...draftPlatformData as any
                      };
                    } else {
                      // Add new platform from draft
                      mergedPlatforms[platformKey] = draftPlatformData;
                    }
                  }

                  setDisplayedPlatforms(mergedPlatforms);
                  lastSavedRef.current = JSON.stringify(mergedPlatforms);
                  forceUpdate({}); // Trigger re-render with merged data
                } else {
                  console.log('[ProductDetail] Draft data is incomplete, ignoring to preserve published data');
                }
              }
            }
          } else {
            console.log('[ProductDetail] Draft data not found (expected for new products)');
          }
        } catch (error) {
          console.error('[ProductDetail] Error loading draft:', error);
        } finally {
          if (!canceled) {
            setIsLoadingDraft(false);
          }
        }
      })();

      return () => { canceled = true };
    }, [detailedItem?.Id, updateCounter, displayedPlatforms]); // updateCounter changes when platforms are updated

    // Set up realtime subscriptions
    useEffect(() => {
      if (!detailedItem) return;

      console.log('Setting up realtime subscriptions for product:', detailedItem.Id);

      // Subscribe to product variant changes
      const productSubscription = supabase
        .channel(`product-${detailedItem.Id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'ProductVariants',
            filter: `Id=eq.${detailedItem.Id}`,
          },
          (payload) => {
            console.log('Product variant updated:', payload);
            if (payload.eventType === 'UPDATE' && payload.new) {
              const updatedProduct = payload.new as ProductVariant;
              setDetailedItem(updatedProduct);
              setFormData({
                Title: updatedProduct.Title || '',
                Description: updatedProduct.Description || '',
                Price: updatedProduct.Price || 0,
                CompareAtPrice: updatedProduct.CompareAtPrice || 0,
                Sku: updatedProduct.Sku || '',
                Barcode: updatedProduct.Barcode || '',
                Weight: updatedProduct.Weight || 0,
                WeightUnit: updatedProduct.WeightUnit || 'kg',
                RequiresShipping: updatedProduct.RequiresShipping !== false,
                IsTaxable: updatedProduct.IsTaxable !== false,
                TaxCode: updatedProduct.TaxCode || '',
              });
            }
          }
        )
        .subscribe();

      // Subscribe to inventory level changes
      const inventorySubscription = supabase
        .channel(`inventory-${detailedItem.Id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'InventoryLevels',
            filter: `ProductVariantId=eq.${detailedItem.Id}`,
          },
          (payload) => {
            console.log('Inventory level updated:', payload);
            loadPlatformData(); // Reload inventory data
          }
        )
        .subscribe();

      // Subscribe to platform mapping changes
      const mappingSubscription = supabase
        .channel(`mappings-${detailedItem.Id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'PlatformProductMappings',
            filter: `ProductVariantId=eq.${detailedItem.Id}`,
          },
          (payload) => {
            console.log('Platform mapping updated:', payload);
            loadPlatformData(); // Reload mapping data
          }
        )
        .subscribe();

      return () => {
        console.log('Cleaning up realtime subscriptions');
        productSubscription.unsubscribe();
        inventorySubscription.unsubscribe();
        mappingSubscription.unsubscribe();
      };
    }, [detailedItem, loadPlatformData]);

    // Collaboration: Request edit lock and listen for team updates
    useEffect(() => {
      if (!detailedItem?.ProductId || !collaboration.isConnected) return;

      // Request edit lock when opening product
      collaboration.startEditing(detailedItem.ProductId).then((response) => {
        if (!response.success && response.lockedBy) {
          setIsLockedByOther(true);
          setLockOwner(response.lockedBy);
          Alert.alert(
            'Product Locked',
            `${response.lockedBy} is currently editing this product. You can view but not edit.`,
            [{ text: 'OK' }]
          );
        }
      });

      // Listen for product updates from other team members
      const unsubscribeUpdate = collaboration.onProductUpdate((update) => {
        // Ignore our own updates
        if (update.userId === detailedItem.UserId) return;

        console.log('[ProductDetail] Received update from teammate:', update);
        
        // Refresh product data from Supabase (single source of truth)
        const observables = getLegendStateObservables();
        if (observables?.productVariants$) {
          const refreshed = observables.productVariants$[update.variantId].get();
          if (refreshed) {
            setDetailedItem(refreshed);
            setFormData({
              Title: refreshed.Title || '',
              Description: refreshed.Description || '',
              Price: refreshed.Price || 0,
              CompareAtPrice: refreshed.CompareAtPrice || 0,
              Sku: refreshed.Sku || '',
              Barcode: refreshed.Barcode || '',
              Weight: refreshed.Weight || 0,
              WeightUnit: refreshed.WeightUnit || 'kg',
              RequiresShipping: refreshed.RequiresShipping !== false,
              IsTaxable: refreshed.IsTaxable !== false,
              TaxCode: refreshed.TaxCode || '',
            });
          }
        }

        Alert.alert(
          'Product Updated',
          'A teammate just updated this product. Your view has been refreshed.',
          [{ text: 'OK' }]
        );
      });

      // Listen for edit started events
      const unsubscribeEditStart = collaboration.onEditStarted((event) => {
        if (event.productId === detailedItem.ProductId) {
          setIsLockedByOther(true);
          setLockOwner(event.userName);
        }
      });

      // Listen for edit ended events
      const unsubscribeEditEnd = collaboration.onEditEnded((event) => {
        if (event.productId === detailedItem.ProductId) {
          setIsLockedByOther(false);
          setLockOwner(null);
        }
      });

      // Cleanup: Release lock when leaving
      return () => {
        collaboration.stopEditing(detailedItem.ProductId);
        unsubscribeUpdate();
        unsubscribeEditStart();
        unsubscribeEditEnd();
      };
    }, [detailedItem?.ProductId, collaboration.isConnected]);


    if (isLoading) {
      return (
        <View style={[styles.container, styles.centered, { backgroundColor: theme.colors.background }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.loadingText, { color: theme.colors.text }]}>Loading product details...</Text>
        </View>
      );
    }

    if (!detailedItem) {
      return (
        <View style={[styles.container, styles.centered, { backgroundColor: theme.colors.background }]}>
          <Text style={[styles.errorText, { color: theme.colors.error }]}>Product not found</Text>
          <Button title="Go Back" onPress={navigation.goBack} />
        </View>
      );
    }


    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Header with auto-save indicator */}
          <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
            <TouchableOpacity onPress={navigation.goBack} style={styles.backButton}>
              <Icon name="arrow-left" size={24} color={theme.colors.text} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Product Details</Text>
              {isSaving && (
                <View style={styles.savingIndicator}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text style={[styles.savingText, { color: theme.colors.primary }]}>Saving...</Text>
                </View>
              )}
              {!isSaving && lastSaveTime > 0 && (
                <Text style={[styles.savedText, { color: theme.colors.success }]}>
                  Saved {new Date(lastSaveTime).toLocaleTimeString()}
                </Text>
              )}
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={() => loadPlatformData()} style={styles.refreshButton}>
                <Icon name="refresh" size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {draftData && <Text style={{ color: 'orange' }}>Draft Mode - Changes not published</Text>}

          {/* Listing editor (edit mode) */}
          <Card style={styles.basicSection}>
            <ListingEditorForm
              ref={listingEditorRef}
              platforms={displayedPlatforms}
              images={detailedItem?.ImageUrls || []}
              platformLocations={buildPlatformLocations()}
              onChangePlatforms={(next) => {
                console.log('[ProductDetail] ListingEditorForm onChange:', Object.keys(next));
                setDisplayedPlatforms(next);
                setHasUnsavedChanges(true);
              }}
              onChangeImages={(next) => { reorderImages(next); }}
              onOpenFieldPanel={undefined}
              onOpenBarcodeScanner={(onResult)=>{
                setIsBarcodeScannerVisible(true);
                // handler stored on closure
                (ProductDetailScreen as any)._scannerResultHandler = onResult;
              }}
              onOpenImageCapture={() => pickImagesFromLibrary()}
            />
          </Card>

          {/* Active Listings */}
          <Card style={styles.platformsSection}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Active Listings</Text>

            {mappings.length > 0 ? (
              <>
                {mappings.map((mapping) => {
                  const connection = connections.find(c => c.Id === mapping.PlatformConnectionId);
                  const platformName = connection?.DisplayName || `${connection?.PlatformType || 'Unknown'} Account`;
                  const platformType = connection?.PlatformType || 'unknown';
                  const Logo = getPlatformLogoComponent(platformType);
                  return (
                    <View key={mapping.Id} style={styles.platformRow}>
                      <View style={styles.platformInfo}>
                        <View style={styles.platformLogoContainer}>
                          {Logo ? (
                            <Logo width={18} height={18} />
                          ) : (
                            <Icon name="store" size={18} color={'#666'} />
                          )}
                        </View>
                        <View style={styles.platformDetails}>
                          <Text style={[styles.platformName, { color: theme.colors.text }]}>{platformName}</Text>
                          <Text style={[styles.platformStatus, {color: theme.colors.text}]}>Status: {mapping.SyncStatus || 'Connected'}</Text>
                        </View>
                      </View>
                      <TouchableOpacity 
                        style={styles.delistButton}
                        onPress={() => {
                          Alert.alert('Delist', `Remove listing from ${platformName}?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delist', style: 'destructive', onPress: () => console.log('Delist from', platformName) }
                          ]);
                        }}
                      >
                        <Icon name="archive-outline" size={16} color={theme.colors.text} style={{ marginRight: 6 }} />
                        <Text style={[styles.delistButtonText, { color: theme.colors.text }]}>Delist</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
                <TouchableOpacity
                  style={styles.addPlatformRow}
                  onPress={() => listingEditorRef.current?.openPlatformPicker?.()}
                >
                  <Icon name="plus" size={16} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
                  <Text style={[styles.addPlatformText, { color: theme.colors.textSecondary }]}>Add Platform</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.noPlatformsContainer}>
                <Text style={[styles.noPlatformsText, { color: theme.colors.textSecondary }]}>No active listings</Text>
                <TouchableOpacity onPress={() => listingEditorRef.current?.openPlatformPicker?.()} style={[styles.syncButton, { backgroundColor: theme.colors.primary, marginTop: 8 }]}> 
                  <Text style={{ color: '#fff', fontWeight: '600' }}>+ Add Platform</Text>
                </TouchableOpacity>
              </View>
            )}
          </Card>

          {/* Danger Zone */}
          <Card style={[
            styles.dangerZoneSection,
            {
              borderColor: "#F12C2D",
              backgroundColor: '#FAFBFC',
              borderWidth: 1.5,
              borderRadius: 10,
              marginTop: 24,
              marginBottom: 24,
              padding: 0,
              overflow: 'hidden'
            }
          ]}>
            <View style={{
              padding: 16,
              borderBottomWidth: 0,
              backgroundColor: 'transparent'
            }}>
              <Text style={[
                styles.dangerZoneTitle,
                { color: theme.colors.text, fontWeight: '600', fontSize: 20, marginBottom: 0 }
              ]}>
                Danger Zone
              </Text>
            </View>
            <View style={{ paddingHorizontal: 8, paddingBottom: 16 }}>
              {/* Archive Product */}
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 1.5,
                  borderColor: "#FFBC13",
                  borderRadius: 8,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  marginBottom: 12,
                  backgroundColor: '#fff',
                  justifyContent: 'center'
                }}
                onPress={() => {
                  Alert.alert(
                    'Archive Product',
                    'Are you sure you want to archive this product? You can restore it later.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Archive', style: 'default', onPress: () => console.log('Archive product') }
                    ]
                  );
                }}
              >
                <Icon name="archive" size={20} color={theme.colors.warning} style={{ marginRight: 8 }} />
                <Text style={{ color: "#FFBC13", fontWeight: '400', fontSize: 16 }}>
                  Archive Product
                </Text>
              </TouchableOpacity>
              {/* Delete Product */}
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 1.25,
                  borderColor: "#F12C2D",
                  borderRadius: 8,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  backgroundColor: '#fff',
                  justifyContent: 'center'
                }}
                onPress={handleDelete}
              >
                <Icon name="delete" size={20} color={theme.colors.error} style={{ marginRight: 8 }} />
                <Text style={{ color: theme.colors.error, fontWeight: '500', fontSize: 16 }}>
                  Delete Product
                </Text>
              </TouchableOpacity>
            </View>
          </Card>
        </ScrollView>
        
        {/* Sync Status Indicator */}
        {hasUnsavedChanges && (
          <BottomActionBar
            primaryLabel={isSaving ? 'Saving…' : 'Save changes'}
            primaryDisabled={isSaving}
            onPrimary={() => performAutoSave()}
          />
        )}
        {/* Barcode Scanner Modal */}
        {isBarcodeScannerVisible && (
          <View style={styles.scannerDockFull} pointerEvents="box-none">
            <View style={styles.scannerFullBleed}>
              <CameraView
                style={{ width: '100%', height: 240 }}
                facing={'back'}
                onBarcodeScanned={(result:any) => {
                  const code = result?.data || result?.rawValue;
                  if (code && (ProductDetailScreen as any)._scannerResultHandler) {
                    (ProductDetailScreen as any)._scannerResultHandler(code);
                    setIsBarcodeScannerVisible(false);
                    (ProductDetailScreen as any)._scannerResultHandler = null;
                  }
                }}
                barcodeScannerSettings={{ barcodeTypes: ['qr','ean13','upc_a','upc_e','code128'] }}
              />
              <TouchableOpacity onPress={() => { setIsBarcodeScannerVisible(false); (ProductDetailScreen as any)._scannerResultHandler = null; }} style={styles.scannerCloseFull}>
                <Text style={{ color: '#fff', fontSize: 28 }}>×</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {isSyncing && (
          <LoadingOverlay visible={isSyncing} message="Syncing to platforms..." onCancel={() => setIsSyncing(false)} />
        )}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scannerDock: { position: 'absolute', top: 6, left: 56, right: 56, zIndex: 5000 },
  scannerCard: { backgroundColor: '#000', borderRadius: 18, borderWidth: 2, borderColor: '#111', overflow: 'hidden' },
  scannerClose: { position: 'absolute', top: 14, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  scannerDockFull: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5000 },
  scannerFullBleed: { backgroundColor: '#000', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, overflow: 'hidden' },
  scannerCloseFull: { position: 'absolute', top: 100, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingBottom: 100,
  },
  header: {
    paddingTop: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  backButton: {
    padding: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
  },
  refreshButton: {
    padding: 8,
  },
  savingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  savingText: {
    fontSize: 12,
    marginLeft: 4,
  },
  savedText: {
    fontSize: 12,
    marginTop: 4,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  
  // Image Section
  imageSection: {
    margin: 16,
  },
  imageSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  addImageButton: {
    padding: 12,
    borderRadius: 8,
  },
  imageScroll: {
    flexDirection: 'row',
  },
  imageContainer: {
    position: 'relative',
    marginRight: 12,
  },
  productImage: {
    width: 120,
    height: 120,
    borderRadius: 8,
  },
  primaryBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  primaryBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  placeholderImageContainer: {
    width: 120,
    height: 120,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 12,
    marginTop: 8,
  },

  // Form Sections
  basicSection: {
    margin: 16,
    marginTop: 0,
  },
  identitySection: {
    margin: 16,
    marginTop: 0,
  },
  shippingSection: {
    margin: 16,
    marginTop: 0,
  },
  
  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  formInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  formRow: {
    flexDirection: 'row',
  },
  barcodeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  scanButton: {
    marginLeft: 10,
    padding: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  switchLabel: {
    fontSize: 16,
  },

  // Inventory Section
  inventorySection: {
    margin: 16,
    marginTop: 0,
  },
  platformGroup: {
    marginBottom: 20,
  },
  platformHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  platformGroupTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  platformSubtitle: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  inventoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  inventoryLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  locationName: {
    fontSize: 14,
    marginLeft: 6,
  },
  inventoryInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    minWidth: 80,
    textAlign: 'center',
  },
  noInventoryText: {
    textAlign: 'center',
    fontSize: 14,
    fontStyle: 'italic',
    padding: 20,
  },

  // Platform Connections
  platformsSection: {
    margin: 16,
    marginTop: 0,
  },
  platformRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  platformLogoContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformDetails: {
    marginLeft: 12,
    flex: 1,
  },
  platformName: {
    fontSize: 16,
    fontWeight: '500',
  },
  platformSku: {
    fontSize: 12,
    marginTop: 2,
  },
  platformStatus: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  platformLastSync: {
    fontSize: 11,
    marginTop: 2,
  },
  platformActions: {
    flexDirection: 'row',
  },
  syncButton: {
    padding: 8,
    borderRadius: 6,
    marginLeft: 8,
  },
  delistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#D0D5DD',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  delistButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  noPlatformsContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  noPlatformsText: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  addPlatformRow: {
    marginTop: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D0D5DD',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  addPlatformText: {
    fontSize: 16,
    fontWeight: '500',
  },
  removeImageButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    padding: 4,
    borderRadius: 4,
  },
  dangerZoneSection: {
    margin: 16,
    marginTop: 0,
  },
  dangerZoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  dangerZoneHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerZoneTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  dangerZoneContent: {
    padding: 16,
  },
  dangerZoneDescription: {
    fontSize: 14,
    marginBottom: 16,
  },
  dangerAction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dangerActionInfo: {
    flex: 1,
  },
  dangerActionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  dangerActionDescription: {
    fontSize: 14,
  },
  dangerButton: {
    padding: 12,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
});

export default ProductDetailScreen; 