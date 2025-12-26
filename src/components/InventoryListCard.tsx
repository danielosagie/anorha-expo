import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import PlaceholderImage from './PlaceholderImage';
import PlatformAvatar from './PlatformAvatar';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

/*
  InventoryListCard - Matches "Needs Attention" design
*/

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
  onPress: () => void;
}

const InventoryListCard: React.FC<InventoryListCardProps> = ({
  id,
  title,
  price,
  minPrice,
  maxPrice,
  sku,
  imageUrl,
  totalQuantity,
  platformNames = [],
  onPress,
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

  return (
    <TouchableOpacity
      style={styles.cardContainer}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.card, { backgroundColor: 'rgba(228, 228, 228, 0.01)', }]}>
        {/* Left side - Image */}
        <View style={styles.imageContainer}>
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.productImage}
              resizeMode="cover"
            />
          ) : (
            <PlaceholderImage
              size={90}
              height={120}
              borderRadius={8}
              type="gradient"
              icon="cube"
              color={getRandomColor(id)}
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

            {/* Stock Badge */}
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
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    marginBottom: 12,
    marginHorizontal: 8,
    backgroundColor: 'rgba(228, 228, 228, 0.07)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderRadius: 16,
  },
  card: {
    flexDirection: 'row',
    borderRadius: 16,
    overflow: 'hidden',
    padding: 12,
  },
  imageContainer: {
    width: "25%",
    height: 120,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    borderRadius: 12,
    alignItems: 'center',
    marginRight: 12,

  },
  productImage: {
    borderRadius: 12,
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
    borderRadius: 8,
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
});

export default InventoryListCard;
