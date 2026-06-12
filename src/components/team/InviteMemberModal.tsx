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
import { X, ShieldCheck, User, Folder, Check } from 'lucide-react-native';
import { useTheme } from '../../context/ThemeContext';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { API_BASE_URL as ENV_API_BASE_URL } from '../../config/env';
import { capture, AnalyticsEvents } from '../../lib/analytics';
import { showMessage } from 'react-native-flash-message';

const ANORHA_GREEN = '#93C822';
const ANORHA_GREEN_TINT = 'rgba(147,200,34,0.12)';

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

  const sendDisabled = loading || !email.trim();

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
        <View style={styles.modal}>
          <View style={styles.dragHandle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Invite Team Member</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={22} color="#71717A" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Email Input */}
            <View style={styles.section}>
              <Text style={[styles.label, { marginTop: 0 }]}>Email Address *</Text>
              <TextInput
                style={styles.input}
                placeholder="colleague@company.com"
                placeholderTextColor="#C7C7CC"
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
                    <ShieldCheck
                      size={20}
                      color={role === 'admin' ? ANORHA_GREEN : '#71717A'}
                    />
                    <Text style={styles.roleTitle}>Admin</Text>
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
                    <User
                      size={20}
                      color={role === 'member' ? ANORHA_GREEN : '#71717A'}
                    />
                    <Text style={styles.roleTitle}>Member</Text>
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
                  pools.map((pool) => {
                    const selected = selectedPoolIds.has(pool.id);
                    return (
                      <TouchableOpacity
                        key={pool.id}
                        style={[
                          styles.platformOption,
                          selected && styles.platformOptionSelected,
                        ]}
                        onPress={() => togglePool(pool.id)}
                      >
                        <View style={styles.platformInfo}>
                          <Folder size={20} color={selected ? ANORHA_GREEN : '#71717A'} />
                          <View style={styles.platformDetails}>
                            <Text style={styles.platformName}>
                              {pool.name}
                            </Text>
                            <Text style={styles.platformType}>
                              {pool.description || 'Pool'}
                            </Text>
                          </View>
                        </View>
                        <View style={[styles.checkbox, selected && styles.checkboxOn]}>
                          {selected && <Check size={16} color="#FFFFFF" strokeWidth={3} />}
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onClose}
              disabled={loading}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendButton, sendDisabled && styles.sendButtonDisabled]}
              onPress={handleSendInvite}
              disabled={sendDisabled}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.sendButtonText}>Send Invitation</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
    maxHeight: '90%',
  },
  dragHandle: {
    width: 60,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D4D4D8',
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: '#18181B',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    // Padding removed since modal now has padding
  },
  section: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#18181B',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#FAFAF8',
    borderWidth: 1,
    borderColor: '#ECEBE6',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#18181B',
  },
  roleOptions: {
    gap: 10,
  },
  roleOption: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECEBE6',
    borderRadius: 16,
    padding: 14,
  },
  roleOptionSelected: {
    borderColor: ANORHA_GREEN,
    backgroundColor: ANORHA_GREEN_TINT,
  },
  roleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  roleTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#18181B',
    marginLeft: 8,
  },
  roleDescription: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
    lineHeight: 19,
    marginLeft: 28,
  },
  hint: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
    lineHeight: 21,
    marginBottom: 12,
  },
  platformOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECEBE6',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  platformOptionSelected: {
    borderColor: ANORHA_GREEN,
    backgroundColor: ANORHA_GREEN_TINT,
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
    fontFamily: 'Inter_600SemiBold',
    color: '#18181B',
  },
  platformType: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
    textTransform: 'capitalize',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#D4D4D8',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: ANORHA_GREEN,
    borderColor: ANORHA_GREEN,
  },
  noPlatforms: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
    textAlign: 'center',
    paddingVertical: 20,
  },
  footer: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#F1F1EE',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#18181B',
  },
  sendButton: {
    flex: 1,
    backgroundColor: ANORHA_GREEN,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
  },
});
