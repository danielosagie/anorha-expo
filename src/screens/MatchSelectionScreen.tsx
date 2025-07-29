import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, Dimensions, Animated } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { FlashList } from '@shopify/flash-list';
import { Analysis } from './AddProductScreen';


// Get screen dimensions for responsive grid
const { width: screenWidth } = Dimensions.get('window');
const GRID_PADDING = 16;
const ITEM_SPACING = 8;
const COLUMNS = 2;
const ITEM_WIDTH = (screenWidth - GRID_PADDING * 2 - ITEM_SPACING * (COLUMNS - 1)) / COLUMNS;

// Base URL for your SSSync API
const SSSYNC_API_BASE_URL = 'https://api.sssync.app';

// Type alias for a single product result from the main analysis
type ProductResult = Analysis['results'][0];
// Type alias for a single item from the nested serpApiData array
type SerpApiItem = ProductResult['serpApiData'][0];

// Enhanced SerpApiItem with selection state
interface SelectableSerpApiItem extends SerpApiItem {
  id: string;
  productId: string;
  isSelected?: boolean;
}

// ====================================================================
// Component #1: Pinterest/Google Lens Style Grid Item
// Beautiful card with image focus, selection states, and interactions
// ====================================================================
interface SerpGridItemProps {
  item: SelectableSerpApiItem;
  onPress: (item: SelectableSerpApiItem) => void;
  onLongPress: (item: SelectableSerpApiItem) => void;
  isSelectionMode: boolean;
}

