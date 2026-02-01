import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Switch,
  TextInput,
  Modal,
  Linking,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
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
import { useAuth } from '@clerk/clerk-expo';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SSSYNC_API_BASE_URL = 'https://api.sssync.app';
const API_BASE_RAW = process.env.EXPO_PUBLIC_API_BASE_URL || SSSYNC_API_BASE_URL;
const API_BASE = API_BASE_RAW.replace(/\/$/, '').endsWith('/api')
  ? API_BASE_RAW.replace(/\/$/, '')
  : `${API_BASE_RAW.replace(/\/$/, '')}/api`;
const ANORHA_GREEN = '#647653';

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

interface Pool {
  id: string;
  name: string;
  locationIds: string[];
  syncInventory: boolean;
  syncPricing: boolean;
}

interface Location {
  platformLocationId: string;
  locationName: string;
  connectionName: string;
  platformType: string;
}

interface Partnership {
  id: string;
  partnerOrgName?: string;
  partnerEmail: string;
  poolName: string;
  productCount: number;
  isPaused?: boolean;
  direction: 'sent' | 'received';
  canTerminate?: boolean;
}

interface PendingPartnerInvite {
  id: string;
  email: string;
  poolName: string;
  expiresAt: string;
  inviteLink: string;
}

interface ReceivedPartnerInvite {
  id: string;
  sourceOrgName: string;
  sourcePoolName: string;
  shareType: string;
  productCount: number;
  variantCount: number;
  expiresAt: string;
  token: string;
}

type TabType = 'pools' | 'partners' | 'team';

