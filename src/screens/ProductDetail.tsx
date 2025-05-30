import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  ProductVariant,
  PlatformProductMapping,
  InventoryLevel,
  getLegendStateObservables
} from '../utils/SupaLegend';
import { observer } from '@legendapp/state/react';

// Define navigation prop types (basic example, adjust as needed)
interface ProductDetailNavigationProps {
  goBack: () => void;
  // Add other navigation methods if used
}

// Define route prop types
interface ProductDetailRouteProps {
  params: {
    item?: ProductVariant; // Use the ProductVariant type for item
    productId?: string; // Allow passing productId directly
  };
}

const ProductDetailScreen = observer(
  ({ route, navigation }: { route: ProductDetailRouteProps; navigation: ProductDetailNavigationProps }) => {
    const theme = useTheme();
    const passedItem = route.params?.item;
    const productId = route.params?.productId || passedItem?.Id;

    // State for the detailed product variant
    const [detailedItem, setDetailedItem] = useState<ProductVariant | undefined | null>(passedItem);
    // State for related mappings and inventory levels
    const [mappings, setMappings] = useState<PlatformProductMapping[]>([]);
    const [levels, setLevels] = useState<InventoryLevel[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(!passedItem);

    useEffect(() => {
      if (!productId) {
        console.error('No Product ID found');
        setIsLoading(false);
        setDetailedItem(null);
        return;
      }

      const observables = getLegendStateObservables();
      if (!observables || !observables.productVariants$ || !observables.platformProductMappings$ || !observables.inventoryLevels$) {
        console.error("[ProductDetailScreen] Legend-State observables not available.");
        setIsLoading(false);
        setDetailedItem(null);
        return;
      }
      const { productVariants$, platformProductMappings$, inventoryLevels$ } = observables;

      const itemData = productVariants$[productId].get();
      if (itemData) {
        setDetailedItem(itemData);
        setIsLoading(false);
      } else if (!passedItem) {
        // If not found and not passed, it might still be loading or not exist
        // Legend-State handles fetching, so we just reflect loading state
        setIsLoading(true); 
        // A timeout or a check on syncState could be used for more robust loading/error handling
        const timeoutId = setTimeout(() => { // Fallback if item doesn't appear quickly
            if(!productVariants$[productId].get()) {
                console.warn(`Product with ID ${productId} not found after timeout.`);
                setDetailedItem(null); // Not found
                setIsLoading(false);
            }
        }, 3000);
        return () => clearTimeout(timeoutId); // Cleanup timeout
      }

      // Fetch and subscribe to related mappings
      const allMappingsData = platformProductMappings$.get() || {}; // .get() is safe now due to above check
      const allMappingsArray = Object.values(allMappingsData) as PlatformProductMapping[];
      setMappings(allMappingsArray.filter((m: PlatformProductMapping) => m.ProductVariantId === productId));

      // Fetch and subscribe to related inventory levels
      const allLevelsData = inventoryLevels$.get() || {}; // .get() is safe now
      const allLevelsArray = Object.values(allLevelsData) as InventoryLevel[];
      setLevels(allLevelsArray.filter((l: InventoryLevel) => l.ProductVariantId === productId));

      // Legend-State will keep these up-to-date, no need for explicit unsubscribe/resubscribe in useEffect
      // unless dependencies of the query itself change (which they don't here based on productId).

    }, [productId, passedItem]); // Rerun if productId changes

    const handleEdit = () => {
      console.log('Edit Listing for:', detailedItem?.Id);
      // TODO: Navigate to EditProductScreen or toggle inline edit mode
    };

    const handleAnalytics = () => {
      console.log('View Analytics for:', detailedItem?.Id);
      // TODO: Navigate to AnalyticsScreen for this product
    };
    
    const handleDelistPlatform = (mappingId: string) => {
      console.log('Delist from platform, mappingId:', mappingId);
      // TODO: Call updatePlatformMapping(mappingId, { IsEnabled: false });
      // Optionally, refresh local state or rely on Legend-State real-time updates.
    };

    const handleDeleteProduct = () => {
        if (detailedItem?.Id) {
            console.log('Attempting to delete product:', detailedItem.Id);
            // TODO: Call archiveProductVariant(detailedItem.Id) for soft delete
            // or deleteProductVariant(detailedItem.Id) for hard delete.
            // Consider adding a confirmation modal here.
            // navigation.goBack(); // Navigate back after deletion
        }
    };

    if (isLoading) {
      return (
        <View style={[styles.container, styles.centered, {backgroundColor: theme.colors.background}]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={{ marginTop: 10, color: theme.colors.text }}>Loading product details...</Text>
        </View>
      );
    }

    if (!detailedItem) {
      return (
        <View style={[styles.container, styles.centered, {backgroundColor: theme.colors.background}]}>
          <Icon name="alert-circle-outline" size={48} color={theme.colors.error} />
          <Text style={[styles.errorText, {color: theme.colors.text}]}>Product not found.</Text>
          <Button title="Go Back" onPress={() => navigation.goBack()} />
        </View>
      );
    }

    return (
      <View style={[styles.outerContainer, { backgroundColor: theme.colors.background }]}>
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerIconContainer}>
              <Icon name="arrow-left" size={24} color={theme.colors.text} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Product Details</Text>
            <TouchableOpacity style={styles.headerIconContainer} onPress={() => console.log('Open menu')}> 
              <Icon name="dots-vertical" size={24} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.productImageContainer}>
            <Image 
              source={{ uri: detailedItem.image || 'https://via.placeholder.com/400' }} 
              style={styles.productImage} 
              resizeMode="cover" 
            />
          </View>
          
          <View style={[styles.productInfo, {backgroundColor: theme.colors.surface}]}>
            <Text style={[styles.productTitle, {color: theme.colors.text}]}>{detailedItem.Title}</Text>
            <Text style={[styles.productPrice, {color: theme.colors.primary}]}>${detailedItem.Price?.toFixed(2)}</Text>
            
            {detailedItem.Description && (
              <Text style={[styles.detailText, styles.description, {color: theme.colors.textSecondary}]}>{detailedItem.Description}</Text>
            )}
            
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, {color: theme.colors.textSecondary}]}>SKU:</Text>
              <Text style={[styles.detailValue, {color: theme.colors.text}]}>{detailedItem.Sku || 'N/A'}</Text>
            </View>
            
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, {color: theme.colors.textSecondary}]}>Barcode:</Text>
              <Text style={[styles.detailValue, {color: theme.colors.text}]}>{detailedItem.Barcode || 'N/A'}</Text>
            </View>

            {detailedItem.Weight !== null && detailedItem.Weight !== undefined && (
                <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, {color: theme.colors.textSecondary}]}>Weight:</Text>
                    <Text style={[styles.detailValue, {color: theme.colors.text}]}>
                        {detailedItem.Weight} {detailedItem.WeightUnit || ''}
                    </Text>
                </View>
            )}

            {/* TODO: Display Options (item.Options is jsonb) */}
            {/* <Text style={styles.sectionTitle}>Options</Text> */}
            {/* Display options here */}

            <View style={styles.actionButtons}>
              <Button 
                title="Edit Listing" 
                icon="pencil" 
                outlined 
                style={{ flex: 1, marginRight: 8 }} 
                onPress={handleEdit}
              />
              <Button 
                title="View Analytics" 
                icon="chart-line" 
                style={{ flex: 1, marginLeft: 8 }} 
                onPress={handleAnalytics}
              />
            </View>
          </View>

          {/* Listing Locations Section */}
          <View style={[styles.section, {backgroundColor: theme.colors.surface}]}>
            <Text style={[styles.sectionTitle, {color: theme.colors.text}]}>Listing Locations</Text>
            {mappings.length === 0 && (
              <Text style={[styles.detailText, {color: theme.colors.textSecondary}]}>Not listed on any platforms yet.</Text>
            )}
            {mappings.map((mapping: PlatformProductMapping) => {
              const platformLevels = levels.filter((l: InventoryLevel) => l.PlatformConnectionId === mapping.PlatformConnectionId);
              // TODO: Fetch PlatformConnection display name for better UI
              const platformDisplayName = mapping.PlatformConnectionId.substring(0,8) + '...'; // Placeholder

              return (
                <View key={mapping.Id} style={[styles.listItem, {borderBottomColor: theme.colors.textSecondary /* Use a theme border color */}]}>
                  <View style={styles.listItemContent}>
                    <Text style={[styles.platformName, {color: theme.colors.text}]}>Platform: {platformDisplayName}</Text>
                    <Text style={[styles.detailTextSM, {color: theme.colors.textSecondary}]}>Platform Product ID: {mapping.PlatformProductId}</Text>
                    <Text style={[styles.detailTextSM, {color: theme.colors.textSecondary}]}>Status: {mapping.SyncStatus} {mapping.IsEnabled ? '(Enabled)' : '(Disabled)'}</Text>
                    {platformLevels.map((level: InventoryLevel) => (
                       <Text key={level.Id} style={[styles.detailTextSM, {color: theme.colors.textSecondary}]}>
                         Location {level.PlatformLocationId || 'Default'}: {level.Quantity} units
                       </Text>
                    ))}
                    {platformLevels.length === 0 &&  <Text style={[styles.detailTextSM, {color: theme.colors.textSecondary}]}>No specific inventory levels found for this platform listing.</Text>}
                  </View>
                  <Button 
                    title={mapping.IsEnabled ? "Delist" : "Relist"} 
                    onPress={() => handleDelistPlatform(mapping.Id)} 
                    outlined 
                    style={mapping.IsEnabled ? styles.delistButton : styles.relistButton}
                    // textStyle={mapping.IsEnabled ? {color: theme.colors.error} : {color: theme.colors.success}} // If your button supports textStyle
                  />
                </View>
              );
            })}
            <Button title="Cross-list to New Platform" icon="plus-circle-outline" style={{marginTop: 10}} onPress={() => console.log('Cross-list to new platform button pressed')} />
          </View>

          {/* Danger Zone Section */}
          <View style={[styles.section, styles.dangerZone, {backgroundColor: theme.colors.surface, borderColor: theme.colors.error}]}>
            <Text style={[styles.sectionTitle, {color: theme.colors.error}]}>Danger Zone</Text>
            <Button 
              title="Delete Product Permanently" 
              icon="delete-forever" 
              onPress={handleDeleteProduct} 
              outlined 
              style={{borderColor: theme.colors.error}} // Keeping this style for the button itself
              // textStyle={{color: theme.colors.error}} // If your button supports textStyle
            />
          </View>

        </ScrollView>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
  },
  scrollContainer: {
    paddingBottom: 30, // Ensure scroll content doesn't hide behind potential tab bar
  },
  container: { // For loading/error states centered content
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  centered: { // Re-usable style for centering content
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 60, // Added to account for status bar if not handled by navigator
  },
  headerIconContainer: {
    padding: 8, // Add padding for easier touch
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  productImageContainer: {
    width: '100%',
    height: 300,
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  productInfo: {
    padding: 20, // Increased padding
    margin: 12,
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  productTitle: {
    fontSize: 26, // Increased size
    fontWeight: 'bold',
    marginBottom: 8,
  },
  productPrice: {
    fontSize: 24, // Increased size
    fontWeight: 'bold',
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0', // Light separator, consider theme.colors.border
  },
  detailLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 15,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  platformText: {
    fontSize: 16,
    marginLeft: 8,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
    marginTop: 8,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 20,
  },
  section: {
    marginTop: 16,
    padding: 16,
    marginHorizontal: 12,
    borderRadius: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  listItemContent: {
    flex: 1,
    marginRight: 10,
  },
  platformName: {
    fontSize: 16,
    fontWeight: '500',
  },
  detailText: {
    fontSize: 14,
    marginBottom: 4,
  },
  detailTextSM: { // Smaller detail text for platform info
    fontSize: 12,
    marginBottom: 2,
  },
  dangerZone: {
    borderColor: '#D9534F',
    borderWidth: 1,
    marginTop: 20,
  },
  errorText: {
      fontSize: 16,
      textAlign: 'center',
      marginTop: 8,
      marginBottom: 16,
  },
  delistButton: { 
    borderColor: 'orange', 
    // Add other styling for delist (warning) button
  },
  relistButton: { // Style for relist button
    borderColor: 'green', // Example: Green border for relist (success indication)
    // Add other styling for relist button
  }
});

export default ProductDetailScreen; 