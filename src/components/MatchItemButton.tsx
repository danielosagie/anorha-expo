import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Linking, Animated } from 'react-native';
import { Analysis } from '../screens/AddProductScreen';


// Enhanced SerpApiItem with selection state
interface SelectableSerpApiItem extends SerpApiItem {
    id: string;
    productId: string;
  isSelected?: boolean;
}

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