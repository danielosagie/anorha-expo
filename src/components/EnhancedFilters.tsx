import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Switch } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Button from './Button';

export interface FilterOption {
  id: string;
  label: string;
  type: string;
  isSelected: boolean;
}

export interface PlatformFilter {
  id: string;
  name: string;
  type: string;
  isSelected: boolean;
  locations: LocationFilter[];
}

export interface LocationFilter {
  id: string;
  name: string;
  platformId: string;
  isSelected: boolean;
  isPOS: boolean;
}

interface EnhancedFiltersProps {
  platforms: PlatformFilter[];
  onFiltersChange: (platforms: PlatformFilter[]) => void;
  showLocationFilters?: boolean;
  title?: string;
}

const EnhancedFilters: React.FC<EnhancedFiltersProps> = ({
  platforms,
  onFiltersChange,
  showLocationFilters = true,
  title = 'Filters'
}) => {
  const theme = useTheme();
  const [isVisible, setIsVisible] = useState(false);
  const [localPlatforms, setLocalPlatforms] = useState<PlatformFilter[]>(platforms);

  useEffect(() => {
    setLocalPlatforms(platforms);
  }, [platforms]);

  const getSelectedCount = () => {
    const selectedPlatforms = localPlatforms.filter(p => p.isSelected).length;
    const selectedLocations = localPlatforms
      .flatMap(p => p.locations)
      .filter(l => l.isSelected).length;
    
    if (showLocationFilters) {
      return `${selectedPlatforms} platforms, ${selectedLocations} locations`;
    }
    return `${selectedPlatforms} platforms`;
  };

  const togglePlatform = (platformId: string) => {
    const updated = localPlatforms.map(platform => {
      if (platform.id === platformId) {
        const newSelected = !platform.isSelected;
        return {
          ...platform,
          isSelected: newSelected,
          locations: platform.locations.map(loc => ({
            ...loc,
            isSelected: newSelected
          }))
        };
      }
      return platform;
    });
    setLocalPlatforms(updated);
  };

  const toggleLocation = (platformId: string, locationId: string) => {
    const updated = localPlatforms.map(platform => {
      if (platform.id === platformId) {
        const updatedLocations = platform.locations.map(loc =>
          loc.id === locationId ? { ...loc, isSelected: !loc.isSelected } : loc
        );
        
        // Update platform selection based on location selections
        const hasSelectedLocations = updatedLocations.some(loc => loc.isSelected);
        
        return {
          ...platform,
          isSelected: hasSelectedLocations,
          locations: updatedLocations
        };
      }
      return platform;
    });
    setLocalPlatforms(updated);
  };

  const selectAllPlatforms = () => {
    const updated = localPlatforms.map(platform => ({
      ...platform,
      isSelected: true,
      locations: platform.locations.map(loc => ({ ...loc, isSelected: true }))
    }));
    setLocalPlatforms(updated);
  };

  const deselectAllPlatforms = () => {
    const updated = localPlatforms.map(platform => ({
      ...platform,
      isSelected: false,
      locations: platform.locations.map(loc => ({ ...loc, isSelected: false }))
    }));
    setLocalPlatforms(updated);
  };

  const selectAllLocationsForPlatform = (platformId: string) => {
    const updated = localPlatforms.map(platform => {
      if (platform.id === platformId) {
        return {
          ...platform,
          isSelected: true,
          locations: platform.locations.map(loc => ({ ...loc, isSelected: true }))
        };
      }
      return platform;
    });
    setLocalPlatforms(updated);
  };

  const deselectAllLocationsForPlatform = (platformId: string) => {
    const updated = localPlatforms.map(platform => {
      if (platform.id === platformId) {
        return {
          ...platform,
          isSelected: false,
          locations: platform.locations.map(loc => ({ ...loc, isSelected: false }))
        };
      }
      return platform;
    });
    setLocalPlatforms(updated);
  };

  const applyFilters = () => {
    onFiltersChange(localPlatforms);
    setIsVisible(false);
  };

  const resetFilters = () => {
    selectAllPlatforms();
  };

  const getPlatformIcon = (platformType: string) => {
    switch (platformType.toLowerCase()) {
      case 'shopify':
        return 'shopping';
      case 'square':
        return 'square';
      case 'clover':
        return 'leaf';
      case 'ebay':
        return 'earth';
      default:
        return 'store';
    }
  };

  const getPlatformColor = (platformType: string) => {
    switch (platformType.toLowerCase()) {
      case 'shopify':
        return '#95BF47';
      case 'square':
        return '#3E4348';
      case 'clover':
        return '#3FA838';
      case 'ebay':
        return '#E53238';
      default:
        return theme.colors.primary;
    }
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.filterButton, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
        onPress={() => setIsVisible(true)}
      >
        <Icon name="filter" size={20} color={theme.colors.primary} />
        <Text style={[styles.filterButtonText, { color: theme.colors.text }]}>
          {title}
        </Text>
        <Text style={[styles.filterCount, { color: theme.colors.textSecondary }]}>
          {getSelectedCount()}
        </Text>
        <Icon name="chevron-down" size={16} color={theme.colors.textSecondary} />
      </TouchableOpacity>

      <Modal
        visible={isVisible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={[styles.modalContainer, { backgroundColor: theme.colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: theme.colors.border }]}>
            <TouchableOpacity onPress={() => setIsVisible(false)}>
              <Icon name="close" size={24} color={theme.colors.text} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{title}</Text>
            <TouchableOpacity onPress={applyFilters}>
              <Text style={[styles.applyButton, { color: theme.colors.primary }]}>Apply</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            {/* Quick Actions */}
            <View style={styles.quickActions}>
              <Button
                title="Select All"
                icon="check-all"
                onPress={selectAllPlatforms}
                outlined
                style={styles.quickActionButton}
              />
              <Button
                title="Deselect All"
                icon="close-box-multiple"
                onPress={deselectAllPlatforms}
                outlined
                style={styles.quickActionButton}
              />
              <Button
                title="Reset"
                icon="refresh"
                onPress={resetFilters}
                outlined
                style={styles.quickActionButton}
              />
            </View>

            {/* Platform Filters */}
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Platforms</Text>
            
            {localPlatforms.map(platform => (
              <View key={platform.id} style={[styles.platformSection, { borderColor: theme.colors.border }]}>
                <TouchableOpacity
                  style={styles.platformHeader}
                  onPress={() => togglePlatform(platform.id)}
                >
                  <View style={styles.platformInfo}>
                    <Icon
                      name={getPlatformIcon(platform.type)}
                      size={24}
                      color={getPlatformColor(platform.type)}
                    />
                    <Text style={[styles.platformName, { color: theme.colors.text }]}>
                      {platform.name}
                    </Text>
                    <Text style={[styles.platformType, { color: theme.colors.textSecondary }]}>
                      {platform.type}
                    </Text>
                  </View>
                  <View style={styles.platformControls}>
                    <Text style={[styles.locationCount, { color: theme.colors.textSecondary }]}>
                      {platform.locations.filter(l => l.isSelected).length}/{platform.locations.length}
                    </Text>
                    <Icon
                      name={platform.isSelected ? "checkbox-marked" : "checkbox-blank-outline"}
                      size={24}
                      color={platform.isSelected ? theme.colors.primary : theme.colors.textSecondary}
                    />
                  </View>
                </TouchableOpacity>

                {/* Location Filters */}
                {showLocationFilters && platform.locations.length > 0 && (
                  <View style={styles.locationsContainer}>
                    <View style={styles.locationActions}>
                      <TouchableOpacity
                        onPress={() => selectAllLocationsForPlatform(platform.id)}
                        style={styles.locationAction}
                      >
                        <Text style={[styles.locationActionText, { color: theme.colors.primary }]}>
                          Select All
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => deselectAllLocationsForPlatform(platform.id)}
                        style={styles.locationAction}
                      >
                        <Text style={[styles.locationActionText, { color: theme.colors.primary }]}>
                          Deselect All
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {platform.locations.map(location => (
                      <TouchableOpacity
                        key={location.id}
                        style={styles.locationItem}
                        onPress={() => toggleLocation(platform.id, location.id)}
                      >
                        <View style={styles.locationInfo}>
                          <Icon
                            name={location.isPOS ? "point-of-sale" : "web"}
                            size={16}
                            color={theme.colors.textSecondary}
                          />
                          <Text style={[styles.locationName, { color: theme.colors.text }]}>
                            {location.name}
                          </Text>
                          {location.isPOS && (
                            <Text style={[styles.posTag, { backgroundColor: theme.colors.primary }]}>
                              POS
                            </Text>
                          )}
                        </View>
                        <Icon
                          name={location.isSelected ? "checkbox-marked" : "checkbox-blank-outline"}
                          size={20}
                          color={location.isSelected ? theme.colors.primary : theme.colors.textSecondary}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}

            {/* Summary */}
            <View style={[styles.summary, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Text style={[styles.summaryTitle, { color: theme.colors.text }]}>Filter Summary</Text>
              <Text style={[styles.summaryText, { color: theme.colors.textSecondary }]}>
                {getSelectedCount()} selected
              </Text>
              <Text style={[styles.summaryDescription, { color: theme.colors.textSecondary }]}>
                Products and orders will be filtered to show only data from selected platforms and locations.
              </Text>
            </View>
          </ScrollView>

          <View style={[styles.modalFooter, { borderTopColor: theme.colors.border }]}>
            <Button
              title="Cancel"
              onPress={() => setIsVisible(false)}
              outlined
              style={styles.footerButton}
            />
            <Button
              title="Apply Filters"
              onPress={applyFilters}
              style={styles.footerButton}
            />
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginVertical: 8,
  },
  filterButtonText: {
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 8,
    flex: 1,
  },
  filterCount: {
    fontSize: 12,
    marginRight: 8,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 60,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  applyButton: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  quickActions: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 8,
  },
  quickActionButton: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    marginTop: 8,
  },
  platformSection: {
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  platformHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  platformName: {
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 12,
  },
  platformType: {
    fontSize: 12,
    marginLeft: 8,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  platformControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationCount: {
    fontSize: 12,
    marginRight: 8,
  },
  locationsContainer: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 8,
  },
  locationActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  locationAction: {
    padding: 4,
  },
  locationActionText: {
    fontSize: 12,
    fontWeight: '500',
  },
  locationItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  locationName: {
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  posTag: {
    fontSize: 10,
    color: 'white',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: '600',
    marginLeft: 8,
  },
  summary: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 16,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  summaryText: {
    fontSize: 14,
    marginBottom: 8,
  },
  summaryDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    gap: 12,
  },
  footerButton: {
    flex: 1,
  },
});

export default EnhancedFilters; 