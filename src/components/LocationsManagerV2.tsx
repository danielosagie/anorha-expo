import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import Button from './Button';
import Card from './Card';
import ShopifySvg from '../assets/shopify.svg';
import SquareSvg from '../assets/square.svg';
import CloverSvg from '../assets/clover.svg';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';

const API_BASE_URL = 'https://api.sssync.app';

const PLATFORM_LOGOS: Record<string, any> = {
  shopify: ShopifySvg,
  square: SquareSvg,
  clover: CloverSvg,
};

type ManageTab = 'location' | 'pool';

interface LocationsManagerV2Props {
  orgId?: string;
  platformConnections: Array<{ Id: string; PlatformType: string; DisplayName: string }>;
}

interface LocationPool {
  id: string;
  name: string;
  description?: string;
  sync_inventory?: boolean;
  sync_pricing?: boolean;
}

interface AvailablePlatformGroup {
  platformType: string; // 'shopify' | 'square' | 'clover' ...
  connections: Array<{
    connectionId: string;
    connectionName: string;
    locations: Array<{
      id: string; // PlatformLocationId
      name: string;
      timezone?: string;
    }>;
  }>
}

interface PoolLocationRow {
  platform_location_id: string;
  PlatformConnections?: { Id: string; PlatformType: string; DisplayName: string };
  PlatformLocations?: { Name: string };
}

// Minimal PlatformLocation record read directly from the DB for single location list display
interface DbPlatformLocation {
  PlatformConnectionId: string;
  PlatformLocationId: string;
  Name: string | null;
}

// Delete confirmation state
interface DeletePoolState {
  visible: boolean;
  poolId: string | null;
  mergeTarget: string | null;
  availablePools: LocationPool[];
  loading: boolean;
}

