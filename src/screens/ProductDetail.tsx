import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, Switch, FlatList } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ListingEditorForm, { ListingEditorFormRef } from '../components/ListingEditorForm';
import BottomActionBar from '../components/BottomActionBar';
import ExpoBarcodeScanner from '../components/ExpoBarcodeScanner';
import { CameraView } from 'expo-camera';
import Card from '../components/Card';
import PlaceholderImage from '../components/PlaceholderImage';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { createCanonicalBase, hydratePlatformsFromBackend } from '../utils/platformDataHydration';
import {
  ProductVariant,
  PlatformProductMapping,
  InventoryLevel,
  getLegendStateObservables,
  PlatformConnection
} from '../utils/SupaLegend';
import { observer } from '@legendapp/state/react';
import * as ImagePicker from 'expo-image-picker';

// Base URL for API
const SSSYNC_API_BASE_URL = 'https://api.sssync.app';

// Toggle to use manual save via BottomActionBar
const ENABLE_AUTOSAVE = false;

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

const ProductDetailScreen = observer(
  ({ route, navigation }: { route: ProductDetailRouteProps; navigation: ProductDetailNavigationProps }) => {
    const theme = useTheme();
    const passedItem = route.params?.item;
    const productId = route.params?.productId || passedItem?.Id;

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
    const [editPlatforms, setEditPlatforms] = useState<Record<string, any>>({});
    
    // Debounce timer for auto-save
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const SAVE_DEBOUNCE_MS = 1000; // Wait 1 second after last change before saving

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

      } catch (error) {
        console.error('Error loading platform data:', error);
      }
    }, [detailedItem, getLocationName]);

    // Auto-save function with proper API call
    const performAutoSave = useCallback(async () => {
      if (!detailedItem || !hasUnsavedChanges) return;

      setIsSaving(true);
      try {
        const token = await ensureSupabaseJwt();

        if (!token) {
          console.error('No authentication token available');
          return;
        }

        // Prepare update data - using the correct API structure from the backend
        const updateData = {
          Title: formData.Title,
          Description: formData.Description,
          Price: formData.Price,
          CompareAtPrice: formData.CompareAtPrice,
          Sku: formData.Sku,
          Barcode: formData.Barcode,
          Weight: formData.Weight,
          WeightUnit: formData.WeightUnit,
          RequiresShipping: formData.RequiresShipping,
          IsTaxable: formData.IsTaxable,
          TaxCode: formData.TaxCode,
        };

        console.log('Auto-saving product:', detailedItem.Id, updateData);

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

        // Push updates to mapped platforms using catalog update (best-effort, do not block UI)
        try {
          const token2 = token;
          const baseUrl = SSSYNC_API_BASE_URL;
          // Get connections for this user to find platforms for this product
          const connRes = await fetch(`${baseUrl}/api/platform-connections`, { headers: { Authorization: `Bearer ${token2}` } });
          const userConnections = connRes.ok ? await connRes.json() : [];
          // Find mappings for this variant to know which connections to target
          const mapRes = await fetch(`${baseUrl}/api/platform-product-mappings?productVariantId=${encodeURIComponent(detailedItem.Id)}`, { headers: { Authorization: `Bearer ${token2}` } });
          const maps = mapRes.ok ? await mapRes.json() : [];
          for (const m of maps) {
            const conn = (userConnections || []).find((c:any)=> c.Id === m.PlatformConnectionId);
            if (!conn) continue;
            const platform = (conn.PlatformType || '').toLowerCase();
            // Minimal canonical to update price/title
            const product = { Title: updateData.Title, Description: updateData.Description };
            const variants = [{ Id: m.ProductVariantId, Sku: updateData.Sku, Price: updateData.Price, Barcode: updateData.Barcode, Title: updateData.Title }];
            await fetch(`${baseUrl}/api/catalog/${platform}/connections/${conn.Id}/products/${m.PlatformProductId}`, {
              method: 'PUT',
              headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ product, variants })
            }).catch(()=>{});
          }
        } catch {}

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
    }, [detailedItem, formData, hasUnsavedChanges]);

    // Debounced auto-save
    const scheduleAutoSave = useCallback(() => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      saveTimeoutRef.current = setTimeout(() => {
        performAutoSave();
      }, SAVE_DEBOUNCE_MS);
    }, [performAutoSave]);

    // Handle form changes with auto-save
    const handleFormChange = useCallback((field: keyof EditFormData, value: any) => {
      setFormData(prev => ({
        ...prev,
        [field]: value
      }));
      setHasUnsavedChanges(true);
      if (ENABLE_AUTOSAVE) scheduleAutoSave();
    }, [scheduleAutoSave]);

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

    const deleteProduct = async () => {
      if (!detailedItem) return;

      Alert.alert(
        'Delete Product',
        'Are you sure you want to delete this product? This action cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                const token = await ensureSupabaseJwt();

                if (token) {
                  const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}`, {
                    method: 'DELETE',
                    headers: {
                      'Authorization': `Bearer ${token}`,
                    },
                  });

                  if (!response.ok) {
                    throw new Error('Failed to delete product');
                  }
                }

                Alert.alert('Success', 'Product deleted successfully', [
                  { text: 'OK', onPress: () => navigation.goBack() }
                ]);
              } catch (error) {
                console.error('Error deleting product:', error);
                Alert.alert('Error', 'Failed to delete product. Please try again.');
              }
            }
          }
        ]
      );
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
        loadPlatformData();
      }
    }, [detailedItem, loadPlatformData]);

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

    // Cleanup auto-save timer
    useEffect(() => {
      return () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
      };
    }, []);

    const handleBarcodeScanned = (code: string) => {
      handleFormChange('Barcode', code);
      setIsBarcodeScannerVisible(false);
      Alert.alert('Barcode Scanned', `Added barcode: ${code}`);
    };

    const getPlatformIcon = (platformType: string) => {
      const type = platformType.toLowerCase();
      if (type.includes('shopify')) return 'shopping';
      if (type.includes('square')) return 'square-medium';
      if (type.includes('clover')) return 'clover';
      if (type.includes('amazon')) return 'amazon';
      if (type.includes('ebay')) return 'tag';
      if (type.includes('facebook')) return 'facebook';
      return 'store';
    };

    // Generate proper image URLs with better error handling
    const getImageUrl = (imageUrl: string): string => {
      if (!imageUrl) return '';
      
      // If it's already a full URL, return as is
      if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        return imageUrl;
      }
      
      // If it's a Supabase storage path, construct the full URL
      if (imageUrl.startsWith('product-images/') || imageUrl.startsWith('product-media/')) {
        const { data } = supabase.storage.from('product-media').getPublicUrl(imageUrl);
        return data.publicUrl;
      }
      
      // If it looks like a relative path, try to construct a Supabase URL
      if (!imageUrl.includes('://')) {
        const { data } = supabase.storage.from('product-media').getPublicUrl(imageUrl);
        return data.publicUrl;
      }
      
      return imageUrl;
    };

    // Normalize platform type to ListingEditorForm key
    const normalizePlatformKey = (platformType?: string) => {
      const type = (platformType || '').toLowerCase();
      if (type.includes('shopify')) return 'shopify';
      if (type.includes('square')) return 'square';
      if (type.includes('clover')) return 'clover';
      if (type.includes('amazon')) return 'amazon';
      if (type.includes('ebay')) return 'ebay';
      if (type.includes('facebook')) return 'facebook';
      return type || 'unknown';
    };

    // Hydrate ListingEditorForm with canonical data for all mapped platforms
    useEffect(() => {
      if (!detailedItem) return;
      
      console.log('[ProductDetail] Hydrating platforms. DetailedItem:', detailedItem);
      
      // Create canonical base from product variant
      const base = createCanonicalBase(detailedItem);

      setEditPlatforms(prev => {
        // Start with canonical shopify platform
        const backendPlatforms: Record<string, any> = {
          shopify: base
        };
        
        // Add platforms for each mapping
        (mappings || []).forEach(m => {
          const conn = connections.find(c => c.Id === m.PlatformConnectionId);
          const key = normalizePlatformKey(conn?.PlatformType);
          if (key && key !== 'shopify') {
            backendPlatforms[key] = base;
          }
        });
        
        // Use unified hydration - preserves user edits
        const hydrated = hydratePlatformsFromBackend(backendPlatforms, prev);
        
        console.log('[ProductDetail] editPlatforms updated:', Object.keys(hydrated), 'shopify.title:', hydrated.shopify?.title);
        return hydrated;
      });
    }, [detailedItem, mappings, connections]);

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

          

          {/* Listing editor (edit mode) */}
          <Card style={styles.basicSection}>
            <ListingEditorForm
              ref={listingEditorRef}
              platforms={editPlatforms}
              images={detailedItem?.ImageUrls || []}
              onChangePlatforms={(next) => { setEditPlatforms(next); setHasUnsavedChanges(true); }}
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
                  return (
                    <View key={mapping.Id} style={styles.platformRow}>
                      <View style={styles.platformInfo}>
                        <Icon name={getPlatformIcon(platformType)} size={20} color={theme.colors.primary} />
                        <View style={styles.platformDetails}>
                          <Text style={[styles.platformName, { color: theme.colors.text }]}>{platformName}</Text>
                          <Text style={[styles.platformSku, { color: theme.colors.textSecondary }]}>SKU: {mapping.PlatformSku || detailedItem.Sku || 'N/A'}</Text>
                          <Text style={[styles.platformStatus, { 
                            color: mapping.SyncStatus === 'Success' ? theme.colors.success : 
                                   mapping.SyncStatus === 'Failed' ? theme.colors.error : 
                                   theme.colors.warning 
                          }]}>Status: {mapping.SyncStatus || 'Connected'}</Text>
                        </View>
                      </View>
                      <TouchableOpacity 
                        style={[styles.syncButton, { backgroundColor: theme.colors.error }]}
                        onPress={() => {
                          Alert.alert('Delist', `Remove listing from ${platformName}?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delist', style: 'destructive', onPress: () => console.log('Delist from', platformName) }
                          ]);
                        }}
                      >
                        <Icon name="minus-circle" size={16} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  );
                })}
                <TouchableOpacity
                  style={[styles.platformRow, { justifyContent: 'center' }]}
                  onPress={() => listingEditorRef.current?.openPlatformPicker?.()}
                >
                  <Text style={[styles.platformName, { color: theme.colors.primary }]}>+ Add Platform</Text>
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
              borderColor: theme.colors.error,
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
                  borderColor: theme.colors.warning,
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
                <Text style={{ color: theme.colors.warning, fontWeight: '500', fontSize: 16 }}>
                  Archive Product
                </Text>
              </TouchableOpacity>
              {/* Delete Product */}
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 1.5,
                  borderColor: theme.colors.error,
                  borderRadius: 8,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  backgroundColor: '#fff',
                  justifyContent: 'center'
                }}
                onPress={deleteProduct}
              >
                <Icon name="delete" size={20} color={theme.colors.error} style={{ marginRight: 8 }} />
                <Text style={{ color: theme.colors.error, fontWeight: '500', fontSize: 16 }}>
                  Delete Product
                </Text>
              </TouchableOpacity>
            </View>
          </Card>
        </ScrollView>
        

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
  noPlatformsContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  noPlatformsText: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
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