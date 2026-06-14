import React, { useState, useEffect } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
  ActivityIndicator,
  Dimensions,
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import VariantInventoryEditor, { VariantInventoryEditorProps } from './VariantInventoryEditor';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import PlatformLogo from './PlatformLogo';
import { getPlatform } from '../config/platforms';
import PlatformFilterChips from './PlatformFilterChips';
import { capture, AnalyticsEvents } from '../lib/analytics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface LocationInventory {
  id: string;
  name: string;
  quantity: number;
  price?: number;
  platformType?: string; // For showing platform logo
}

interface VariantInventory {
  id: string;
  name: string;
  optionValues?: Record<string, string>;
  inventoryByLocation: Record<string, { quantity: number; price?: number }>;
  image?: string;
}

interface QuickProductDetailSheetProps {
  product: any; // barcodeSearchResult from AddProductScreen
  onClose: () => void;
  onSave: (updates: { variantId: string; location: string; quantity: number; price?: number }[]) => Promise<void>;
  onOpenDetail?: () => void;
  platformLocations?: { id: string; name: string; platformType?: string }[];
}

const QuickProductDetailSheet: React.FC<QuickProductDetailSheetProps> = ({
  product,
  onClose,
  onSave,
  onOpenDetail,
  platformLocations = [],
}) => {
  const theme = useTheme();
  const [locations, setLocations] = useState<LocationInventory[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [variants, setVariants] = useState<VariantInventory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [inventoryUpdates, setInventoryUpdates] = useState<Record<string, { quantity: number; price?: number }>>({});
  // Note: Keys are composite: `${variantId}:${locationId}`
  const [selectedPlatformFilter, setSelectedPlatformFilter] = useState<string | null>(null);

  // Load variant and location data
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        console.log('[QUICK DETAIL] Loading data for product:', product.variant?.Id || 'unknown');

        let loadedVariants: VariantInventory[] = [];

        // Handle backend format: { variant, inventoryLevels, images }
        if (product.variant && product.inventoryLevels) {
          console.log('[QUICK DETAIL] Backend format detected, transforming data');

          // Transform inventoryLevels to inventoryByLocation format
          const inventoryByLocation: Record<string, { quantity: number; price?: number }> = {};
          (product.inventoryLevels || []).forEach((level: any) => {
            if (level.PlatformLocationId) {
              inventoryByLocation[level.PlatformLocationId] = {
                quantity: level.Quantity || 0,
                price: level.Price,
              };
            }
          });

          // Check if we have the base variant or need to fetch all variants for the product
          const baseVariant = product.variant;

          console.log('[QUICK DETAIL] Base variant:', {
            id: baseVariant.Id,
            productId: baseVariant.ProductId,
            title: baseVariant.Title,
            options: baseVariant.Options,
          });

          // Always try to fetch all variants for this product from DB
          if (baseVariant.ProductId) {
            try {
              const { data: allVariants, error: variantsError } = await supabase
                .from('ProductVariants')
                .select('Id, ProductId, UserId, Sku, Barcode, Title, Description, Price, CompareAtPrice, Options, VariantType, PrimaryImageUrl, CreatedAt, UpdatedAt')
                .eq('ProductId', baseVariant.ProductId);

              console.log('[QUICK DETAIL] DB Query result:', {
                productId: baseVariant.ProductId,
                variantCount: allVariants?.length || 0,
                error: variantsError?.message,
                variants: allVariants?.map((v: any) => ({ id: v.Id, title: v.Title, options: v.Options, variantType: v.VariantType })),
              });

              // Also fetch inventory for all variants
              const variantIds = (allVariants || []).map((v: any) => v.Id);
              const { data: allInventory } = await supabase
                .from('InventoryLevels')
                .select('Id, ProductVariantId, PlatformConnectionId, PlatformLocationId, PoolId, OrgId, Quantity, Price, CompareAtPrice, Currency, UpdatedAt')
                .in('ProductVariantId', variantIds);

              // CRITICAL FIX: Filter out base variant when option variants exist
              // Base variants have VariantType='base' or no Options - they're the parent container
              // Option variants are the actual sellable items with specific options (Size=S, Color=Red, etc.)
              const optionVariants = (allVariants || []).filter((v: any) => {
                const hasOptions = v.Options && Object.keys(v.Options).length > 0;
                const isBaseType = v.VariantType === 'base';
                // Include if: has options OR is not marked as base type
                // This handles both new products (with VariantType) and legacy products (checking Options)
                return hasOptions || !isBaseType;
              });

              // If we have option variants, use those. Otherwise use all variants (single-variant products)
              const variantsToUse = optionVariants.length > 0
                ? optionVariants
                : (allVariants || []);

              console.log('[QUICK DETAIL] Filtered variants:', {
                total: allVariants?.length || 0,
                optionVariants: optionVariants.length,
                usingVariants: variantsToUse.length,
              });

              // Transform filtered variants with their inventory
              loadedVariants = variantsToUse.map((v: any) => {
                const variantInventory: Record<string, { quantity: number; price?: number }> = {};
                (allInventory || [])
                  .filter((inv: any) => inv.ProductVariantId === v.Id)
                  .forEach((inv: any) => {
                    if (inv.PlatformLocationId) {
                      variantInventory[inv.PlatformLocationId] = {
                        quantity: inv.Quantity || 0,
                        price: inv.Price,
                      };
                    }
                  });

                // Build variant name from Options or Title
                const optionValues = v.Options || {};
                const hasOptions = Object.keys(optionValues).length > 0;
                const variantName = hasOptions
                  ? Object.values(optionValues).join(' / ')
                  : (v.Title || 'Default');

                return {
                  id: v.Id,
                  name: variantName,
                  optionValues: optionValues,
                  inventoryByLocation: variantInventory,
                  image: v.PrimaryImageUrl,
                };
              });

              // If no option-based variants found, use the base variant
              if (loadedVariants.length === 0) {
                loadedVariants = [{
                  id: baseVariant.Id,
                  name: baseVariant.Title || 'Default',
                  optionValues: baseVariant.Options || {},
                  inventoryByLocation,
                  image: product.images?.[0]?.ImageUrl,
                }];
              }

              console.log(`[QUICK DETAIL] Loaded ${loadedVariants.length} variants from DB`);
              console.log('[QUICK DETAIL] Loaded variants:', loadedVariants.map(v => ({
                id: v.id,
                name: v.name,
                inventoryLocCount: Object.keys(v.inventoryByLocation).length
              })));
            } catch (dbError) {
              console.warn('[QUICK DETAIL] Could not fetch variants from DB:', dbError);
              // Fallback to single variant
              loadedVariants = [{
                id: baseVariant.Id,
                name: baseVariant.Title || 'Default',
                optionValues: baseVariant.Options || {},
                inventoryByLocation,
                image: product.images?.[0]?.ImageUrl,
              }];
            }
          } else {
            // No ProductId - use single base variant with inventoryLevels
            console.log('[QUICK DETAIL] No ProductId, using single base variant');
            loadedVariants = [{
              id: baseVariant.Id,
              name: baseVariant.Title || 'Default',
              optionValues: baseVariant.Options || {},
              inventoryByLocation,
              image: product.images?.[0]?.ImageUrl,
            }];
          }
        }
        // Handle frontend format: { variants: [...] }
        else if (product.variants && product.variants.length > 0) {
          console.log('[QUICK DETAIL] Frontend format detected');
          loadedVariants = product.variants;
        }

        setVariants(loadedVariants);
        console.log(`[QUICK DETAIL] Set ${loadedVariants.length} variants`);

        // Determine locations list
        let locationsList: LocationInventory[] = [];

        if (platformLocations && platformLocations.length > 0) {
          // Use provided platform locations as the source of truth
          locationsList = platformLocations.map(pl => ({
            id: pl.id,
            name: pl.name,
            quantity: 0, // Placeholder, actual quantity is in variants
            platformType: pl.platformType, // For platform logo
          }));
        } else {
          // Extract unique locations from all variants (fallback)
          // CRITICAL FIX: Also try to determine platformType from location ID patterns
          const locationsMap = new Map<string, LocationInventory>();
          loadedVariants.forEach((variant) => {
            Object.entries(variant.inventoryByLocation || {}).forEach(([locId, locData]: [string, any]) => {
              if (locId !== 'default' && locId !== 'loc-default' && !locationsMap.has(locId)) {
                // Determine platformType from location ID patterns
                let platformType: string | undefined = undefined;
                if (locId.includes('gid://shopify/Location/')) {
                  platformType = 'shopify';
                } else if (/^[A-Z0-9]{10,}$/.test(locId)) {
                  // Square location IDs are alphanumeric uppercase strings
                  platformType = 'square';
                }
                // Note: clover and other platforms would need their patterns added here

                locationsMap.set(locId, {
                  id: locId,
                  name: locData.name || locId.slice(0, 20),
                  quantity: locData.quantity || 0,
                  platformType,
                });
              }
            });
          });
          locationsList = Array.from(locationsMap.values());
        }

        setLocations(locationsList);
        console.log(`[QUICK DETAIL] Set ${locationsList.length} locations`);

        if (locationsList.length > 0) {
          setSelectedLocationId(locationsList[0].id);
        }
      } catch (error) {
        console.error('[QUICK DETAIL] Error loading data:', error);
        Alert.alert('Error', 'Failed to load product details');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [product]);

  // Auto-swap to first location of selected platform when filter changes
  useEffect(() => {
    if (!locations.length) return;

    if (selectedPlatformFilter) {
      // Find first location matching the selected platform
      const matchingLocation = locations.find(
        l => l.platformType?.toLowerCase() === selectedPlatformFilter.toLowerCase()
      );
      if (matchingLocation && matchingLocation.id !== selectedLocationId) {
        setSelectedLocationId(matchingLocation.id);
      }
    } else {
      // "All" selected - keep current or use first
      if (!selectedLocationId || !locations.find(l => l.id === selectedLocationId)) {
        setSelectedLocationId(locations[0].id);
      }
    }
  }, [selectedPlatformFilter, locations]);

  // Use composite key: variantId:locationId for proper per-location tracking
  const getInventoryKey = (variantId: string, locationId: string) => `${variantId}:${locationId}`;

  const handleQuantityChange = (variantId: string, locationId: string, quantity: number) => {
    const key = getInventoryKey(variantId, locationId);
    setInventoryUpdates(prev => ({
      ...prev,
      [key]: { ...prev[key], quantity },
    }));
  };

  const handlePriceChange = (variantId: string, locationId: string, price: number) => {
    const key = getInventoryKey(variantId, locationId);
    setInventoryUpdates(prev => ({
      ...prev,
      [key]: { ...prev[key], price },
    }));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);

      // Prepare updates array - parse composite keys
      const updates = Object.entries(inventoryUpdates).map(([key, data]) => {
        const [variantId, locationId] = key.split(':');
        return {
          variantId,
          location: locationId,
          quantity: data.quantity || 0,
          price: data.price,
        };
      });

      if (updates.length === 0) {
        Alert.alert('No Changes', 'Update at least one variant quantity');
        setIsSaving(false);
        return;
      }

      await onSave(updates);
      capture(AnalyticsEvents.INVENTORY_UPDATED, { product_id: product?.id, update_count: updates.length });
      Alert.alert('Success', `Updated ${updates.length} item(s)`);
      onClose();
    } catch (error) {
      console.error('[QUICK DETAIL] Save error:', error);
      Alert.alert('Error', 'Failed to save inventory updates');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={BRAND_PRIMARY} />
          <Text style={[styles.loadingText, { color: theme.colors.text }]}>Loading product...</Text>
        </View>
      </View>
    );
  }

  const mainImage = product.images?.[0]?.ImageUrl || product.variant?.ImageUrl;
  const title = product.variant?.Title || 'Product';
  const price = product.variant?.Price || 0;
  const sku = product.variant?.Sku || 'N/A';
  const totalStock = variants.reduce((sum, v) => {
    const locData = v.inventoryByLocation?.[selectedLocationId];
    return sum + (locData?.quantity || 0);
  }, 0);

  return (
    <View style={styles.backdrop}>



      {/* Modal Sheet Card */}
      <View style={[styles.modalSheet]}>
        <ScrollView
          style={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Header with close button */}
          <View style={styles.header}>
            <View style={styles.sheetHeaderSpacer} />
            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Update Product</Text>
            <TouchableOpacity onPress={onClose} style={styles.exitButton} activeOpacity={0.8} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={18} color="#64748B" />
              <Text style={styles.exitButtonText}>Exit</Text>
            </TouchableOpacity>
          </View>

          {/* Product Card */}
          <View style={[styles.productCard, { backgroundColor: theme.colors.surface }]}>
            {/* Left - Image */}
            <View style={styles.imageContainer}>
              {mainImage ? (
                <Image
                  source={{ uri: mainImage }}
                  style={styles.productImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.placeholderImage, { backgroundColor: '#F0F0F0' }]}>
                  <Icon name="image-off" size={40} color="#CCC" />
                </View>
              )}
            </View>

            {/* Right - Product Info */}
            <View style={styles.productInfoContainer}>
              <Text style={[styles.productTitle, { color: theme.colors.text }]} numberOfLines={2}>
                {title}
              </Text>

              <Text style={[styles.productPrice, { color: theme.colors.textSecondary }]}>
                ${typeof price === 'number' ? price.toFixed(2) : '0.00'}
              </Text>

              <Text style={[styles.productSku, { color: theme.colors.textSecondary }]}>
                SKU: {sku}
              </Text>

              <View style={styles.stockBadgeContainer}>
                <View style={[styles.stockBadge, { backgroundColor: '#FFF' }]}>
                  <Text style={[styles.stockText, { color: '#000' }]}>
                    {totalStock} in Stock
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* View Full Details Button */}
          <TouchableOpacity
            style={[styles.viewDetailsButton, { backgroundColor: theme.colors.surface, borderColor: '#E5E5E5' }]}
            onPress={() => {
              if (onOpenDetail) {
                onOpenDetail();
              } else {
                onClose(); // Fallback if no handler
              }
            }}
          >
            <Icon name="open-in-new" size={18} color={theme.colors.text} />
            <Text style={[styles.viewDetailsText, { color: theme.colors.text }]}>Open Product Detail</Text>
          </TouchableOpacity>

          {/* Platform Filter Chips */}
          {(() => {
            // Build unique platforms from locations
            const uniquePlatforms = Array.from(
              new Set(locations.map(l => l.platformType).filter(Boolean))
            ).map(platformType => ({
              name: platformType || 'Unknown',
              type: platformType || 'unknown',
            }));

            if (uniquePlatforms.length > 0) {
              return (
                <View style={{ marginTop: 16, marginBottom: 8 }}>
                  <PlatformFilterChips
                    platforms={uniquePlatforms}
                    selectedPlatform={selectedPlatformFilter}
                    onSelectPlatform={setSelectedPlatformFilter}
                    activeColor={theme.colors.primary}
                  />
                </View>
              );
            }
            return null;
          })()}

          {/* Inventory Section */}
          <View style={[styles.inventorySection, { backgroundColor: theme.colors.surface }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, zIndex: 10 }}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Inventory</Text>

              {locations.length > 0 && (
                <View>
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderWidth: 1,
                      borderColor: '#E5E5E5',
                      borderRadius: 8,
                      backgroundColor: '#FFF',
                    }}
                    onPress={() => setShowLocationPicker(!showLocationPicker)}
                  >
                    {/* Platform logo */}
                    {(() => {
                      const selectedLoc = locations.find(l => l.id === selectedLocationId);
                      return selectedLoc?.platformType && getPlatform(selectedLoc.platformType) ? (
                        <PlatformLogo type={selectedLoc.platformType} size={16} style={{ marginRight: 6 }} />
                      ) : (
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#FACC15', marginRight: 8 }} />
                      );
                    })()}
                    <Text style={{ fontWeight: '600', color: '#000', marginRight: 4, maxWidth: 150, flexShrink: 1 }} numberOfLines={1}>
                      {locations.find(l => l.id === selectedLocationId)?.name || 'Select Location'}
                    </Text>
                    <Icon name={showLocationPicker ? "chevron-up" : "chevron-down"} size={20} color="#666" />
                  </TouchableOpacity>

                  {showLocationPicker && (
                    <View style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: 4,
                      backgroundColor: '#FFF',
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: '#E5E5E5',
                      elevation: 5,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.1,
                      shadowRadius: 4,
                      width: 220,
                      zIndex: 1000,
                    }}>
                      {locations
                        .filter(loc => !selectedPlatformFilter || loc.platformType?.toLowerCase() === selectedPlatformFilter.toLowerCase())
                        .map(loc => {
                          return (
                            <TouchableOpacity
                              key={loc.id}
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                paddingVertical: 12,
                                paddingHorizontal: 12,
                                borderBottomWidth: 1,
                                borderBottomColor: '#F0F0F0',
                                backgroundColor: selectedLocationId === loc.id ? '#F9F9F9' : '#FFF',
                              }}
                              onPress={() => {
                                setSelectedLocationId(loc.id);
                                setShowLocationPicker(false);
                              }}
                            >
                              {loc.platformType && getPlatform(loc.platformType) && (
                                <PlatformLogo type={loc.platformType} size={16} style={{ marginRight: 8 }} />
                              )}
                              <Text style={{
                                fontWeight: selectedLocationId === loc.id ? '600' : '400',
                                color: '#000',
                                flexShrink: 1,
                              }} numberOfLines={1}>
                                {loc.name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Global Pricing Message */}
            {(() => {
              const selectedLoc = locations.find(l => l.id === selectedLocationId);
              const platformType = selectedLoc?.platformType?.toLowerCase() || '';
              const isGlobalPricing = platformType === 'shopify';
              if (isGlobalPricing) {
                return (
                  <Text style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
                    Price must be same everywhere
                  </Text>
                );
              }
              return null;
            })()}

            {/* Variants List */}
            <View style={{ gap: 12, zIndex: 1, paddingBottom: 24 }}>
              {(() => {
                // Debug: Log what we're passing
                console.log('[QUICK DETAIL] Rendering VariantInventoryEditor');
                console.log('[QUICK DETAIL] variants:', variants.length, 'selectedLocationId:', selectedLocationId);
                console.log('[QUICK DETAIL] locations:', locations.length, 'selectedPlatformFilter:', selectedPlatformFilter);

                // MATCH ListingEditorForm EXACTLY:
                // 1. Build locations list based on active tab/filter
                let editorLocations: Array<{ id: string; name: string; platformKey: string }>;

                if (!selectedPlatformFilter || selectedPlatformFilter === 'all') {
                  // "All" tab: show all locations across all platforms
                  const seenIds = new Set<string>();
                  editorLocations = locations
                    .filter(l => {
                      if (seenIds.has(l.id)) return false;
                      seenIds.add(l.id);
                      return true;
                    })
                    .map(l => ({
                      id: l.id,
                      name: l.name,
                      platformKey: l.platformType?.toLowerCase() || 'unknown'
                    }));
                } else {
                  // Platform tab: filter to only this platform's locations
                  const platformKey = selectedPlatformFilter.toLowerCase();
                  const platformLocs = locations.filter(l =>
                    l.platformType?.toLowerCase() === platformKey
                  );

                  // If a location is selected (via dropdown), filter to just that location
                  // This matches ListingEditorForm's behavior with selectedLocationId
                  if (selectedLocationId) {
                    const selectedLoc = platformLocs.find(l => l.id === selectedLocationId);
                    editorLocations = selectedLoc
                      ? [{ id: selectedLoc.id, name: selectedLoc.name, platformKey }]
                      : platformLocs.map(l => ({ id: l.id, name: l.name, platformKey }));
                  } else {
                    editorLocations = platformLocs.map(l => ({ id: l.id, name: l.name, platformKey }));
                  }
                }

                console.log(`[QUICK DETAIL] editorLocations: ${editorLocations.length} locations`);

                // 2. Prepare Variants - MATCH ListingEditorForm EXACTLY
                // Deduplicate variants by ID using a Map (same as ListingEditorForm)
                const variantMap = new Map<string, any>();

                variants.forEach(v => {
                  const vId = v.id;
                  if (variantMap.has(vId)) return; // Skip duplicates

                  const inv: Record<string, { quantity: number; price?: number; image?: string }> = {};

                  // Only include inventory for locations that will be displayed
                  Object.entries(v.inventoryByLocation || {}).forEach(([locId, data]: [string, any]) => {
                    const isLocationShown = editorLocations.some(l => l.id === locId);
                    if (isLocationShown) {
                      inv[locId] = {
                        quantity: data.quantity || 0,
                        price: data.price,
                        image: data.image
                      };
                    }
                  });

                  // Apply any unsaved updates for this variant
                  Object.entries(inventoryUpdates).forEach(([key, update]) => {
                    const [updateVId, locId] = key.split(':');
                    if (updateVId === vId && editorLocations.some(l => l.id === locId)) {
                      inv[locId] = {
                        ...(inv[locId] || { quantity: 0 }),
                        ...update
                      };
                    }
                  });

                  variantMap.set(vId, {
                    id: vId,
                    name: Object.values(v.optionValues || {}).join(' / ') || 'Variant',
                    image: v.image,
                    defaultPrice: undefined,
                    inventory: inv
                  });
                });

                const editorVariants = Array.from(variantMap.values());

                console.log('[QUICK DETAIL] editorVariants:', editorVariants.length, 'variants');
                editorVariants.forEach(v => {
                  console.log(`  - ${v.name}: ${Object.keys(v.inventory).length} location(s)`);
                });

                // 3. Callback
                const handleUpdateInventory = (variantId: string, locationId: string, field: 'quantity' | 'price', value: number) => {
                  console.log(`[QUICK DETAIL] Update: ${variantId} @ ${locationId}, ${field} = ${value}`);
                  const key = `${variantId}:${locationId}`;
                  setInventoryUpdates(prev => ({
                    ...prev,
                    [key]: {
                      ...(prev[key] || {}),
                      [field]: value
                    }
                  }));
                };

                // If no variants or locations, show message
                if (editorVariants.length === 0) {
                  return <Text style={{ color: '#999', fontStyle: 'italic' }}>No variants found</Text>;
                }
                if (editorLocations.length === 0) {
                  return <Text style={{ color: '#999', fontStyle: 'italic' }}>No locations for {selectedPlatformFilter || 'this platform'}</Text>;
                }

                return (
                  <VariantInventoryEditor
                    variants={editorVariants}
                    locations={editorLocations}
                    activeTab={selectedPlatformFilter || 'all'}
                    isGenerationMode={false}
                    onUpdateInventory={handleUpdateInventory}
                  />
                );
              })()}
            </View>
          </View>
        </ScrollView>

        {/* Action Buttons */}
        <View style={styles.actionContainer}>
          <TouchableOpacity
            style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Icon name="content-save" size={20} color="#FFF" />
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.cancelButton, { borderColor: '#E5E5E5' }]}
            onPress={onClose}
            disabled={isSaving}
          >
            <Text style={[styles.cancelButtonText, { color: theme.colors.text }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View >
    </View >
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  modalSheet: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 1,
    elevation: 2,
    zIndex: 1000,
    paddingBottom: 40,
  },
  scrollContent: {
    paddingHorizontal: 0,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sheetHeaderSpacer: { minWidth: 72, minHeight: 34 },
  exitButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    minHeight: 34,
    maxHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F2F2F7',
    flexDirection: 'row',
    alignItems: 'center',
  },
  exitButtonText: { color: '#64748B', fontWeight: '600', marginLeft: 6, fontSize: 15 },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '500',
  },

  // Product Card (like InventoryListCard)
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    marginVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  imageContainer: {
    width: '25%',
    height: 110,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    paddingLeft: 8,
  },
  productImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  placeholderImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productInfoContainer: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  productTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  productPrice: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  productSku: {
    fontSize: 12,
    marginBottom: 8,
  },
  stockBadgeContainer: {
    marginTop: 8,
  },
  stockBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  stockText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Inventory Section
  viewDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  viewDetailsText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  inventorySection: {
    marginHorizontal: 12,
    marginBottom: 12,
    marginTop: 8,
    borderRadius: 12,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  locationSelectorContainer: {
    marginBottom: 16,
    gap: 8,
  },
  locationSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  locationSelectorText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  locationButtonsContainer: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  locationButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
  },
  locationButtonActive: {
    borderColor: BRAND_PRIMARY,
  },
  locationButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  locationButtonTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },

  // Variants
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 12,
  },
  variantThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
  },
  variantName: {
    fontSize: 13,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 20,
  },

  // Input Controls
  inputGroup: {
    alignItems: 'center',
    gap: 4,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  inputButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputValue: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    width: 40,
  },

  // Action Buttons
  actionContainer: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: BRAND_PRIMARY,
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default QuickProductDetailSheet;