const SerpGridItem: React.FC<SerpGridItemProps> = ({ 
  item, 
  onPress, 
  onLongPress, 
  isSelectionMode 
}) => {
  const [scaleAnim] = useState(new Animated.Value(1));
  const [imageLoaded, setImageLoaded] = useState(false);
  
  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  const getCardHeight = () => {
    // Pinterest-style varying heights based on content
    const baseHeight = 180;
    const titleLines = Math.ceil((item.title?.length || 0) / 25);
    return baseHeight + (titleLines * 15);
  };

  return (
    <Animated.View 
      style={[
        styles.gridItem, 
        { 
          width: ITEM_WIDTH,
          height: getCardHeight(),
          transform: [{ scale: scaleAnim }] 
        }
      ]}
    >
      <TouchableOpacity
        style={[
          styles.gridItemTouchable,
          item.isSelected && styles.selectedCard,
          isSelectionMode && styles.selectionModeCard
        ]}
        onPress={() => onPress(item)}
        onLongPress={() => onLongPress(item)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.9}
      >
        {/* Selection Indicator */}
        {isSelectionMode && (
          <View style={styles.selectionIndicator}>
            <View style={[
              styles.selectionCircle,
              item.isSelected && styles.selectedCircle
            ]}>
              {item.isSelected && (
                <Text style={styles.checkmark}>✓</Text>
              )}
            </View>
          </View>
        )}

        {/* Main Image */}
        <View style={styles.imageContainer}>
          <Image 
            source={{ uri: item.thumbnail || item.image || 'https://placehold.co/200x200/e0e0e0/999999?text=No+Image' }} 
            style={styles.gridImage}
            onLoad={() => setImageLoaded(true)}
            resizeMode="cover"
          />
          
          {/* Price Overlay */}
          {item.price?.value && (
            <View style={styles.priceOverlay}>
              <Text style={styles.priceText}>{item.price.value}</Text>
            </View>
          )}

          {/* Source Badge */}
          <View style={styles.sourceBadge}>
            <Text style={styles.sourceText} numberOfLines={1}>
              {item.source || 'Unknown'}
            </Text>
          </View>
        </View>

        {/* Content Area */}
        <View style={styles.contentArea}>
          <Text style={styles.gridTitle} numberOfLines={3}>
            {item.title || 'No Title Available'}
          </Text>
          
          {/* Rating & Reviews */}
          {(item.rating || item.reviews) && (
            <View style={styles.ratingContainer}>
              {item.rating && (
                <View style={styles.ratingBadge}>
                  <Text style={styles.ratingText}>★ {item.rating}</Text>
                </View>
              )}
              {item.reviews && (
                <Text style={styles.reviewsText}>({item.reviews})</Text>
              )}
            </View>
          )}

          {/* Stock Status */}
          {item.in_stock !== undefined && (
            <View style={[
              styles.stockBadge,
              item.in_stock ? styles.inStock : styles.outOfStock
            ]}>
              <Text style={[
                styles.stockText,
                item.in_stock ? styles.inStockText : styles.outOfStockText
              ]}>
                {item.in_stock ? 'In Stock' : 'Out of Stock'}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// ====================================================================
// Component #2: Enhanced Product Group with Grid Layout
// ====================================================================
interface ProductGroupProps {
  product: ProductResult;
  onItemPress: (item: SelectableSerpApiItem) => void;
  onItemLongPress: (item: SelectableSerpApiItem) => void;
  isSelectionMode: boolean;
  selectedItems: Set<string>;
}

const ProductGroup: React.FC<ProductGroupProps> = ({ 
  product, 
  onItemPress, 
  onItemLongPress, 
  isSelectionMode,
  selectedItems 
}) => {
  // Transform serpApiData into selectable items
  const gridData: SelectableSerpApiItem[] = product.serpApiData.map((item, index) => ({
    ...item,
    id: `${product.productId}-${index}`,
    productId: product.productId,
    isSelected: selectedItems.has(`${product.productId}-${index}`)
  }));

  const renderGridItem = ({ item }: { item: SelectableSerpApiItem }) => (
    <SerpGridItem
      item={item}
      onPress={onItemPress}
      onLongPress={onItemLongPress}
      isSelectionMode={isSelectionMode}
    />
  );

  return (
    <View style={styles.productGroupContainer}>
      {/* Product Header */}
      <View style={styles.productHeader}>
        <Image 
          source={{ uri: product.originalTargetImage || 'https://placehold.co/60x60' }} 
          style={styles.originalImage} 
        />
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Search Results</Text>
          <Text style={styles.headerSubtitle}>
            {gridData.length} matches • {product.confidence} confidence
          </Text>
        </View>
      </View>

      {/* Grid of Results */}
      <FlashList
        data={gridData}
        renderItem={renderGridItem}
        numColumns={COLUMNS}
        estimatedItemSize={220}
        contentContainerStyle={styles.gridContainer}
        ItemSeparatorComponent={() => <View style={{ height: ITEM_SPACING }} />}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

// ====================================================================
// Component #3: Main Screen with Selection Management
// ====================================================================
type MatchSelectionScreenProps = StackScreenProps<AppStackParamList, 'MatchSelectionScreen'>;

const MatchSelectionScreen: React.FC<MatchSelectionScreenProps> = ({ route, navigation }) => {
  const { analysis } = route.params || {};
  console.log('[MATCH SELECTION] Initial analysis:', analysis);

  // Selection state management
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  
  // Fresh data state
  const [displayAnalysis, setDisplayAnalysis] = useState<Analysis | null>(analysis || null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  async function getAuthHeaders(): Promise<Record<string, string>> {
    try {
      const { supabase } = await import('../../lib/supabase');
      const { data: { session } } = await supabase.auth.getSession();
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
      
      return headers;
    } catch (error) {
      console.error('[MATCH SELECTION] Auth error:', error);
      return {
        'Content-Type': 'application/json',
      };
    }
  }

  async function pollJobStatus(jobId: string): Promise<Analysis> {
    console.log('[MATCH SELECTION] Checking for completed job results, jobId:', jobId);
    const headers = await getAuthHeaders();
    
    const maxAttempts = 6; // 1 minute max (10-second intervals)
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      try {
        console.log(`[MATCH SELECTION] Attempt ${attempts + 1}/${maxAttempts} - Checking database for completed analysis`);
        
        // Query database directly for completed analysis (your data is already saved)
        const dbResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/analysis`, {
          method: 'GET',
          headers,
        });
        
        if (dbResponse.ok) {
          const dbResults = await dbResponse.json();
          console.log('[MATCH SELECTION] Database query results count:', dbResults?.length || 0);
          
          // Find analysis with matching job ID in the results
          const matchingAnalysis = dbResults.find((analysis: any) => {
            const hasJobIdInMetadata = analysis.Metadata?.jobId === jobId;
            const hasJobIdInText = analysis.GeneratedText?.includes(jobId);
            return hasJobIdInMetadata || hasJobIdInText;
          });
          
          if (matchingAnalysis) {
            console.log('[MATCH SELECTION] Found matching analysis:', matchingAnalysis.Id);
            
            if (matchingAnalysis.GeneratedText) {
              try {
                const parsedAnalysis = JSON.parse(matchingAnalysis.GeneratedText);
                console.log('[MATCH SELECTION] Parsed analysis - results count:', parsedAnalysis.results?.length || 0);
                
                // Check if the analysis has actual results (not just job metadata)
                if (parsedAnalysis.results && parsedAnalysis.results.length > 0) {
                  // Check if results have serpApiData (the actual product matches)
                  const hasProductData = parsedAnalysis.results.some((result: any) => 
                    result.serpApiData && result.serpApiData.length > 0
                  );
                  
                  if (hasProductData) {
                    console.log('[MATCH SELECTION] ✅ Found completed analysis with product data!');
                    return parsedAnalysis;
                  } else {
                    console.log('[MATCH SELECTION] Found analysis but no product data yet, waiting...');
                  }
                } else {
                  console.log('[MATCH SELECTION] Found analysis but no results yet, waiting...');
                }
              } catch (parseError) {
                console.error('[MATCH SELECTION] Failed to parse analysis GeneratedText:', parseError);
              }
            } else {
              console.log('[MATCH SELECTION] Found analysis but no GeneratedText yet, waiting...');
            }
          } else {
            console.log('[MATCH SELECTION] No matching analysis found yet, waiting...');
          }
        } else {
          console.error('[MATCH SELECTION] Database query failed:', dbResponse.status, dbResponse.statusText);
        }
        
        if (attempts < maxAttempts - 1) {
          console.log('[MATCH SELECTION] Waiting 10 seconds before next check...');
          await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        }
        attempts++;
        
      } catch (error) {
        console.error(`[MATCH SELECTION] Polling attempt ${attempts + 1} failed:`, error);
        attempts++;
        
        if (attempts >= maxAttempts) {
          throw new Error(`Failed to find completed job results after ${maxAttempts} attempts: ${error}`);
        }
        
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 10000)); // Wait before retry
        }
      }
    }
    
    throw new Error(`Job results not found within ${maxAttempts * 10} seconds. The job may still be processing.`);
  }

  // Fetch fresh data function (extracted for reuse)
  const fetchFreshData = async () => {
    const jobId = analysis?.jobId;
    if (!jobId) {
      console.log('[MATCH SELECTION] No jobId provided, using initial analysis');
      setCanRetry(false);
      return;
    }

    // If we already have results in the initial analysis, don't refetch
    if (analysis?.results && analysis.results.length > 0) {
      console.log('[MATCH SELECTION] Using initial analysis with', analysis.results.length, 'results');
      setDisplayAnalysis(analysis);
      setCanRetry(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setCanRetry(false);
    
    try {
      const freshData = await pollJobStatus(jobId);
      console.log('[MATCH SELECTION] Successfully fetched fresh data:', freshData);
      setDisplayAnalysis(freshData);
      setCanRetry(false);
    } catch (err) {
      console.error('[MATCH SELECTION] Error fetching fresh data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch results');
      setCanRetry(true); // Enable retry button
      // Keep using initial analysis if fresh fetch fails
      console.log('[MATCH SELECTION] Falling back to initial analysis');
      setDisplayAnalysis(analysis);
    } finally {
      setIsLoading(false);
    }
  };

  // Manual retry function for the retry button
  const handleRetry = () => {
    console.log('[MATCH SELECTION] Manual retry triggered');
    fetchFreshData();
  };

  // Fetch fresh data when component mounts or jobId changes
  useEffect(() => {
    fetchFreshData();
  }, [analysis?.jobId]);

  useEffect(() => {
    console.log('[MatchSelectionScreen] Received analysis data with results:', displayAnalysis?.results?.length || 0);
  }, [displayAnalysis]);

  // Handle item press (normal tap)
  const handleItemPress = (item: SelectableSerpApiItem) => {
    if (isSelectionMode) {
      toggleItemSelection(item.id);
    } else {
      // Navigate to product detail or open link
      console.log('Opening item:', item.title, item.link);
      // You can add navigation or link opening logic here
    }
  };

  // Handle item long press (enters selection mode)
  const handleItemLongPress = (item: SelectableSerpApiItem) => {
    if (!isSelectionMode) {
      setIsSelectionMode(true);
      setSelectedItems(new Set([item.id]));
    } else {
      toggleItemSelection(item.id);
    }
  };

  // Toggle item selection
  const toggleItemSelection = (itemId: string) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      
      // Exit selection mode if no items selected
      if (newSet.size === 0) {
        setIsSelectionMode(false);
      }
      
      return newSet;
    });
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedItems(new Set());
    setIsSelectionMode(false);
  };

  // Select all items
  const selectAll = () => {
    const allIds = new Set<string>();
    displayAnalysis?.results?.forEach(product => {
      product.serpApiData.forEach((_, index) => {
        allIds.add(`${product.productId}-${index}`);
      });
    });
    setSelectedItems(allIds);
  };

  const renderProductGroup = ({ item }: { item: ProductResult }) => (
    <ProductGroup
      product={item}
      onItemPress={handleItemPress}
      onItemLongPress={handleItemLongPress}
      isSelectionMode={isSelectionMode}
      selectedItems={selectedItems}
    />
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Product Matches</Text>
        {isSelectionMode && (
          <View style={styles.selectionHeader}>
            <Text style={styles.selectionCount}>
              {selectedItems.size} selected
            </Text>
            <View style={styles.selectionActions}>
              <TouchableOpacity style={styles.actionButton} onPress={selectAll}>
                <Text style={styles.actionButtonText}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={clearSelection}>
                <Text style={styles.actionButtonText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Main Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading fresh results...</Text>
          <Text style={styles.loadingSubtext}>
            This may take 1-2 minutes while we analyze your product...
          </Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error: {error}</Text>
          <Text style={styles.errorSubtext}>
            {displayAnalysis?.results?.length ? 
              'Using cached results below' : 
              'Unable to load results'
            }
          </Text>
          {canRetry && (
            <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
              <Text style={styles.retryButtonText}>🔄 Retry</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlashList
          data={displayAnalysis?.results}
          renderItem={renderProductGroup}
          estimatedItemSize={500}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No matches found</Text>
              <Text style={styles.emptySubtext}>
                {displayAnalysis?.jobId ? 
                  'The analysis completed but found no matches' : 
                  'Try adjusting your search or capture new photos'
                }
              </Text>
            </View>
          }
        />
      )}

      {/* Bottom Action Bar (when in selection mode) */}
      {isSelectionMode && selectedItems.size > 0 && (
        <View style={styles.bottomActionBar}>
          <TouchableOpacity style={styles.primaryAction}>
            <Text style={styles.primaryActionText}>
              Compare ({selectedItems.size})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryAction}>
            <Text style={styles.secondaryActionText}>Save</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

export default MatchSelectionScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    backgroundColor: 'white',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  selectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectionCount: {
    fontSize: 16,
    color: '#6b7280',
  },
  selectionActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f3f4f6',
    borderRadius: 16,
  },
  actionButtonText: {
    fontSize: 14,
    color: '#4b5563',
    fontWeight: '500',
  },

  // Product Group Styles
  productGroupContainer: {
    backgroundColor: 'white',
    marginHorizontal: 8,
    marginVertical: 6,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  productHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fafbfc',
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
  },
  originalImage: {
    width: 50,
    height: 50,
    borderRadius: 12,
    marginRight: 12,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
  gridContainer: {
    padding: ITEM_SPACING,
  },

  // Grid Item Styles
  gridItem: {
    marginHorizontal: ITEM_SPACING / 2,
  },
  gridItemTouchable: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e1e5e9',
  },
  selectedCard: {
    borderColor: '#3b82f6',
    borderWidth: 2,
    transform: [{ scale: 0.98 }],
  },
  selectionModeCard: {
    borderColor: '#d1d5db',
  },
  selectionIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
  },
  selectionCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderWidth: 2,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedCircle: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  checkmark: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },

  // Image Styles
  imageContainer: {
    position: 'relative',
    height: 120,
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  priceOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  priceText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  sourceBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    maxWidth: 80,
  },
  sourceText: {
    fontSize: 10,
    color: '#4b5563',
    fontWeight: '500',
  },

  // Content Styles
  contentArea: {
    padding: 8,
    flex: 1,
  },
  gridTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1a1a1a',
    lineHeight: 16,
    marginBottom: 6,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  ratingBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 4,
  },
  ratingText: {
    fontSize: 10,
    color: '#92400e',
    fontWeight: '500',
  },
  reviewsText: {
    fontSize: 10,
    color: '#6b7280',
  },
  stockBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  inStock: {
    backgroundColor: '#d1fae5',
  },
  outOfStock: {
    backgroundColor: '#fee2e2',
  },
  stockText: {
    fontSize: 9,
    fontWeight: '500',
  },
  inStockText: {
    color: '#065f46',
  },
  outOfStockText: {
    color: '#991b1b',
  },

  // Bottom Action Bar
  bottomActionBar: {
    flexDirection: 'row',
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: '#e1e5e9',
    gap: 12,
  },
  primaryAction: {
    flex: 1,
    backgroundColor: '#3b82f6',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryActionText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryAction: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryActionText: {
    color: '#4b5563',
    fontSize: 16,
    fontWeight: '500',
  },

  // Loading & Error States
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
    fontWeight: '500',
  },
  loadingSubtext: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 8,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#dc2626',
    fontWeight: '500',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorSubtext: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 16,
    alignSelf: 'center',
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },

  // Empty State
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '500',
    color: '#4b5563',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
});