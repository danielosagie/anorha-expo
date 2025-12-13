/**
 * PlatformRow Component
 * 
 * Displays a single platform listing (Shopify, Square, etc.) for a product.
 * 
 * This is an example of a CLEAN component pattern:
 * - Receives props (data in)
 * - Renders UI (JSX out)
 * - Calls callback when user interacts (events up)
 * 
 * Usage:
 * ```tsx
 * <PlatformRow
 *   mapping={mapping}
 *   connection={connection}
 *   theme={theme}
 *   onDelist={(name) => handleDelist(name)}
 * />
 * ```
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { PlatformProductMapping, PlatformConnection } from '../utils/SupaLegend';

// Import platform logo helper (extract from ProductDetail.tsx)
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';

const platformSvgMap: Record<string, React.FC<any>> = {
  shopify: ShopifySvg,
  square: SquareSvg,
  clover: CloverSvg,
  amazon: AmazonSvg,
  ebay: EbaySvg,
  facebook: FacebookSvg,
};

function getPlatformLogoComponent(platformType?: string) {
  const type = (platformType || '').toLowerCase();
  const found = Object.entries(platformSvgMap).find(([key]) => type.includes(key));
  return found ? found[1] : null;
}

interface PlatformRowProps {
  mapping: PlatformProductMapping;
  connection: PlatformConnection;
  theme: {
    colors: {
      text: string;
      textSecondary?: string;
      error?: string;
    };
  };
  onDelist: (platformName: string) => void;
}

export function PlatformRow({ mapping, connection, theme, onDelist }: PlatformRowProps) {
  // ✅ Data transformation happens ONCE when component receives props
  const platformName = connection?.DisplayName || `${connection?.PlatformType || 'Unknown'} Account`;
  const platformType = connection?.PlatformType || 'unknown';
  const Logo = getPlatformLogoComponent(platformType);

  const handleDelistPress = () => {
    Alert.alert(
      'Delist Product',
      `Remove listing from ${platformName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delist',
          style: 'destructive',
          onPress: () => onDelist(platformName),
        },
      ]
    );
  };

  return (
    <View style={styles.platformRow}>
      <View style={styles.platformInfo}>
        <View style={styles.platformLogoContainer}>
          {Logo ? (
            <Logo width={18} height={18} />
          ) : (
            <Icon name="store" size={18} color={'#666'} />
          )}
        </View>
        <View style={styles.platformDetails}>
          <Text style={[styles.platformName, { color: theme.colors.text }]}>
            {platformName}
          </Text>
          <Text style={[styles.platformStatus, { color: theme.colors.text }]}>
            Status: {mapping.SyncStatus || 'Connected'}
          </Text>
        </View>
      </View>
      <TouchableOpacity style={styles.delistButton} onPress={handleDelistPress}>
        <Icon name="archive-outline" size={16} color={theme.colors.text} style={{ marginRight: 6 }} />
        <Text style={[styles.delistButtonText, { color: theme.colors.text }]}>
          Delist
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  platformRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  platformLogoContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformDetails: {
    marginLeft: 12,
    flex: 1,
  },
  platformName: {
    fontSize: 16,
    fontWeight: '500',
  },
  platformStatus: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  delistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#D0D5DD',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  delistButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});