export default function TeamScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { getToken } = useAuth();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'member' | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  const [activeTab, setActiveTab] = useState<TabType>('team');
  const [pools, setPools] = useState<Pool[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [pendingPartnerInvites, setPendingPartnerInvites] = useState<PendingPartnerInvite[]>([]);
  const [receivedPartnerInvites, setReceivedPartnerInvites] = useState<ReceivedPartnerInvite[]>([]);

  const [editingPool, setEditingPool] = useState<Partial<Pool> & { id?: string } | null>(null);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [partnerInviteEmail, setPartnerInviteEmail] = useState('');
  const [partnerInvitePoolId, setPartnerInvitePoolId] = useState('');
  const [partnerInviteCanRevoke, setPartnerInviteCanRevoke] = useState(true);
  const [isSendingPartnerInvite, setIsSendingPartnerInvite] = useState(false);
  const [showPartnerInviteModal, setShowPartnerInviteModal] = useState(false);
  const [partnerInviteSuccessLink, setPartnerInviteSuccessLink] = useState('');
  const [isAcceptingInvite, setIsAcceptingInvite] = useState<string | null>(null);

  // Modal states
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [locationRequestModalVisible, setLocationRequestModalVisible] = useState(false);

  const loadTeamData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const token = await ensureSupabaseJwt();
      const activeOrgResponse = await fetch(
        `${SSSYNC_API_BASE_URL}/api/organizations/user/active-org`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!activeOrgResponse.ok) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const { activeOrg } = await activeOrgResponse.json();
      const orgId = activeOrg.Id;
      setCurrentOrg({ Id: activeOrg.Id, Name: activeOrg.Name });
      setCurrentUserRole(activeOrg.Role);

      const clerkToken = await getToken();
      const headers: HeadersInit = clerkToken ? { Authorization: `Bearer ${clerkToken}` } : {};

      const [membersRes, invitationsRes, poolsRes, locsRes, partnersRes, invitesRes] = await Promise.all([
        supabase.from('OrgMemberships').select(`
          Id, UserId, OrgId, Role, CreatedAt,
          Users ( Email, FirstName, LastName )
        `).eq('OrgId', orgId),
        fetch(`${SSSYNC_API_BASE_URL}/api/organizations/${orgId}/invitations`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        }),
        clerkToken ? fetch(`${API_BASE}/pools/org/${orgId}`, { headers }) : Promise.resolve(null),
        clerkToken ? fetch(`${API_BASE}/pools/locations/available?orgId=${orgId}`, { headers }) : Promise.resolve(null),
        clerkToken ? fetch(`${API_BASE}/cross-org/partnerships?orgId=${orgId}`, { headers }).catch(() => null) : Promise.resolve(null),
        clerkToken ? fetch(`${API_BASE}/cross-org/invites/pending?orgId=${orgId}`, { headers }).catch(() => null) : Promise.resolve(null),
      ]);

      const { data: teamMembers } = membersRes;
      if (teamMembers) {
        setMembers(teamMembers.map((m: any) => ({
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
        })));
      }

      if (invitationsRes?.ok) {
        const invites = await invitationsRes.json();
        setInvitations(Array.isArray(invites) ? invites.filter((inv: Invitation) => inv.Status === 'pending') : []);
      }

      if (poolsRes?.ok) {
        const poolsData = await poolsRes.json();
        setPools(Array.isArray(poolsData) ? poolsData : []);
      }

      if (locsRes?.ok) {
        const rawLocs: Record<string, any> = await locsRes.json();
        const flatLocs: Location[] = [];
        Object.entries(rawLocs).forEach(([, conn]: [string, any]) => {
          if (conn.locations) {
            conn.locations.forEach((l: any) => {
              flatLocs.push({
                platformLocationId: l.platformLocationId,
                locationName: l.locationName,
                connectionName: conn.connectionName || 'Unknown',
                platformType: conn.platformType || 'unknown',
              });
            });
          }
        });
        setLocations(flatLocs);
      }

      if (partnersRes?.ok) {
        const pData = await partnersRes.json();
        setPartnerships(pData.partnerships || []);
      }

      if (invitesRes?.ok) {
        const iData = await invitesRes.json();
        setPendingPartnerInvites(iData.sent || []);
        setReceivedPartnerInvites((iData.received || []).map((inv: any) => ({
          id: inv.id,
          sourceOrgName: inv.sourceOrgName || 'Unknown Organization',
          sourcePoolName: inv.sourcePoolName || 'Unknown Pool',
          shareType: inv.shareType || 'consignment',
          productCount: inv.productCount || inv.variantCount || 0,
          variantCount: inv.variantCount || 0,
          expiresAt: inv.expiresAt,
          token: inv.token || inv.id,
        })));
      }
    } catch (error) {
      console.error('[TeamScreen] Error loading team data:', error);
      showMessage({ message: 'Error', description: 'Failed to load team data', type: 'danger' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken]);

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

  const savePool = async () => {
    if (!editingPool || !currentOrg?.Id) return;
    const token = await getToken();
    if (!token) return;
    const orgId = currentOrg.Id;
    const body = {
      orgId,
      name: editingPool.name,
      syncInventory: editingPool.syncInventory ?? true,
      syncPricing: editingPool.syncPricing ?? true,
      location_ids: selectedLocations,
    };
    try {
      if (editingPool.id === 'new') {
        const res = await fetch(`${API_BASE}/pools`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          setEditingPool(null);
          setSelectedLocations([]);
          loadTeamData();
        } else {
          const text = await res.text();
          showMessage({ message: 'Error', description: text || 'Failed to create pool', type: 'danger' });
        }
      } else {
        const res = await fetch(`${API_BASE}/pools/${editingPool.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          setEditingPool(null);
          setSelectedLocations([]);
          loadTeamData();
        } else {
          const text = await res.text();
          showMessage({ message: 'Error', description: text || 'Failed to update pool', type: 'danger' });
        }
      }
    } catch (e) {
      showMessage({ message: 'Error', description: 'Failed to save pool', type: 'danger' });
    }
  };

  const deletePool = (poolId: string, poolName: string) => {
    Alert.alert('Delete Pool', `Are you sure you want to delete "${poolName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const token = await getToken();
          if (!token || !currentOrg?.Id) return;
          try {
            const res = await fetch(`${API_BASE}/pools/${poolId}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) loadTeamData();
            else showMessage({ message: 'Error', description: 'Failed to delete pool', type: 'danger' });
          } catch {
            showMessage({ message: 'Error', description: 'Failed to delete pool', type: 'danger' });
          }
        },
      },
    ]);
  };

  const sendPartnerInvite = async () => {
    if (!partnerInviteEmail.trim() || !partnerInvitePoolId || !currentOrg?.Id) return;
    setIsSendingPartnerInvite(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/cross-org/invites?orgId=${currentOrg.Id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteeEmail: partnerInviteEmail.trim(),
          poolId: partnerInvitePoolId,
          shareType: partnerInviteCanRevoke ? 'consignment' : 'sync',
          syncDirection: 'bidirectional',
          canRevoke: partnerInviteCanRevoke,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPartnerInviteSuccessLink(data.inviteLink || '');
        setPartnerInviteEmail('');
        setPartnerInvitePoolId('');
        setShowPartnerInviteModal(false);
        loadTeamData();
      } else {
        const text = await res.text();
        showMessage({ message: 'Invite Failed', description: text || 'Failed to send invite', type: 'danger' });
      }
    } catch {
      showMessage({ message: 'Error', description: 'Failed to send invite', type: 'danger' });
    } finally {
      setIsSendingPartnerInvite(false);
    }
  };

  const revokePartnerInvite = (inviteId: string) => {
    Alert.alert('Revoke Invite', 'Are you sure you want to revoke this invite?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          const token = await getToken();
          if (!token || !currentOrg?.Id) return;
          try {
            const res = await fetch(`${API_BASE}/cross-org/invites/${inviteId}?orgId=${currentOrg.Id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              setPendingPartnerInvites((prev) => prev.filter((i) => i.id !== inviteId));
            } else {
              showMessage({ message: 'Error', description: 'Failed to revoke invite', type: 'danger' });
            }
          } catch {
            showMessage({ message: 'Error', description: 'Failed to revoke invite', type: 'danger' });
          }
        },
      },
    ]);
  };

  const acceptReceivedInvite = async (invite: ReceivedPartnerInvite) => {
    if (!currentOrg?.Id) return;
    setIsAcceptingInvite(invite.id);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(
        `${API_BASE}/cross-org/invites/${encodeURIComponent(invite.token)}/accept?orgId=${encodeURIComponent(currentOrg.Id)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      if (res.ok) {
        setReceivedPartnerInvites((prev) => prev.filter((i) => i.id !== invite.id));
        loadTeamData();
        showMessage({
          message: 'Partnership established',
          description: `Connected with ${invite.sourceOrgName}.`,
          type: 'success',
        });
      } else {
        const errData = await res.json().catch(() => ({}));
        showMessage({
          message: errData.code === 'EMAIL_MISMATCH' ? 'Wrong account' : 'Error',
          description: errData.message || 'Failed to accept invite',
          type: 'danger',
        });
      }
    } catch {
      showMessage({ message: 'Error', description: 'Failed to accept invite', type: 'danger' });
    } finally {
      setIsAcceptingInvite(null);
    }
  };

  const terminatePartnership = (partnershipId: string, cleanup: boolean = true) => {
    Alert.alert(
      'End Partnership',
      cleanup
        ? "This will remove all shared products from the partner's account."
        : 'Shared products will remain but sync will stop.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Partnership',
          style: 'destructive',
          onPress: async () => {
            const token = await getToken();
            if (!token) return;
            try {
              const res = await fetch(`${API_BASE}/cross-org/partnerships/${partnershipId}?cleanup=${cleanup}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) {
                setPartnerships((prev) => prev.filter((p) => p.id !== partnershipId));
                showMessage({ message: 'Partnership ended', type: 'success' });
              } else {
                const text = await res.text();
                showMessage({ message: 'Error', description: text || 'Failed to end partnership', type: 'danger' });
              }
            } catch {
              showMessage({ message: 'Error', description: 'Failed to end partnership', type: 'danger' });
            }
          },
        },
      ]
    );
  };

  const togglePartnershipPause = async (partnershipId: string, currentlyPaused: boolean) => {
    const action = currentlyPaused ? 'resume' : 'pause';
    const token = await getToken();
    if (!token || !currentOrg?.Id) return;
    try {
      const res = await fetch(
        `${API_BASE}/cross-org/partnerships/${partnershipId}/${action}?orgId=${currentOrg.Id}`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        setPartnerships((prev) =>
          prev.map((p) => (p.id === partnershipId ? { ...p, isPaused: !currentlyPaused } : p))
        );
        showMessage({ message: currentlyPaused ? 'Partnership resumed' : 'Partnership paused', type: 'success' });
      } else {
        const text = await res.text();
        showMessage({ message: 'Error', description: text || `Failed to ${action}`, type: 'danger' });
      }
    } catch {
      showMessage({ message: 'Error', description: `Failed to ${action} partnership`, type: 'danger' });
    }
  };

  const copyInviteLink = async (link: string) => {
    await Clipboard.setStringAsync(link);
    showMessage({ message: 'Link copied', type: 'success' });
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
      style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[ANORHA_GREEN]} />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: theme.colors.text }]}>Team</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>Manage your organization</Text>
          {currentOrg && <Text style={[styles.orgName, { color: theme.colors.textSecondary }]}>{currentOrg.Name}</Text>}
        </View>
        {activeTab === 'team' && currentUserRole === 'admin' && (
          <Button title="Invite" icon="account-plus" onPress={handleInviteMember} style={styles.inviteButton} />
        )}
        {activeTab === 'partners' && currentUserRole === 'admin' && pools.length > 0 && (
          <Button
            title="Invite Partner"
            icon="account-plus"
            onPress={() => setShowPartnerInviteModal(true)}
            style={styles.inviteButton}
          />
        )}
      </View>

      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'team' && styles.tabActive]}
          onPress={() => setActiveTab('team')}
        >
          <Icon name="account-group" size={18} color={activeTab === 'team' ? '#FFFFFF' : theme.colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'team' && styles.tabTextActive]}>
            Team
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'partners' && styles.tabActive]}
          onPress={() => setActiveTab('partners')}
        >
          <Icon name="handshake" size={18} color={activeTab === 'partners' ? '#FFFFFF' : theme.colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'partners' && styles.tabTextActive]}>
            Partners
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'pools' && styles.tabActive]}
          onPress={() => setActiveTab('pools')}
        >
          <Icon name="map-marker" size={18} color={activeTab === 'pools' ? '#FFFFFF' : theme.colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'pools' && styles.tabTextActive]}>
            Pools
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'pools' && (
        <View style={styles.tabContent}>
          {currentUserRole === 'admin' && (
            <TouchableOpacity
              style={styles.createPoolButton}
              onPress={() => {
                setEditingPool({ id: 'new', name: '', syncInventory: true, syncPricing: true });
                setSelectedLocations([]);
              }}
            >
              <Icon name="plus" size={20} color="#FFFFFF" />
              <Text style={styles.createPoolButtonText}>Create New Pool</Text>
            </TouchableOpacity>
          )}

          {pools.length === 0 ? (
            <View style={styles.emptyStateContainer}>
              <View style={[styles.emptyStateIconBubble, { backgroundColor: ANORHA_GREEN + '15' }]}>
                <Icon name="map-marker-radius" size={48} color={ANORHA_GREEN} />
              </View>
              <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>No pools yet</Text>
              <Text style={[styles.emptyStateDescription, { color: theme.colors.textSecondary }]}>
                Create a pool to group locations that share inventory and pricing strategies.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              {pools.map((pool) => (
                <View key={pool.id} style={styles.poolCard}>
                  <View style={styles.poolHeader}>
                    <Text style={styles.poolName}>{pool.name}</Text>
                    {currentUserRole === 'admin' && (
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                        <TouchableOpacity
                          onPress={() => {
                            setEditingPool({ ...pool });
                            setSelectedLocations(pool.locationIds || []);
                          }}
                        >
                          <Icon name="pencil" size={20} color={theme.colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => deletePool(pool.id, pool.name)}>
                          <Icon name="delete" size={20} color={theme.colors.error} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                  <View style={styles.poolMetaContainer}>
                    <View style={styles.poolMetaTag}>
                      <Icon name="store" size={14} color="#4B5563" />
                      <Text style={styles.poolMetaText}>{pool.locationIds?.length ?? 0} locations</Text>
                    </View>
                    {pool.syncInventory && (
                      <View style={styles.poolMetaTag}>
                        <Icon name="sync" size={14} color="#4B5563" />
                        <Text style={styles.poolMetaText}>Inventory</Text>
                      </View>
                    )}
                    {pool.syncPricing && (
                      <View style={styles.poolMetaTag}>
                        <Icon name="tag" size={14} color="#4B5563" />
                        <Text style={styles.poolMetaText}>Pricing</Text>
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          <Modal
            visible={!!editingPool}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => setEditingPool(null)}
          >
            <SafeAreaView style={styles.modalContainer}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {editingPool?.id === 'new' ? 'Create New Pool' : 'Edit Pool'}
                </Text>
                <TouchableOpacity onPress={() => setEditingPool(null)} style={styles.closeButton}>
                  <Icon name="close" size={24} color={theme.colors.text} />
                </TouchableOpacity>
              </View>
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ flex: 1 }}
              >
                <ScrollView contentContainerStyle={styles.modalContent}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Pool Name</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="e.g. West Coast Stores"
                      placeholderTextColor="#9CA3AF"
                      value={editingPool?.name || ''}
                      onChangeText={(name) => setEditingPool((prev) => (prev ? { ...prev, name } : null))}
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Settings</Text>
                    <View style={styles.switchRow}>
                      <Text style={styles.switchLabel}>Sync Inventory</Text>
                      <Switch
                        value={editingPool?.syncInventory ?? true}
                        onValueChange={(v) =>
                          setEditingPool((prev) => (prev ? { ...prev, syncInventory: v } : null))
                        }
                        trackColor={{ false: '#D1D5DB', true: ANORHA_GREEN }}
                      />
                    </View>
                    <View style={styles.switchRow}>
                      <Text style={styles.switchLabel}>Sync Pricing</Text>
                      <Switch
                        value={editingPool?.syncPricing ?? true}
                        onValueChange={(v) =>
                          setEditingPool((prev) => (prev ? { ...prev, syncPricing: v } : null))
                        }
                        trackColor={{ false: '#D1D5DB', true: ANORHA_GREEN }}
                      />
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>
                      Locations ({selectedLocations.length} selected)
                    </Text>
                    {locations.length === 0 ? (
                      <Text style={{ color: '#6B7280', fontSize: 13, fontStyle: 'italic' }}>
                        No locations available. Connect a platform first.
                      </Text>
                    ) : (
                      locations.map((loc) => {
                        const isSelected = selectedLocations.includes(loc.platformLocationId);
                        return (
                          <TouchableOpacity
                            key={loc.platformLocationId}
                            style={[
                              styles.locationSelectRow,
                              isSelected && styles.locationSelectActive,
                            ]}
                            onPress={() =>
                              setSelectedLocations((prev) =>
                                isSelected
                                  ? prev.filter((id) => id !== loc.platformLocationId)
                                  : [...prev, loc.platformLocationId]
                              )
                            }
                          >
                            <Icon
                              name={isSelected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                              size={20}
                              color={isSelected ? ANORHA_GREEN : '#9CA3AF'}
                            />
                            <View>
                              <Text style={styles.locationName}>{loc.locationName}</Text>
                              <Text style={styles.locationSubtext}>
                                {loc.connectionName} ({loc.platformType})
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.saveButton,
                      (!editingPool?.name?.trim() || selectedLocations.length === 0) &&
                      styles.saveButtonDisabled,
                    ]}
                    onPress={savePool}
                    disabled={!editingPool?.name?.trim() || selectedLocations.length === 0}
                  >
                    <Text style={styles.saveButtonText}>
                      {editingPool?.id === 'new' ? 'Create Pool' : 'Save Changes'}
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              </KeyboardAvoidingView>
            </SafeAreaView>
          </Modal>
        </View>
      )}

      {activeTab === 'partners' && (
        <View style={styles.tabContent}>
          {pendingPartnerInvites.length > 0 && (
            <Card style={styles.card}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Sent Invites</Text>
              {pendingPartnerInvites.map((inv) => (
                <View key={inv.id} style={[styles.partnerInviteRow, { borderColor: '#E5E7EB' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.partnerInviteEmail, { color: theme.colors.text }]}>{inv.email}</Text>
                    <Text style={[styles.partnerInvitePool, { color: theme.colors.textSecondary }]}>{inv.poolName}</Text>
                  </View>
                  <TouchableOpacity onPress={() => copyInviteLink(inv.inviteLink)} style={styles.copyBtn}>
                    <Icon name="content-copy" size={18} color={ANORHA_GREEN} />
                  </TouchableOpacity>
                  {currentUserRole === 'admin' && (
                    <TouchableOpacity onPress={() => revokePartnerInvite(inv.id)}>
                      <Icon name="close-circle" size={20} color={theme.colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </Card>
          )}
          {receivedPartnerInvites.length > 0 && (
            <Card style={styles.card}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Received Invites</Text>
              {receivedPartnerInvites.map((inv) => (
                <View key={inv.id} style={[styles.partnerInviteRow, { borderColor: '#E5E7EB' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.partnerInviteEmail, { color: theme.colors.text }]}>{inv.sourceOrgName}</Text>
                    <Text style={[styles.partnerInvitePool, { color: theme.colors.textSecondary }]}>
                      {inv.sourcePoolName} · {inv.productCount ?? inv.variantCount ?? 0} products
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.acceptInviteBtn, { backgroundColor: ANORHA_GREEN }]}
                    onPress={() => acceptReceivedInvite(inv)}
                    disabled={isAcceptingInvite === inv.id}
                  >
                    {isAcceptingInvite === inv.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.acceptInviteBtnText}>Accept</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))}
            </Card>
          )}
          {partnerships.length > 0 && (
            <Card style={styles.card}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Partnerships</Text>
              {partnerships.map((p) => (
                <View key={p.id} style={[styles.partnershipRow, { borderColor: '#E5E7EB' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.partnershipName, { color: theme.colors.text }]}>
                      {p.partnerOrgName || p.partnerEmail}
                    </Text>
                    <Text style={[styles.partnershipMeta, { color: theme.colors.textSecondary }]}>
                      {p.poolName} · {p.productCount} products · {p.direction}
                    </Text>
                  </View>
                  <View style={styles.partnershipActions}>
                    <TouchableOpacity
                      onPress={() => togglePartnershipPause(p.id, !!p.isPaused)}
                      style={styles.partnershipActionBtn}
                    >
                      <Text style={[styles.partnershipActionText, { color: ANORHA_GREEN }]}>
                        {p.isPaused ? 'Resume' : 'Pause'}
                      </Text>
                    </TouchableOpacity>
                    {p.canTerminate !== false && (
                      <TouchableOpacity onPress={() => terminatePartnership(p.id)} style={styles.partnershipActionBtn}>
                        <Text style={[styles.partnershipActionText, { color: theme.colors.error }]}>End</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </Card>
          )}
          {pendingPartnerInvites.length === 0 && receivedPartnerInvites.length === 0 && partnerships.length === 0 && (
            <View style={styles.emptyStateContainer}>
              <View style={[styles.emptyStateIconBubble, { backgroundColor: ANORHA_GREEN + '15' }]}>
                <Icon name="handshake-outline" size={48} color={ANORHA_GREEN} />
              </View>
              <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>No active partnerships</Text>
              <Text style={[styles.emptyStateDescription, { color: theme.colors.textSecondary }]}>
                Connect with other organizations to share products and sync inventory seamlessly.
              </Text>
            </View>
          )}
        </View>
      )}

      {activeTab === 'team' && (
        <>
          {/* Team Members */}
          <Card style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon name="account-group" size={20} color={theme.colors.primary} />
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Team Members</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{members.length}</Text>
              </View>
            </View>



            {members.length === 0 ? (
              <View style={styles.emptyStateContainer}>
                <View style={[styles.emptyStateIconBubble, { backgroundColor: ANORHA_GREEN + '15' }]}>
                  <Icon name="account-group-outline" size={48} color={ANORHA_GREEN} />
                </View>
                <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>No members yet</Text>
                <Text style={[styles.emptyStateDescription, { color: theme.colors.textSecondary }]}>
                  Invite your team members to collaborate on this organization.
                </Text>
              </View>
            ) : (
              members.map((member) => (
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
              ))
            )}
          </Card>

          {/* Pending Invitations (Admin Only) */}
          {currentUserRole === 'admin' && invitations.length > 0 && (
            <Card style={styles.card}>
              <View style={styles.sectionHeader}>
                <Icon name="email-outline" size={20} color="#FF9500" />
                <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Pending Invitations</Text>
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
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Permissions</Text>
              <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
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
        </>
      )
      }

      {/* Invite Modal */}
      {
        inviteModalVisible && currentOrg && (
          <InviteMemberModal
            visible={inviteModalVisible}
            orgId={currentOrg.Id}
            onClose={() => setInviteModalVisible(false)}
            onSuccess={() => {
              setInviteModalVisible(false);
              loadTeamData();
            }}
          />
        )
      }

      {/* Member Detail Modal */}
      {
        selectedMemberId && (
          <MemberDetailModal
            visible={!!selectedMemberId}
            memberId={selectedMemberId}
            isCurrentUserAdmin={currentUserRole === 'admin'}
            onClose={() => setSelectedMemberId(null)}
            onUpdate={() => loadTeamData()}
          />
        )
      }

      {/* Location Access Request Modal */}
      {
        locationRequestModalVisible && currentOrg && (
          <LocationAccessRequestModal
            visible={locationRequestModalVisible}
            orgId={currentOrg.Id}
            onClose={() => setLocationRequestModalVisible(false)}
          />
        )
      }

      {/* Partner Invite Modal */}
      <Modal visible={showPartnerInviteModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.partnerInviteModal, { backgroundColor: theme.colors.background }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Invite Partner</Text>
            <Text style={[styles.modalSubtitle, { color: theme.colors.textSecondary }]}>
              Send an invite link to share a pool with another organization.
            </Text>
            <TextInput
              style={[styles.modalInput, { color: theme.colors.text, borderColor: '#E5E7EB' }]}
              placeholder="Partner email"
              placeholderTextColor={theme.colors.textSecondary}
              value={partnerInviteEmail}
              onChangeText={setPartnerInviteEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Text style={[styles.modalLabel, { color: theme.colors.text }]}>Pool</Text>
            <ScrollView style={styles.poolPicker} nestedScrollEnabled>
              {pools.map((pool) => (
                <TouchableOpacity
                  key={pool.id}
                  style={[
                    styles.poolPickerItem,
                    partnerInvitePoolId === pool.id && styles.poolPickerItemSelected,
                    { borderColor: '#E5E7EB' },
                  ]}
                  onPress={() => setPartnerInvitePoolId(pool.id)}
                >
                  <Text style={[styles.poolPickerItemText, { color: theme.colors.text }]}>{pool.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalToggles}>
              <Text style={[styles.poolToggleLabel, { color: theme.colors.text }]}>Consignment (can revoke products)</Text>
              <Switch
                value={partnerInviteCanRevoke}
                onValueChange={setPartnerInviteCanRevoke}
                trackColor={{ false: '#ccc', true: ANORHA_GREEN }}
              />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setShowPartnerInviteModal(false);
                  setPartnerInviteSuccessLink('');
                }}
              >
                <Text style={[styles.modalCancelText, { color: theme.colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmitBtn, { backgroundColor: ANORHA_GREEN }]}
                onPress={sendPartnerInvite}
                disabled={!partnerInviteEmail.trim() || !partnerInvitePoolId || isSendingPartnerInvite}
              >
                {isSendingPartnerInvite ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.modalSubmitText}>Send Invite</Text>
                )}
              </TouchableOpacity>
            </View>
            {partnerInviteSuccessLink ? (
              <View style={styles.inviteLinkRow}>
                <Text style={[styles.inviteLinkLabel, { color: theme.colors.textSecondary }]}>Invite link (copy and share):</Text>
                <TouchableOpacity onPress={() => copyInviteLink(partnerInviteSuccessLink)}>
                  <Text style={[styles.inviteLinkText, { color: ANORHA_GREEN }]} numberOfLines={1}>
                    {partnerInviteSuccessLink}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </ScrollView >
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
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    gap: 6,
  },
  tabActive: {
    backgroundColor: ANORHA_GREEN,
    borderColor: ANORHA_GREEN,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  createPoolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ANORHA_GREEN,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 16,
    gap: 8,
    marginHorizontal: 16,
  },
  createPoolButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  poolCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginHorizontal: 16,
  },
  poolHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  poolName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  poolMetaContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  poolMetaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    gap: 4,
  },
  poolMetaText: {
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '500',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  closeButton: {
    padding: 4,
  },
  modalContent: {
    padding: 16,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#111827',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  switchLabel: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '500',
  },
  locationSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    marginBottom: 8,
    gap: 12,
  },
  locationSelectActive: {
    borderColor: ANORHA_GREEN,
    backgroundColor: '#ECFDF5',
  },
  locationSubtext: {
    fontSize: 12,
    color: '#6B7280',
  },
  saveButton: {
    marginTop: 24,
    backgroundColor: ANORHA_GREEN,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: ANORHA_GREEN,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonDisabled: {
    backgroundColor: '#9CA3AF',
    shadowOpacity: 0,
    elevation: 0,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyPools: {
    textAlign: 'center',
    color: '#6B7280',
    fontSize: 15,
    marginTop: 40,
    lineHeight: 22,
    paddingHorizontal: 32,
  },
  locationName: { fontSize: 14, fontWeight: '500' },
  partnerInviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  modalSubtitle: { fontSize: 13, marginBottom: 16 },
  partnerInviteEmail: { fontSize: 14, fontWeight: '500' },
  partnerInvitePool: { fontSize: 12, marginTop: 2 },
  copyBtn: { padding: 8 },
  acceptInviteBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  acceptInviteBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  partnershipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  partnershipName: { fontSize: 14, fontWeight: '600' },
  partnershipMeta: { fontSize: 12, marginTop: 2 },
  partnershipActions: { flexDirection: 'row', gap: 8 },
  partnershipActionBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  partnershipActionText: { fontSize: 13, fontWeight: '500' },
  emptyPartners: { fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  partnerInviteModal: {
    borderRadius: 12,
    padding: 20,
    maxHeight: '80%',
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 16,
  },
  modalLabel: { fontSize: 14, fontWeight: '500', marginBottom: 8 },
  poolPicker: { maxHeight: 120, marginBottom: 12 },
  poolPickerItem: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 6,
  },
  poolPickerItemSelected: { borderColor: ANORHA_GREEN, backgroundColor: ANORHA_GREEN + '15' },
  poolPickerItemText: { fontSize: 14 },
  modalToggles: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  poolToggleLabel: { fontSize: 14 },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalCancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  modalCancelText: { fontSize: 14 },
  modalSubmitBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalSubmitText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  inviteLinkRow: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  inviteLinkLabel: { fontSize: 12, marginBottom: 4 },
  inviteLinkText: { fontSize: 12 },
  tabContent: { paddingHorizontal: 0 },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    marginTop: 20,
  },
  emptyStateIconBubble: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateDescription: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: '80%',
  },
});

