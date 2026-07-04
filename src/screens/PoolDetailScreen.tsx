// PoolDetailScreen — manage one pool in the new design language: its locations
// (add/remove), partner sharing (list + invite), rename, and delete-with-merge.
// Replaces bouncing to the legacy Account & login mega-screen from Connections.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Modal,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Handshake, Layers, Pencil, Plus, Trash2, X } from 'lucide-react-native';
import { PageHeader } from '../components/ui/PageHeader';
import { useOrg } from '../context/OrgContext';
import { ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { BRAND_PRIMARY } from '../design/tokens';
import PlatformAvatar from '../components/PlatformAvatar';
import PoolLocationPicker, { GroupedPlatform, groupAvailableLocations } from '../components/pools/PoolLocationPicker';

interface PoolLocation {
  platformLocationId: string;
  locationName: string;
  timezone?: string;
  platformConnection: { id: string; platformType: string; displayName: string };
}

interface Partnership {
  partnerOrgName?: string;
  partnerEmail?: string;
  poolName?: string;
  status?: string;
}

interface SiblingPool { id: string; name: string }

const authHeaders = async () => {
  const token = await ensureSupabaseJwt();
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
};

const PoolDetailScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { currentOrg } = useOrg();

  const poolId: string = route.params?.poolId;
  const [poolName, setPoolName] = useState<string>(route.params?.name || 'Pool');
  const [isPartnerPool, setIsPartnerPool] = useState<boolean>(!!route.params?.isPartnerPool);
  const [locations, setLocations] = useState<PoolLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [siblings, setSiblings] = useState<SiblingPool[]>([]);

  // Add-locations sheet
  const [addOpen, setAddOpen] = useState(false);
  const [available, setAvailable] = useState<GroupedPlatform[]>([]);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  // Rename
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Invite partner
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRevocable, setInviteRevocable] = useState(true);
  const [inviting, setInviting] = useState(false);

  // Delete / merge
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!poolId) return;
    setLoading(true);
    try {
      const headers = await authHeaders();
      const [poolRes, partnersRes, siblingsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/pools/${poolId}/locations`, { headers }),
        currentOrg?.id
          ? fetch(`${API_BASE_URL}/api/cross-org/partnerships?orgId=${currentOrg.id}`, { headers }).catch(() => null)
          : Promise.resolve(null),
        currentOrg?.id
          ? fetch(`${API_BASE_URL}/api/pools/org/${currentOrg.id}`, { headers }).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (poolRes.ok) {
        const j = await poolRes.json();
        if (j.pool?.name) setPoolName(j.pool.name);
        if (typeof j.pool?.isPartnerPool === 'boolean') setIsPartnerPool(j.pool.isPartnerPool);
        setLocations(Array.isArray(j.locations) ? j.locations : []);
      }
      if (partnersRes?.ok) {
        const data = await partnersRes.json();
        setPartnerships(Array.isArray(data.partnerships) ? data.partnerships : []);
      }
      if (siblingsRes?.ok) {
        const data = await siblingsRes.json();
        const list: any[] = Array.isArray(data) ? data : [];
        setSiblings(list.filter((p) => p.id !== poolId).map((p) => ({ id: p.id, name: p.name })));
      }
    } catch {
      // surfaced via empty states
    } finally {
      setLoading(false);
    }
  }, [poolId, currentOrg?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pull-to-refresh: re-pull the pool's locations, partnerships, and siblings.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.all([Promise.resolve(load())]).finally(() => setRefreshing(false));
  }, [load]);

  // Partnerships that reference this pool (rows only carry poolName).
  const poolPartnerships = useMemo(
    () => partnerships.filter((p) => (p.poolName || '').toLowerCase() === poolName.toLowerCase()),
    [partnerships, poolName],
  );

  const openAddLocations = async () => {
    setAddOpen(true);
    setPickedIds(new Set());
    if (!currentOrg?.id) return;
    setAvailableLoading(true);
    try {
      const headers = await authHeaders();
      const r = await fetch(`${API_BASE_URL}/api/pools/locations/available?orgId=${currentOrg.id}`, { headers });
      if (!r.ok) return;
      const record: Record<string, any> = await r.json();
      const inPoolIds = new Set(locations.map((l) => l.platformLocationId));
      setAvailable(groupAvailableLocations(record || {}, inPoolIds));
    } finally {
      setAvailableLoading(false);
    }
  };

  const confirmAddLocations = async () => {
    if (pickedIds.size === 0) {
      setAddOpen(false);
      return;
    }
    setAdding(true);
    try {
      const headers = await authHeaders();
      const r = await fetch(`${API_BASE_URL}/api/pools/${poolId}/locations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ location_ids: Array.from(pickedIds) }),
      });
      if (!r.ok) throw new Error(await r.text());
      setAddOpen(false);
      void load();
    } catch {
      Alert.alert('Error', 'Failed to add locations to the pool.');
    } finally {
      setAdding(false);
    }
  };

  const removeLocation = (loc: PoolLocation) => {
    Alert.alert('Remove location', `Remove "${loc.locationName}" from this pool?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const headers = await authHeaders();
            const r = await fetch(`${API_BASE_URL}/api/pools/${poolId}/locations/${loc.platformLocationId}`, {
              method: 'DELETE',
              headers,
            });
            if (!r.ok) throw new Error(await r.text());
            void load();
          } catch {
            Alert.alert('Error', 'Failed to remove the location.');
          }
        },
      },
    ]);
  };

  const confirmRename = async () => {
    const name = renameDraft.trim();
    if (!name || name === poolName) {
      setRenameOpen(false);
      return;
    }
    setRenaming(true);
    try {
      const headers = await authHeaders();
      const r = await fetch(`${API_BASE_URL}/api/pools/${poolId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name, location_ids: locations.map((l) => l.platformLocationId) }),
      });
      if (!r.ok) throw new Error(await r.text());
      setPoolName(name);
      setRenameOpen(false);
    } catch {
      Alert.alert('Error', 'Failed to rename the pool.');
    } finally {
      setRenaming(false);
    }
  };

  const sendInvite = async () => {
    const email = inviteEmail.trim();
    if (!email) {
      Alert.alert('Email required', 'Enter your partner\'s email address.');
      return;
    }
    setInviting(true);
    try {
      const headers = await authHeaders();
      const r = await fetch(`${API_BASE_URL}/api/cross-org/invites`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          inviteeEmail: email,
          poolId,
          shareType: inviteRevocable ? 'consignment' : 'sync',
          syncDirection: 'bidirectional',
          canRevoke: inviteRevocable,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const { inviteLink } = await r.json();
      if (inviteLink) Clipboard.setString(inviteLink);
      setInviteOpen(false);
      setInviteEmail('');
      Alert.alert('Invite sent', inviteLink ? 'The invite link was copied to your clipboard.' : 'Your partner will get an email.');
      void load();
    } catch {
      Alert.alert('Error', 'Failed to send the invite.');
    } finally {
      setInviting(false);
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const headers = await authHeaders();
      const r = await fetch(`${API_BASE_URL}/api/pools/${poolId}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify(mergeTarget ? { mergeIntoPoolId: mergeTarget } : {}),
      });
      if (!r.ok) throw new Error(await r.text());
      setDeleteOpen(false);
      navigation.goBack();
    } catch {
      Alert.alert('Error', 'Failed to delete the pool.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND_PRIMARY} colors={[BRAND_PRIMARY]} />}
      >
        <PageHeader
          title={poolName}
          onBack={() => navigation.goBack()}
          right={
            !isPartnerPool ? (
              <TouchableOpacity
                style={styles.editPill}
                activeOpacity={0.8}
                onPress={() => {
                  setRenameDraft(poolName);
                  setRenameOpen(true);
                }}
              >
                <Pencil size={14} color="#FFFFFF" />
                <Text style={styles.editPillText}>Rename</Text>
              </TouchableOpacity>
            ) : undefined
          }
        />

        {isPartnerPool && (
          <View style={styles.partnerBanner}>
            <Handshake size={18} color="#A2611A" />
            <Text style={styles.partnerBannerText}>
              Shared with you by a partner — its locations are managed by the owner.
            </Text>
          </View>
        )}

        {/* Locations */}
        <Text style={styles.section}>Locations</Text>
        <View style={styles.card}>
          {loading ? (
            <View style={styles.loadingRow}><ActivityIndicator color="#93C822" /></View>
          ) : locations.length === 0 ? (
            <Text style={styles.empty}>No locations in this pool yet.</Text>
          ) : (
            locations.map((loc, i) => (
              <View key={loc.platformLocationId} style={[styles.row, i > 0 && styles.rowBorder]}>
                <PlatformAvatar platformType={(loc.platformConnection?.platformType || '').toLowerCase()} size="medium" />
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{loc.locationName}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{loc.platformConnection?.displayName}</Text>
                </View>
                {!isPartnerPool && (
                  <TouchableOpacity
                    onPress={() => removeLocation(loc)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.removeBtn}
                  >
                    <X size={16} color="#9CA3AF" />
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </View>
        {!isPartnerPool && (
          <TouchableOpacity style={styles.primaryBtn} onPress={openAddLocations} activeOpacity={0.85}>
            <Plus size={18} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>Add locations</Text>
          </TouchableOpacity>
        )}

        {/* Sharing */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.section, { marginBottom: 0 }]}>Sharing</Text>
          {!isPartnerPool && (
            <TouchableOpacity style={styles.darkPill} activeOpacity={0.8} onPress={() => setInviteOpen(true)}>
              <Handshake size={14} color="#FFFFFF" />
              <Text style={styles.darkPillText}>Invite partner</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.card}>
          {poolPartnerships.length === 0 ? (
            <Text style={styles.empty}>
              Not shared yet. Invite a partner to consign or sync this pool's inventory.
            </Text>
          ) : (
            poolPartnerships.map((p, i) => (
              <View key={`${p.partnerOrgName || p.partnerEmail}-${i}`} style={[styles.row, i > 0 && styles.rowBorder]}>
                <View style={styles.shareIcon}>
                  <Handshake size={20} color="#A2611A" />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{p.partnerOrgName || p.partnerEmail}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{p.status || 'Active partnership'}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Danger zone */}
        {!isPartnerPool && (
          <>
            <Text style={[styles.section, { marginTop: 26 }]}>Danger zone</Text>
            <View style={[styles.card, styles.dangerCard]}>
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => {
                  setMergeTarget(siblings[0]?.id ?? null);
                  setDeleteOpen(true);
                }}
              >
                <View style={styles.dangerIcon}>
                  <Trash2 size={20} color="#DC2626" />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.dangerTitle}>Delete pool</Text>
                  <Text style={styles.rowSub}>
                    {siblings.length > 0 ? 'Optionally merge its locations into another pool' : 'Locations will be unassigned'}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>

      {/* Add-locations sheet */}
      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add locations</Text>
            {availableLoading ? (
              <View style={styles.loadingRow}><ActivityIndicator color="#93C822" /></View>
            ) : available.length === 0 ? (
              <Text style={styles.empty}>Every available location is already in this pool.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                <PoolLocationPicker
                  available={available}
                  pickedIds={pickedIds}
                  onToggle={(id) =>
                    setPickedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      return next;
                    })
                  }
                />
              </ScrollView>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAddOpen(false)} activeOpacity={0.8}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, (adding || pickedIds.size === 0) && { opacity: 0.5 }]}
                onPress={confirmAddLocations}
                disabled={adding || pickedIds.size === 0}
                activeOpacity={0.8}
              >
                {adding ? <ActivityIndicator color="#FFFFFF" size="small" /> : (
                  <Text style={styles.confirmText}>Add{pickedIds.size > 0 ? ` ${pickedIds.size}` : ''}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename */}
      <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename pool</Text>
            <TextInput
              style={styles.input}
              value={renameDraft}
              onChangeText={setRenameDraft}
              placeholder="Pool name"
              placeholderTextColor="#C7C7CC"
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setRenameOpen(false)} activeOpacity={0.8}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, renaming && { opacity: 0.6 }]}
                onPress={confirmRename}
                disabled={renaming}
                activeOpacity={0.8}
              >
                {renaming ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.confirmText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Invite partner */}
      <Modal visible={inviteOpen} transparent animationType="fade" onRequestClose={() => setInviteOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Invite a partner</Text>
            <Text style={styles.modalBody}>They'll get access to this pool's inventory.</Text>
            <TextInput
              style={styles.input}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="partner@email.com"
              placeholderTextColor="#C7C7CC"
              autoCapitalize="none"
              keyboardType="email-address"
              autoFocus
            />
            <TouchableOpacity
              style={styles.toggleRow}
              activeOpacity={0.7}
              onPress={() => setInviteRevocable((v) => !v)}
            >
              <View style={[styles.checkbox, inviteRevocable && styles.checkboxOn]}>
                {inviteRevocable && <Check size={14} color="#FFFFFF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Consignment (revocable)</Text>
                <Text style={styles.rowSub}>Unchecked sends a permanent two-way sync share</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setInviteOpen(false)} activeOpacity={0.8}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, inviting && { opacity: 0.6 }]}
                onPress={sendInvite}
                disabled={inviting}
                activeOpacity={0.8}
              >
                {inviting ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.confirmText}>Send invite</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete / merge */}
      <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => setDeleteOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete "{poolName}"?</Text>
            {siblings.length > 0 ? (
              <>
                <Text style={styles.modalBody}>Move its locations into another pool, or remove them:</Text>
                {siblings.map((s) => (
                  <TouchableOpacity key={s.id} style={styles.pickRow} activeOpacity={0.7} onPress={() => setMergeTarget(s.id)}>
                    <View style={[styles.radio, mergeTarget === s.id && styles.radioOn]} />
                    <Text style={styles.rowTitle}>Merge into "{s.name}"</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.pickRow} activeOpacity={0.7} onPress={() => setMergeTarget(null)}>
                  <View style={[styles.radio, mergeTarget === null && styles.radioOn]} />
                  <Text style={styles.rowTitle}>Don't merge — unassign locations</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.modalBody}>Its locations will be left unassigned. This cannot be undone.</Text>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setDeleteOpen(false)} activeOpacity={0.8}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteBtn, deleting && { opacity: 0.6 }]}
                onPress={confirmDelete}
                disabled={deleting}
                activeOpacity={0.8}
              >
                {deleting ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.confirmText}>Delete pool</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F7F4' },

  section: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginLeft: 4 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 10 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 16, borderWidth: 1, borderColor: '#ECEBE6' },
  dangerCard: { borderColor: 'rgba(220,38,38,0.25)' },
  loadingRow: { paddingVertical: 26, alignItems: 'center' },
  empty: { paddingVertical: 22, textAlign: 'center', color: '#9CA3AF', fontFamily: 'Inter_500Medium', fontSize: 13, paddingHorizontal: 8, lineHeight: 19 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F1F1EE' },
  rowInfo: { flex: 1 },
  rowTitle: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  rowSub: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular', marginTop: 2 },
  removeBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F1F1EE', alignItems: 'center', justifyContent: 'center' },

  partnerBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(162,97,26,0.10)',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 18,
  },
  partnerBannerText: { flex: 1, fontSize: 13, color: '#A2611A', fontFamily: 'Inter_500Medium', lineHeight: 18 },

  shareIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(162,97,26,0.12)' },
  dangerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(220,38,38,0.10)', alignItems: 'center', justifyContent: 'center' },
  dangerTitle: { fontSize: 16, color: '#DC2626', fontFamily: 'Inter_600SemiBold' },

  editPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#18181B', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  editPillText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  darkPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#18181B', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  darkPillText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#93C822', borderRadius: 16, paddingVertical: 15, marginTop: 14 },
  primaryBtnText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 15 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 20 },
  modalTitle: { fontSize: 20, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 8 },
  modalBody: { fontSize: 14, color: '#71717A', fontFamily: 'Inter_400Regular', lineHeight: 21, marginBottom: 12 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: '#F1F1EE' },
  cancelText: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  confirmBtn: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: '#93C822' },
  confirmText: { fontSize: 15, color: '#FFFFFF', fontFamily: 'Inter_700Bold' },
  deleteBtn: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: '#DC2626' },

  input: {
    borderWidth: 1, borderColor: '#ECEBE6', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 15, color: '#18181B', fontFamily: 'Inter_400Regular', backgroundColor: '#FAFAF8', marginBottom: 8,
  },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  checkbox: {
    width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: '#D4D4D8',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#93C822', borderColor: '#93C822' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#D4D4D8' },
  radioOn: { borderWidth: 6, borderColor: '#93C822' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});

export default PoolDetailScreen;
