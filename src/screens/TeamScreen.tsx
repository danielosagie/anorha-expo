import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config/env';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
  SafeAreaView,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { showMessage } from 'react-native-flash-message';
import InviteMemberModal from '../components/team/InviteMemberModal';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SSSYNC_API_BASE_URL = API_BASE_URL;
const API_BASE_RAW = API_BASE_URL;
const API_BASE = API_BASE_RAW.endsWith('/api') ? API_BASE_RAW : `${API_BASE_RAW}/api`;
const ANORHA_GREEN = '#8cc63f';
const NEUTRAL_GRAY = '#6B7280';
const MEMBER_YELLOW = '#F59E0B';

interface TeamMember {
  Id: string;
  UserId: string;
  ClerkUserId?: string;
  OrgId: string;
  Role: 'admin' | 'member' | 'partner';
  CreatedAt: string;
  User: {
    Email: string;
    FirstName?: string;
    LastName?: string;
  };
}

interface Invitation {
  Id: string;
  Email: string;
  Role: 'admin' | 'member';
  Status: 'pending' | 'accepted' | 'expired' | 'revoked';
  InvitedBy: string;
  CreatedAt: string;
  ExpiresAt: string;
}

interface Organization {
  Id: string;
  Name: string;
}

export default function TeamScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'member' | null>(null);
  
  // Debug: Log role changes
  useEffect(() => {
    console.log('[TeamScreen] Current user role changed to:', currentUserRole);
  }, [currentUserRole]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  // Modal states
  const [inviteModalVisible, setInviteModalVisible] = useState(false);

  const loadTeamData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const token = await ensureSupabaseJwt();
      const apiHeaders: HeadersInit = { Authorization: `Bearer ${token}` };

      // 1) Get user's orgs
      const orgsResponse = await fetch(
        `${API_BASE}/organizations`,
        { headers: apiHeaders }
      );
      if (!orgsResponse.ok) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const orgsList = await orgsResponse.json();
      const firstMembership = Array.isArray(orgsList) ? orgsList[0] : null;
      if (!firstMembership?.Organizations?.Id) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const orgId = firstMembership.Organizations.Id;
      setCurrentOrg({ Id: orgId, Name: firstMembership.Organizations.Name ?? 'Team' });
      
      // Debug: Log the role value to see what we're getting
      console.log('[TeamScreen] First membership role:', firstMembership.Role);
      console.log('[TeamScreen] Full membership data:', JSON.stringify(firstMembership, null, 2));
      
      // Check for admin role - handle multiple possible formats
      const role = firstMembership.Role;
      const isAdminFromRole = role === 'org:admin' || role === 'admin' || role === 'Admin' || role?.toLowerCase() === 'admin';
      console.log('[TeamScreen] Is admin from role?', isAdminFromRole, 'from role:', role);
      
      // Also check using the backend's check-admin endpoint for more reliable detection
      let isAdminFromBackend = isAdminFromRole;
      try {
        const adminCheckRes = await fetch(`${API_BASE}/organizations/${orgId}/check-admin`, { headers: apiHeaders });
        if (adminCheckRes.ok) {
          const adminCheckData = await adminCheckRes.json();
          isAdminFromBackend = adminCheckData.isAdmin === true;
          console.log('[TeamScreen] Backend admin check result:', adminCheckData.isAdmin);
        }
      } catch (e) {
        console.warn('[TeamScreen] Failed to check admin status from backend:', e);
      }
      
      setCurrentUserRole(isAdminFromBackend ? 'admin' : 'member');

      // Parallel Fetch Members & Invites
      const [membersRes, invitesRes] = await Promise.all([
        fetch(`${API_BASE}/organizations/${orgId}/members`, { headers: apiHeaders }),
        fetch(`${API_BASE}/organizations/${orgId}/invitations`, { headers: apiHeaders }).catch(() => null),
      ]);

      // Process Members
      if (membersRes.ok) {
        const membersData = await membersRes.json();
        const list = Array.isArray(membersData) ? membersData : [];
        const mappedMembers = list.map((m: any) => ({
          Id: m.Id,
          UserId: m.Users?.Id ?? m.UserId ?? '',
          ClerkUserId: m.Users?.ClerkUserId ?? m.ClerkUserId,
          OrgId: orgId,
          Role: (
            m.Role === 'partner'
              ? 'partner'
              : (m.Role === 'org:admin' || m.Role === 'admin' ? 'admin' : 'member')
          ) as 'admin' | 'member' | 'partner',
          CreatedAt: m.CreatedAt ?? '',
          User: {
            Email: m.Users?.Email ?? '',
            FirstName: m.Users?.FirstName,
            LastName: m.Users?.LastName,
          },
        }));
        
        // Filter out broken Clerk placeholder users
        const filteredMembers = mappedMembers.filter((m) => {
          const email = m.User?.Email || '';
          // Filter out Clerk placeholder users (pattern: user_xxx@clerk.com)
          return !email.match(/^user_[a-zA-Z0-9]+@clerk\.com$/);
        });
        
        setMembers(filteredMembers);
        
        // Fallback: Check if current user is admin from members list
        // This helps catch cases where the org membership role might not be set correctly
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser?.email) {
          const currentUserMember = filteredMembers.find(m => 
            m.User?.Email?.toLowerCase() === currentUser.email?.toLowerCase()
          );
          if (currentUserMember && currentUserMember.Role === 'admin') {
            console.log('[TeamScreen] Fallback: Found current user as admin in members list');
            setCurrentUserRole('admin');
          } else if (currentUserMember && currentUserMember.Role === 'member' && currentUserRole === 'admin') {
            // If we thought we were admin but members list says member, trust members list
            console.log('[TeamScreen] Fallback: Overriding admin status - user is member in members list');
            setCurrentUserRole('member');
          }
        }
      } else {
        setMembers([]);
      }

      // Process Invites
      if (invitesRes?.ok) {
        const invitesData = await invitesRes.json();
        setInvitations(Array.isArray(invitesData) ? invitesData.filter((inv: Invitation) => inv.Status === 'pending') : []);
      } else {
        setInvitations([]);
      }

    } catch (error) {
      console.error('[TeamScreen] Error loading team data:', error);
      showMessage({ message: 'Error', description: 'Failed to load team data', type: 'danger' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadTeamData();
  }, [loadTeamData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadTeamData();
  };

  const handleInviteMember = () => {
    setInviteModalVisible(true);
  };

  const handleMemberActions = (member: TeamMember) => {
    if (currentUserRole !== 'admin') return;

    const canChangeRole = member.Role !== 'partner';
    const options = [
      ...(canChangeRole ? ['Change Role'] : []),
      'Remove From Team',
      'Cancel',
    ];
    const cancelButtonIndex = options.length - 1;
    const removeButtonIndex = canChangeRole ? 1 : 0;

    const onSelect = (buttonIndex: number) => {
      const picked = options[buttonIndex];
      if (picked === 'Change Role') {
        handleUpdateRole(member.ClerkUserId || member.UserId, member.Role);
      } else if (picked === 'Remove From Team') {
        handleRemoveMember(member.Id, member.User.Email);
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex,
          destructiveButtonIndex: removeButtonIndex,
          title: member.User.Email || 'Member',
          message: 'Member actions',
        },
        onSelect
      );
    } else {
      // Android fallback
      const buttons: any[] = [];
      if (canChangeRole) {
        buttons.push({ text: 'Change Role', onPress: () => onSelect(0) });
      }
      buttons.push({
        text: 'Remove From Team',
        style: 'destructive',
        onPress: () => onSelect(canChangeRole ? 1 : 0),
      });
      buttons.push({ text: 'Cancel', style: 'cancel' });

      Alert.alert('Member Actions', member.User.Email || 'Member', buttons);
    }
  };

  const handleUpdateRole = async (userId: string, currentRole: 'admin' | 'member' | 'partner') => {
    if (currentUserRole !== 'admin' || !currentOrg) return;
    if (currentRole === 'partner') return;

    const options = ['Admin', 'Member', 'Cancel'];
    const destructiveButtonIndex = -1;
    const cancelButtonIndex = 2;

    const updateRole = async (newRole: 'admin' | 'member') => {
      if (newRole === currentRole) return;
      try {
        const token = await ensureSupabaseJwt();
        // Use the permissions endpoint (reliable) to update membership role
        const res = await fetch(`${API_BASE}/organizations/${currentOrg.Id}/members/${userId}/permissions`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ role: newRole })
        });

        if (res.ok) {
          showMessage({ message: 'Role Updated', type: 'success' });
          // Optimistic update - match by UserId (Clerk user ID) or fallback to Id
          setMembers(prev => prev.map(m => 
            (m.ClerkUserId === userId || m.UserId === userId) ? { ...m, Role: newRole } : m
          ));
          // Reload to ensure consistency
          loadTeamData();
        } else {
          const errorText = await res.text();
          console.error('[TeamScreen] Role update failed:', errorText);
          showMessage({ message: 'Error', description: 'Failed to update role', type: 'danger' });
        }
      } catch (e) {
        console.error('[TeamScreen] Role update error:', e);
        showMessage({ message: 'Error', description: 'Failed to update role', type: 'danger' });
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex,
          title: 'Update Role',
          message: 'Select a new role for this member',
        },
        (buttonIndex) => {
          if (buttonIndex === 0) updateRole('admin');
          if (buttonIndex === 1) updateRole('member');
        }
      );
    } else {
      Alert.alert('Update Role', 'Select a new role', [
        { text: 'Admin', onPress: () => updateRole('admin') },
        { text: 'Member', onPress: () => updateRole('member') },
        { text: 'Cancel', style: 'cancel' }
      ]);
    }
  };

  const handleRemoveMember = async (memberId: string, memberEmail: string) => {
    if (!currentOrg) return;

    Alert.alert(
      'Remove Team Member',
      `Are you sure you want to remove ${memberEmail} from the team?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await ensureSupabaseJwt();
              const response = await fetch(
                `${API_BASE}/organizations/${currentOrg.Id}/members/${memberId}`,
                {
                  method: 'DELETE',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                  },
                }
              );

              if (response.ok) {
                showMessage({
                  message: 'Success',
                  description: 'Team member removed',
                  type: 'success',
                });
                loadTeamData();
              } else {
                throw new Error('Failed to remove member');
              }
            } catch (error) {
              showMessage({
                message: 'Error',
                description: 'Failed to remove team member',
                type: 'danger',
              });
            }
          },
        },
      ]
    );
  };

  const handleResendInvitation = async (inviteId: string) => {
    // Implementation reused from previous
    // ... (omitted for brevity, can re-add if needed or user assumed standard Action logic is enough. Adding basics.)
    if (!currentOrg) return;
    try {
      const token = await ensureSupabaseJwt();
      const response = await fetch(
        `${API_BASE}/organizations/${currentOrg.Id}/invitations/${inviteId}/resend`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (response.ok) showMessage({ message: 'Success', description: 'Invitation resent', type: 'success' });
      else throw new Error('Failed to resend');
    } catch (error) {
      showMessage({ message: 'Error', description: 'Failed to resend invitation', type: 'danger' });
    }
  };

  const handleRevokeInvitation = async (inviteId: string) => {
    if (!currentOrg) return;
    try {
      const token = await ensureSupabaseJwt();
      const response = await fetch(
        `${API_BASE}/organizations/${currentOrg.Id}/invitations/${inviteId}`,
        { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (response.ok) {
        showMessage({ message: 'Success', description: 'Invitation revoked', type: 'success' });
        loadTeamData();
      } else throw new Error('Failed to revoke');
    } catch (error) {
      showMessage({ message: 'Error', description: 'Failed to revoke invitation', type: 'danger' });
    }
  };


  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={ANORHA_GREEN} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#F8F9FB' }]}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-left" size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Team</Text>
        <TouchableOpacity
          onPress={handleInviteMember}
          style={[styles.inviteButton, { backgroundColor: ANORHA_GREEN }]}
        >
          <Text style={styles.inviteButtonText}>Invite</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[ANORHA_GREEN]} />
        }
      >
        <View style={styles.listContainer}>
          {members.length === 0 ? (
            <Text style={styles.emptyText}>No team members found.</Text>
          ) : (
            members.map((member) => {
              const initials = member.User.FirstName && member.User.LastName
                ? `${member.User.FirstName[0]}${member.User.LastName[0]}`.toUpperCase()
                : (member.User.Email[0] || '?').toUpperCase();
              const displayName = member.User.FirstName ? `${member.User.FirstName} ${member.User.LastName}` : member.User.Email;

              return (
                <TouchableOpacity
                  key={member.Id}
                  style={styles.memberRow}
                  activeOpacity={0.95}
                  onLongPress={() => handleMemberActions(member)}
                  delayLongPress={250}
                  disabled={currentUserRole !== 'admin'}
                >
                  {/* Avatar */}
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>

                  {/* Info */}
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{displayName}</Text>
                    <Text style={styles.memberEmail}>{member.User.Email}</Text>
                  </View>

                  {/* Role Dropdown (Trigger) */}
                  <TouchableOpacity
                    style={styles.roleButton}
                    onPress={() => handleUpdateRole(member.ClerkUserId || member.UserId, member.Role)}
                    disabled={currentUserRole !== 'admin' || member.Role === 'partner'}
                  >
                    <Text
                      style={[
                        styles.roleText,
                        member.Role === 'admin'
                          ? { color: ANORHA_GREEN }
                          : member.Role === 'partner'
                            ? { color: NEUTRAL_GRAY }
                            : { color: MEMBER_YELLOW }
                      ]}
                    >
                      {member.Role === 'admin' ? 'Admin' : member.Role === 'partner' ? 'Partner' : 'Member'}
                    </Text>
                    {currentUserRole === 'admin' && member.Role !== 'partner' && (
                      <Icon name="chevron-down" size={16} color="#9CA3AF" />
                    )}
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* PENDING INVITES */}
        {invitations.length > 0 && currentUserRole === 'admin' && (
          <View style={styles.invitesSection}>
            <Text style={styles.sectionHeader}>Pending Invites</Text>
            {invitations.map((inv) => (
              <View key={inv.Id} style={styles.inviteRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inviteEmail}>{inv.Email}</Text>
                  <Text style={styles.inviteMeta}>{inv.Role} • {new Date(inv.CreatedAt).toLocaleDateString()}</Text>
                </View>
                <TouchableOpacity onPress={() => handleResendInvitation(inv.Id)} style={styles.iconBtn}>
                  <Icon name="refresh" size={20} color={ANORHA_GREEN} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRevokeInvitation(inv.Id)} style={styles.iconBtn}>
                  <Icon name="close" size={20} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

      </ScrollView>

      {/* Invite Modal */}
      {inviteModalVisible && currentOrg && (
        <InviteMemberModal
          visible={inviteModalVisible}
          orgId={currentOrg.Id}
          onClose={() => setInviteModalVisible(false)}
          onSuccess={() => {
            setInviteModalVisible(false);
            loadTeamData();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backBtn: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  inviteButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginRight: -4,
  },
  inviteButtonText: {
    fontSize: 16,
    color: '#FFF',
    fontWeight: '600',
  },
  scrollContent: {
    padding: 16,
  },
  listContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4B5563',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  memberEmail: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  roleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  roleText: {
    fontSize: 13,
    fontWeight: '500',
  },
  emptyText: {
    padding: 24,
    textAlign: 'center',
    color: '#6B7280',
  },
  invitesSection: {
    marginTop: 32,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
    marginLeft: 4,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  inviteEmail: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  inviteMeta: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  iconBtn: {
    padding: 8,
  },
});
