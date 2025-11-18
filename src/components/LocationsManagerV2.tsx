import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
  Modal,
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

type ViewMode = 'default' | 'managePools' | 'createLocation' | 'createPool';
type ManageTab = 'location' | 'pool';

interface LocationsManagerV2Props {
  orgId?: string;
  platformConnections: Array<{ Id: string; PlatformType: string; DisplayName: string }>;
}

interface LocationPool {
  id: string;
  name: string;
  description?: string;
  locationIds?: string[];
}

interface AvailablePlatformGroup {
  platformType: string;
  connections: Array<{
    connectionId: string;
    connectionName: string;
    locations: Array<{
      id: string;
      name: string;
      timezone?: string;
    }>;
  }>;
}

interface TransformedLocationGroup {
  platformType: string;
  connections: Array<{
    connectionId: string;
    connectionName: string;
    locations: Array<{
      platformLocationId: string;
      locationName: string;
      timezone?: string;
    }>;
  }>;
}

interface PoolLocation {
  platformLocationId: string;
  locationName: string;
  timezone?: string;
  platformConnection: {
    id: string;
    platformType: string;
    displayName: string;
  };
}

interface DbPlatformLocation {
  PlatformConnectionId: string;
  PlatformLocationId: string;
  Name: string | null;
}

interface DraftPool {
  name: string;
  locationIds: string[];
}

interface DeletePoolState {
  visible: boolean;
  poolId: string | null;
  mergeTarget: string | null;
  availablePools: LocationPool[];
  loading: boolean;
}

