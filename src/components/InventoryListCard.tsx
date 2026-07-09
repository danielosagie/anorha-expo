import React, { memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  LayoutChangeEvent,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import PlaceholderImage from './PlaceholderImage';
import ShadowSurface from './ui/ShadowSurface';
import PlatformAvatar from './PlatformAvatar';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, { FadeInLeft, FadeOutLeft, Layout } from 'react-native-reanimated';

/*
  InventoryListCard - Matches "Needs Attention" design
*/

type MatchLocation = 'title' | 'description' | 'sku' | 'barcode' | 'tags';

interface InventoryListCardProps {
  id: string;
  title: string;
  price?: number;
  minPrice?: number;  // For price range display when variants have different prices
  maxPrice?: number;  // For price range display when variants have different prices
  sku?: string;
  imageUrl?: string;
  totalQuantity?: number;
  platformNames?: string[];
  lastSyncedAt?: string | null;
  isStale?: boolean;
  matchLocations?: MatchLocation[];
  matchSnippet?: string;
  searchQuery?: string;
  onPress: (id: string) => void;
  onLongPress?: (id: string) => void;
  onPressOut?: (id: string) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** Optional status pill (import review: "Linked", "Needs review" …). */
  statusLabel?: string;
  statusColor?: string;
  /** Hide the "Last synced" line (irrelevant for items being imported). */
  hideSync?: boolean;
}

const InventoryListCard: React.FC<InventoryListCardProps> = memo(({
  id,
  title,
  price,
  minPrice,
  maxPrice,
  sku,
  imageUrl,
  totalQuantity,
  platformNames = [],
  lastSyncedAt,
  isStale = false,
  matchLocations,
  matchSnippet,
  searchQuery,
  onPress,
  onLongPress,
  onPressOut,
  isSelectionMode,
  isSelected,
  onLayout,
  statusLabel,
  statusColor,
  hideSync,
}) => {
  const theme = useTheme();

  const getRandomColor = (seed: string | number): string => {
    const colors = ['#4B0082', '#1E90FF', '#32CD32', '#FF8C00', '#8A2BE2', '#20B2AA'];
    const numId = typeof seed === 'string'
      ? seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
      : seed;
    return colors[numId % colors.length];
  };

  // Robust: lowercase and trim all platform names for safety
  const normalizedPlatformNames = (platformNames || []).map(name =>
    typeof name === 'string' ? name.trim().toLowerCase() : ''
  );

  const isLowStock = (totalQuantity ?? 0) <= 5;
  const isOutOfStock = (totalQuantity ?? 0) === 0;

  // Format price display - show range if min and max are different
  const formatPriceDisplay = (): string => {
    // If minPrice and maxPrice are provided and different, show range
    if (minPrice !== undefined && maxPrice !== undefined && minPrice !== maxPrice) {
      return `$${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`;
    }
    // If only minPrice or maxPrice provided, use that
    if (minPrice !== undefined) {
      return `$${minPrice.toFixed(2)}`;
    }
    if (maxPrice !== undefined) {
      return `$${maxPrice.toFixed(2)}`;
    }
    // Fallback to single price prop
    return `$${price?.toFixed(2) ?? '0.00'}`;
  };

  // Get display label for match location
  const getMatchLabel = (location: MatchLocation): string => {
    switch (location) {
      case 'title': return 'Title';
      case 'description': return 'Description';
      case 'sku': return 'SKU';
      case 'barcode': return 'Barcode';
      case 'tags': return 'Tags';
      default: return location;
    }
  };

  // Highlight search term in snippet
  const highlightMatch = (text: string, query: string): React.ReactNode => {
    if (!query || !text) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, index) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <Text key={index} style={{ backgroundColor: '#FEF3C7', fontWeight: '700' }}>{part}</Text>
      ) : (
        <Text key={index}>{part}</Text>
      )
    );
  };

  return (
    <ShadowSurface shadow="sm" radius={20} style={styles.cardOuter} innerStyle={styles.cardSurface}>
      <TouchableOpacity
        style={[
          styles.cardContent,
          {
            backgroundColor: isSelected ? 'rgba(132, 204, 22, 0.1)' : 'rgba(228, 228, 228, 0.01)',
            borderColor: isSelected ? '#84CC16' : 'transparent',
            borderWidth: 1,
          },
        ]}
        onPress={() => onPress(id)}
        onLongPress={onLongPress ? () => onLongPress(id) : undefined}
        onPressOut={onPressOut ? () => onPressOut(id) : undefined}
        activeOpacity={0.7}
        delayLongPress={300}
        onLayout={onLayout}
        accessibilityRole="button"
        accessibilityLabel={`${title || 'Inventory item'}${isSelectionMode ? (isSelected ? ', selected' : ', not selected') : ''}`}
        accessibilityHint={isSelectionMode ? 'Toggles this item selection.' : 'Opens product details. Long press to select this item.'}
        accessibilityState={{ selected: !!isSelected }}
      >

        {/* Selection Indicator */}
        {isSelectionMode && (
          <Animated.View
            entering={FadeInLeft.duration(300)}
            exiting={FadeOutLeft.duration(300)}
            layout={Layout.springify()}
            style={styles.selectionIndicatorContainer}
          >
            <Icon
              name={isSelected ? "check-circle" : "circle-outline"}
              size={24}
              color={isSelected ? "#84CC16" : "#C7C7CC"}
            />
          </Animated.View>
        )}

        {/* Left side - Image */}
        <View style={styles.imageContainer}>
          {imageUrl && typeof imageUrl === 'string' && imageUrl.trim().length > 0 ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.productImage}
              resizeMode="cover"
            />
          ) : (
            <PlaceholderImage
              size={90}
              borderRadius={16}
              type="gradient"
              icon="cube"
              color={getRandomColor(id)}
              style={{ width: '100%', height: '100%', borderRadius: 16 }}
            />
          )}
        </View>

        {/* Right side - Product Info */}
        <View style={styles.infoContainer}>
          <View>
            <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={2}>
              {title}
            </Text>

            <Text style={[styles.price, { color: theme.colors.textSecondary }]}>
              {formatPriceDisplay()}
            </Text>

            {sku && (
              <Text style={[styles.sku, { color: theme.colors.textSecondary }]}>
                SKU: {sku}
              </Text>
            )}

            {!!statusLabel && (
              <View style={[styles.statusChip, { borderColor: `${statusColor || '#6B7280'}55`, backgroundColor: `${statusColor || '#6B7280'}14` }]}>
                <Text style={[styles.statusChipText, { color: statusColor || '#6B7280' }]} numberOfLines={1}>{statusLabel}</Text>
              </View>
            )}

            {!hideSync && isStale ? (
              <Text style={styles.syncText}>Needs sync</Text>
            ) : null}

            {/* Match chips - only show when there's a search query and matches */}
            {searchQuery && matchLocations && matchLocations.length > 0 && (
              <View style={styles.matchChipsContainer}>
                {matchLocations.map((location, index) => (
                  <View key={location} style={styles.matchChip}>
                    <Text style={styles.matchChipText}>{getMatchLabel(location)}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Match snippet */}
            {searchQuery && matchSnippet && (
              <Text style={styles.matchSnippet} numberOfLines={2}>
                {highlightMatch(matchSnippet, searchQuery)}
              </Text>
            )}
          </View>

          {/* Stock and Platform Avatars */}
          <View style={styles.bottomRow}>
            {/* Platform Avatars */}
            <View style={styles.platformAvatars}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {normalizedPlatformNames.map((platformName: string, index: number) => (
                  <View
                    key={`${platformName}-${index}`}
                    style={styles.avatarWrapper}
                  >
                    <PlatformAvatar
                      platformType={platformName}
                      size="small"
                    />
                  </View>
                ))}
              </View>
            </View>

            {/* Stock Badge — only when quantity is known. Sources that don't track
                stock (e.g. campaign items) pass totalQuantity undefined; we hide the
                badge rather than show a misleading "0 Units Left". */}
            {totalQuantity !== undefined ? (
              <View
                style={[
                  styles.stockBadge,
                  {
                    borderColor: isOutOfStock ? '#9CA3AF' : isLowStock ? '#EF4444' : '#E5E7EB',
                  },
                ]}
              >
                {isLowStock && !isOutOfStock && (
                  <Icon name="alert-outline" size={14} color="#EF4444" style={{ marginRight: 4 }} />
                )}
                {isOutOfStock && (
                  <Icon name="refresh" size={14} color="#6B7280" style={{ marginRight: 4 }} />
                )}
                <Text
                  style={[
                    styles.stockText,
                    { color: isOutOfStock ? '#6B7280' : isLowStock ? '#EF4444' : '#374151' },
                  ]}
                >
                  {totalQuantity ?? 0} Units Left
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    </ShadowSurface>
  );
});

const styles = StyleSheet.create({
  cardOuter: {
    marginBottom: 12,
    marginHorizontal: 8,
  },
  cardSurface: {
    backgroundColor: 'rgba(228, 228, 228, 0.07)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#9999995f',
  },
  cardContent: {
    flexDirection: 'row',
    padding: 12,
  },
  imageContainer: {
    width: "25%",
    height: 120,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    borderRadius: 16,
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  productImage: {
    borderRadius: 16,
    width: "100%",
    height: "100%",
  },
  infoContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
    lineHeight: 20,
  },
  price: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 2,
  },
  sku: {
    fontSize: 11,
    marginBottom: 8,
  },
  syncText: {
    fontSize: 10,
    color: '#BA7517',
    fontWeight: '700',
    marginTop: -4,
    marginBottom: 8,
  },
  statusChip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginTop: 2,
    marginBottom: 6,
  },
  statusChipText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.2 },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  stockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: '#FAFAFA',
  },
  stockText: {
    fontSize: 11,
    fontWeight: '600',
  },
  platformAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrapper: {
    marginLeft: -4,
    marginRight: -2,

  },
  selectionIndicatorContainer: {
    justifyContent: 'center',
    paddingRight: 12,
  },
  matchChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  matchChip: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  matchChipText: {
    fontSize: 10,
    color: '#1E40AF',
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  matchSnippet: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
    fontStyle: 'italic',
    lineHeight: 16,
  },
});

export default InventoryListCard;
