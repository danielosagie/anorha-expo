import React from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import ShadowSurface from './ui/ShadowSurface';
import PlatformLogo from './PlatformLogo';

interface PlatformFilterChipsProps {
  platforms: Array<{
    name: string;
    type: string;
    connectionCount?: number;
  }>;
  selectedPlatform: string | null;
  onSelectPlatform: (platformType: string | null) => void;
  activeColor?: string;
}

const PlatformFilterChips: React.FC<PlatformFilterChipsProps> = ({
  platforms,
  selectedPlatform,
  onSelectPlatform,
  activeColor,
}) => {
  const theme = useTheme();
  const activeHighlightColor = activeColor || theme.colors.primary;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.platformFiltersContainer}
        contentContainerStyle={styles.platformFiltersContent}
      >
        {/* All Filter - Always available */}
        <ShadowSurface shadow="xs" radius={20} style={styles.platformFilterChipShadow} innerStyle={styles.platformFilterChipInner}>
          <TouchableOpacity
            style={[
              styles.platformFilterChip,
              !selectedPlatform && {
                backgroundColor: activeHighlightColor,
                borderColor: activeHighlightColor,
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
        </ShadowSurface>

        {/* Dynamic Platform Filters */}
        {platforms.map((platform) => {
          const isSelected = selectedPlatform?.toLowerCase() === platform.type.toLowerCase();
          const displayName = platform.name.charAt(0).toUpperCase() + platform.name.slice(1);

          return (
            <ShadowSurface
              key={platform.type}
              shadow="xs"
              radius={20}
              style={styles.platformFilterChipShadow}
              innerStyle={styles.platformFilterChipInner}
            >
              <TouchableOpacity
                style={[
                  styles.platformFilterChip,
                  {
                    opacity: 1,
                    borderColor: '#E0E0E0',
                  },
                  isSelected && {
                    backgroundColor: activeHighlightColor,
                    borderColor: activeHighlightColor,
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
                  <PlatformLogo
                    type={platform.type}
                    size={16}
                    color={isSelected ? '#FFFFFF' : theme.colors.text}
                    style={styles.platformIcon}
                  />
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
                        isSelected && { backgroundColor: 'rgba(255,255,255,0.2)' },
                      ]}
                    >
                      <Text
                        style={[
                          styles.connectionCountText,
                          isSelected && { color: '#FFFFFF' },
                        ]}
                      >
                        {platform.connectionCount}
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            </ShadowSurface>
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
  platformFilterChipShadow: {
    marginRight: 8,
  },
  platformFilterChipInner: {
    borderRadius: 20,
  },
  platformFilterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
  },
  platformIcon: {
    marginRight: 6,
  },
  platformFilterChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333333',
    lineHeight: 18,
    includeFontPadding: false,
    textAlignVertical: 'center',
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
    lineHeight: 12,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});

export default PlatformFilterChips;
