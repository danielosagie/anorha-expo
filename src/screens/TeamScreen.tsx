import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { showMessage } from 'react-native-flash-message';
import MemberCard from '../components/team/MemberCard';
import InviteMemberModal from '../components/team/InviteMemberModal';
import MemberDetailModal from '../components/team/MemberDetailModal';
import PendingInvitationCard from '../components/team/PendingInvitationCard';
import LocationAccessRequestModal from '../components/team/LocationAccessRequestModal';

const SSSYNC_API_BASE_URL = "https://api.sssync.app";

interface TeamMember {
  Id: string;
  UserId: string;
  OrgId: string;
  Role: 'admin' | 'member';
  CreatedAt: string;
  User: {
    Email: string;
    FirstName?: string;
    LastName?: string;
  };
  platformAccess?: Array<{ id: string; name: string; type: string }>;
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
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'member' | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  
  // Modal states
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [locationRequestModalVisible, setLocationRequestModalVisible] = useState(false);

  const loadTeamData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const token = await ensureSupabaseJwt();
      if (!token) return;

      // Get user's current org
      const { data: orgMemberships } = await supabase
        .from('OrgMemberships')
        .select(`
          Id,
          Role,
          OrgId,
          Organizations (
            Id,
            Name
          )
        `)
        .eq('UserId', user.id)
        .limit(1)
        .single();

      if (!orgMemberships) {
        showMessage({
          message: 'No Organization',
          description: 'You are not part of any organization yet.',
          type: 'warning',
        });
        return;
      }

      const org = (orgMemberships.Organizations as any);
      setCurrentOrg({ Id: org.Id, Name: org.Name });
      setCurrentUserRole(orgMemberships.Role as 'admin' | 'member');

      // Load team members
      const { data: teamMembers } = await supabase
        .from('OrgMemberships')
        .select(`
          Id,
          UserId,
          OrgId,
          Role,
          CreatedAt,
          Users (
            Email,
            FirstName,
            LastName
          )
        `)
        .eq('OrgId', org.Id);

      if (teamMembers) {
        const formattedMembers: TeamMember[] = teamMembers.map((m: any) => ({
          Id: m.Id,
          UserId: m.UserId,
          OrgId: m.OrgId,
          Role: m.Role,
          CreatedAt: m.CreatedAt,
          User: {
            Email: m.Users?.Email || '',
            FirstName: m.Users?.FirstName,
            LastName: m.Users?.LastName,
          },
        }));
        setMembers(formattedMembers);
      }

