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
  StatusBar,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { ChevronDown, RefreshCw, X } from 'lucide-react-native';
import PageHeader from '../components/ui/PageHeader';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { showMessage } from 'react-native-flash-message';
import InviteMemberModal from '../components/team/InviteMemberModal';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createLogger } from '../utils/logger';
const log = createLogger('TeamScreen');


const SSSYNC_API_BASE_URL = API_BASE_URL;
const API_BASE_RAW = API_BASE_URL;
const API_BASE = API_BASE_RAW.endsWith('/api') ? API_BASE_RAW : `${API_BASE_RAW}/api`;
const ANORHA_GREEN = '#93C822';
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

      // Check for admin role - handle multiple possible formats
      const role = firstMembership.Role;
      const isAdminFromRole = role === 'org:admin' || role === 'admin' || role === 'Admin' || role?.toLowerCase() === 'admin';

      // Also check using the backend's check-admin endpoint for more reliable detection
      let isAdminFromBackend = isAdminFromRole;
      try {
        const adminCheckRes = await fetch(`${API_BASE}/organizations/${orgId}/check-admin`, { headers: apiHeaders });
        if (adminCheckRes.ok) {
          const adminCheckData = await adminCheckRes.json();
          isAdminFromBackend = adminCheckData.isAdmin === true;
        }
      } catch (e) {
        log.warn('[TeamScreen] Failed to check admin status from backend:', e);
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
            setCurrentUserRole('admin');
          } else if (currentUserMember && currentUserMember.Role === 'member' && currentUserRole === 'admin') {
            // If we thought we were admin but members list says member, trust members list
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
      log.error('[TeamScreen] Error loading team data:', error);
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
          log.error('[TeamScreen] Role update failed:', errorText);
          showMessage({ message: 'Error', description: 'Failed to update role', type: 'danger' });
        }
      } catch (e) {
        log.error('[TeamScreen] Role update error:', e);
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
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[ANORHA_GREEN]} />
        }
      >
        <PageHeader
          title="Team"
          onBack={() => navigation.goBack()}
          right={
            <TouchableOpacity onPress={handleInviteMember} style={styles.invitePill} activeOpacity={0.85}>
              <Text style={styles.invitePillText}>Invite</Text>
            </TouchableOpacity>
          }
        />
        <View style={styles.card}>
          {members.length === 0 ? (
            <Text style={styles.emptyText}>No team members found.</Text>
          ) : (
            members.map((member, index) => {
              const initials = member.User.FirstName && member.User.LastName
                ? `${member.User.FirstName[0]}${member.User.LastName[0]}`.toUpperCase()
                : (member.User.Email[0] || '?').toUpperCase();
              const displayName = member.User.FirstName ? `${member.User.FirstName} ${member.User.LastName}` : member.User.Email;

              return (
                <TouchableOpacity
                  key={member.Id}
                  style={[styles.memberRow, index > 0 && styles.rowBorder]}
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
                      <ChevronDown size={16} color="#9CA3AF" />
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
            <Text style={styles.sectionLabel}>Pending invites</Text>
            <View style={styles.card}>
              {invitations.map((inv, index) => (
                <View key={inv.Id} style={[styles.inviteRow, index > 0 && styles.rowBorder]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inviteEmail}>{inv.Email}</Text>
                    <Text style={styles.inviteMeta}>{inv.Role} • {new Date(inv.CreatedAt).toLocaleDateString()}</Text>
                  </View>
                  <TouchableOpacity onPress={() => handleResendInvitation(inv.Id)} style={styles.iconBtn}>
                    <RefreshCw size={18} color={ANORHA_GREEN} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleRevokeInvitation(inv.Id)} style={styles.iconBtn}>
                    <X size={20} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
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
    backgroundColor: '#F6F7F4',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  invitePill: {
    backgroundColor: '#18181B',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  invitePillText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  sectionLabel: {
    fontSize: 13,
    color: '#71717A',
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#ECEBE6',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#F1F1EE',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F1EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#4B5563',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#18181B',
  },
  memberEmail: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
    marginTop: 2,
  },
  roleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#F6F7F4',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ECEBE6',
  },
  roleText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  emptyText: {
    paddingVertical: 24,
    textAlign: 'center',
    color: '#71717A',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  invitesSection: {
    marginTop: 28,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  inviteEmail: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#18181B',
  },
  inviteMeta: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
    marginTop: 2,
  },
  iconBtn: {
    padding: 6,
  },
});
