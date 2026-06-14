import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { API_BASE_URL as ENV_API_BASE_URL } from '../config/env';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { useOrg } from '../context/OrgContext';
import PlatformLogo from './PlatformLogo';
import { getPlatform } from '../config/platforms';

const API_BASE_URL = ENV_API_BASE_URL;

interface LocationPool {
  id: string;
  name: string;
  description?: string;
  locationIds?: string[];
}

interface PlatformConnection {
  Id: string;
  PlatformType: string;
  DisplayName: string;
  Status?: string;
  IsEnabled?: boolean;
}

interface DbPlatformLocation {
  PlatformConnectionId: string;
  PlatformLocationId: string;
  Name: string | null;
}

interface LocationMetadata {
  platformLocationId: string;
  locationName: string;
  platformType: string;
  connectionName: string;
}

interface PoolLocationComboboxProps {
  orgId?: string; // Optional now, as we can use context
  platformConnections?: PlatformConnection[]; // NEW: Pass connections like LocationsManagerV2
  selectedItems: string[]; // location IDs
  onSelectionChange: (locationIds: string[]) => void;
  startOpen?: boolean;
  /** Render a compact circular icon button (sits to the right of the search bar). */
  compact?: boolean;
}

const PoolLocationCombobox: React.FC<PoolLocationComboboxProps> = ({
  orgId: propOrgId,
  platformConnections = [],
  selectedItems,
  onSelectionChange,
  startOpen = false,
  compact = false,
}) => {
  const theme = useTheme();
  const { currentOrg } = useOrg();

  // Use prop orgId if provided, otherwise fall back to context
  const effectiveOrgId = propOrgId || currentOrg?.id;

  const [isDropdownOpen, setIsDropdownOpen] = useState(startOpen);
  const [pools, setPools] = useState<LocationPool[]>([]);
  const [singleLocations, setSingleLocations] = useState<DbPlatformLocation[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>(selectedItems);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  // Derive connection IDs and connection map from platformConnections (like LocationsManagerV2)
  const connectionIds = useMemo(() => platformConnections?.map((c) => c.Id) || [], [platformConnections]);

  const connectionById = useMemo(() => {
    const map = new Map<string, PlatformConnection>();
    for (const c of platformConnections || []) map.set(c.Id, c);
    return map;
  }, [platformConnections]);

  // Build location metadata map for display
  const locationMetadataMap = useMemo(() => {
    const map = new Map<string, LocationMetadata>();
    singleLocations.forEach(loc => {
      // Special handling for virtual partner locations (created in loadData)
      if (loc.PlatformConnectionId === 'virtual-partner-connection') {
        map.set(loc.PlatformLocationId, {
          platformLocationId: loc.PlatformLocationId,
          locationName: loc.Name || 'Partner Pool',
          platformType: 'partner', // New type
          connectionName: 'Shared Inventory',
        });
        return;
      }

      const conn = connectionById.get(loc.PlatformConnectionId);
      if (conn) {
        map.set(loc.PlatformLocationId, {
          platformLocationId: loc.PlatformLocationId,
          locationName: loc.Name || loc.PlatformLocationId,
          platformType: conn.PlatformType.toLowerCase(),
          connectionName: conn.DisplayName,
        });
      }
    });
    return map;
  }, [singleLocations, connectionById]);

  // Sync internal state when props change
  useEffect(() => {
    setSelectedLocations(selectedItems);
  }, [selectedItems]);

  // Load data exactly like LocationsManagerV2.loadList
  const loadData = useCallback(async () => {
    if (!effectiveOrgId) {
      console.log('[PoolLocationCombobox] No org ID available');
      return;
    }

    try {
      setLoading(true);
      const token = await ensureSupabaseJwt();

      // Load pools from API (same as LocationsManagerV2)
      const poolsRes = await fetch(`${API_BASE_URL}/api/pools/org/${effectiveOrgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (poolsRes.ok) {
        const poolData = await poolsRes.json();
        setPools(Array.isArray(poolData) ? poolData : []);
        console.log('[PoolLocationCombobox] Loaded pools:', poolData?.length || 0);
      } else {
        console.error('[PoolLocationCombobox] Pools fetch failed', poolsRes.status);
        setPools([]);
      }

      // Load platform locations directly from Supabase (same as LocationsManagerV2)
      if (connectionIds.length > 0) {
        const { data: platformLocs, error } = await supabase
          .from('PlatformLocations')
          .select('PlatformConnectionId, PlatformLocationId, Name')
          .in('PlatformConnectionId', connectionIds);

        if (error) {
          console.error('[PoolLocationCombobox] Error loading locations:', error);
          setSingleLocations([]);
        } else {
          setSingleLocations(platformLocs || []);
          console.log('[PoolLocationCombobox] Loaded locations:', platformLocs?.length || 0);
        }
      } else {
        setSingleLocations([]);
      }

      // CRITICAL FIX: Detect Partner Pools (which have no locations) and add them as virtual locations
      // This ensures they appear in the dropdown map
      if (Array.isArray(poolsRes.ok ? await poolsRes.clone().json() : [])) {
        const poolList = (await poolsRes.clone().json()) as (LocationPool & { isPartnerPool?: boolean })[];

        // Find partner/shared/remote pools
        const partnerPools = poolList.filter(p => p.isPartnerPool || p.name.toLowerCase().includes('partner'));

        if (partnerPools.length > 0) {
          console.log('[PoolLocationCombobox] Detected Partner Pools:', partnerPools.length);

          setPools(prevPools => {
            return prevPools.map(pool => {
              // If it's a partner pool, modify it to include itself as a location ID
              // This is a "virtual location" that represents the whole pool
              if ((pool as any).isPartnerPool || (partnerPools.find(pp => pp.id === pool.id))) {
                const virtualLocationId = pool.id; // Use Pool ID as virtual Location ID

                // Add to singleLocations so metadata map picks it up (needs mock connection)
                setSingleLocations(prevLocs => {
                  // Avoid duplicates
                  if (prevLocs.find(l => l.PlatformLocationId === virtualLocationId)) return prevLocs;

                  return [...prevLocs, {
                    PlatformConnectionId: 'virtual-partner-connection',
                    PlatformLocationId: virtualLocationId,
                    Name: pool.name, // Use pool name as location name
                  }];
                });

                // Return modified pool with virtual location ID
                return {
                  ...pool,
                  locationIds: [...(pool.locationIds || []), virtualLocationId]
                };
              }
              return pool;
            });
          });
        }
      }
    } catch (error) {
      console.error('[PoolLocationCombobox] Error loading data:', error);
      Alert.alert('Error', 'Failed to load pools and locations');
    } finally {
      setLoading(false);
    }
  }, [effectiveOrgId, connectionIds]);

  useEffect(() => {
    if (startOpen && !isDropdownOpen) {
      setIsDropdownOpen(true);
      loadData();
    }
  }, [startOpen]);

  const handleOpenDropdown = () => {
    if (!isDropdownOpen) {
      loadData();
    }
    setIsDropdownOpen(!isDropdownOpen);
  };

  const toggleLocationSelection = (locationId: string) => {
    const newSelected = selectedLocations.includes(locationId)
      ? selectedLocations.filter((id) => id !== locationId)
      : [...selectedLocations, locationId];

    setSelectedLocations(newSelected);
    onSelectionChange(newSelected);
  };

  const toggleAllLocationsInPool = (poolId: string) => {
    const pool = pools.find((p) => p.id === poolId);
    if (!pool || !pool.locationIds) return;

    // Only include locations that have valid metadata (exist in PlatformLocations)
    const validLocationIds = pool.locationIds.filter(id => locationMetadataMap.has(id));
    if (validLocationIds.length === 0) return;

    // Check if all VALID locations in this pool are currently selected
    const allSelected = validLocationIds.every((id) => selectedLocations.includes(id));

    let newSelected: string[];
    if (allSelected) {
      // Unselect all in this pool
      newSelected = selectedLocations.filter((id) => !validLocationIds.includes(id));
    } else {
      // Select all in this pool (merge with existing)
      const currentSet = new Set(selectedLocations);
      validLocationIds.forEach((id) => currentSet.add(id));
      newSelected = Array.from(currentSet);
    }

    setSelectedLocations(newSelected);
    onSelectionChange(newSelected);
  };

  // NEW: Toggle ALL locations across ALL pools (Global "All Locations")
  const toggleGlobalAll = () => {
    // Collect ALL valid location IDs from ALL pools
    const allValidLocationIds = new Set<string>();
    pools.forEach(pool => {
      (pool.locationIds || []).forEach(id => {
        if (locationMetadataMap.has(id)) {
          allValidLocationIds.add(id);
        }
      });
    });

    const allIds = Array.from(allValidLocationIds);
    if (allIds.length === 0) return;

    // Check if everything is currently selected
    const isEverythingSelected = allIds.every(id => selectedLocations.includes(id));

    let newSelected: string[];
    if (isEverythingSelected) {
      // Deselect all (that are known valid locations)
      // Note: We only remove known locations to preserve any stray IDs if that's desired, 
      // but usually 'Deselect All' implies clearing the selection. 
      // User context implies 'filtering', so clearing selection means 'no locations selected'.
      newSelected = [];
    } else {
      // Select all
      newSelected = allIds;
    }

    setSelectedLocations(newSelected);
    onSelectionChange(newSelected);
  };

  const getDisplayText = (): string => {
    if (selectedLocations.length === 0) {
      return 'All Locations';
    }

    // Count total valid locations across all pools
    const totalLocations = pools.reduce((acc, pool) => {
      const validCount = (pool.locationIds || []).filter(id => locationMetadataMap.has(id)).length;
      return acc + validCount;
    }, 0);

    if (totalLocations > 0 && selectedLocations.length >= totalLocations) {
      return 'All Locations';
    }

    if (selectedLocations.length === 1) {
      const meta = locationMetadataMap.get(selectedLocations[0]);
      return meta?.locationName || 'All Locations';
    }

    return `${selectedLocations.length} of ${totalLocations} Locations`;
  };

  // Get unique platform types for a pool
  const getPoolPlatformTypes = (pool: LocationPool): string[] => {
    const types = new Set<string>();
    (pool.locationIds || []).forEach(id => {
      const meta = locationMetadataMap.get(id);
      if (meta?.platformType) types.add(meta.platformType);
    });
    return Array.from(types);
  };

  // Render platform logo
  const renderPlatformLogo = (platformType: string, key?: string) => {
    if (!getPlatform(platformType)) return null;
    return (
      <PlatformLogo key={key || platformType} type={platformType} size={16} style={{ marginLeft: 4 }} />
    );
  };

  // Helper to determine if global "All" is selected
  const isGlobalAllSelected = () => {
    let hasAnyLocations = false;
    let allSelected = true;

    for (const pool of pools) {
      const validIds = (pool.locationIds || []).filter(id => locationMetadataMap.has(id));
      if (validIds.length > 0) {
        hasAnyLocations = true;
        if (!validIds.every(id => selectedLocations.includes(id))) {
          allSelected = false;
          break;
        }
      }
    }
    return hasAnyLocations && allSelected;
  };

  // Search filtering logic
  const filteredPools = pools.filter((pool) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    if (pool.name.toLowerCase().includes(query)) return true;
    const hasMatchingLocation = (pool.locationIds || []).some(id => {
      const meta = locationMetadataMap.get(id);
      return meta?.locationName.toLowerCase().includes(query);
    });
    return hasMatchingLocation;
  });

  const getFilteredLocationsForPool = (pool: LocationPool): string[] => {
    const validIds = (pool.locationIds || []).filter(id => locationMetadataMap.has(id));
    if (!searchQuery) return validIds;
    const query = searchQuery.toLowerCase();
    return validIds.filter(id => {
      const meta = locationMetadataMap.get(id);
      return meta?.locationName.toLowerCase().includes(query);
    });
  };

  return (
    <View style={styles.container}>
      {compact ? (
        <TouchableOpacity style={styles.compactBtn} onPress={handleOpenDropdown} activeOpacity={0.7}>
          <Icon name="filter-variant" size={20} color="#3F3F46" />
          {selectedLocations.length > 0 ? <View style={styles.compactDot} /> : null}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.dropdownButton, { borderColor: theme.colors.textSecondary + '40' }]}
          onPress={handleOpenDropdown}
          activeOpacity={0.7}
        >
          <View style={styles.dropdownContent}>
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
      )}

      {/* Fade-in-place bottom sheet — a Modal overlays the list so it's never clipped behind items. */}
      <Modal
        animationType="fade"
        transparent
        visible={isDropdownOpen}
        onRequestClose={() => setIsDropdownOpen(false)}
      >
        <View style={styles.sheetRoot}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setIsDropdownOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
          {/* Search Input */}
          <View style={styles.searchContainer}>
            <Icon name="magnify" size={18} color="#9CA3AF" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search pools/locations..."
              placeholderTextColor="#9CA3AF"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {loading ? (
            <Text style={styles.loadingText}>
              Loading...
            </Text>
          ) : (
            <ScrollView
              style={styles.locationListScrollView}
              scrollEnabled={true}
              showsVerticalScrollIndicator={false}
            >
              {/* GLOBAL "ALL LOCATIONS" TOGGLE (Only if not searching, or always? User said "All locations should go above all pools") */}
              {/* If searching, "All Locations" might be confusing if it only selects visible? 
                  Standard behavior is it acts on the dataset. I'll make it act on visible if searched, or all if not.
                  For simplicity and "User Request: 1 all locations/pools button", I'll put it at the top always. */}
              {!searchQuery && pools.length > 0 && (
                <>
                  <TouchableOpacity
                    style={styles.locationSelectItem} // Reusing item style for consistency
                    onPress={toggleGlobalAll}
                  >
                    <View style={styles.checkContainer}>
                      {isGlobalAllSelected() && (
                        <Icon name="check" size={16} color="#374151" />
                      )}
                    </View>
                    <Text style={[styles.locationNameText, styles.allLocationText, { fontSize: 14 }]}>
                      All Locations
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.poolDivider} />
                </>
              )}

              {filteredPools.length === 0 && !loading ? (
                <Text style={styles.emptyText}>
                  No pools or locations found
                </Text>
              ) : (
                filteredPools.map((pool) => {
                  const filteredLocationIds = getFilteredLocationsForPool(pool);
                  const platformTypes = getPoolPlatformTypes(pool);

                  // Skip pools with no valid locations
                  if (filteredLocationIds.length === 0 && !searchQuery) return null;

                  // Check if all VALID locations in this pool are selected (for pool header checkmark)
                  const validIds = (pool.locationIds || []).filter(id => locationMetadataMap.has(id));
                  const isPoolFullySelected = validIds.length > 0 && validIds.every(id => selectedLocations.includes(id));

                  return (
                    <View key={pool.id}>
                      {/* Pool Header - Now Clickable to Select Whole Pool */}
                      <TouchableOpacity
                        style={styles.poolHeaderInteractive}
                        onPress={() => toggleAllLocationsInPool(pool.id)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.checkContainer, { marginRight: 0 }]}>
                          {isPoolFullySelected && (
                            <Icon name="check" size={16} color="#6B7280" />
                          )}
                        </View>
                        <Text style={styles.poolNameText}>
                          {pool.name}
                        </Text>
                      </TouchableOpacity>

                      {/* Individual Locations */}
                      {filteredLocationIds.map((locationId) => {
                        const meta = locationMetadataMap.get(locationId);
                        if (!meta) return null;

                        const isSelected = selectedLocations.includes(locationId);

                        return (
                          <TouchableOpacity
                            key={locationId}
                            style={styles.locationSelectItem}
                            onPress={() => toggleLocationSelection(locationId)}
                          >
                            <View style={styles.checkContainer}>
                              {isSelected && (
                                <Icon name="check" size={16} color="#374151" />
                              )}
                            </View>

                            <Text style={styles.locationNameText}>
                              {meta.locationName}
                            </Text>

                            <View style={styles.platformIconsRow}>
                              {renderPlatformLogo(meta.platformType, locationId)}
                            </View>
                          </TouchableOpacity>
                        );
                      })}

                      {/* Divider between pools */}
                      <View style={styles.poolDivider} />
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}

          {/* Footer Removed as requested ("dont really want a done button") */}
            <View style={{ height: 8 }} />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  compactBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F2F2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactDot: {
    position: 'absolute',
    top: 11,
    right: 11,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#93C822',
  },
  // Fade-in-place bottom sheet (no background push).
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 28,
    paddingTop: 8,
    maxHeight: '72%',
    overflow: 'hidden',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4D4D8',
    marginBottom: 8,
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
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    maxHeight: 450,
    overflow: 'hidden',
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: '#374151',
    paddingVertical: 0,
  },
  locationListScrollView: {
    maxHeight: 350,
  },
  loadingText: {
    textAlign: 'center',
    paddingVertical: 20,
    color: '#6B7280',
    fontSize: 14,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 20,
    color: '#6B7280',
    fontSize: 14,
  },
  // Updated Pool Header style for interactivity
  poolHeaderInteractive: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F9FAFB',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  poolNameText: {
    fontSize: 13,
    fontWeight: '700', // Bolder to stand out
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  poolDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  locationSelectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12, // Slightly taller click area
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  checkContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  locationNameText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    color: '#374151',
    marginLeft: 4,
  },
  allLocationText: {
    fontWeight: '600',
    color: '#111',
  },
  platformIconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});

export default PoolLocationCombobox;
