import React from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
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
  ActivityEventCard - Matches Figma design
*/

interface ActivityEventCardProps {
  id: string;
  title: string;
  displayTitle: string; // e.g., "Inventory Adjustment", "Order #1001"
  sku?: string;
  imageUrl?: string;
  timestamp: string;
  reasonText?: string; // e.g., "Reason: -5 Units (Damaged)"
  price?: number;
  ownerLabel?: string; // e.g. "Shopify" (used for platform logic if ownerImageUrl not present)
  ownerImageUrl?: string; // User avatar URL
  eventType?: string;
  onPress: () => void;
  /** Show Undo button and call this when tapped (for reversible events) */
  canUndo?: boolean;
  onUndo?: () => void;
  undone?: boolean;
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
  canUndo,
  onUndo,
  undone,
}) => {
  const theme = useTheme();

  const formatTime = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <TouchableOpacity
      style={styles.cardContainer}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        {/* Left side - Product Image */}
        <View style={styles.imageContainer}>
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.productImage}
              resizeMode="cover"
            />
          ) : (
            <PlaceholderImage
              size={80}
              borderRadius={12}
              type="gradient"
              icon="package-variant"
              color={BRAND_PRIMARY}
            />
          )}
          
          {/* Overlay: Avatar OR Platform Icon (Top Right) */}
          <View style={styles.overlayContainer}>
            {ownerImageUrl ? (
              <Image
                source={{ uri: ownerImageUrl }}
                style={styles.overlayImage}
              />
            ) : (
              // Use PlatformAvatar if no user image, fallback to generic
              <View style={styles.overlayPlatform}>
                 <PlatformAvatar 
                    platformType={ownerLabel || 'system'} 
                    size="medium" 
                 />
              </View>
            )}
          </View>
        </View>

        {/* Right side - Event Info */}
        <View style={styles.infoContainer}>
          {/* Header Row: Title + Time/Price */}
          <View style={styles.headerRow}>
            <Text style={[styles.displayTitle, { color: theme.colors.text }]}>
              {displayTitle}
            </Text>
            <View style={styles.headerRight}>
               {price !== undefined && price > 0 && (
                 <Text style={[styles.headerPrice, { color: theme.colors.text }]}>
                   ${price.toFixed(2)}
                 </Text>
               )}
               {price !== undefined && price > 0 && <Text style={styles.headerDot}>•</Text>}
               <Text style={[styles.headerTime, { color: theme.colors.text }]}>
                 {formatTime(timestamp)}
               </Text>
            </View>
          </View>
          {(undone || (canUndo && onUndo)) && (
            <View style={styles.undoRow}>
              {undone && (
                <Text style={[styles.undoneLabel, { color: theme.colors.textSecondary }]}>Undone</Text>
              )}
              {canUndo && onUndo && !undone && (
                <TouchableOpacity style={styles.undoButton} onPress={onUndo} activeOpacity={0.7}>
                  <Icon name="undo" size={16} color="#647653" />
                  <Text style={styles.undoButtonText}>Undo</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Product Title */}
          <Text style={[styles.productTitle, { color: '#6B7280' }]} numberOfLines={1}>
            {title}
          </Text>

          {/* SKU */}
          {sku && (
            <Text style={[styles.sku, { color: '#9CA3AF' }]}>
              SKU: {sku}
            </Text>
          )}

          {/* Reason Pill */}
          {reasonText && (
            <View style={styles.reasonPill}>
              <Text style={styles.reasonText} numberOfLines={1}>
                {reasonText}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    gap: 12,
    borderRadius: 12,
    marginHorizontal: 12,
    marginTop: 12,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    borderRadius: 12,
  },
  imageContainer: {
    width: 80,
    height: 100,
    marginRight: 12,
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
  },
  productImage: {
    width: 80,
    height: 100,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
  },
  overlayContainer: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 10,
  },
  overlayImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2.5,
    borderColor: '#fff',
  },
  overlayPlatform: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#fff',
    overflow: 'hidden',
  },
  infoContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingRight: 0,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  displayTitle: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
    color: '#111',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  headerPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
  },
  headerDot: {
    marginHorizontal: 4,
    color: '#9CA3AF',
    fontSize: 10,
  },
  headerTime: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
  },
  undoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 2,
  },
  undoneLabel: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  undoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  undoButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#647653',
  },
  productTitle: {
    fontSize: 13,
    marginBottom: 2,
    color: '#6B7280',
    lineHeight: 18,
  },
  sku: {
    fontSize: 12,
    marginBottom: 6,
    color: '#9CA3AF',
  },
  reasonPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reasonText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
  },
});

export default ActivityEventCard;
