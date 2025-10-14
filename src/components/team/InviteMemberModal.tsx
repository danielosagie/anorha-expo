import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import Button from '../Button';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { showMessage } from 'react-native-flash-message';

const SSSYNC_API_BASE_URL = "https://api.sssync.app";

interface Platform {
  Id: string;
  DisplayName: string;
  PlatformType: string;
  Status: string;
}

interface Props {
  visible: boolean;
  orgId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function InviteMemberModal({ visible, orgId, onClose, onSuccess }: Props) {
  const theme = useTheme();
  
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingPlatforms, setLoadingPlatforms] = useState(true);

  useEffect(() => {
    if (visible) {
      loadPlatforms();
    }
  }, [visible]);

  const loadPlatforms = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('PlatformConnections')
        .select('*')
        .eq('UserId', user.id)
        .eq('IsEnabled', true);

      if (error) throw error;
      
      setPlatforms(data || []);
    } catch (error) {
      console.error('[InviteMemberModal] Error loading platforms:', error);
    } finally {
      setLoadingPlatforms(false);
    }
  };

  const togglePlatform = (platformId: string) => {
    const newSelected = new Set(selectedPlatforms);
    if (newSelected.has(platformId)) {
      newSelected.delete(platformId);
    } else {
      newSelected.add(platformId);
    }
    setSelectedPlatforms(newSelected);
  };

  const handleSendInvite = async () => {
    if (!email.trim()) {
      showMessage({
        message: 'Error',
        description: 'Please enter an email address',
        type: 'danger',
      });
      return;
    }

    if (role === 'member' && selectedPlatforms.size === 0) {
      showMessage({
        message: 'Error',
        description: 'Please select at least one platform for this member',
        type: 'danger',
      });
      return;
    }

    setLoading(true);

    try {
      const token = await ensureSupabaseJwt();
      const response = await fetch(
        `${SSSYNC_API_BASE_URL}/api/organizations/${orgId}/invitations`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: email.trim(),
            role,
            platformAccess: role === 'admin' ? undefined : Array.from(selectedPlatforms),
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to send invitation');
      }

      showMessage({
        message: 'Success',
        description: `Invitation sent to ${email}`,
        type: 'success',
      });

      // Reset form
      setEmail('');
      setRole('member');
      setSelectedPlatforms(new Set());
      
      onSuccess();
    } catch (error: any) {
      showMessage({
        message: 'Error',
        description: error.message || 'Failed to send invitation',
        type: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

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
            <Text style={styles.title}>Invite Team Member</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Email Input */}
            <View style={styles.section}>
              <Text style={styles.label}>Email Address *</Text>
              <TextInput
                style={styles.input}
                placeholder="colleague@company.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Role Selector */}
            <View style={styles.section}>
              <Text style={styles.label}>Role *</Text>
              <View style={styles.roleOptions}>
                <TouchableOpacity
                  style={[
                    styles.roleOption,
                    role === 'admin' && styles.roleOptionSelected,
                  ]}
                  onPress={() => setRole('admin')}
                >
                  <View style={styles.roleHeader}>
                    <Icon
                      name="shield-crown"
                      size={20}
                      color={role === 'admin' ? '#9b59b6' : '#999'}
                    />
                    <Text
                      style={[
                        styles.roleTitle,
                        role === 'admin' && { color: '#9b59b6' },
                      ]}
                    >
                      Admin
                    </Text>
                  </View>
                  <Text style={styles.roleDescription}>
                    Full access to all platforms and team settings
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.roleOption,
                    role === 'member' && styles.roleOptionSelected,
                  ]}
                  onPress={() => setRole('member')}
                >
                  <View style={styles.roleHeader}>
                    <Icon
                      name="account"
                      size={20}
                      color={role === 'member' ? '#3498db' : '#999'}
                    />
                    <Text
                      style={[
                        styles.roleTitle,
                        role === 'member' && { color: '#3498db' },
                      ]}
                    >
                      Member
                    </Text>
                  </View>
                  <Text style={styles.roleDescription}>
                    Limited access to selected platforms only
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Platform Access (for Members) */}
            {role === 'member' && (
              <View style={styles.section}>
                <Text style={styles.label}>Platform Access *</Text>
                <Text style={styles.hint}>
                  Select which platforms this member can access
                </Text>

                {loadingPlatforms ? (
                  <ActivityIndicator color={theme.colors.primary} />
                ) : platforms.length === 0 ? (
                  <Text style={styles.noPlatforms}>
                    No platforms connected yet
                  </Text>
                ) : (
                  platforms.map((platform) => (
                    <TouchableOpacity
                      key={platform.Id}
                      style={styles.platformOption}
                      onPress={() => togglePlatform(platform.Id)}
                    >
                      <View style={styles.platformInfo}>
                        <Icon name="store" size={20} color={theme.colors.primary} />
                        <View style={styles.platformDetails}>
                          <Text style={styles.platformName}>
                            {platform.DisplayName}
                          </Text>
                          <Text style={styles.platformType}>
                            {platform.PlatformType}
                          </Text>
                        </View>
                      </View>
                      <Icon
                        name={
                          selectedPlatforms.has(platform.Id)
                            ? 'checkbox-marked'
                            : 'checkbox-blank-outline'
                        }
                        size={24}
                        color={
                          selectedPlatforms.has(platform.Id)
                            ? theme.colors.primary
                            : '#ccc'
                        }
                      />
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <Button
              title="Cancel"
              outlined
              onPress={onClose}
              style={styles.cancelButton}
            />
            <Button
              title="Send Invitation"
              onPress={handleSendInvite}
              loading={loading}
              disabled={loading || !email.trim()}
              style={styles.sendButton}
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
  content: {
    padding: 20,
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  roleOptions: {
    gap: 12,
  },
  roleOption: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 16,
  },
  roleOptionSelected: {
    borderColor: '#5c9c00',
    borderWidth: 2,
    backgroundColor: '#5c9c00' + '05',
  },
  roleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  roleTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  roleDescription: {
    fontSize: 13,
    color: '#666',
    marginLeft: 28,
  },
  hint: {
    fontSize: 13,
    color: '#666',
    marginBottom: 12,
  },
  platformOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  platformDetails: {
    marginLeft: 12,
  },
  platformName: {
    fontSize: 15,
    fontWeight: '500',
  },
  platformType: {
    fontSize: 12,
    color: '#666',
    textTransform: 'capitalize',
  },
  noPlatforms: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 20,
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
  sendButton: {
    flex: 1,
  },
});