      // Load pending invitations (admin only)
      if (orgMemberships.Role === 'admin') {
        const response = await fetch(
          `${SSSYNC_API_BASE_URL}/api/organizations/${org.Id}/invitations`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.ok) {
          const invites = await response.json();
          setInvitations(invites.filter((inv: Invitation) => inv.Status === 'pending'));
        }
      }
    } catch (error) {
      console.error('[TeamScreen] Error loading team data:', error);
      showMessage({
        message: 'Error',
        description: 'Failed to load team data',
        type: 'danger',
      });
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

  const handleMemberPress = (memberId: string) => {
    setSelectedMemberId(memberId);
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
                `${SSSYNC_API_BASE_URL}/api/organizations/${currentOrg.Id}/members/${memberId}`,
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
    if (!currentOrg) return;

    try {
      const token = await ensureSupabaseJwt();
      const response = await fetch(
        `${SSSYNC_API_BASE_URL}/api/organizations/${currentOrg.Id}/invitations/${inviteId}/resend`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        showMessage({
          message: 'Success',
          description: 'Invitation resent',
          type: 'success',
        });
      } else {
        throw new Error('Failed to resend');
      }
    } catch (error) {
      showMessage({
        message: 'Error',
        description: 'Failed to resend invitation',
        type: 'danger',
      });
    }
  };

  const handleRevokeInvitation = async (inviteId: string) => {
    if (!currentOrg) return;

    try {
      const token = await ensureSupabaseJwt();
      const response = await fetch(
        `${SSSYNC_API_BASE_URL}/api/organizations/${currentOrg.Id}/invitations/${inviteId}`,
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
          description: 'Invitation revoked',
          type: 'success',
        });
        loadTeamData();
      } else {
        throw new Error('Failed to revoke');
      }
    } catch (error) {
      showMessage({
        message: 'Error',
        description: 'Failed to revoke invitation',
        type: 'danger',
      });
    }
  };

  const handleRequestLocationAccess = () => {
    setLocationRequestModalVisible(true);
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: theme.colors.text }]}>Team</Text>
          {currentOrg && (
            <Text style={styles.orgName}>{currentOrg.Name}</Text>
          )}
        </View>
        {currentUserRole === 'admin' && (
          <Button
            title="Invite"
            icon="account-plus"
            onPress={handleInviteMember}
            style={styles.inviteButton}
          />
        )}
      </View>

      {/* Team Members */}
      <Card style={styles.card}>
        <View style={styles.sectionHeader}>
          <Icon name="account-group" size={20} color={theme.colors.primary} />
          <Text style={styles.sectionTitle}>Team Members</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{members.length}</Text>
          </View>
        </View>

        {members.map((member) => (
          <MemberCard
            key={member.Id}
            member={member}
            isCurrentUserAdmin={currentUserRole === 'admin'}
            onPress={() => handleMemberPress(member.Id)}
            onRemove={
              currentUserRole === 'admin'
                ? () => handleRemoveMember(member.Id, member.User.Email)
                : undefined
            }
          />
        ))}
      </Card>

      {/* Pending Invitations (Admin Only) */}
      {currentUserRole === 'admin' && invitations.length > 0 && (
        <Card style={styles.card}>
          <View style={styles.sectionHeader}>
            <Icon name="email-outline" size={20} color="#FF9500" />
            <Text style={styles.sectionTitle}>Pending Invitations</Text>
            <View style={[styles.badge, { backgroundColor: '#FF9500' + '20' }]}>
              <Text style={[styles.badgeText, { color: '#FF9500' }]}>
                {invitations.length}
              </Text>
            </View>
          </View>

          {invitations.map((invite) => (
            <PendingInvitationCard
              key={invite.Id}
              invitation={invite}
              onResend={() => handleResendInvitation(invite.Id)}
              onRevoke={() => handleRevokeInvitation(invite.Id)}
            />
          ))}
        </Card>
      )}

      {/* Member Actions (for regular members) */}
      {currentUserRole === 'member' && (
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Permissions</Text>
          <Text style={styles.hint}>
            You have read-only access to assigned platforms. Contact your admin to modify your permissions.
          </Text>
          
          <Button
            title="Request Location Access"
            icon="map-marker-plus"
            outlined
            onPress={handleRequestLocationAccess}
            style={styles.actionButton}
          />
        </Card>
      )}

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

      {/* Member Detail Modal */}
      {selectedMemberId && (
        <MemberDetailModal
          visible={!!selectedMemberId}
          memberId={selectedMemberId}
          isCurrentUserAdmin={currentUserRole === 'admin'}
          onClose={() => setSelectedMemberId(null)}
          onUpdate={() => loadTeamData()}
        />
      )}

      {/* Location Access Request Modal */}
      {locationRequestModalVisible && currentOrg && (
        <LocationAccessRequestModal
          visible={locationRequestModalVisible}
          orgId={currentOrg.Id}
          onClose={() => setLocationRequestModalVisible(false)}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FB',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 60,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  orgName: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  inviteButton: {
    paddingHorizontal: 16,
  },
  card: {
    margin: 16,
    marginTop: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  badge: {
    backgroundColor: '#5c9c00' + '20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5c9c00',
  },
  hint: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  actionButton: {
    marginTop: 8,
  },
});

