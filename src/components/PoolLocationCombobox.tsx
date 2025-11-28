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
import { useOrg } from '../context/OrgContext'; // Moved to correct import order

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
  orgId?: string; // Optional now, as we can use context
  selectedItems: string[]; // location IDs
  onSelectionChange: (locationIds: string[]) => void;
  startOpen?: boolean;
}

interface PoolWithLocations {
  pool: LocationPool;
  locations: PlatformLocation[];
}

const PoolLocationCombobox: React.FC<PoolLocationComboboxProps> = ({
  orgId: propOrgId,
  selectedItems,
  onSelectionChange,
  startOpen = false,
}) => {
  const theme = useTheme();
  const { currentOrg } = useOrg();
  
  // Use prop orgId if provided (legacy support), otherwise fall back to context
  const effectiveOrgId = propOrgId || currentOrg?.id;

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
    if (!effectiveOrgId) {
        console.log('[PoolLocationCombobox] No org ID available');
        return;
    }

    try {
      setLoading(true);
      const token = await ensureSupabaseJwt();

      // Fetch all pools
      const poolsRes = await fetch(`${API_BASE_URL}/api/pools/org/${effectiveOrgId}`, {
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
          {/* <Icon name="map-marker-outline" size={18} color={theme.colors.textSecondary} /> */} 
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
        <View style={[styles.dropdownPanel, { backgroundColor: '#fff' }]}>
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
                      <Text style={[styles.poolNameText, { color: '#333' }]}>
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
                      <View style={{ width: 24, alignItems: 'center' }}>
                        {item.locations.every((loc) => selectedLocations.includes(loc.Id)) && (
                            <Icon name="check" size={18} color="#333" />
                        )}
                      </View>
                      <Text
                        style={[
                          styles.locationNameText,
                          { color: '#333', flex: 1 },
                        ]}
                      >
                        All Locations
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 4 }}>
                         {/* Show distinct platform icons available in this pool */}
                         {Array.from(new Set(item.locations.map(l => l.PlatformConnections?.PlatformType))).map(pt => (
                             pt ? <PlatformAvatar key={pt} platformType={pt} size="small" /> : null
                         ))}
                      </View>
                    </TouchableOpacity>

                    {/* Individual Locations */}
                    {item.locations.map((location) => (
                      <TouchableOpacity
                        key={location.Id}
                        style={styles.locationSelectItem}
                        onPress={() => toggleLocationSelection(location.Id)}
                      >
                        <View style={{ width: 24, alignItems: 'center' }}>
                            {selectedLocations.includes(location.Id) && (
                                <Icon name="check" size={18} color="#333" />
                            )}
                        </View>
                        
                        <Text style={[styles.locationNameText, { color: '#333', flex: 1 }]}>
                            {location.Name}
                        </Text>
                        
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
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    // No shadow for cleaner look
  },
  dropdownContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
  },
  dropdownPanel: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    maxHeight: 400,
    overflow: 'hidden',
    zIndex: 1000, // Ensure high z-index
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
  },
  locationListScrollView: {
    maxHeight: 300,
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
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#F9FAFB', // Light gray background for headers
  },
  poolNameText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  poolDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
  },
  locationSelectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
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
    fontWeight: '400',
    marginLeft: 8,
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
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  applyButton: {
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  applyButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default PoolLocationCombobox;
