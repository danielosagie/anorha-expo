import React, { useEffect, useState } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Platform,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { ensureSupabaseJwt } from '../lib/supabase';
import PlatformAvatar from './PlatformAvatar';

const API_BASE_URL = 'https://api.sssync.app';

interface LocationPool {
  id: string;
  name: string;
  description?: string;
}

interface PlatformLocation {
  Id: string;
  Name: string;
  IsPOS: boolean;
  PlatformConnectionId: string;
  PlatformConnections?: {
    PlatformType: string;
  };
}

interface PoolLocationComboboxProps {
  orgId: string;
  selectedItems: string[]; // location IDs
  onSelectionChange: (locationIds: string[]) => void;
  startOpen?: boolean;
}

interface PoolWithLocations {
  pool: LocationPool;
  locations: PlatformLocation[];
}

const PoolLocationCombobox: React.FC<PoolLocationComboboxProps> = ({
  orgId,
  selectedItems,
  onSelectionChange,
  startOpen = false,
}) => {
  const theme = useTheme();
  const [isDropdownOpen, setIsDropdownOpen] = useState(startOpen);
  const [pools, setPools] = useState<LocationPool[]>([]);
  const [poolsWithLocations, setPoolsWithLocations] = useState<PoolWithLocations[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>(selectedItems);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSelectedLocations(selectedItems);
  }, [selectedItems]);

  const loadPoolsWithLocations = async () => {
    try {
      setLoading(true);
      const token = await ensureSupabaseJwt();

      // Fetch all pools
      const poolsRes = await fetch(`${API_BASE_URL}/api/pools/org/${orgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!poolsRes.ok) throw new Error('Failed to fetch pools');
      const poolsData: LocationPool[] = await poolsRes.json();
      setPools(poolsData);

      // Fetch locations for each pool
      const poolLocations: PoolWithLocations[] = [];
      for (const pool of poolsData) {
        try {
          const locRes = await fetch(`${API_BASE_URL}/api/pools/${pool.id}/locations`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (locRes.ok) {
            const locData = await locRes.json();
            poolLocations.push({
              pool,
              locations: locData.locations || [],
            });
          }
        } catch (e) {
          console.error(`Error fetching locations for pool ${pool.id}:`, e);
        }
      }
      setPoolsWithLocations(poolLocations);
    } catch (error) {
      console.error('Error loading pools and locations:', error);
      Alert.alert('Error', 'Failed to load pools and locations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (startOpen && !isDropdownOpen) {
        setIsDropdownOpen(true);
        loadPoolsWithLocations();
    }
  }, [startOpen]);

  const handleOpenDropdown = () => {
    if (!isDropdownOpen) {
      loadPoolsWithLocations();
    }
    setIsDropdownOpen(!isDropdownOpen);
  };

  const toggleLocationSelection = (locationId: string) => {
    setSelectedLocations((prev) => {
      if (prev.includes(locationId)) {
        return prev.filter((id) => id !== locationId);
      } else {
        return [...prev, locationId];
      }
    });
  };

  const toggleAllLocationsInPool = (poolId: string) => {
    const pool = poolsWithLocations.find((p) => p.pool.id === poolId);
    if (!pool) return;

    const poolLocationIds = pool.locations.map((loc) => loc.Id);
    const allSelected = poolLocationIds.every((id) =>
      selectedLocations.includes(id)
    );

    if (allSelected) {
      setSelectedLocations((prev) =>
        prev.filter((id) => !poolLocationIds.includes(id))
      );
    } else {
      setSelectedLocations((prev) => {
        const newSelected = new Set(prev);
        poolLocationIds.forEach((id) => newSelected.add(id));
        return Array.from(newSelected);
      });
    }
  };

  const handleApplySelection = () => {
    onSelectionChange(selectedLocations);
    setIsDropdownOpen(false);
  };

  const getDisplayText = (): string => {
    if (selectedLocations.length === 0) {
      return 'All Locations';
    }

    // Count total locations
    const totalLocations = poolsWithLocations.reduce(
      (acc, p) => acc + p.locations.length,
      0
    );

    if (selectedLocations.length === totalLocations) {
      return 'All Locations';
    }

    if (selectedLocations.length === 1) {
      const location = poolsWithLocations
        .flatMap((p) => p.locations)
        .find((loc) => loc.Id === selectedLocations[0]);
      return location?.Name || 'All Locations';
    }

    return `${selectedLocations.length} of ${totalLocations} Locations`;
  };

  const filteredPools = poolsWithLocations.filter((p) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      p.pool.name.toLowerCase().includes(query) ||
      p.locations.some((loc) => loc.Name.toLowerCase().includes(query))
    );
  });

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.dropdownButton, { borderColor: theme.colors.textSecondary + '40' }]}
        onPress={handleOpenDropdown}
        activeOpacity={0.7}
      >
        <View style={styles.dropdownContent}>
          <Icon name="map-marker-outline" size={18} color={theme.colors.textSecondary} />
          <Text style={[styles.dropdownText, { color: theme.colors.text }]}>
            {getDisplayText()}
          </Text>
        </View>
        <Icon
          name={isDropdownOpen ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={theme.colors.textSecondary}
        />
      </TouchableOpacity>

      {/* Absolute Positioned Inline Dropdown */}
      {isDropdownOpen && (
        <View style={[styles.dropdownPanel, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.searchContainer}>
            <Icon name="magnify" size={18} color="#999" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search pools/locations..."
              placeholderTextColor="#999"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {loading ? (
            <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
              Loading...
            </Text>
          ) : (
            <ScrollView style={styles.locationListScrollView} scrollEnabled={true}>
              {filteredPools.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  No pools or locations found
                </Text>
              ) : (
                filteredPools.map((item) => (
                  <View key={item.pool.id}>
                    {/* Pool Header */}
                    <TouchableOpacity
                      style={styles.poolHeader}
                      onPress={() => toggleAllLocationsInPool(item.pool.id)}
                    >
                      <Icon
                        name={
                          item.locations.every((loc) =>
                            selectedLocations.includes(loc.Id)
                          )
                            ? 'checkbox-marked-outline'
                            : item.locations.some((loc) =>
                                selectedLocations.includes(loc.Id)
                              )
                            ? 'minus-box-outline'
                            : 'checkbox-blank-outline'
                        }
                        size={24}
                        color={
                          item.locations.some((loc) =>
                            selectedLocations.includes(loc.Id)
                          )
                            ? theme.colors.primary
                            : theme.colors.textSecondary
                        }
                        style={styles.checkboxIcon}
                      />
                      <Text style={[styles.poolNameText, { color: theme.colors.text }]}>
                        {item.pool.name}
                      </Text>
                    </TouchableOpacity>

                    {/* All Locations Option */}
                    <TouchableOpacity
                      style={styles.locationSelectItem}
                      onPress={() => {
                        const allLocationIds = item.locations.map((loc) => loc.Id);
                        setSelectedLocations((prev) => {
                          const allSelected = allLocationIds.every((id) =>
                            prev.includes(id)
                          );
                          if (allSelected) {
                            return prev.filter((id) => !allLocationIds.includes(id));
                          } else {
                            return [...prev, ...allLocationIds.filter((id) => !prev.includes(id))];
                          }
                        });
                      }}
                    >
                      <Icon
                        name={
                          item.locations.every((loc) =>
                            selectedLocations.includes(loc.Id)
                          )
                            ? 'checkbox-marked-outline'
                            : 'checkbox-blank-outline'
                        }
                        size={22}
                        color={
                          item.locations.some((loc) =>
                            selectedLocations.includes(loc.Id)
                          )
                            ? theme.colors.primary
                            : theme.colors.textSecondary
                        }
                        style={styles.checkboxIcon}
                      />
                      <Text
                        style={[
                          styles.locationNameText,
                          styles.allLocationText,
                          { color: theme.colors.text },
                        ]}
                      >
                        All Locations
                      </Text>
                    </TouchableOpacity>

                    {/* Individual Locations */}
                    {item.locations.map((location) => (
                      <TouchableOpacity
                        key={location.Id}
                        style={styles.locationSelectItem}
                        onPress={() => toggleLocationSelection(location.Id)}
                      >
                        <Icon
                          name={
                            selectedLocations.includes(location.Id)
                              ? 'checkbox-marked-outline'
                              : 'checkbox-blank-outline'
                          }
                          size={22}
                          color={
                            selectedLocations.includes(location.Id)
                              ? theme.colors.primary
                              : theme.colors.textSecondary
                          }
                          style={styles.checkboxIcon}
                        />
                        <View style={styles.locationInfo}>
                          <View style={styles.locationHeader}>
                            <Text style={[styles.locationNameText, { color: theme.colors.text }]}>
                              {location.Name}
                            </Text>
                            {location.IsPOS && (
                              <Text style={[styles.locationBadge, { color: theme.colors.primary }]}>
                                POS
                              </Text>
                            )}
                          </View>
                        </View>
                        {location.PlatformConnections && (
                          <PlatformAvatar
                            platformType={location.PlatformConnections.PlatformType}
                            size="small"
                          />
                        )}
                      </TouchableOpacity>
                    ))}

                    <View style={styles.poolDivider} />
                  </View>
                ))
              )}
            </ScrollView>
          )}

          <View style={styles.dropdownFooter}>
            <TouchableOpacity
              style={[styles.applyButton, { backgroundColor: theme.colors.primary }]}
              onPress={handleApplySelection}
            >
              <Text style={styles.applyButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  dropdownContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownText: {
    marginLeft: 8,
    fontSize: 15,
    fontWeight: '500',
  },
  dropdownPanel: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    maxHeight: 350,
    overflow: 'hidden',
    zIndex: 100,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
  },
  locationListScrollView: {
    maxHeight: 260,
  },
  loadingText: {
    textAlign: 'center',
    paddingVertical: 20,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 20,
  },
  poolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#F9F9F9',
  },
  poolNameText: {
    fontSize: 15,
    fontWeight: '600',
  },
  poolDivider: {
    height: 1,
    backgroundColor: '#F0F0F0',
  },
  locationSelectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  checkboxIcon: {
    marginRight: 12,
  },
  locationInfo: {
    flex: 1,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationNameText: {
    fontSize: 14,
    fontWeight: '500',
  },
  allLocationText: {
    fontWeight: '600',
  },
  locationBadge: {
    fontSize: 11,
    fontWeight: '500',
    marginLeft: 8,
  },
  dropdownFooter: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  applyButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  applyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PoolLocationCombobox;
