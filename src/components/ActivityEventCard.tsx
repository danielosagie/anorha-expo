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
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface ActivityEventCardProps {
  id: string;
  title: string;
  displayTitle: string; // e.g., "Inventory Adjustment", "Order #1001"
  sku?: string;
  imageUrl?: string;
  timestamp: string;
  reasonText?: string; // e.g., "Reason: -5 Units (Damaged)"
  price?: number;
  ownerLabel?: string; // "You", "Teammate", "Shopify", etc.
  ownerImageUrl?: string; // Avatar for the owner
  eventType?: string;
  onPress: () => void;
}

const ActivityEventCard: React.FC<ActivityEventCardProps> = ({
  id,
  title,
  displayTitle,
  sku,
  imageUrl,
  timestamp,
  reasonText,
  price,
  ownerLabel,
  ownerImageUrl,
  eventType,
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

  const getEventIcon = (type?: string): string => {
    if (type?.includes('ORDER')) return 'shopping-outline';
    if (type?.includes('INVENTORY')) return 'package-variant';
    if (type?.includes('PRICE')) return 'tag-outline';
    if (type?.includes('LISTING')) return 'store-outline';
    if (type?.includes('SYNC')) return 'sync';
    return 'information-outline';
  };

  const getEventColor = (type?: string): string => {
    if (type?.includes('ERROR') || type?.includes('FAILED')) return '#ef4444';
    if (type?.includes('ORDER')) return '#10b981';
    if (type?.includes('INVENTORY')) return '#3b82f6';
    if (type?.includes('PRICE')) return '#f59e0b';
    if (type?.includes('SYNC')) return '#8b5cf6';
    return '#6b7280';
  };

  const formatTime = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return timestamp;
    }
  };

  return (
    <TouchableOpacity
      style={styles.cardContainer}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        {/* Left side - Image + Event Icon Overlay */}
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
              icon={getEventIcon(eventType)}
              color={getEventColor(eventType)}
            />
          )}
          {/* Event icon overlay on bottom right of image */}
          <View
            style={[
              styles.eventIconOverlay,
              { backgroundColor: getEventColor(eventType) },
            ]}
          >
            <Icon
              name={getEventIcon(eventType)}
              size={16}
              color="white"
            />
          </View>
        </View>

        {/* Right side - Event Info */}
        <View style={styles.infoContainer}>
          {/* Top row: Display Title + Owner Avatar + Time */}
          <View style={styles.topRow}>
            <View style={styles.titleTimeWrapper}>
              <Text style={[styles.displayTitle, { color: theme.colors.text }]}>
                {displayTitle}
              </Text>
              <Text style={[styles.timestamp, { color: theme.colors.textSecondary }]}>
                {formatTime(timestamp)}
              </Text>
            </View>

            {/* Owner Avatar - Top Right */}
            <View style={styles.ownerAvatarWrapper}>
              {ownerImageUrl ? (
                <Image
                  source={{ uri: ownerImageUrl }}
                  style={styles.ownerAvatar}
                />
              ) : ownerLabel ? (
                <View
                  style={[
                    styles.ownerAvatarPlaceholder,
                    { backgroundColor: getRandomColor(ownerLabel) },
                  ]}
                >
                  <Text style={styles.ownerAvatarText}>
                    {ownerLabel.charAt(0).toUpperCase()}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Product Title and SKU */}
          <Text
            style={[styles.productTitle, { color: theme.colors.text }]}
            numberOfLines={2}
          >
            {title}
          </Text>

          {sku && (
            <Text style={[styles.sku, { color: theme.colors.textSecondary }]}>
              SKU: {sku}
            </Text>
          )}

          {/* Reason/Details Pill */}
          {reasonText && (
            <View style={[styles.reasonPill, { backgroundColor: theme.colors.background }]}>
              <Text style={[styles.reasonText, { color: theme.colors.textSecondary }]}>
                {reasonText}
              </Text>
            </View>
          )}

          {/* Bottom row: Price + Owner Label */}
          <View style={styles.bottomRow}>
            {price !== undefined && price > 0 && (
              <Text style={[styles.price, { color: theme.colors.textSecondary }]}>
                ${price.toFixed(2)}
              </Text>
            )}
            {ownerLabel && (
              <Text style={[styles.ownerLabel, { color: theme.colors.textSecondary }]}>
                {ownerLabel}
              </Text>
            )}
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
    alignItems: 'flex-start',
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
    width: '25%',
    height: 110,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    position: 'relative',
  },
  productImage: {
    borderRadius: 12,
    width: '100%',
    height: '100%',
  },
  eventIconOverlay: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  infoContainer: {
    flex: 1,
    padding: 12,
    justifyContent: 'flex-start',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  titleTimeWrapper: {
    flex: 1,
    marginRight: 8,
  },
  displayTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  timestamp: {
    fontSize: 12,
    fontWeight: '500',
  },
  ownerAvatarWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  ownerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  ownerAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  ownerAvatarText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
  productTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 3,
  },
  sku: {
    fontSize: 11,
    marginBottom: 6,
  },
  reasonPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  reasonText: {
    fontSize: 11,
    fontWeight: '500',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  price: {
    fontSize: 12,
    fontWeight: '600',
  },
  ownerLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
});

export default ActivityEventCard;

