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
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';

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
}

const QuickProductDetailSheet: React.FC<QuickProductDetailSheetProps> = ({
  product,
  onClose,
  onSave,
}) => {
  const theme = useTheme();
  const [locations, setLocations] = useState<LocationInventory[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [variants, setVariants] = useState<VariantInventory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [inventoryUpdates, setInventoryUpdates] = useState<Record<string, { quantity: number; price?: number }>>({});

  // Load variant and location data
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        
        // For now, assume product has variants with inventoryByLocation already populated
        // In future: fetch from backend if needed
        if (product.variants) {
          setVariants(product.variants);
        }
        
        // Extract unique locations from all variants
        const locationsMap = new Map<string, LocationInventory>();
        if (product.variants) {
          product.variants.forEach((variant: any) => {
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
        }
        
        const locationsList = Array.from(locationsMap.values());
        setLocations(locationsList);
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
    <ScrollView 
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header with close button */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Icon name="close" size={28} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Update Product</Text>
        <View style={{ width: 28 }} />
      </View>

      {/* Product Card (like InventoryListCard) */}
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

      {/* Inventory Section */}
      <View style={[styles.inventorySection, { backgroundColor: theme.colors.surface, marginHorizontal: 16, marginTop: 16, borderRadius: 12, padding: 16 }]}>
        <View style={{ marginBottom: 12 }}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Inventory</Text>
          
          {/* Location Selector */}
          {locations.length > 0 && (
            <View style={styles.locationSelectorContainer}>
              <View style={[styles.locationSelector, { borderColor: theme.colors.border }]}>
                <Icon name="map-marker" size={18} color="#999" />
                <Text style={[styles.locationSelectorText, { color: theme.colors.text }]}>
                  {locations.find(l => l.id === selectedLocationId)?.name || 'Select Location'}
                </Text>
              </View>
              
              {locations.length > 1 && (
                <View style={styles.locationButtonsContainer}>
                  {locations.map(location => (
                    <TouchableOpacity
                      key={location.id}
                      onPress={() => setSelectedLocationId(location.id)}
                      style={[
                        styles.locationButton,
                        selectedLocationId === location.id && [styles.locationButtonActive, { backgroundColor: '#93C822' }],
                        { borderColor: theme.colors.border },
                      ]}
                    >
                      <Text style={[
                        styles.locationButtonText,
                        selectedLocationId === location.id && styles.locationButtonTextActive,
                        { color: selectedLocationId === location.id ? '#FFF' : theme.colors.text },
                      ]}>
                        {location.name.slice(0, 12)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>

        {/* Variants with Quantity/Price inputs */}
        <View style={{ gap: 12 }}>
          {variants.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
              No variants available
            </Text>
          ) : (
            variants.map((variant, idx) => {
              const variantName = Object.values(variant.optionValues || {}).join(' / ') || `Variant ${idx + 1}`;
              const locData = variant.inventoryByLocation?.[selectedLocationId] || { quantity: 0 };
              const currentQty = inventoryUpdates[variant.id]?.quantity !== undefined 
                ? inventoryUpdates[variant.id]?.quantity
                : locData.quantity || 0;
              const currentPrice = inventoryUpdates[variant.id]?.price !== undefined
                ? inventoryUpdates[variant.id]?.price
                : locData.price;

              return (
                <View key={variant.id} style={[styles.variantRow, { borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
                  {/* Variant name and image */}
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {variant.image ? (
                      <Image source={{ uri: variant.image }} style={styles.variantThumbnail} />
                    ) : (
                      <View style={[styles.variantThumbnail, { backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center' }]}>
                        <Icon name="image-off" size={20} color="#CCC" />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.variantName, { color: theme.colors.text }]} numberOfLines={2}>
                        {variantName}
                      </Text>
                    </View>
                  </View>

                  {/* Quantity and Price inputs */}
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Qty</Text>
                      <TouchableOpacity
                        onPress={() => handleQuantityChange(variant.id, Math.max(0, currentQty - 1))}
                        style={[styles.inputButton, { borderColor: theme.colors.border }]}
                      >
                        <Icon name="minus" size={16} color={theme.colors.text} />
                      </TouchableOpacity>
                      <Text style={[styles.inputValue, { color: theme.colors.text }]}>
                        {currentQty}
                      </Text>
                      <TouchableOpacity
                        onPress={() => handleQuantityChange(variant.id, currentQty + 1)}
                        style={[styles.inputButton, { borderColor: theme.colors.border }]}
                      >
                        <Icon name="plus" size={16} color={theme.colors.text} />
                      </TouchableOpacity>
                    </View>

                    {currentPrice !== undefined && (
                      <View style={styles.inputGroup}>
                        <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Price</Text>
                        <TouchableOpacity
                          onPress={() => handlePriceChange(variant.id, Math.max(0, (currentPrice || 0) - 1))}
                          style={[styles.inputButton, { borderColor: theme.colors.border }]}
                        >
                          <Icon name="minus" size={16} color={theme.colors.text} />
                        </TouchableOpacity>
                        <Text style={[styles.inputValue, { color: theme.colors.text }]}>
                          ${(currentPrice || 0).toFixed(2)}
                        </Text>
                        <TouchableOpacity
                          onPress={() => handlePriceChange(variant.id, (currentPrice || 0) + 1)}
                          style={[styles.inputButton, { borderColor: theme.colors.border }]}
                        >
                          <Icon name="plus" size={16} color={theme.colors.text} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>
      </View>

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
          style={[styles.cancelButton, { borderColor: theme.colors.border }]}
          onPress={onClose}
          disabled={isSaving}
        >
          <Text style={[styles.cancelButtonText, { color: theme.colors.text }]}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
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
    marginHorizontal: 16,
    marginBottom: 12,
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
  inventorySection: {
    marginBottom: 16,
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
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 8,
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