const LocationsManagerV2: React.FC<LocationsManagerV2Props> = ({ orgId, platformConnections }) => {
  const theme = useTheme();

  // List state (top card)
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [pools, setPools] = useState<LocationPool[]>([]);
  const [singleLocations, setSingleLocations] = useState<DbPlatformLocation[]>([]);
  const [selectedListItem, setSelectedListItem] = useState<{ kind: 'pool' | 'single' | null; id?: string | null }>({ kind: null, id: null });
  const [resolvedOrgId, setResolvedOrgId] = useState<string | null>(orgId || null);

  // Manage modal state
  const [manageVisible, setManageVisible] = useState(false);
  const [manageTab, setManageTab] = useState<ManageTab>('location');

  // Manage form state
  const [groupName, setGroupName] = useState('');
  const [available, setAvailable] = useState<AvailablePlatformGroup[]>([]);
  const [existingRows, setExistingRows] = useState<PoolLocationRow[]>([]);
  const [selectedByConnection, setSelectedByConnection] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Delete modal state
  const [deleteState, setDeleteState] = useState<DeletePoolState>({
    visible: false,
    poolId: null,
    mergeTarget: null,
    availablePools: [],
    loading: false,
  });

  const connectionIds = useMemo(() => platformConnections?.map((c) => c.Id) || [], [platformConnections]);

  const connectionById = useMemo(() => {
    const map = new Map<string, { Id: string; PlatformType: string; DisplayName: string }>();
    for (const c of platformConnections || []) map.set(c.Id, c as any);
    return map;
  }, [platformConnections]);

  const loadList = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await ensureSupabaseJwt();

      if (!resolvedOrgId) {
        setPools([]);
        setSingleLocations([]);
        return;
      }

      // Load pools
      const res = await fetch(`${API_BASE_URL}/api/pools/org/${resolvedOrgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const poolData = res.ok ? ((await res.json()) as LocationPool[]) : [];
      setPools(Array.isArray(poolData) ? poolData : []);

      // Load single platform locations directly from DB (fast path)
      if (connectionIds.length > 0) {
        const { data: platformLocs } = await supabase
          .from('PlatformLocations')
          .select('PlatformConnectionId, PlatformLocationId, Name')
          .in('PlatformConnectionId', connectionIds);
        setSingleLocations(platformLocs || []);
      } else {
        setSingleLocations([]);
      }
    } catch (e) {
      console.error('[LocationsManagerV2] loadList error', e);
      setPools([]);
      setSingleLocations([]);
    } finally {
      setIsLoading(false);
    }
  }, [resolvedOrgId, connectionIds]);

  useEffect(() => {
    loadList();
  }, [resolvedOrgId, loadList]);

  // Resolve org id on mount if not provided
  useEffect(() => {
    (async () => {
      if (resolvedOrgId) return;
      try {
        const token = await ensureSupabaseJwt();
        const r = await fetch(`${API_BASE_URL}/api/organizations/me/active`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) {
          const j = await r.json();
          setResolvedOrgId(j?.id || j?.orgId || null);
        } else {
          setResolvedOrgId(null);
        }
      } catch {
        setResolvedOrgId(null);
      }
    })();
  }, []);

  // Available locations for the manage modal
  const loadAvailableLocations = useCallback(async () => {
    try {
      const token = await ensureSupabaseJwt();
      if (!resolvedOrgId) { setAvailable([]); return; }
      const r = await fetch(`${API_BASE_URL}/api/pools/locations/available?orgId=${resolvedOrgId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) throw new Error('Failed to load locations');
      const j: AvailablePlatformGroup[] = await r.json();
      setAvailable(Array.isArray(j) ? j : []);
    } catch (e) {
      console.error('[LocationsManagerV2] loadAvailableLocations error', e);
      setAvailable([]);
    }
  }, [resolvedOrgId]);

  // Load rows for an existing pool
  const loadPoolRows = useCallback(async (poolId: string) => {
    try {
      const token = await ensureSupabaseJwt();
      const r = await fetch(`${API_BASE_URL}/api/pools/${poolId}/locations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error('Failed to load pool');
      const j = await r.json();
      const rows: PoolLocationRow[] = j.locations || [];
      setExistingRows(rows);
      setGroupName(j.pool?.name || '');

      // Hydrate current mapping (pick first per connection)
      const mapping: Record<string, string> = {};
      for (const row of rows) {
        const connId = row.PlatformConnections?.Id;
        if (connId && !mapping[connId]) mapping[connId] = row.platform_location_id;
      }
      setSelectedByConnection(mapping);
    } catch (e) {
      console.error('[LocationsManagerV2] loadPoolRows error', e);
      setExistingRows([]);
      setGroupName('');
      setSelectedByConnection({});
    }
  }, []);

  const openManage = async (tab: ManageTab) => {
    setManageTab(tab);
    setManageVisible(true);
    await loadAvailableLocations();

    // If a pool is selected, load its details; otherwise, reset for create
    if (selectedListItem.kind === 'pool' && selectedListItem.id) {
      await loadPoolRows(selectedListItem.id);
    } else {
      setGroupName('');
      setExistingRows([]);
      setSelectedByConnection({});
    }
  };

  const setSelection = (connectionId: string, locId: string) => {
    setSelectedByConnection((prev) => ({ ...prev, [connectionId]: locId }));
  };

  const handleConfirm = async () => {
    // Create or update a pool based on current selection
    try {
      setSaving(true);
      const token = await ensureSupabaseJwt();

      const chosenLocationIds = Object.values(selectedByConnection).filter(Boolean);
      const isEditing = selectedListItem.kind === 'pool' && !!selectedListItem.id;

      if (isEditing && selectedListItem.id) {
        // Update name
        await fetch(`${API_BASE_URL}/api/pools/${selectedListItem.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: groupName.trim() || undefined }),
        });

        // Load current rows to compute deltas
        const existingByConn = new Map<string, string[]>();
        for (const r of existingRows) {
          const cid = r.PlatformConnections?.Id;
          if (!cid) continue;
          if (!existingByConn.has(cid)) existingByConn.set(cid, []);
          existingByConn.get(cid)!.push(r.platform_location_id);
        }

        const toAdd: string[] = [];
        const toRemove: string[] = [];
        for (const [connId, locId] of Object.entries(selectedByConnection)) {
          const list = existingByConn.get(connId) || [];
          if (locId && !list.includes(locId)) toAdd.push(locId);
          for (const l of list) if (l !== locId) toRemove.push(l);
        }
        for (const [connId, list] of existingByConn) {
          if (!selectedByConnection[connId]) {
            for (const l of list) toRemove.push(l);
          }
        }

        // Apply removals then adds
        await Promise.all(
          toRemove.map((id) =>
            fetch(`${API_BASE_URL}/api/pools/${selectedListItem.id}/locations/${id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            })
          )
        );
        if (toAdd.length > 0) {
          await fetch(`${API_BASE_URL}/api/pools/${selectedListItem.id}/locations`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ location_ids: toAdd }),
          });
        }
      } else {
        // Create new pool with chosen locations
        if (!resolvedOrgId) throw new Error('No organization');
        const r = await fetch(`${API_BASE_URL}/api/pools`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: resolvedOrgId,
            name: groupName.trim() || 'New Pool',
            syncInventory: true,
            syncPricing: true,
            location_ids: chosenLocationIds.length > 0 ? chosenLocationIds : undefined,
          }),
        });
        if (!r.ok) throw new Error(`Create failed (${r.status})`);
      }

      setManageVisible(false);
      await loadList();
    } catch (e) {
      console.error('[LocationsManagerV2] handleConfirm error', e);
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // NEW: Load available pools for merge target selection
  const loadAvailablePoolsForDelete = useCallback(async (excludePoolId: string) => {
    try {
      const token = await ensureSupabaseJwt();
      if (!resolvedOrgId) return [];

      const res = await fetch(`${API_BASE_URL}/api/pools/org/${resolvedOrgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Failed to load pools for delete');

      const poolData: LocationPool[] = await res.json();
      const filteredPools = (Array.isArray(poolData) ? poolData : []).filter(p => p.id !== excludePoolId);
      
      setDeleteState(prev => ({ ...prev, availablePools: filteredPools }));
      return filteredPools;
    } catch (e) {
      console.error('[LocationsManagerV2] loadAvailablePoolsForDelete error', e);
      setDeleteState(prev => ({ ...prev, availablePools: [] }));
      return [];
    }
  }, [resolvedOrgId]);

  // NEW: Handle pool delete confirmation
  const confirmDeletePool = async () => {
    if (!deleteState.poolId || !resolvedOrgId || deleteState.mergeTarget === null) {
      Alert.alert('Error', 'Invalid delete state');
      return;
    }

    setDeleteState(prev => ({ ...prev, loading: true }));

    try {
      const token = await ensureSupabaseJwt();

      const res = await fetch(`${API_BASE_URL}/api/pools/${deleteState.poolId}`, {
        method: 'DELETE',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          mergeIntoPoolId: deleteState.mergeTarget === 'none' ? undefined : deleteState.mergeTarget 
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Delete failed: ${res.status} - ${errorText}`);
      }

      Alert.alert('Success', 'Pool deleted successfully');
      setDeleteState({ visible: false, poolId: null, mergeTarget: null, availablePools: [], loading: false });
      await loadList(); // Refresh the list
    } catch (e) {
      console.error('[LocationsManagerV2] deletePool error', e);
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete pool');
      setDeleteState(prev => ({ ...prev, loading: false }));
    }
  };

  // NEW: Open delete confirmation for a pool
  const openDeletePool = async (poolId: string, poolName: string) => {
    const availablePools = await loadAvailablePoolsForDelete(poolId);
    const defaultMergeTarget = availablePools.length > 0 ? availablePools[0].id : 'none';
    
    setDeleteState({
      visible: true,
      poolId,
      mergeTarget: defaultMergeTarget, // Default to first available pool or 'none'
      availablePools,
      loading: false,
    });
    Alert.alert(
      'Delete Pool',
      `Are you sure you want to delete "${poolName}"? This will move its locations to another pool.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', onPress: () => {} }, // Modal will handle
      ]
    );
  };

  const renderListItemRight = (platformType?: string) => {
    if (!platformType) return null;
    const Logo = PLATFORM_LOGOS[platformType as keyof typeof PLATFORM_LOGOS];
    if (!Logo) return null;
    return <Logo width={16} height={16} />;
  };

  const groupedSingleLocations = useMemo(() => {
    // Reduce to distinct names; safe for display purposes only
    const items = singleLocations.map((l) => ({
      id: l.PlatformLocationId,
      name: l.Name || 'Unnamed Location',
      platformType: connectionById.get(l.PlatformConnectionId)?.PlatformType?.toLowerCase(),
    }));
    // Deduplicate by name+platform for cleaner listing
    const keySet = new Set<string>();
    const out: { id: string; name: string; platformType?: string }[] = [];
    for (const it of items) {
      const k = `${it.platformType}:${it.name}`;
      if (keySet.has(k)) continue;
      keySet.add(k);
      out.push(it);
    }
    return out;
  }, [singleLocations, connectionById]);

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Locations</Text>
          <TouchableOpacity
            onPress={() => openManage('location')}
            style={styles.manageBtn}
          >
            <Text style={styles.manageBtnText}>Manage</Text>
          </TouchableOpacity>
        </View>

        {(!resolvedOrgId || isLoading) ? (
          <View style={{ paddingVertical: 24 }}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : (
          <ScrollView>
            {(pools || []).map((p) => (
              <TouchableOpacity
                key={`pool-${p.id}`}
                style={[styles.listItem, selectedListItem.kind === 'pool' && selectedListItem.id === p.id && styles.listItemActive]}
                onPress={() => setSelectedListItem({ kind: 'pool', id: p.id })}
              >
                <Text style={styles.listItemText}>{p.name} - Pool</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="lock" size={14} color="#999" />
                  {/* Delete button for pools */}
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      openDeletePool(p.id, p.name);
                    }}
                    style={{ padding: 4 }}
                  >
                    <Icon name="delete-outline" size={20} color="#ff4444" />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))}

            {groupedSingleLocations.map((l) => (
              <TouchableOpacity
                key={`loc-${l.id}`}
                style={[styles.listItem, selectedListItem.kind === 'single' && selectedListItem.id === l.id && styles.listItemActive]}
                onPress={() => setSelectedListItem({ kind: 'single', id: l.id })}
              >
                <Text style={styles.listItemText}>{l.name}</Text>
                {renderListItemRight(l.platformType)}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <TouchableOpacity style={styles.confirmBtn} onPress={() => openManage('pool')}>
          <Icon name="plus-circle" size={18} color="#fff" />
          <Text style={styles.confirmBtnText}>Confirm New Location</Text>
        </TouchableOpacity>
      </View>

      {/* Manage Modal (mimics the image flow) */}
      <Modal visible={manageVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Managing Locations</Text>
              <TouchableOpacity onPress={() => setManageVisible(false)}>
                <Icon name="close" size={22} />
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={styles.tabsRow}>
              <TouchableOpacity
                onPress={() => setManageTab('location')}
                style={[styles.tab, manageTab === 'location' ? styles.tabActive : styles.tabGhost]}
              >
                <Text style={[styles.tabText, manageTab === 'location' && styles.tabTextActive]}>Location</Text>
                <Icon name="map-marker-outline" size={16} style={{ marginLeft: 6 }} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setManageTab('pool')}
                style={[styles.tab, manageTab === 'pool' ? styles.tabActive : styles.tabGhost]}
              >
                <Text style={[styles.tabText, manageTab === 'pool' && styles.tabTextActive]}>Location Pool</Text>
                <Icon name="account-group-outline" size={16} style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            </View>

            {/* Name input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>{manageTab === 'pool' ? 'Location Pool Name' : 'Location Name'}</Text>
              <TextInput
                value={groupName}
                onChangeText={setGroupName}
                placeholder={manageTab === 'pool' ? 'Atlanta' : 'Atlanta'}
                style={styles.textInput}
              />
            </View>

            {/* Connection rows with dropdown-like pickers */}
            <ScrollView style={{ maxHeight: 380 }}>
              {available.map((platform) => {
                const Logo = PLATFORM_LOGOS[platform.platformType as keyof typeof PLATFORM_LOGOS];
                return (
                  <View key={platform.platformType} style={{ marginBottom: 10 }}>
                    {platform.connections.map((conn) => (
                      <View key={conn.connectionId} style={styles.connRow}>
                        <View style={styles.connLeft}>
                          {Logo ? <Logo width={24} height={24} /> : null}
                          <Text style={styles.connName}>{conn.connectionName}</Text>
                        </View>
                        <View style={styles.comboShell}>
                          {/* Simple custom combobox: we render options as inline sheet */}
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.inlineChipsRow}>
                            {conn.locations.map((loc) => {
                              const selected = selectedByConnection[conn.connectionId] === loc.id;
                              return (
                                <TouchableOpacity
                                  key={loc.id}
                                  onPress={() => setSelection(conn.connectionId, loc.id)}
                                  style={[styles.chip, selected && styles.chipSelected]}
                                >
                                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{loc.name}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </ScrollView>
                        </View>
                      </View>
                    ))}
                  </View>
                );
              })}

              {/* Add another row (visual only per design) */}
              <View style={styles.addAnotherRow}>
                <Icon name="plus" size={18} color="#777" />
                <Text style={styles.addAnotherText}>{manageTab === 'pool' ? 'Add Another Location' : 'Add Another Platform'}</Text>
              </View>
            </ScrollView>

            {/* Footer actions */}
            <View style={styles.footerRow}>
              <Button title="Cancel" outlined onPress={() => setManageVisible(false)} style={{ flex: 1 }} />
              <Button
                title="Confirm New Location"
                onPress={handleConfirm}
                loading={saving}
                disabled={!groupName.trim()}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* NEW: Delete Confirmation Modal */}
      <Modal visible={deleteState.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 350 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Delete Pool</Text>
              <TouchableOpacity onPress={() => setDeleteState(prev => ({ ...prev, visible: false }))}>
                <Icon name="close" size={22} />
              </TouchableOpacity>
            </View>

            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              <Text style={styles.label}>Select merge target for locations:</Text>
              <View style={{ marginTop: 8 }}>
                {/* Option: Delete without merging (if no locations or user choice) */}
                <TouchableOpacity
                  style={[
                    styles.chip, 
                    deleteState.mergeTarget === 'none' && styles.chipSelected,
                    { marginBottom: 8, alignSelf: 'flex-start' }
                  ]}
                  onPress={() => setDeleteState(prev => ({ ...prev, mergeTarget: 'none' }))}
                >
                  <Text style={[
                    styles.chipText, 
                    deleteState.mergeTarget === 'none' && styles.chipTextSelected
                  ]}>
                    Delete without merging (locations become single)
                  </Text>
                </TouchableOpacity>

                {/* Available pools picker */}
                <ScrollView style={{ maxHeight: 200 }}>
                  {deleteState.availablePools.map((pool) => (
                    <TouchableOpacity
                      key={pool.id}
                      style={[
                        styles.chip, 
                        deleteState.mergeTarget === pool.id && styles.chipSelected,
                        { marginBottom: 4, alignSelf: 'flex-start' }
                      ]}
                      onPress={() => setDeleteState(prev => ({ ...prev, mergeTarget: pool.id }))}
                    >
                      <Text style={[
                        styles.chipText, 
                        deleteState.mergeTarget === pool.id && styles.chipTextSelected
                      ]}>
                        {pool.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {deleteState.availablePools.length === 0 && (
                  <Text style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                    No other pools available. Locations will become single.
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.footerRow}>
              <Button 
                title="Cancel" 
                outlined 
                onPress={() => setDeleteState(prev => ({ ...prev, visible: false }))} 
                style={{ flex: 1 }} 
              />
              <Button
                title={deleteState.loading ? "Deleting..." : "Delete Pool"}
                onPress={confirmDeletePool}
                loading={deleteState.loading}
                disabled={deleteState.loading || deleteState.mergeTarget === null}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default LocationsManagerV2;

const styles = StyleSheet.create({
  root: {
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  manageBtn: {
    borderWidth: 1,
    borderColor: '#d9d9d9',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f6f6f6',
  },
  manageBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  listItemActive: {
    backgroundColor: '#f3f8ff',
    borderColor: '#d0e2ff',
  },
  listItemText: {
    fontSize: 14,
    fontWeight: '600',
  },
  confirmBtn: {
    marginTop: 12,
    backgroundColor: '#8BC34A',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  confirmBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  tabGhost: {
    borderColor: '#d9d9d9',
    backgroundColor: '#fafafa',
  },
  tabActive: {
    borderColor: '#f0c36b',
    backgroundColor: '#fff5db',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#b8860b',
  },
  inputGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    color: '#333',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  connLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  connName: {
    fontSize: 14,
    fontWeight: '600',
  },
  comboShell: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  inlineChipsRow: {
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: '#fafafa',
  },
  chipSelected: {
    borderColor: '#8BC34A',
    backgroundColor: '#8BC34A20',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555',
  },
  chipTextSelected: {
    color: '#4CAF50',
  },
  addAnotherRow: {
    marginTop: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  addAnotherText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  footerRow: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 8,
  },
});