const LocationsManagerV2: React.FC<LocationsManagerV2Props> = ({ orgId, platformConnections }) => {
  const theme = useTheme();

  // View mode state machine
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [manageTab, setManageTab] = useState<ManageTab>('pool');

  // List state (top card)
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [pools, setPools] = useState<LocationPool[]>([]);
  const [singleLocations, setSingleLocations] = useState<DbPlatformLocation[]>([]);
  const [selectedListItem, setSelectedListItem] = useState<{ kind: 'pool' | 'single' | null; id?: string | null }>({ kind: null, id: null });
  const [resolvedOrgId, setResolvedOrgId] = useState<string | null>(orgId || null);

  // Available locations for creating/editing pools
  const [available, setAvailable] = useState<TransformedLocationGroup[]>([]);

  // Draft pools for manage mode (per-pool editing)
  const [draftPools, setDraftPools] = useState<Record<string, DraftPool>>({});

  // For create new location/pool
  const [newPoolName, setNewPoolName] = useState('');
  const [newPoolLocations, setNewPoolLocations] = useState<Record<string, string[]>>({});

  // Loading and saving states
  const [loadingManage, setLoadingManage] = useState(false);
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
      Alert.alert('Error', 'Failed to load locations');
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

  // Transform API response from Record<connId, {...}> to the grouped format we need
  const transformAvailableLocations = (record: Record<string, any>): TransformedLocationGroup[] => {
    const byPlatform = new Map<string, TransformedLocationGroup>();

    // Handle empty object or null
    if (!record || Object.keys(record).length === 0) {
      console.log('[LocationsManagerV2] No available locations (empty record)');
      return [];
    }

    for (const [connId, connData] of Object.entries(record)) {
      if (!connData) continue;
      
      const platformType = connData.platformType?.toLowerCase();
      if (!platformType) continue;

      if (!byPlatform.has(platformType)) {
        byPlatform.set(platformType, {
          platformType,
          connections: [],
        });
      }

      const group = byPlatform.get(platformType)!;
      
      // Only add if there are locations
      const locations = connData.locations || [];
      if (locations.length > 0) {
        group.connections.push({
          connectionId: connId,
          connectionName: connData.connectionName,
          locations: locations.map((loc: any) => ({
            platformLocationId: loc.platformLocationId,
            locationName: loc.locationName,
            timezone: loc.timezone,
          })),
        });
      }
    }

    const result = Array.from(byPlatform.values());
    console.log('[LocationsManagerV2] Transformed locations:', result.length, 'platforms');
    return result;
  };

  // Load available locations for creating/editing
  const loadAvailableLocations = useCallback(async () => {
    try {
      const token = await ensureSupabaseJwt();
      if (!resolvedOrgId) {
        console.log('[LocationsManagerV2] No org ID, skipping locations load');
        setAvailable([]);
        return;
      }
      console.log('[LocationsManagerV2] Loading available locations for org:', resolvedOrgId);
      const r = await fetch(`${API_BASE_URL}/api/pools/locations/available?orgId=${resolvedOrgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const errorText = await r.text();
        throw new Error(`Failed to load locations: ${r.status} - ${errorText}`);
      }
      const rawRecord: Record<string, any> = await r.json();
      console.log('[LocationsManagerV2] Raw API response:', rawRecord);
      const transformed = transformAvailableLocations(rawRecord);
      console.log('[LocationsManagerV2] Transformed result:', transformed);
      setAvailable(transformed);
    } catch (e) {
      console.error('[LocationsManagerV2] loadAvailableLocations error', e);
      setAvailable([]);
    }
  }, [resolvedOrgId]);

  // Load an existing pool and its locations for editing
  const loadPoolForEditing = useCallback(
    async (poolId: string) => {
    try {
      const token = await ensureSupabaseJwt();
      const r = await fetch(`${API_BASE_URL}/api/pools/${poolId}/locations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error('Failed to load pool');
      const j = await r.json();
        const pool: LocationPool = j.pool;
        const locations: PoolLocation[] = j.locations || [];

        // Group locations by connection, supporting multiple per connection
        const locsByConn: Record<string, string[]> = {};
        for (const loc of locations) {
          const connId = loc.platformConnection.id;
          if (!locsByConn[connId]) {
            locsByConn[connId] = [];
          }
          locsByConn[connId].push(loc.platformLocationId);
        }

        setDraftPools((prev) => ({
          ...prev,
          [poolId]: {
            name: pool.name,
            locationIds: pool.locationIds || [],
          },
        }));
    } catch (e) {
        console.error('[LocationsManagerV2] loadPoolForEditing error', e);
        Alert.alert('Error', 'Failed to load pool details');
      }
    },
    []
  );

  // Enter manage mode: load all pools and their locations
  const enterManageMode = async () => {
    setLoadingManage(true);
    try {
      const token = await ensureSupabaseJwt();
      
      // Load available locations FIRST
      console.log('[LocationsManagerV2] enterManageMode: loading available locations');
    await loadAvailableLocations();

      if (!resolvedOrgId) return;

      // Load all pools and prepare drafts
      console.log('[LocationsManagerV2] enterManageMode: loading pools for org', resolvedOrgId);
      const res = await fetch(`${API_BASE_URL}/api/pools/org/${resolvedOrgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load pools');
      const poolList: LocationPool[] = await res.json();
      console.log('[LocationsManagerV2] enterManageMode: found', poolList.length, 'pools');

      // Load each pool's locations
      const drafts: Record<string, DraftPool> = {};
      for (const pool of poolList) {
        await loadPoolForEditing(pool.id);
        drafts[pool.id] = {
          name: pool.name,
          locationIds: pool.locationIds || [],
        };
      }
      setDraftPools(drafts);

      // Reset per-pool platform selection state (all closed by default)
      setManagePlatformSelectionByPool({});

      setViewMode('managePools');
    } catch (e) {
      console.error('[LocationsManagerV2] enterManageMode error', e);
      Alert.alert('Error', 'Failed to load managing view');
    } finally {
      setLoadingManage(false);
    }
  };

  // Enter create location/pool mode - default to location tab
  const enterCreateMode = async () => {
    setManageTab('location');
    setNewPoolName('');
    setNewPoolLocations({});
    setCreateAddPlatformMode(false);
    setSelectedPlatformForManage(null);
    setActiveCreateDropdownConnId(null);
    await loadAvailableLocations();
    setViewMode('createLocation');
  };

  // Switch from create location to create pool (when user clicks "Add Another Location")
  const switchToCreatePool = () => {
    setManageTab('pool');
    setViewMode('createPool');
  };

  // Toggle location selection in create/edit forms (supports multi-select per connection)
  const toggleLocationSelection = (
    mode: 'create' | 'edit',
    connectionId: string,
    platformLocationId: string
  ) => {
    if (mode === 'create') {
      setNewPoolLocations((prev) => {
        const current = prev[connectionId] || [];
        const idx = current.indexOf(platformLocationId);
        if (idx >= 0) {
          return {
            ...prev,
            [connectionId]: current.filter((_, i) => i !== idx),
          };
        } else {
          return {
            ...prev,
            [connectionId]: [...current, platformLocationId],
          };
        }
      });
    } else {
      // For edit, we update the draft pool's locationIds
      // This is handled per pool in the manage view
    }
  };

  // Confirm all changes in manage mode and save pools
  const confirmManageChanges = async () => {
    try {
      setSaving(true);
      const token = await ensureSupabaseJwt();

      // For each modified draft, call PATCH /api/pools/:id
      for (const [poolId, draft] of Object.entries(draftPools)) {
        const currentPool = pools.find((p) => p.id === poolId);
        if (!currentPool) continue;

        // Only save if something changed
        if (draft.name !== currentPool.name || JSON.stringify(draft.locationIds) !== JSON.stringify(currentPool.locationIds)) {
          const res = await fetch(`${API_BASE_URL}/api/pools/${poolId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: draft.name,
              location_ids: draft.locationIds,
            }),
          });
          if (!res.ok) throw new Error(`Failed to update pool ${poolId}`);
        }
      }

      // Reload list and exit manage mode
      await loadList();
      setViewMode('default');
      setDraftPools({});
    } catch (e) {
      console.error('[LocationsManagerV2] confirmManageChanges error', e);
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // Create new pool or location
  const confirmCreate = async (overrideName?: string) => {
    try {
      setSaving(true);
      const token = await ensureSupabaseJwt();

      if (!resolvedOrgId) throw new Error('No organization');

      const nameToUse = (overrideName ?? newPoolName).trim();
      if (!nameToUse) throw new Error('Name is required');

      // Collect all selected locations
      const allLocationIds: string[] = [];
      for (const locIds of Object.values(newPoolLocations)) {
        allLocationIds.push(...locIds);
      }

      if (allLocationIds.length === 0) throw new Error('Select at least one location');

      const res = await fetch(`${API_BASE_URL}/api/pools`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orgId: resolvedOrgId,
          name: nameToUse,
            syncInventory: true,
            syncPricing: true,
          location_ids: allLocationIds,
          }),
        });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(error || 'Failed to create pool');
      }

      // Reset and reload
      setNewPoolName('');
      setNewPoolLocations({});
      await loadList();
      setViewMode('default');
    } catch (e) {
      console.error('[LocationsManagerV2] confirmCreate error', e);
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to create pool');
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
    const items = singleLocations.map((l) => ({
      id: l.PlatformLocationId,
      name: l.Name || 'Unnamed Location',
      platformType: connectionById.get(l.PlatformConnectionId)?.PlatformType?.toLowerCase(),
    }));
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

  // Fast lookup for available locations by platformLocationId
  const availableLocationById = useMemo(() => {
    const map = new Map<
      string,
      {
        platformLocationId: string;
        locationName: string;
        timezone?: string;
        connectionName?: string;
        platformType?: string;
      }
    >();

    for (const platform of available) {
      for (const conn of platform.connections) {
        for (const loc of conn.locations) {
          map.set(loc.platformLocationId, {
            platformLocationId: loc.platformLocationId,
            locationName: loc.locationName,
            timezone: loc.timezone,
            connectionName: conn.connectionName,
            platformType: platform.platformType,
          });
        }
      }
    }

    return map;
  }, [available]);

  // Render the appropriate view based on viewMode
  const renderView = () => {
    if (viewMode === 'default') {
      return renderDefaultView();
    } else if (viewMode === 'managePools') {
      return renderManagePoolsView();
    } else if (viewMode === 'createLocation') {
      return renderCreateLocationView();
    } else if (viewMode === 'createPool') {
      return renderCreatePoolView();
    }
    return null;
  };

  // Default view: list of pools and locations
  const renderDefaultView = () => (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Locations</Text>
        <TouchableOpacity onPress={enterManageMode} style={styles.manageBtn}>
            <Text style={styles.manageBtnText}>Manage</Text>
          </TouchableOpacity>
        </View>

        {(!resolvedOrgId || isLoading) ? (
          <View style={{ paddingVertical: 24 }}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : (
          <ScrollView>
          {/* Pools section */}
          {pools.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Pools</Text>
              {pools.map((p) => (
              <TouchableOpacity
                key={`pool-${p.id}`}
                  style={[
                    styles.listItem,
                    selectedListItem.kind === 'pool' && selectedListItem.id === p.id && styles.listItemPoolActive,
                  ]}
                onPress={() => setSelectedListItem({ kind: 'pool', id: p.id })}
              >
                <Text style={styles.listItemText}>{p.name} - Pool</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="lock" size={14} color="#999" />
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
            </>
          )}

          {/* Locations section */}
          {groupedSingleLocations.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, pools.length > 0 && { marginTop: 12 }]}>Locations</Text>
            {groupedSingleLocations.map((l) => (
              <TouchableOpacity
                key={`loc-${l.id}`}
                  style={[
                    styles.listItem,
                    selectedListItem.kind === 'single' && selectedListItem.id === l.id && styles.listItemSingleActive,
                  ]}
                onPress={() => setSelectedListItem({ kind: 'single', id: l.id })}
              >
                <Text style={styles.listItemText}>{l.name}</Text>
                {renderListItemRight(l.platformType)}
              </TouchableOpacity>
            ))}
            </>
          )}
          </ScrollView>
        )}

      <TouchableOpacity style={styles.confirmBtn} onPress={enterCreateMode}>
          <Icon name="plus-circle" size={18} color="#fff" />
        <Text style={styles.confirmBtnText}>Create Location/Group</Text>
        </TouchableOpacity>
      </View>
  );

  // Manage pools view: inline card with all pools expanded
  const renderManagePoolsView = () => (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Managing Locations</Text>
        <TouchableOpacity onPress={() => setViewMode('default')}>
          <Icon name="close" size={22} />
        </TouchableOpacity>
      </View>

      {/* Managing Locations content */}
      <View style={styles.manageCard}>
        {loadingManage ? (
          <View style={{ paddingVertical: 24 }}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : (
          <ScrollView>
            {Object.entries(draftPools).map(([poolId, draft]) => {
              const selection = managePlatformSelectionByPool[poolId];

              return (
                <View key={`draft-${poolId}`} style={{
                  backgroundColor: '#fff',
                  borderWidth: 1,
                  borderColor: '#ddd',
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 10,
                  }}>
                  <View style={styles.poolHeader}>
                    <TextInput
                      value={draft.name}
                      onChangeText={(text) =>
                        setDraftPools((prev) => ({
                          ...prev,
                          [poolId]: { ...prev[poolId], name: text },
                        }))
                      }
                      style={styles.poolNameInput}
                    />
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        openDeletePool(poolId, draft.name);
                      }}
                      style={{ padding: 4 }}
                    >
                      <Icon name="delete-outline" size={20} color="#ff4444" />
                    </TouchableOpacity>
                  </View>

                  {/* Selected locations in this pool */}
                  <View style={styles.poolLocations}>
                    {draft.locationIds.length > 0 && (
                      <>
                        <Text style={styles.label}>Selected Locations</Text>
                        {draft.locationIds.map((locId) => {
                          const meta = availableLocationById.get(locId);
                          const connName = meta?.connectionName || 'Unknown connection';
                          const locName = meta?.locationName || locId;
                          const platformType = meta?.platformType;
                          const Logo =
                            platformType &&
                            PLATFORM_LOGOS[platformType as keyof typeof PLATFORM_LOGOS];

                          return (
                            <View
                              key={`${poolId}-${locId}`}
                              style={styles.selectedLocationRow}
                            >
                              <View style={{ flex: 1 }}>
                                <View
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    marginBottom: 2,
                                  }}
                                >
                                  {Logo ? <Logo width={18} height={18} /> : null}
                                  <Text
                                    style={[
                                      styles.selectedLocationText,
                                      Logo ? { marginLeft: 8 } : null,
                                    ]}
                                  >
                                    {connName}
                                  </Text>
                                </View>
                                <Text style={styles.selectedLocationSubText}>{locName}</Text>
                              </View>
                              <TouchableOpacity
                                onPress={() => {
                                  setDraftPools((prev) => ({
                                    ...prev,
                                    [poolId]: {
                                      ...prev[poolId],
                                      locationIds: prev[poolId].locationIds.filter(
                                        (id) => id !== locId
                                      ),
                                    },
                                  }));
                                }}
                              >
                                <Icon name="close" size={16} color="#ff4444" />
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </>
                    )}
                  </View>

                  {/* Add location from platform */}
                  <TouchableOpacity
                    style={styles.addMoreRow}
                    onPress={() =>
                      setManagePlatformSelectionByPool((prev) => ({
                        ...prev,
                        [poolId]: null,
                      }))
                    }
                  >
                    <Icon name="plus" size={16} color="#666" />
                    <Text style={styles.addMoreText}>Add Location from Platform</Text>
                  </TouchableOpacity>

                  {/* Platform selector for this pool (opened by Add Location button) */}
                  {selection === null && (
                    <View style={{ marginTop: 8 }}>
                      <Text style={styles.label}>Select Platform</Text>
                      {available.length === 0 ? (
                        <Text style={{ fontSize: 12, color: '#999' }}>No platforms available</Text>
                      ) : (
                        available.map((platform) => {
                          const Logo =
                            PLATFORM_LOGOS[platform.platformType as keyof typeof PLATFORM_LOGOS];
                          return (
                            <View key={platform.platformType}>
                              {platform.connections.map((conn) => (
                                <TouchableOpacity
                                  key={conn.connectionId}
                                  style={styles.platformSelectButton}
                                  onPress={() =>
                                    setManagePlatformSelectionByPool((prev) => ({
                                      ...prev,
                                      [poolId]: {
                                        connectionId: conn.connectionId,
                                        connectionName: conn.connectionName,
                                        platformType: platform.platformType,
                                      },
                                    }))
                                  }
                                >
                                  {Logo ? <Logo width={20} height={20} /> : null}
                                  <Text style={styles.platformSelectText}>
                                    {conn.connectionName}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          );
                        })
                      )}
                    </View>
                  )}

                  {/* Location dropdown for selected platform in this pool */}
                  {selection && (
                    <View style={{ marginTop: 8 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          marginBottom: 8,
                        }}
                      >
                        <Text style={styles.label}>Select Location</Text>
                        <TouchableOpacity
                          onPress={() =>
                            setManagePlatformSelectionByPool((prev) => ({
                              ...prev,
                              [poolId]: null,
                            }))
                          }
                          style={{ marginLeft: 'auto' }}
                        >
                          <Icon name="close" size={16} color="#999" />
                        </TouchableOpacity>
                      </View>

                      <View style={styles.dropdownContainer}>
                        <ScrollView style={{ maxHeight: 200 }}>
                          {available
                            .flatMap((p) => p.connections)
                            .find((c) => c.connectionId === selection.connectionId)
                            ?.locations.map((loc) => (
                              <TouchableOpacity
                                key={loc.platformLocationId}
                                style={styles.dropdownItem}
                                onPress={() => {
                                  const locationId = loc.platformLocationId;
                                  setDraftPools((prev) => {
                                    const current = prev[poolId]?.locationIds || [];
                                    if (current.includes(locationId)) return prev;
                                    return {
                                      ...prev,
                                      [poolId]: {
                                        ...prev[poolId],
                                        locationIds: [...current, locationId],
                                      },
                                    };
                                  });
                                  setManagePlatformSelectionByPool((prev) => {
                                    const updated = { ...prev };
                                    delete updated[poolId];
                                    return updated;
                                  });
                                }}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.dropdownItemText}>{loc.locationName}</Text>
                                  {loc.timezone ? (
                                    <Text style={styles.dropdownItemTimezone}>{loc.timezone}</Text>
                                  ) : null}
                                </View>
                                <Icon name="chevron-right" size={16} color="#ccc" />
                              </TouchableOpacity>
                            ))}
                        </ScrollView>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.footerRow}>
          <Button title="Cancel" outlined onPress={() => setViewMode('default')} style={{ flex: 1 }} />
          <Button title="Confirm Updates" onPress={confirmManageChanges} loading={saving} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  );

  // State for platform/location selection in create mode (single/pool)
  const [selectedPlatformForManage, setSelectedPlatformForManage] = useState<{
    connectionId: string;
    connectionName: string;
    platformType: string;
  } | null>(null);

  // Per-pool platform selection in manage mode
  const [managePlatformSelectionByPool, setManagePlatformSelectionByPool] = useState<
    Record<
      string,
      {
        connectionId: string;
        connectionName: string;
        platformType: string;
      } | null
    >
  >({});

  // Create-mode helpers
  const [createAddPlatformMode, setCreateAddPlatformMode] = useState(false);
  const [activeCreateDropdownConnId, setActiveCreateDropdownConnId] = useState<string | null>(null);

  // Create location view - now with tabs to switch to pool
  const renderCreateLocationView = () => (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>
          {manageTab === 'location' ? 'Create Location' : 'Create Location Pool'}
        </Text>
        <TouchableOpacity onPress={() => setViewMode('default')}>
          <Icon name="close" size={22} />
        </TouchableOpacity>
      </View>

      <View style={styles.manageCard}>
        

        {/* Both tabs visible - user can toggle */}
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

        {manageTab === 'location' ? (
          <>
            {/* Location name input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Location Name</Text>
              <TextInput
                value={newPoolName}
                onChangeText={setNewPoolName}
                placeholder="Enter location name"
                style={styles.textInput}
              />
            </View>

            {/* Platform/Location Selector Stack */}
            <ScrollView style={{ maxHeight: 300, marginBottom: 12 }}>
              {Object.keys(newPoolLocations).length > 0 && (
                <View>
                  <Text style={styles.label}>Selected Platforms</Text>
                  {Object.entries(newPoolLocations).map(([connId, locIds]) => {
                    if (!locIds || locIds.length === 0) return null;
                    const selectedId = locIds[0];
                    const meta = availableLocationById.get(selectedId);

                    const platformGroup = available.find((p) =>
                      p.connections.some((c) => c.connectionId === connId)
                    );
                    const conn = platformGroup?.connections.find(
                      (c) => c.connectionId === connId
                    );
                    const Logo =
                      platformGroup &&
                      PLATFORM_LOGOS[platformGroup.platformType as keyof typeof PLATFORM_LOGOS];

                return (
                      <View key={connId} style={styles.platformCard}>
                        <View style={styles.platformCardHeader}>
                          <View style={styles.platformCardHeaderLeft}>
                            {Logo ? <Logo width={22} height={22} /> : null}
                            <Text style={styles.platformCardHeaderText}>
                              {conn?.connectionName || 'Unknown connection'}
                            </Text>
                        </View>
                          <TouchableOpacity
                            onPress={() =>
                              setNewPoolLocations((prev) => {
                                const clone = { ...prev };
                                delete clone[connId];
                                return clone;
                              })
                            }
                          >
                            <Icon name="close" size={18} color="#ff4444" />
                          </TouchableOpacity>
                        </View>

                        {/* Selected location field (dropdown trigger) */}
                        <TouchableOpacity
                          style={styles.platformLocationSelectRow}
                          onPress={() =>
                            setActiveCreateDropdownConnId((current) =>
                              current === connId ? null : connId
                            )
                          }
                        >
                          <Text style={styles.platformLocationSelectText}>
                            {meta?.locationName || 'Select location'}
                          </Text>
                          <Icon
                            name={
                              activeCreateDropdownConnId === connId ? 'chevron-up' : 'chevron-down'
                            }
                            size={18}
                            color="#999"
                          />
                        </TouchableOpacity>

                        {/* Inline dropdown for this platform */}
                        {activeCreateDropdownConnId === connId && (
                          <View style={[styles.dropdownContainer, { marginTop: 6 }]}>
                            <ScrollView style={{ maxHeight: 200 }}>
                              {platformGroup
                                ?.connections.find((c) => c.connectionId === connId)
                                ?.locations.map((loc) => (
                                  <TouchableOpacity
                                    key={loc.platformLocationId}
                                    style={styles.dropdownItem}
                                    onPress={() => {
                                      setNewPoolLocations((prev) => ({
                                        ...prev,
                                        [connId]: [loc.platformLocationId],
                                      }));
                                      setActiveCreateDropdownConnId(null);
                                    }}
                                  >
                                    <View style={{ flex: 1 }}>
                                      <Text style={styles.dropdownItemText}>
                                        {loc.locationName}
                                      </Text>
                                      {loc.timezone ? (
                                        <Text style={styles.dropdownItemTimezone}>
                                          {loc.timezone}
                                        </Text>
                                      ) : null}
                                    </View>
                                    <Icon name="chevron-right" size={16} color="#ccc" />
                                  </TouchableOpacity>
                                ))}
                            </ScrollView>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Add Another Platform Button */}
              {!createAddPlatformMode && (
                <TouchableOpacity
                  style={styles.addAnotherRow}
                  onPress={() => {
                    setCreateAddPlatformMode(true);
                    setSelectedPlatformForManage(null);
                  }}
                >
                  <Icon name="plus" size={18} color="#777" />
                  <Text style={styles.addAnotherText}>Add Another Platform</Text>
                </TouchableOpacity>
              )}

              {/* Platform Selector (shown when adding) */}
              {createAddPlatformMode && selectedPlatformForManage === null && (
                <View style={{ marginTop: 12 }}>
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}
                  >
                    <Text style={styles.label}>Select Platform</Text>
                    <TouchableOpacity
                      onPress={() => {
                        setCreateAddPlatformMode(false);
                        setSelectedPlatformForManage(null);
                      }}
                      style={{ marginLeft: 'auto' }}
                    >
                      <Icon name="close" size={16} color="#999" />
                    </TouchableOpacity>
                  </View>
                  {available.length === 0 ? (
                    <Text style={{ fontSize: 12, color: '#999' }}>No platforms available</Text>
                  ) : (
                    available.map((platform) => {
                      const Logo =
                        PLATFORM_LOGOS[platform.platformType as keyof typeof PLATFORM_LOGOS];
                      return (
                        <View key={platform.platformType}>
                          {platform.connections.map((conn) => {
                            // Skip already-selected platforms
                            if (newPoolLocations[conn.connectionId]) return null;
                              return (
                                <TouchableOpacity
                                key={conn.connectionId}
                                style={styles.platformSelectButton}
                                onPress={() => setSelectedPlatformForManage(conn as any)}
                              >
                                {Logo ? <Logo width={20} height={20} /> : null}
                                <Text style={styles.platformSelectText}>
                                  {conn.connectionName}
                                </Text>
                                </TouchableOpacity>
                              );
                            })}
                        </View>
                      );
                    })
                  )}
                      </View>
              )}

              {/* Location Selector Dropdown for chosen platform (adding new platform) */}
              {createAddPlatformMode && selectedPlatformForManage && (
                <View style={{ marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={styles.label}>Select Location</Text>
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedPlatformForManage(null);
                        setCreateAddPlatformMode(false);
                      }}
                      style={{ marginLeft: 'auto' }}
                    >
                      <Icon name="close" size={16} color="#999" />
                    </TouchableOpacity>
                  </View>
                  
                  {/* Dropdown picker */}
                  <View style={styles.dropdownContainer}>
                    <ScrollView style={{ maxHeight: 200 }}>
                      {available
                        .flatMap((p) => p.connections)
                        .find((c) => c.connectionId === selectedPlatformForManage.connectionId)
                        ?.locations.map((loc) => (
                          <TouchableOpacity
                            key={loc.platformLocationId}
                            style={styles.dropdownItem}
                            onPress={() => {
                              setNewPoolLocations((prev) => ({
                                ...prev,
                                [selectedPlatformForManage.connectionId]: [
                                  loc.platformLocationId,
                                ],
                              }));
                              setSelectedPlatformForManage(null);
                              setCreateAddPlatformMode(false);
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.dropdownItemText}>{loc.locationName}</Text>
                              {loc.timezone ? (
                                <Text style={styles.dropdownItemTimezone}>{loc.timezone}</Text>
                              ) : null}
                            </View>
                            <Icon name="chevron-right" size={16} color="#ccc" />
                          </TouchableOpacity>
                        ))}
                    </ScrollView>
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={styles.footerRow}>
              <Button
                title="Cancel"
                outlined
                onPress={() => {
                  setViewMode('default');
                  setNewPoolLocations({});
                  setSelectedPlatformForManage(null);
                  setCreateAddPlatformMode(false);
                  setActiveCreateDropdownConnId(null);
                  setNewPoolName('');
                }}
                style={{ flex: 1 }}
              />
              <Button
                title="Confirm Location"
                onPress={() => {
                  const allIds = Object.values(newPoolLocations).flat();
                  if (allIds.length === 1) {
                    const onlyId = allIds[0];
                    const meta = availableLocationById.get(onlyId);
                    const defaultName =
                      meta?.locationName || meta?.connectionName || 'Location';
                    const finalName =
                      newPoolName && newPoolName.trim().length > 0
                        ? newPoolName.trim()
                        : defaultName;
                    confirmCreate(finalName);
                  } else {
                    setManageTab('pool');
                  }
                }}
                loading={saving}
                disabled={Object.values(newPoolLocations).flat().length === 0}
                style={{ flex: 1 }}
              />
            </View>
          </>
        ) : (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Location Pool Name</Text>
              <TextInput
                value={newPoolName}
                onChangeText={setNewPoolName}
                placeholder="Enter pool name"
                style={styles.textInput}
              />
            </View>

            <ScrollView style={{ maxHeight: 300, marginBottom: 12 }}>
              {newPoolLocations[Object.keys(newPoolLocations)[0]] && Object.keys(newPoolLocations).length > 0 ? (
                <View>
                  <Text style={styles.label} >Selected Locations</Text>
                  {Object.entries(newPoolLocations).map(([connId, locIds]) => {
                    const platformGroup = available.find((p) =>
                      p.connections.some((c) => c.connectionId === connId)
                    );
                    const conn = platformGroup?.connections.find(
                      (c) => c.connectionId === connId
                    );
                    const Logo =
                      platformGroup &&
                      PLATFORM_LOGOS[platformGroup.platformType as keyof typeof PLATFORM_LOGOS];

                    const locs = available
                      .flatMap((p) => p.connections)
                      .flatMap((c) => c.locations)
                      .filter((l) => locIds.includes(l.platformLocationId));

                    return locs.map((loc) => (
                      <View
                        key={`${connId}-${loc.platformLocationId}`}
                        style={styles.selectedLocationRow}
                      >
                        <View style={{ flex: 1 }}>
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              marginBottom: 2,
                            }}
                          >
                            {Logo ? <Logo width={18} height={18} /> : null}
                            <Text
                              style={[
                                styles.selectedLocationText,
                                Logo ? { marginLeft: 8 } : null,
                              ]}
                            >
                              {conn?.connectionName || 'Unknown connection'}
                            </Text>
                          </View>
                          <Text style={styles.selectedLocationSubText}>
                            {loc.locationName}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => {
                            setNewPoolLocations((prev) => ({
                              ...prev,
                              [connId]: prev[connId].filter(
                                (id) => id !== loc.platformLocationId
                              ),
                            }));
                          }}
                        >
                          <Icon name="close" size={16} color="#ff4444" />
                        </TouchableOpacity>
                      </View>
                    ));
                  })}
                </View>
              ) : null}

              {/* Add Another Location Button */}
              <TouchableOpacity
                style={styles.addAnotherRow}
                onPress={() => {
                  setCreateAddPlatformMode(true);
                  setSelectedPlatformForManage(null);
                }}
              >
                <Icon name="plus" size={18} color="#777" />
                <Text style={styles.addAnotherText}>Add Location from Platform</Text>
              </TouchableOpacity>

              {/* Platform Selector (shown when adding) */}
              {createAddPlatformMode && selectedPlatformForManage === null && (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.label}>Select Platform</Text>
                  {available.length === 0 ? (
                    <Text style={{ fontSize: 12, color: '#999' }}>No platforms available</Text>
                  ) : (
                    available.map((platform) => {
                      const Logo =
                        PLATFORM_LOGOS[platform.platformType as keyof typeof PLATFORM_LOGOS];
                      return (
                        <View key={platform.platformType}>
                          {platform.connections.map((conn) => (
                            <TouchableOpacity
                              key={conn.connectionId}
                              style={styles.platformSelectButton}
                              onPress={() => setSelectedPlatformForManage(conn as any)}
                            >
                              {Logo ? <Logo width={20} height={20} /> : null}
                              <Text style={styles.platformSelectText}>
                                {conn.connectionName}
                              </Text>
                            </TouchableOpacity>
                          ))}
              </View>
                      );
                    })
                  )}
                </View>
              )}

              {/* Location Selector Dropdown for chosen platform */}
              {createAddPlatformMode && selectedPlatformForManage && (
                <View style={{ marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={styles.label}>Select Location</Text>
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedPlatformForManage(null);
                        setCreateAddPlatformMode(false);
                      }}
                      style={{ marginLeft: 'auto' }}
                    >
                      <Icon name="close" size={16} color="#999" />
                    </TouchableOpacity>
                  </View>
                  
                  {/* Dropdown picker */}
                  <View style={styles.dropdownContainer}>
                    <ScrollView style={{ maxHeight: 200 }}>
                      {available
                        .flatMap((p) => p.connections)
                        .find((c) => c.connectionId === selectedPlatformForManage.connectionId)
                        ?.locations.map((loc) => (
                          <TouchableOpacity
                            key={loc.platformLocationId}
                            style={styles.dropdownItem}
                            onPress={() => {
                              toggleLocationSelection(
                                'create',
                                selectedPlatformForManage.connectionId,
                                loc.platformLocationId
                              );
                              setSelectedPlatformForManage(null);
                              setCreateAddPlatformMode(false);
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.dropdownItemText}>{loc.locationName}</Text>
                              {loc.timezone ? (
                                <Text style={styles.dropdownItemTimezone}>{loc.timezone}</Text>
                              ) : null}
                            </View>
                            <Icon name="chevron-right" size={16} color="#ccc" />
                          </TouchableOpacity>
                        ))}
                    </ScrollView>
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={styles.footerRow}>
              <Button title="Cancel" outlined onPress={() => setViewMode('default')} style={{ flex: 1 }} />
              <Button
                title="Confirm New Location Pool"
                onPress={() => confirmCreate()}
                loading={saving}
                disabled={!newPoolName.trim() || available.length === 0 || Object.values(newPoolLocations).flat().length === 0}
                style={{ flex: 1 }}
              />
            </View>
          </>
        )}
          </View>
        </View>
  );

  // Create pool view - now unified with location view via tabs
  // This is kept for the state machine but renderCreateLocationView handles both tabs
  const renderCreatePoolView = () => renderCreateLocationView();

  return (
    <View style={styles.root}>
      {renderView()}

      {/* Delete Confirmation Modal */}
      {deleteState.visible && (
        <Modal visible animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 350 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Delete Pool</Text>
                <TouchableOpacity onPress={() => setDeleteState((prev) => ({ ...prev, visible: false }))}>
                <Icon name="close" size={22} />
              </TouchableOpacity>
            </View>

            <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
              <Text style={styles.label}>Select merge target for locations:</Text>
              <View style={{ marginTop: 8 }}>
                <TouchableOpacity
                  style={[
                    styles.chip, 
                    deleteState.mergeTarget === 'none' && styles.chipSelected,
                      { marginBottom: 8, alignSelf: 'flex-start' },
                  ]}
                    onPress={() => setDeleteState((prev) => ({ ...prev, mergeTarget: 'none' }))}
                >
                    <Text
                      style={[
                    styles.chipText, 
                        deleteState.mergeTarget === 'none' && styles.chipTextSelected,
                      ]}
                    >
                    Delete without merging (locations become single)
                  </Text>
                </TouchableOpacity>

                <ScrollView style={{ maxHeight: 200 }}>
                  {deleteState.availablePools.map((pool) => (
                    <TouchableOpacity
                      key={pool.id}
                      style={[
                        styles.chip, 
                        deleteState.mergeTarget === pool.id && styles.chipSelected,
                          { marginBottom: 4, alignSelf: 'flex-start' },
                      ]}
                        onPress={() => setDeleteState((prev) => ({ ...prev, mergeTarget: pool.id }))}
                    >
                        <Text
                          style={[
                        styles.chipText, 
                            deleteState.mergeTarget === pool.id && styles.chipTextSelected,
                          ]}
                        >
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
                  onPress={() => setDeleteState((prev) => ({ ...prev, visible: false }))}
                style={{ flex: 1 }} 
              />
              <Button
                  title={deleteState.loading ? 'Deleting...' : 'Delete Pool'}
                onPress={confirmDeletePool}
                loading={deleteState.loading}
                disabled={deleteState.loading || deleteState.mergeTarget === null}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
      )}
    </View>
  );
};

export default LocationsManagerV2;

const styles = StyleSheet.create({
  root: {},
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 8,
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
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
    marginBottom: 8,
    marginTop: 12,
    textTransform: 'uppercase',
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
  listItemPoolActive: {
    backgroundColor: '#fffaef',
    borderColor: '#f0c36b',
  },
  listItemSingleActive: {
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
  manageCard: {
    padding: 0,
    marginTop: 0,
  },
  poolCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  poolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  poolNameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    fontWeight: '600',
  },
  poolLocations: {
    marginBottom: 8,
  },
  poolLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  addMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 6,
  },
  addMoreText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  selectedLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f0f8ff',
    borderLeftWidth: 3,
    borderLeftColor: '#d0e2ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 6,
    borderRadius: 4,
  },
  selectedLocationText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#333',
    flex: 1,
  },
  selectedLocationSubText: {
    fontSize: 12,
    color: '#555',
    marginTop: 2,
  },
  platformCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    marginBottom: 6,
  },
  platformCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  platformCardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  platformCardHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  platformLocationSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginTop: 2,
  },
  platformLocationSelectText: {
    fontSize: 13,
    color: '#333',
  },
  platformSelectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    marginBottom: 6,
    gap: 8,
  },
  platformSelectText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
  },
  dropdownContainer: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  dropdownItemText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
  },
  dropdownItemTimezone: {
    fontSize: 11,
    color: '#999',
    marginTop: 3,
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
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 16,
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
    flexDirection: 'column',
    gap: 12,
    paddingTop: 8,
  },
});


