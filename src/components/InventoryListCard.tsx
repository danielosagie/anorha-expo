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

/*
  Why are platform avatars not showing anymore after refreshing?
  It's likely that after refresh (hot reload/fast refresh/expo refresh), the SVG imports
  such as ShopifySvg, AmazonSvg, etc., are being invalidated or not re-imported correctly.

  PlatformAvatar uses dynamic .svg imports and selects the component
  at runtime. If there is a metro bundler cache or hot reload issue, those
  icon component references may be missing or stale.

  - Ensure the SVG files are correctly imported.
  - Ensure any remote data source for `platformNames` is not returning unexpected values.
  - If you see the `store` icon fallback, it means `getPlatformIcon` is returning null.
  - A common cause is inconsistent or unexpected string casing/whitespace or platformName value in your platformNames array.

  QUICK DIAGNOSTIC:
  - Try console.log(platformNames) right here.
  - Confirm `platformNames` is non-empty and strings match those expected by PlatformAvatar.
  - Try lowercasing your platform strings explicitly before passing to PlatformAvatar for safety.
*/

interface InventoryListCardProps {
  id: string;
  title: string;
  price?: number;
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

  return (
    <TouchableOpacity
      style={styles.cardContainer}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
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
              size={100}
              borderRadius={8}
              type="gradient"
              icon="cube"
              color={getRandomColor(id)}
            />
          )}
        </View>

        {/* Right side - Product Info */}
        <View style={styles.infoContainer}>
          <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={2}>
            {title}
          </Text>

          <Text style={[styles.price, { color: theme.colors.textSecondary }]}>
            ${price?.toFixed(2) ?? '0.00'}
          </Text>

          {sku && (
            <Text style={[styles.sku, { color: theme.colors.textSecondary }]}>
              SKU: {sku}
            </Text>
          )}

          {/* Stock and Platform Avatars */}
          <View style={styles.bottomRow}>

            {/* Platform Avatars */}
            <View style={styles.platformAvatars}>
              <View style={{ marginLeft: 6, flexDirection: 'row', alignItems: 'center' }}>
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

            <View
              style={[
                styles.stockBadge,
                { backgroundColor: '#FFF' },
              ]}
            >
              <Text
                style={[
                  styles.stockText,
                  { color: "#000" },
                ]}
              >
                {totalQuantity ?? 0} in stock
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
  },
  card: {
    flexDirection: 'row',
    alignItems: "center",
    borderRadius: 12,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  imageContainer: {
    paddingLeft: 8,
    width: "25%",
    height: 110,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    borderRadius: 12,
    alignItems: 'center',
  },
  productImage: {
    borderRadius: 12,
    width: "100%",
    height: "100%",
  },
  infoContainer: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  price: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  sku: {
    fontSize: 12,
    marginBottom: 8,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stockBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  stockText: {
    fontSize: 12,
    fontWeight: '600',
  },
  platformAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrapper: {
    marginLeft: -8,
  },
});

export default InventoryListCard;
