import React from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';

interface PlatformFilterChipsProps {
  platforms: Array<{
    name: string;
    type: string;
    connectionCount?: number;
  }>;
  selectedPlatform: string | null;
  onSelectPlatform: (platformType: string | null) => void;
}

const getPlatformIcon = (platformType: string) => {
  const type = platformType.toLowerCase();
  if (type.includes('shopify')) return ShopifySvg;
  if (type.includes('square')) return SquareSvg;
  if (type.includes('clover')) return CloverSvg;
  if (type.includes('amazon')) return AmazonSvg;
  if (type.includes('ebay')) return EbaySvg;
  if (type.includes('facebook')) return FacebookSvg;
  return null; // Return null for unknown platforms
};

const PlatformFilterChips: React.FC<PlatformFilterChipsProps> = ({
  platforms,
  selectedPlatform,
  onSelectPlatform,
}) => {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.platformFiltersContainer}
        contentContainerStyle={styles.platformFiltersContent}
      >
        {/* All Filter - Always available */}
        <TouchableOpacity
          style={[
            styles.platformFilterChip,
            !selectedPlatform && {
              backgroundColor: theme.colors.primary,
              borderColor: theme.colors.primary,
            },
          ]}
          onPress={() => onSelectPlatform(null)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.platformFilterChipText,
              !selectedPlatform && {
                color: '#FFFFFF',
                fontWeight: '600',
              },
            ]}
          >
            All
          </Text>
        </TouchableOpacity>

        {/* Dynamic Platform Filters */}
        {platforms.map((platform) => {
          const isSelected = selectedPlatform?.toLowerCase() === platform.type.toLowerCase();
          const displayName = platform.name.charAt(0).toUpperCase() + platform.name.slice(1);

          return (
            <TouchableOpacity
              key={platform.type}
              style={[
                styles.platformFilterChip,
                {
                  opacity: 1,
                  borderColor: '#E0E0E0',
                },
                isSelected && {
                  backgroundColor: theme.colors.primary,
                  borderColor: theme.colors.primary,
                },
              ]}
              onPress={() => {
                if (isSelected) {
                  onSelectPlatform(null);
                } else {
                  onSelectPlatform(displayName);
                }
              }}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {(() => {
                  const IconComponent = getPlatformIcon(platform.type);
                  return IconComponent ? (
                    <IconComponent
                      width={16}
                      height={16}
                      fill={isSelected ? '#FFFFFF' : theme.colors.text}
                      style={styles.platformIcon}
                    />
                  ) : (
                    <Icon
                      name="store"
                      size={16}
                      color={isSelected ? '#FFFFFF' : theme.colors.text}
                      style={styles.platformIcon}
                    />
                  );
                })()}
                <Text
                  style={[
                    styles.platformFilterChipText,
                    {
                      color: isSelected ? '#FFFFFF' : theme.colors.text,
                    },
                    isSelected && {
                      fontWeight: '600',
                    },
                  ]}
                >
                  {displayName}
                </Text>
                {platform.connectionCount && platform.connectionCount > 1 && (
                  <View
                    style={[
                      styles.connectionCountBadge,
                      isSelected && { backgroundColor: '#FFFFFF' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.connectionCountText,
                        isSelected && { color: theme.colors.primary },
                      ]}
                    >
                      {platform.connectionCount}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 12,
    marginLeft: 8,
  },
  platformFiltersContainer: {
    marginBottom: 0,
  },
  platformFiltersContent: {
    paddingHorizontal: 8,
  },
  platformFilterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  platformIcon: {
    marginRight: 6,
  },
  platformFilterChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333333',
  },
  connectionCountBadge: {
    backgroundColor: '#F0F0F0',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  connectionCountText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#555555',
  },
});

export default PlatformFilterChips;
