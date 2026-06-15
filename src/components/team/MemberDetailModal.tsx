import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import Button from '../Button';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { API_BASE_URL } from '../../config/env';
import { showMessage } from 'react-native-flash-message';

const SSSYNC_API_BASE_URL = API_BASE_URL;

interface Member {
  Id: string;
  UserId: string;
  Role: 'admin' | 'member';
  User: {
    Email: string;
    FirstName?: string;
    LastName?: string;
  };
}

interface Permission {
  resourceId: string;
  /** 'pool' rows come from MemberPoolPermissions (the only permissions table that exists). */
  resourceType: 'platform_connection' | 'platform_location' | 'pool';
  canRead: boolean;
  canWrite: boolean;
}

interface Platform {
  Id: string;
  DisplayName: string;
  PlatformType: string;
}

interface Props {
  visible: boolean;
  memberId: string;
  isCurrentUserAdmin: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export default function MemberDetailModal({
  visible,
  memberId,
  isCurrentUserAdmin,
  onClose,
  onUpdate,
}: Props) {
  const theme = useTheme();
  
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);

  useEffect(() => {
    if (visible) {
      loadMemberDetails();
    }
  }, [visible, memberId]);

  const loadMemberDetails = async () => {
    setLoading(true);
    try {
      // Load member info
      const { data: memberData } = await supabase
        .from('OrgMemberships')
        .select(`
          Id,
          UserId,
          Role,
          Users (
            Email,
            FirstName,
            LastName
          )
        `)
        .eq('Id', memberId)
        .single();

      if (memberData) {
        setMember({
          Id: memberData.Id,
          UserId: memberData.UserId,
          Role: memberData.Role,
          User: {
            Email: (memberData.Users as any)?.Email || '',
            FirstName: (memberData.Users as any)?.FirstName,
            LastName: (memberData.Users as any)?.LastName,
          },
        });
      }

      // Load permissions
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get member's pool permissions. The real table is MemberPoolPermissions
      // ('OrgMemberPermissions' never existed — this query silently returned nothing):
      // one row per (MembershipId, PoolId) with canRead/canEdit/canSync flags.
      const { data: permsData } = await supabase
        .from('MemberPoolPermissions')
        .select('PoolId, canRead, canEdit, MembershipId')
        .eq('MembershipId', memberId);

      if (permsData) {
        setPermissions(
          permsData.map((p: any) => ({
            resourceId: p.PoolId,
            resourceType: 'pool',
            canRead: p.canRead,
            canWrite: p.canEdit,
          }))
        );
      }

      // Load available platforms
      const { data: platformsData } = await supabase
        .from('PlatformConnections')
        .select('Id, UserId, OrgId, PlatformType, DisplayName, Status, IsEnabled, LastSyncAttemptAt, LastSyncSuccessAt, CreatedAt, UpdatedAt')
        .eq('UserId', user.id)
        .eq('IsEnabled', true);

      if (platformsData) {
        setPlatforms(platformsData);
      }
    } catch (error) {
      console.error('[MemberDetailModal] Error loading member details:', error);
      showMessage({
        message: 'Error',
        description: 'Failed to load member details',
        type: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  const updatePermission = async (platformId: string, field: 'canRead' | 'canWrite', value: boolean) => {
    if (!isCurrentUserAdmin || member?.Role === 'admin') return;

    setUpdating(true);
    try {
      const token = await ensureSupabaseJwt();
      const response = await fetch(
        `${SSSYNC_API_BASE_URL}/api/organizations/members/${memberId}/permissions`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            platforms: [
              {
                id: platformId,
                canRead: field === 'canRead' ? value : true,
                canWrite: field === 'canWrite' ? value : false,
              },
            ],
          }),
        }
      );

      if (!response.ok) throw new Error('Failed to update permissions');

      showMessage({
        message: 'Success',
        description: 'Permissions updated',
        type: 'success',
      });

      loadMemberDetails();
      onUpdate();
    } catch (error) {
      showMessage({
        message: 'Error',
        description: 'Failed to update permissions',
        type: 'danger',
      });
    } finally {
      setUpdating(false);
    }
  };

  if (!member) return null;

  const displayName =
    member.User.FirstName && member.User.LastName
      ? `${member.User.FirstName} ${member.User.LastName}`
      : member.User.Email;

  const roleColor = member.Role === 'admin' ? '#9b59b6' : '#3498db';

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
            <Text style={styles.title}>Team Member</Text>
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
              {/* Member Info */}
              <View style={styles.memberInfo}>
                <View style={[styles.avatar, { backgroundColor: roleColor + '20' }]}>
                  <Text style={[styles.initials, { color: roleColor }]}>
                    {member.User.FirstName?.[0] || member.User.Email[0].toUpperCase()}
                    {member.User.LastName?.[0] || ''}
                  </Text>
                </View>
                <Text style={styles.name}>{displayName}</Text>
                <Text style={styles.email}>{member.User.Email}</Text>
                <View style={[styles.roleBadge, { backgroundColor: roleColor + '15' }]}>
                  <Icon
                    name={member.Role === 'admin' ? 'shield-crown' : 'account'}
                    size={14}
                    color={roleColor}
                  />
                  <Text style={[styles.roleText, { color: roleColor }]}>
                    {member.Role === 'admin' ? 'Admin' : 'Member'}
                  </Text>
                </View>
              </View>

              {/* Platform Permissions */}
              {member.Role === 'member' && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Platform Access</Text>
                  {isCurrentUserAdmin ? (
                    <Text style={styles.hint}>
                      Control which platforms this member can access
                    </Text>
                  ) : (
                    <Text style={styles.hint}>View-only permissions</Text>
                  )}

                  {platforms.length === 0 ? (
                    <Text style={styles.noPlatforms}>No platforms connected</Text>
                  ) : (
                    platforms.map((platform) => {
                      const perm = permissions.find(
                        (p) =>
                          p.resourceId === platform.Id &&
                          p.resourceType === 'platform_connection'
                      );

                      return (
                        <View key={platform.Id} style={styles.platformItem}>
                          <View style={styles.platformHeader}>
                            <Icon name="store" size={20} color={theme.colors.primary} />
                            <View style={styles.platformInfo}>
                              <Text style={styles.platformName}>
                                {platform.DisplayName}
                              </Text>
                              <Text style={styles.platformType}>
                                {platform.PlatformType}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.permissions}>
                            <View style={styles.permissionRow}>
                              <Text style={styles.permissionLabel}>View</Text>
                              <Switch
                                value={perm?.canRead ?? false}
                                onValueChange={(value) =>
                                  updatePermission(platform.Id, 'canRead', value)
                                }
                                disabled={!isCurrentUserAdmin || updating}
                              />
                            </View>

                            <View style={styles.permissionRow}>
                              <Text style={styles.permissionLabel}>Edit</Text>
                              <Switch
                                value={perm?.canWrite ?? false}
                                onValueChange={(value) =>
                                  updatePermission(platform.Id, 'canWrite', value)
                                }
                                disabled={!isCurrentUserAdmin || updating || !perm?.canRead}
                              />
                            </View>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              )}

              {member.Role === 'admin' && (
                <View style={styles.adminNotice}>
                  <Icon name="shield-crown" size={24} color="#9b59b6" />
                  <Text style={styles.adminNoticeText}>
                    Admins have full access to all platforms and settings
                  </Text>
                </View>
              )}
            </ScrollView>
          )}

          {/* Footer */}
          <View style={styles.footer}>
            <Button title="Close" onPress={onClose} style={styles.closeBtn} />
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
  memberInfo: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  initials: {
    fontSize: 28,
    fontWeight: '600',
  },
  name: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  roleText: {
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  hint: {
    fontSize: 13,
    color: '#666',
    marginBottom: 16,
  },
  platformItem: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  platformHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  platformInfo: {
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
  permissions: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    gap: 12,
  },
  permissionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  permissionLabel: {
    fontSize: 14,
    color: '#333',
  },
  noPlatforms: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 20,
  },
  adminNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#9b59b6' + '10',
    borderRadius: 12,
    gap: 12,
  },
  adminNoticeText: {
    flex: 1,
    fontSize: 14,
    color: '#666',
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  closeBtn: {
    width: '100%',
  },
});

