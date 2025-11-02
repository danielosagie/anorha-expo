import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  ActivityIndicator,
  TextInput,
  Switch,
  FlatList,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import Button from './Button';
import Card from './Card';
import ShopifySvg from '../assets/shopify.svg';
import SquareSvg from '../assets/square.svg';
import CloverSvg from '../assets/clover.svg';
import { ensureSupabaseJwt } from '../lib/supabase';

const API_BASE_URL = "https://api.sssync.app";

const PLATFORM_LOGOS = {
  shopify: ShopifySvg,
  square: SquareSvg,
  clover: CloverSvg,
};

const PLATFORM_COLORS = {
  shopify: '#96bf48',
  square: '#000000',
  clover: '#1abc9c',
};

interface Location {
  id: string;
  name: string;
  platformType: string;
  connectionName: string;
  timezone?: string;
}

interface Pool {
  id: string;
  name: string;
  description?: string;
  sync_inventory?: boolean;
  sync_pricing?: boolean;
}

interface LocationPoolManagerProps {
  poolId: string;
  orgId: string;
  onClose: () => void;
  onSave?: () => void;
}

export default function LocationPoolManager({
  poolId,
  orgId,
  onClose,
  onSave,
}: LocationPoolManagerProps) {
  const theme = useTheme();
  const [pool, setPool] = useState<Pool | null>(null);
  const [poolLocations, setPoolLocations] = useState<Location[]>([]);
  const [availableLocations, setAvailableLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditingPool, setIsEditingPool] = useState(false);
  const [poolName, setPoolName] = useState('');
  const [poolDescription, setPoolDescription] = useState('');
  const [syncInventory, setSyncInventory] = useState(true);
  const [syncPricing, setSyncPricing] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);

  // Load pool and locations on mount
  useEffect(() => {
    loadPoolData();
  }, [poolId]);

  const loadPoolData = async () => {
    try {
      setLoading(true);
      // Fetch pool details and locations
      const poolRes = await fetch(`${API_BASE_URL}/api/pools/${poolId}/locations`, {
        headers: { 'Authorization': `Bearer ${await getToken()}` },
      });
      const poolData = await poolRes.json();
      setPool(poolData.pool);
      setPoolLocations(poolData.locations);
      setPoolName(poolData.pool.name);
      setPoolDescription(poolData.pool.description || '');
      setSyncInventory(poolData.pool.sync_inventory ?? true);
      setSyncPricing(poolData.pool.sync_pricing ?? false);

      // Fetch available locations
      const locRes = await fetch(
        `${API_BASE_URL}/api/pools/locations/available?orgId=${orgId}`,
        {
          headers: { 'Authorization': `Bearer ${await getToken()}` },
        }
      );
      const locData = await locRes.json();
      setAvailableLocations(locData);
    } catch (error) {
      console.error('Error loading pool data:', error);
      Alert.alert('Error', 'Failed to load pool data');
    } finally {
      setLoading(false);
    }
  };

  const getToken = async () => {
    return await ensureSupabaseJwt();
  };

  const handleAddLocations = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/pools/${poolId}/locations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${await getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ location_ids: selectedLocations }),
      });

      if (!response.ok) throw new Error('Failed to add locations');

      Alert.alert('Success', 'Locations added to pool');
      setShowLocationPicker(false);
      setSelectedLocations([]);
      await loadPoolData();
      onSave?.();
    } catch (error) {
      Alert.alert('Error', 'Failed to add locations');
    }
  };

  const handleRemoveLocation = (locationId: string) => {
    Alert.alert('Remove Location', 'Remove this location from the pool?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const response = await fetch(
              `${API_BASE_URL}/api/pools/${poolId}/locations/${locationId}`,
              {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${await getToken()}` },
              }
            );

            if (!response.ok) throw new Error('Failed to remove location');

            Alert.alert('Success', 'Location removed from pool');
            await loadPoolData();
            onSave?.();
          } catch (error) {
            Alert.alert('Error', 'Failed to remove location');
          }
        },
      },
    ]);
  };

  const handleDeletePool = () => {
    Alert.alert('Delete Pool', 'Delete this location pool? This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const response = await fetch(`${API_BASE_URL}/api/pools/${poolId}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${await getToken()}` },
            });

            if (!response.ok) throw new Error('Failed to delete pool');

            Alert.alert('Success', 'Pool deleted successfully');
            onClose();
            onSave?.();
          } catch (error) {
            Alert.alert('Error', 'Failed to delete pool');
          }
        },
      },
    ]);
  };

  const toggleLocationSelection = (locationId: string) => {
    setSelectedLocations(prev => {
      if (prev.includes(locationId)) {
        return prev.filter(id => id !== locationId);
      } else {
        return [...prev, locationId];
      }
    });
  };

  if (loading) {
    return (
      <Modal visible transparent animationType="slide">
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible transparent animationType="slide">
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: theme.colors.primary }]}>
          <Text style={styles.headerTitle}>Manage Locations</Text>
          <TouchableOpacity onPress={onClose}>
            <Icon name="close" size={24} color="white" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {/* Pool Info Section */}
          <Card style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Location Group: {poolName}</Text>
              <TouchableOpacity onPress={() => setIsEditingPool(!isEditingPool)}>
                <Icon name={isEditingPool ? 'check' : 'pencil'} size={20} color={theme.colors.primary} />
              </TouchableOpacity>
            </View>

            {isEditingPool ? (
              <View>
                <TextInput
                  style={styles.input}
                  placeholder="Group Name"
                  value={poolName}
                  onChangeText={setPoolName}
                />
                <TextInput
                  style={[styles.input, { minHeight: 60 }]}
                  placeholder="Description"
                  value={poolDescription}
                  onChangeText={setPoolDescription}
                  multiline
                />
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Sync Inventory</Text>
                  <Switch value={syncInventory} onValueChange={setSyncInventory} />
                </View>
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Sync Pricing</Text>
                  <Switch value={syncPricing} onValueChange={setSyncPricing} />
                </View>
              </View>
            ) : (
              <View>
                {poolDescription && <Text style={styles.description}>{poolDescription}</Text>}
                <View style={styles.statusRow}>
                  <Text style={styles.statusLabel}>Sync Inventory:</Text>
                  <Icon
                    name={syncInventory ? 'check-circle' : 'circle-outline'}
                    size={18}
                    color={syncInventory ? '#4CAF50' : '#999'}
                  />
                </View>
                <View style={styles.statusRow}>
                  <Text style={styles.statusLabel}>Sync Pricing:</Text>
                  <Icon
                    name={syncPricing ? 'check-circle' : 'circle-outline'}
                    size={18}
                    color={syncPricing ? '#4CAF50' : '#999'}
                  />
                </View>
              </View>
            )}
          </Card>

          {/* Locations Section */}
          <Card style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Locations ({poolLocations.length})
              </Text>
              <TouchableOpacity onPress={() => setShowLocationPicker(true)}>
                <Icon name="plus-circle" size={24} color={theme.colors.primary} />
              </TouchableOpacity>
            </View>

            {poolLocations.length > 0 ? (
              <View>
                {poolLocations.map(location => {
                  const PlatformLogo = PLATFORM_LOGOS[location.platformType as keyof typeof PLATFORM_LOGOS];
                  return (
                    <View key={location.id} style={styles.locationItem}>
                      {PlatformLogo && (
                        <PlatformLogo width={24} height={24} style={styles.platformIcon} />
                      )}
                      <View style={styles.locationInfo}>
                        <Text style={styles.locationName}>{location.name}</Text>
                        <Text style={styles.locationMeta}>
                          {location.connectionName} • {location.timezone || 'Unknown'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleRemoveLocation(location.id)}
                        style={styles.removeButton}
                      >
                        <Icon name="close-circle" size={20} color="#FF3B30" />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.emptyText}>No locations in this group yet</Text>
            )}
          </Card>

          {/* Delete Pool Button */}
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={handleDeletePool}
          >
            <Icon name="trash-can" size={18} color="white" />
            <Text style={styles.deleteButtonText}>Delete Location Group</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Location Picker Modal */}
        <Modal visible={showLocationPicker} transparent animationType="slide">
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerContent}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Add Locations</Text>
                <TouchableOpacity onPress={() => setShowLocationPicker(false)}>
                  <Icon name="close" size={24} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.platformsList}>
                {availableLocations.map(platform => (
                  <View key={platform.platformType} style={styles.platformSection}>
                    <Text style={styles.platformName}>{platform.platformType.toUpperCase()}</Text>

                    {platform.connections.map((connection: any) => (
                      <View key={connection.connectionId} style={styles.connectionGroup}>
                        <Text style={styles.connectionName}>{connection.connectionName}</Text>

                        {connection.locations.map((location: any) => {
                          const PlatformLogo = PLATFORM_LOGOS[platform.platformType as keyof typeof PLATFORM_LOGOS];
                          const isSelected = selectedLocations.includes(location.id);

                          return (
                            <TouchableOpacity
                              key={location.id}
                              style={[styles.locationOption, isSelected && styles.locationOptionSelected]}
                              onPress={() => toggleLocationSelection(location.id)}
                            >
                              <View style={styles.checkboxContainer}>
                                <Icon
                                  name={isSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                                  size={20}
                                  color={isSelected ? '#4CAF50' : '#999'}
                                />
                              </View>
                              {PlatformLogo && (
                                <PlatformLogo width={20} height={20} style={styles.platformIconSmall} />
                              )}
                              <View style={styles.locationSelectInfo}>
                                <Text style={styles.locationSelectName}>{location.name}</Text>
                                <Text style={styles.locationSelectMeta}>{location.timezone || 'Unknown'}</Text>
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                ))}
              </ScrollView>

              <View style={styles.pickerFooter}>
                <Button
                  title="Cancel"
                  onPress={() => {
                    setShowLocationPicker(false);
                    setSelectedLocations([]);
                  }}
                  outlined
                />
                <Button
                  title="Add Locations"
                  onPress={handleAddLocations}
                  disabled={selectedLocations.length === 0}
                />
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 50,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  content: {
    padding: 16,
    flex: 1,
  },
  section: {
    marginBottom: 16,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  platformIcon: {
    marginRight: 12,
  },
  locationInfo: {
    flex: 1,
  },
  locationName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  locationMeta: {
    fontSize: 12,
    color: '#999',
  },
  removeButton: {
    padding: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 20,
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
    gap: 8,
  },
  deleteButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  pickerContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  platformsList: {
    maxHeight: '70%',
  },
  platformSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  platformName: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  connectionGroup: {
    marginBottom: 12,
  },
  connectionName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
    marginLeft: 8,
  },
  locationOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 4,
  },
  locationOptionSelected: {
    backgroundColor: '#4CAF50' + '15',
  },
  checkboxContainer: {
    marginRight: 12,
  },
  platformIconSmall: {
    marginRight: 8,
  },
  locationSelectInfo: {
    flex: 1,
  },
  locationSelectName: {
    fontSize: 13,
    fontWeight: '500',
  },
  locationSelectMeta: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  pickerFooter: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#EEE',
  },
});
