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

interface CreateLocationPoolModalProps {
  visible: boolean;
  orgId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateLocationPoolModal({
  visible,
  orgId,
  onClose,
  onSuccess,
}: CreateLocationPoolModalProps) {
  const theme = useTheme();
  const [step, setStep] = useState(1); // 1: Pool Details, 2: Select Locations
  const [poolName, setPoolName] = useState('');
  const [poolDescription, setPoolDescription] = useState('');
  const [syncInventory, setSyncInventory] = useState(true);
  const [syncPricing, setSyncPricing] = useState(false);
  const [availableLocations, setAvailableLocations] = useState<any[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingPool, setCreatingPool] = useState(false);

  useEffect(() => {
    if (visible && step === 2) {
      loadAvailableLocations();
    }
  }, [visible, step]);

  const loadAvailableLocations = async () => {
    try {
      setLoading(true);
      const token = await ensureSupabaseJwt();
      const response = await fetch(
        `${API_BASE_URL}/api/pools/locations/available?orgId=${orgId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to load locations: ${response.status}`);
      }
      const data = await response.json();
      setAvailableLocations(data);
    } catch (error) {
      console.error('Error loading locations:', error);
      Alert.alert('Error', 'Failed to load available locations');
    } finally {
      setLoading(false);
    }
  };

  const getToken = async () => {
    return await ensureSupabaseJwt();
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

  const handleCreatePool = async () => {
    if (!poolName.trim()) {
      Alert.alert('Error', 'Please enter a pool name');
      return;
    }

    try {
      setCreatingPool(true);
      const token = await ensureSupabaseJwt();
      const response = await fetch(
        `${API_BASE_URL}/api/pools`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            orgId: orgId,
            name: poolName.trim(),
            description: poolDescription.trim() || undefined,
            syncInventory: syncInventory,
            syncPricing: syncPricing,
            location_ids: selectedLocations.length > 0 ? selectedLocations : undefined,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || 'Failed to create location pool';
        Alert.alert('Error', errorMessage);
        return;
      }

      const newPool = await response.json();
      Alert.alert('Success', 'Location pool created successfully');
      handleClose();
      onSuccess();
    } catch (error) {
      console.error('Error creating pool:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create location pool');
    } finally {
      setCreatingPool(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setPoolName('');
    setPoolDescription('');
    setSyncInventory(true);
    setSyncPricing(false);
    setSelectedLocations([]);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.container}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: theme.colors.primary }]}>
          <Text style={styles.headerTitle}>Create Location Group</Text>
          <TouchableOpacity onPress={handleClose}>
            <Icon name="close" size={24} color="white" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {step === 1 ? (
            // Step 1: Pool Details
            <Card style={styles.section}>
              <Text style={styles.stepTitle}>Step 1: Location Group Details</Text>

              <Text style={styles.label}>Group Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Atlanta Stores, Multi-Location Inventory"
                value={poolName}
                onChangeText={setPoolName}
                placeholderTextColor="#999"
              />

              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, { minHeight: 80 }]}
                placeholder="Describe this location group"
                value={poolDescription}
                onChangeText={setPoolDescription}
                multiline
                placeholderTextColor="#999"
              />

              <View style={styles.toggleRow}>
                <View>
                  <Text style={styles.toggleLabel}>Sync Inventory</Text>
                  <Text style={styles.toggleHint}>Sync product quantities across locations</Text>
                </View>
                <Switch value={syncInventory} onValueChange={setSyncInventory} />
              </View>

              <View style={styles.toggleRow}>
                <View>
                  <Text style={styles.toggleLabel}>Sync Pricing</Text>
                  <Text style={styles.toggleHint}>Sync product prices across locations</Text>
                </View>
                <Switch value={syncPricing} onValueChange={setSyncPricing} />
              </View>

              {/* Helpful Info */}
              <View style={styles.infoBox}>
                <Icon name="information" size={16} color={theme.colors.primary} />
                <Text style={styles.infoText}>
                  You can add locations in the next step or later from the location group editor
                </Text>
              </View>
            </Card>
          ) : (
            // Step 2: Select Locations
            <Card style={styles.section}>
              <Text style={styles.stepTitle}>Step 2: Add Locations (Optional)</Text>

              {loading ? (
                <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginVertical: 20 }} />
              ) : availableLocations.length > 0 ? (
                <ScrollView style={styles.locationsList}>
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
                                  <PlatformLogo width={20} height={20} style={styles.platformIcon} />
                                )}
                                <View style={styles.locationInfo}>
                                  <Text style={styles.locationName}>{location.name}</Text>
                                  <Text style={styles.locationMeta}>{location.timezone}</Text>
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <Text style={styles.emptyText}>No locations available. Connect platforms first.</Text>
              )}
            </Card>
          )}
        </ScrollView>

        {/* Footer Buttons */}
        <View style={styles.footer}>
          {step === 2 && (
            <Button
              title="Back"
              onPress={() => setStep(1)}
              outlined
              style={{ flex: 1 }}
            />
          )}
          <Button
            title={step === 1 ? 'Next' : 'Create Group'}
            onPress={step === 1 ? () => setStep(2) : handleCreatePool}
            disabled={!poolName.trim() || creatingPool}
            loading={creatingPool}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    paddingTop: 50,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    padding: 16,
    marginBottom: 16,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
    color: '#333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  toggleHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  infoBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#E3F2FD',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  infoText: {
    fontSize: 12,
    color: '#1976D2',
    flex: 1,
  },
  locationsList: {
    maxHeight: 300,
  },
  platformSection: {
    marginBottom: 16,
  },
  platformName: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  connectionGroup: {
    marginBottom: 12,
  },
  connectionName: {
    fontSize: 12,
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
  platformIcon: {
    marginRight: 8,
  },
  locationInfo: {
    flex: 1,
  },
  locationName: {
    fontSize: 13,
    fontWeight: '500',
  },
  locationMeta: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 20,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#EEE',
    backgroundColor: 'white',
  },
});
