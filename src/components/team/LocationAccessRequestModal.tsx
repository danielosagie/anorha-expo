import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import Button from '../Button';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { API_BASE_URL } from '../../config/env';
import { showMessage } from 'react-native-flash-message';
import { createLogger } from '../../utils/logger';
const log = createLogger('LocationAccessRequestModal');


const SSSYNC_API_BASE_URL = API_BASE_URL;

interface Location {
  Id: string;
  Name: string;
  PlatformConnectionId: string;
  PlatformConnection: {
    DisplayName: string;
    PlatformType: string;
  };
}

interface Props {
  visible: boolean;
  orgId: string;
  onClose: () => void;
}

export default function LocationAccessRequestModal({ visible, orgId, onClose }: Props) {
  const theme = useTheme();
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (visible) {
      loadLocations();
    }
  }, [visible]);

  const loadLocations = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get all platform locations
      const { data: locationsData } = await supabase
        .from('PlatformLocations')
        .select(`
          Id,
          Name,
          PlatformConnectionId,
          PlatformConnections (
            DisplayName,
            PlatformType
          )
        `)
        .order('Name');

      if (locationsData) {
        setLocations(
          locationsData.map((loc: any) => ({
            Id: loc.Id,
            Name: loc.Name,
            PlatformConnectionId: loc.PlatformConnectionId,
            PlatformConnection: {
              DisplayName: loc.PlatformConnections?.DisplayName || '',
              PlatformType: loc.PlatformConnections?.PlatformType || '',
            },
          }))
        );
      }
    } catch (error) {
      log.error('[LocationAccessRequestModal] Error loading locations:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleLocation = (locationId: string) => {
    const newSelected = new Set(selectedLocations);
    if (newSelected.has(locationId)) {
      newSelected.delete(locationId);
    } else {
      newSelected.add(locationId);
    }
    setSelectedLocations(newSelected);
  };

  const handleSubmitRequest = async () => {
    if (selectedLocations.size === 0) {
      showMessage({
        message: 'Error',
        description: 'Please select at least one location',
        type: 'danger',
      });
      return;
    }

    setSubmitting(true);
    try {
      const token = await ensureSupabaseJwt();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create activity log entry as a "request"
      const { error } = await supabase.from('ActivityLogs').insert({
        UserId: user.id,
        EntityType: 'location_access_request',
        EntityId: orgId,
        EventType: 'ACCESS_REQUEST',
        Status: 'pending',
        Message: `Requesting access to ${selectedLocations.size} location(s)`,
        Details: {
          locations: Array.from(selectedLocations),
          reason: reason.trim() || 'No reason provided',
        },
      });

      if (error) throw error;

      showMessage({
        message: 'Request Sent',
        description: 'Your admin will be notified of your access request',
        type: 'success',
      });

      // Reset form
      setSelectedLocations(new Set());
      setReason('');
      onClose();
    } catch (error: any) {
      showMessage({
        message: 'Error',
        description: error.message || 'Failed to submit request',
        type: 'danger',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Group locations by platform
  const locationsByPlatform = locations.reduce((acc, loc) => {
    const platformKey = loc.PlatformConnection.DisplayName;
    if (!acc[platformKey]) {
      acc[platformKey] = {
        type: loc.PlatformConnection.PlatformType,
        locations: [],
      };
    }
    acc[platformKey].locations.push(loc);
    return acc;
  }, {} as Record<string, { type: string; locations: Location[] }>);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: '#fff' }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Request Location Access</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : (
            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
              <Text style={styles.description}>
                Select the locations you need access to. Your admin will be notified and can approve your request.
              </Text>

              {/* Locations by Platform */}
              {Object.entries(locationsByPlatform).map(([platformName, data]) => (
                <View key={platformName} style={styles.platformGroup}>
                  <View style={styles.platformHeader}>
                    <Icon name="store" size={18} color={theme.colors.primary} />
                    <Text style={styles.platformName}>{platformName}</Text>
                    <Text style={styles.platformType}>({data.type})</Text>
                  </View>

                  {data.locations.map((location) => (
                    <TouchableOpacity
                      key={location.Id}
                      style={styles.locationItem}
                      onPress={() => toggleLocation(location.Id)}
                    >
                      <View style={styles.locationInfo}>
                        <Icon name="map-marker" size={20} color="#666" />
                        <Text style={styles.locationName}>{location.Name}</Text>
                      </View>
                      <Icon
                        name={
                          selectedLocations.has(location.Id)
                            ? 'checkbox-marked'
                            : 'checkbox-blank-outline'
                        }
                        size={24}
                        color={
                          selectedLocations.has(location.Id)
                            ? theme.colors.primary
                            : '#ccc'
                        }
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              ))}

              {locations.length === 0 && (
                <Text style={styles.noLocations}>No locations available</Text>
              )}

              {/* Reason (Optional) */}
              <View style={styles.reasonSection}>
                <Text style={styles.label}>Reason (Optional)</Text>
                <TextInput
                  style={styles.reasonInput}
                  placeholder="Why do you need access to these locations?"
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>
            </ScrollView>
          )}

          {/* Footer */}
          <View style={styles.footer}>
            <Button
              title="Cancel"
              outlined
              onPress={onClose}
              style={styles.cancelButton}
            />
            <Button
              title="Send Request"
              onPress={handleSubmitRequest}
              loading={submitting}
              disabled={submitting || selectedLocations.size === 0}
              style={styles.submitButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  loading: {
    padding: 40,
    alignItems: 'center',
  },
  content: {
    padding: 20,
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    lineHeight: 20,
  },
  platformGroup: {
    marginBottom: 24,
  },
  platformHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  platformName: {
    fontSize: 15,
    fontWeight: '600',
  },
  platformType: {
    fontSize: 12,
    color: '#666',
    textTransform: 'capitalize',
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    marginBottom: 8,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationName: {
    fontSize: 14,
  },
  noLocations: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 40,
  },
  reasonSection: {
    marginTop: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  reasonInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
  },
  footer: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
  },
  submitButton: {
    flex: 1,
  },
});

