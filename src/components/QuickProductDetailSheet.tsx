import React, { useState, useEffect } from 'react';
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
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface LocationInventory {
  id: string;
  name: string;
  quantity: number;
  price?: number;
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
  platformLocations?: { id: string; name: string }[];
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
          
          // If this variant has no options, treat it as a single variant
          if (!baseVariant.Options || Object.keys(baseVariant.Options).length === 0) {
            loadedVariants = [{
              id: baseVariant.Id,
              name: baseVariant.Title || 'Default',
              optionValues: {},
              inventoryByLocation,
              image: product.images?.[0]?.ImageUrl,
            }];
          } else {
            // This variant has options - try to fetch all variants for this product
            try {
              const { data: allVariants } = await supabase
                .from('ProductVariants')
                .select('*')
                .eq('ProductId', baseVariant.ProductId);
              
              // Also fetch inventory for all variants
              const variantIds = (allVariants || []).map((v: any) => v.Id);
              const { data: allInventory } = await supabase
                .from('InventoryLevels')
                .select('*')
                .in('ProductVariantId', variantIds);
              
              // Transform all variants with their inventory
              loadedVariants = (allVariants || [])
                .filter((v: any) => v.Options && Object.keys(v.Options).length > 0)
                .map((v: any) => {
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
                  
                  return {
                    id: v.Id,
                    name: Object.values(v.Options || {}).join(' / ') || v.Title,
                    optionValues: v.Options || {},
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
          }));
        } else {
          // Extract unique locations from all variants (fallback)
          const locationsMap = new Map<string, LocationInventory>();
          loadedVariants.forEach((variant) => {
            Object.entries(variant.inventoryByLocation || {}).forEach(([locId, locData]: [string, any]) => {
              if (locId !== 'default' && locId !== 'loc-default' && !locationsMap.has(locId)) {
                locationsMap.set(locId, {
                  id: locId,
                  name: locData.name || locId.slice(0, 20),
                  quantity: locData.quantity || 0,
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

  const handleQuantityChange = (variantId: string, quantity: number) => {
    setInventoryUpdates(prev => ({
      ...prev,
      [variantId]: { ...prev[variantId], quantity },
    }));
  };

  const handlePriceChange = (variantId: string, price: number) => {
    setInventoryUpdates(prev => ({
      ...prev,
      [variantId]: { ...prev[variantId], price },
    }));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      
      // Prepare updates array
      const updates = Object.entries(inventoryUpdates).map(([variantId, data]) => ({
        variantId,
        location: selectedLocationId,
        quantity: data.quantity || 0,
        price: data.price,
      }));

      if (updates.length === 0) {
        Alert.alert('No Changes', 'Update at least one variant quantity');
        setIsSaving(false);
        return;
      }

      await onSave(updates);
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
          <ActivityIndicator size="large" color="#93C822" />
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
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={28} color={theme.colors.text} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Update Product</Text>
            <View style={{ width: 28 }} />
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
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#FACC15', marginRight: 8 }} />
                    <Text style={{ fontWeight: '600', color: '#000', marginRight: 4, maxWidth: 150 }} numberOfLines={1}>
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
                      width: 200,
                      zIndex: 1000,
                    }}>
                      {locations.map(loc => (
                        <TouchableOpacity
                          key={loc.id}
                          style={{
                            paddingVertical: 12,
                            paddingHorizontal: 16,
                            borderBottomWidth: 1,
                            borderBottomColor: '#F0F0F0',
                            backgroundColor: selectedLocationId === loc.id ? '#F9F9F9' : '#FFF',
                          }}
                          onPress={() => {
                            setSelectedLocationId(loc.id);
                            setShowLocationPicker(false);
                          }}
                        >
                          <Text style={{
                            fontWeight: selectedLocationId === loc.id ? '600' : '400',
                            color: '#000',
                          }}>
                            {loc.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Variants List */}
            <View style={{ gap: 12, zIndex: 1 }}>
              {variants.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  No variants available
                </Text>
              ) : (
                variants.map((variant) => {
                  const variantName = Object.values(variant.optionValues || {}).join(' / ') || 'Variant';

                  // Get values for selected location
                  const currentQty = inventoryUpdates[variant.id]?.quantity !== undefined
                    ? inventoryUpdates[variant.id]?.quantity
                    : (variant.inventoryByLocation?.[selectedLocationId]?.quantity ?? 0);

                  const currentPrice = inventoryUpdates[variant.id]?.price !== undefined
                    ? inventoryUpdates[variant.id]?.price
                    : (variant.inventoryByLocation?.[selectedLocationId]?.price ?? 0);

                  return (
                    <View key={variant.id} style={{
                      padding: 12,
                      borderWidth: 1,
                      borderColor: '#E5E5E5',
                      borderRadius: 12,
                      backgroundColor: '#FFF',
                    }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <View style={{ flex: 1, marginRight: 12 }}>
                          {/* Variant Name Badge */}
                          <View style={{
                            alignSelf: 'flex-start',
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderWidth: 1,
                            borderColor: '#E5E5E5',
                            borderRadius: 8,
                            marginBottom: 16,
                          }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={{ fontWeight: '600', color: '#000', fontSize: 13 }}>{variantName}</Text>
                              <Icon name="chevron-down" size={14} color="#666" style={{ marginLeft: 4 }} />
                            </View>
                          </View>

                          {/* Inputs */}
                          <View style={{ gap: 12 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={{ width: 70, fontSize: 13, fontWeight: '500', color: '#000' }}>Quantity:</Text>
                              <TextInput
                                style={{
                                  flex: 1,
                                  height: 40,
                                  paddingHorizontal: 12,
                                  borderWidth: 1,
                                  borderColor: '#E5E5E5',
                                  borderRadius: 8,
                                  textAlign: 'center',
                                  fontWeight: '600',
                                  color: '#000',
                                  backgroundColor: '#FFF',
                                }}
                                value={String(currentQty)}
                                onChangeText={(text) => {
                                  const qty = parseInt(text, 10);
                                  if (!isNaN(qty)) {
                                    setInventoryUpdates(prev => ({
                                      ...prev,
                                      [variant.id]: { ...prev[variant.id], quantity: qty },
                                    }));
                                  } else if (text === '') {
                                     setInventoryUpdates(prev => ({
                                      ...prev,
                                      [variant.id]: { ...prev[variant.id], quantity: 0 },
                                    }));
                                  }
                                }}
                                keyboardType="number-pad"
                                placeholder="0"
                              />
                            </View>

                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={{ width: 70, fontSize: 13, fontWeight: '500', color: '#000' }}>Price:</Text>
                              <TextInput
                                style={{
                                  flex: 1,
                                  height: 40,
                                  paddingHorizontal: 12,
                                  borderWidth: 1,
                                  borderColor: '#E5E5E5',
                                  borderRadius: 8,
                                  textAlign: 'center',
                                  fontWeight: '600',
                                  color: '#000',
                                  backgroundColor: '#FFF',
                                }}
                                value={String(currentPrice)} // Simplify to allow editing
                                onChangeText={(text) => {
                                  const price = parseFloat(text);
                                  if (!isNaN(price)) {
                                    setInventoryUpdates(prev => ({
                                      ...prev,
                                      [variant.id]: { ...prev[variant.id], price },
                                    }));
                                  }
                                }}
                                keyboardType="decimal-pad"
                                placeholder="0.00"
                              />
                            </View>
                          </View>
                        </View>

                        {/* Image Slot */}
                        <View>
                          {variant.image ? (
                            <Image
                              source={{ uri: variant.image }}
                              style={{ width: 100, height: 100, borderRadius: 8, backgroundColor: '#F0F0F0' }}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={{
                              width: 100,
                              height: 100,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: '#E5E5E5',
                              borderStyle: 'dashed',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: '#FAFAFA'
                            }}>
                              <Icon name="plus" size={24} color="#CCC" />
                            </View>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
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
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'flex-start',
    
  },

  modalSheet: {
    width: '100%',
    minHeight: '100%',
    borderRadius: 16,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 1,
    elevation: 2,
    zIndex: 1000,
    paddingBottom: 80,
  },
  scrollContent: {
    paddingHorizontal: 0,
  },
  container: {
    flex: 1,
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  closeButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
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
    borderColor: '#93C822',
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
    backgroundColor: '#93C822',
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

