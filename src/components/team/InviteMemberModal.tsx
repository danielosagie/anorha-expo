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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import Button from '../Button';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { API_BASE_URL as ENV_API_BASE_URL } from '../../config/env';
import { capture, AnalyticsEvents } from '../../lib/analytics';
import { showMessage } from 'react-native-flash-message';

const ANORHA_GREEN = '#8cc63f';
const NEUTRAL_GRAY = '#6B7280';
const MEMBER_YELLOW = '#F59E0B';

const API_BASE_URL = ENV_API_BASE_URL;
const API_BASE_RAW = API_BASE_URL.replace(/\/$/, '');
const API_BASE = API_BASE_RAW.endsWith('/api') ? API_BASE_RAW : `${API_BASE_RAW}/api`;



interface Pool {
  id: string;
  name: string;
  description?: string | null;
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
  const [selectedPoolIds, setSelectedPoolIds] = useState<Set<string>>(new Set());
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingPools, setLoadingPools] = useState(true);

  useEffect(() => {
    if (visible) {
      loadPools();
    }
  }, [visible]);

  const loadPools = async () => {
    try {
      const token = await ensureSupabaseJwt();
      if (!token) return;

      const res = await fetch(`${API_BASE}/pools/org/${orgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(errText || `Failed to load pools (${res.status})`);
      }

      const data = await res.json();
      setPools(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('[InviteMemberModal] Error loading pools:', error);
    } finally {
      setLoadingPools(false);
    }
  };

  const togglePool = (poolId: string) => {
    const next = new Set(selectedPoolIds);
    if (next.has(poolId)) {
      next.delete(poolId);
    } else {
      next.add(poolId);
    }
    setSelectedPoolIds(next);
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

    if (role === 'member' && selectedPoolIds.size === 0) {
      showMessage({
        message: 'Error',
        description: 'Please select at least one pool for this member',
        type: 'danger',
      });
      return;
    }

    setLoading(true);

    try {
      const token = await ensureSupabaseJwt();

      const response = await fetch(
        `${API_BASE}/organizations/${orgId}/invitations`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: email.trim(),
            role,
            // Pool-based access for members (admins get full access)
            assignedPoolIds: role === 'admin' ? undefined : Array.from(selectedPoolIds),
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to send invitation');
      }

      capture(AnalyticsEvents.TEAM_INVITE_SENT);

      showMessage({
        message: 'Success',
        description: `Invitation sent to ${email}`,
        type: 'success',
      });

      // Reset form
      setEmail('');
      setRole('member');
      setSelectedPoolIds(new Set());

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
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={styles.overlay}
      >
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
              <Text style={[styles.label, { marginTop: 0 }]}>Email Address *</Text>
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
                    role === 'admin' && styles.roleOptionSelectedAdmin,
                  ]}
                  onPress={() => setRole('admin')}
                >
                  <View style={styles.roleHeader}>
                    <Icon
                      name="shield-crown"
                      size={20}
                      color={role === 'admin' ? ANORHA_GREEN : '#999'}
                    />
                    <Text
                      style={[
                        styles.roleTitle,
                        role === 'admin' && { color: ANORHA_GREEN },
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
                    role === 'member' && styles.roleOptionSelectedMember,
                  ]}
                  onPress={() => setRole('member')}
                >
                  <View style={styles.roleHeader}>
                    <Icon
                      name="account"
                      size={20}
                      color={role === 'member' ? MEMBER_YELLOW : '#999'}
                    />
                    <Text
                      style={[
                        styles.roleTitle,
                        role === 'member' && { color: MEMBER_YELLOW },
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

            {/* Pool Access (for Members) */}
            {role === 'member' && (
              <View style={styles.section}>
                <Text style={styles.label}>Pool Access *</Text>
                <Text style={styles.hint}>
                  Select which pools this member can access
                </Text>

                {loadingPools ? (
                  <ActivityIndicator color={ANORHA_GREEN} />
                ) : pools.length === 0 ? (
                  <Text style={styles.noPlatforms}>
                    No pools created yet
                  </Text>
                ) : (
                  pools.map((pool) => (
                    <TouchableOpacity
                      key={pool.id}
                      style={styles.platformOption}
                      onPress={() => togglePool(pool.id)}
                    >
                      <View style={styles.platformInfo}>
                        <Icon name="folder-outline" size={20} color={ANORHA_GREEN} />
                        <View style={styles.platformDetails}>
                          <Text style={styles.platformName}>
                            {pool.name}
                          </Text>
                          <Text style={styles.platformType}>
                            {pool.description || 'Pool'}
                          </Text>
                        </View>
                      </View>
                      <Icon
                        name={
                          selectedPoolIds.has(pool.id)
                            ? 'checkbox-marked'
                            : 'checkbox-blank-outline'
                        }
                        size={24}
                        color={
                          selectedPoolIds.has(pool.id)
                            ? ANORHA_GREEN
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
      </KeyboardAvoidingView>
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 48,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    // Padding removed since modal now has padding
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
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
  roleOptionSelectedAdmin: {
    borderColor: ANORHA_GREEN,
    borderWidth: 2,
    backgroundColor: ANORHA_GREEN + '05',
  },
  roleOptionSelectedMember: {
    borderColor: MEMBER_YELLOW,
    borderWidth: 2,
    backgroundColor: MEMBER_YELLOW + '14',
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
    color: NEUTRAL_GRAY,
    marginLeft: 28,
  },
  hint: {
    fontSize: 13,
    color: NEUTRAL_GRAY,
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
    color: NEUTRAL_GRAY,
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
    marginTop: 24,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
  },
  sendButton: {
    flex: 1,
    backgroundColor: ANORHA_GREEN,
  },
});

