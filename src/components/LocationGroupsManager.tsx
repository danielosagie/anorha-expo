import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import Button from './Button';
import ShopifySvg from '../assets/shopify.svg';
import SquareSvg from '../assets/square.svg';
import CloverSvg from '../assets/clover.svg';
import { ensureSupabaseJwt } from '../lib/supabase';

const API_BASE_URL = "https://api.sssync.app";

const PLATFORM_LOGOS: Record<string, any> = {
  shopify: ShopifySvg,
  square: SquareSvg,
  clover: CloverSvg,
};

interface LocationPool {
  id: string;
  name: string;
  org_id: string;
  sync_inventory: boolean;
  sync_pricing: boolean;
}

interface AvailablePlatformGroup {
  platformType: string;
  connections: {
    connectionId: string;
    connectionName: string;
    locations: {
      id: string; // PlatformLocationId
      name: string;
      platformType: string;
      connectionId: string;
      connectionName: string;
      timezone?: string;
    }[];
  }[];
}

interface PoolLocationRow {
  id: string; // row id from LocationPool_Locations
  platform_location_id: string;
  PlatformConnections?: { PlatformType: string; DisplayName: string; Id: string };
  PlatformLocations?: { Name: string; Timezone?: string };
}

interface LocationGroupsManagerProps {
  orgId: string;
  platformConnections: any[]; // kept for compatibility
}

type Mode = 'list' | 'manage';
type ManageKind = 'group' | 'location';

export default function LocationGroupsManager({ orgId }: LocationGroupsManagerProps) {
  const theme = useTheme();

  // Global state
  const [mode, setMode] = useState<Mode>('list');
  const [manageKind, setManageKind] = useState<ManageKind>('group');
  const [loading, setLoading] = useState(false);

  // Pools list + metadata
  const [pools, setPools] = useState<LocationPool[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [poolIdToPlatforms, setPoolIdToPlatforms] = useState<Record<string, string[]>>({});

  // Manage form state
  const [groupName, setGroupName] = useState('');
  const [available, setAvailable] = useState<AvailablePlatformGroup[]>([]);
  const [existingRows, setExistingRows] = useState<PoolLocationRow[]>([]);
  // Selected mapping: connectionId -> platformLocationId
  const [selectedByConnection, setSelectedByConnection] = useState<Record<string, string>>({});

  const selectedPool = useMemo(
    () => pools.find((p) => p.id === selectedPoolId) || null,
    [pools, selectedPoolId]
  );

  useEffect(() => {
    if (!orgId) return;
    loadPools();
  }, [orgId]);

  useEffect(() => {
    if (mode === 'manage') {
      loadAvailableLocations();
    }
  }, [mode]);

  useEffect(() => {
    if (mode === 'manage' && selectedPoolId) {
      // editing existing
      loadPoolLocations(selectedPoolId);
    } else if (mode === 'manage' && !selectedPoolId) {
      // creating new
      setExistingRows([]);
      setSelectedByConnection({});
    }
  }, [mode, selectedPoolId]);

  const loadPools = async () => {
    try {
      setLoading(true);
      const token = await ensureSupabaseJwt();
      const res = await fetch(`${API_BASE_URL}/api/pools/org/${orgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load pools');
      const data: LocationPool[] = await res.json();
      setPools(Array.isArray(data) ? data : []);

      // Fetch platform badges for each pool in parallel
      const badgeEntries = await Promise.all(
        (Array.isArray(data) ? data : []).map(async (p) => {
          const r = await fetch(`${API_BASE_URL}/api/pools/${p.id}/locations`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) return [p.id, []] as [string, string[]];
          const j = await r.json();
          const plats: string[] = (j.locations || []).map(
            (loc: any) => (loc.PlatformConnections?.PlatformType || '').toLowerCase()
          );
          const unique = Array.from(new Set(plats));
          return [p.id, unique] as [string, string[]];
        })
      );
      setPoolIdToPlatforms(Object.fromEntries(badgeEntries));
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to load location groups');
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableLocations = async () => {
    try {
      const token = await ensureSupabaseJwt();
      const res = await fetch(
        `${API_BASE_URL}/api/pools/locations/available?orgId=${orgId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error('Failed to load locations');
      const data: AvailablePlatformGroup[] = await res.json();
      setAvailable(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadPoolLocations = async (poolId: string) => {
    try {
      const token = await ensureSupabaseJwt();
      const res = await fetch(`${API_BASE_URL}/api/pools/${poolId}/locations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load pool locations');
      const data = await res.json();
      setGroupName(data.pool?.name || '');
      const rows: PoolLocationRow[] = data.locations || [];
      setExistingRows(rows);
      // initialize mapping based on existing rows (pick the first per connection)
      const mapping: Record<string, string> = {};
      for (const r of rows) {
        const connId = r.PlatformConnections?.Id;
        if (connId && !mapping[connId]) {
          mapping[connId] = r.platform_location_id;
        }
      }
      setSelectedByConnection(mapping);
    } catch (e) {
      console.error(e);
    }
  };

  const onPressCreateNew = () => {
    setSelectedPoolId(null);
    setGroupName('');
    setSelectedByConnection({});
    setMode('manage');
  };

  const onPressManage = () => {
    if (!selectedPoolId) return;
    setMode('manage');
  };

  const handleSaveExisting = async () => {
    if (!selectedPoolId || !groupName.trim()) return;
    try {
      const token = await ensureSupabaseJwt();
      // 1) update name if changed
      await fetch(`${API_BASE_URL}/api/pools/${selectedPoolId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: groupName.trim() }),
      });

      // 2) compute adds/removes
      const existingByConn = new Map<string, string[]>();
      for (const r of existingRows) {
        const connId = r.PlatformConnections?.Id;
        if (!connId) continue;
        if (!existingByConn.has(connId)) existingByConn.set(connId, []);
        existingByConn.get(connId)!.push(r.platform_location_id);
      }

      const toAdd: string[] = [];
      const toRemove: string[] = [];
      // add: chosen value not already present
      for (const [connId, locId] of Object.entries(selectedByConnection)) {
        const list = existingByConn.get(connId) || [];
        if (locId && !list.includes(locId)) toAdd.push(locId);
        // remove any others for this connection
        for (const l of list) {
          if (l !== locId) toRemove.push(l);
        }
      }
      // also remove any existing connections now deselected
      for (const [connId, list] of existingByConn) {
        if (!selectedByConnection[connId]) {
          for (const l of list) toRemove.push(l);
        }
      }

      // perform removals
      await Promise.all(
        toRemove.map((locId) =>
          fetch(`${API_BASE_URL}/api/pools/${selectedPoolId}/locations/${locId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          })
        )
      );
      // perform adds
      if (toAdd.length > 0) {
        await fetch(`${API_BASE_URL}/api/pools/${selectedPoolId}/locations`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ location_ids: toAdd }),
        });
      }

      Alert.alert('Success', 'Changes saved');
      await loadPools();
      setMode('list');
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to save changes');
    }
  };

  const handleCreateNew = async () => {
    if (!groupName.trim()) {
      Alert.alert('Enter name', 'Please enter a location group name.');
      return;
    }
    try {
      const token = await ensureSupabaseJwt();
      const selectedIds = Object.values(selectedByConnection).filter(Boolean);
      const res = await fetch(`${API_BASE_URL}/api/pools`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orgId,
          name: groupName.trim(),
          syncInventory: true,
          syncPricing: false,
          location_ids: selectedIds,
        }),
      });
      if (!res.ok) throw new Error('Failed to create pool');
      Alert.alert('Success', 'Location group created');
      await loadPools();
      setMode('list');
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to create location group');
    }
  };

  const setSelection = (connectionId: string, locId: string) => {
    setSelectedByConnection((prev) => ({ ...prev, [connectionId]: locId }));
  };

  const renderPoolRowBadges = (platforms: string[]) => {
    return (
      <View style={styles.badgesRow}>
        {platforms.map((pt) => {
          const Logo = PLATFORM_LOGOS[pt as keyof typeof PLATFORM_LOGOS];
          if (!Logo) return null;
          return <Logo key={pt} width={18} height={18} style={{ marginLeft: 6 }} />;
        })}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      {mode === 'list' ? (
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Locations</Text>
            <TouchableOpacity
              disabled={!selectedPoolId}
              onPress={onPressManage}
              style={[styles.manageBtn, !selectedPoolId && { opacity: 0.5 }]}
            >
              <Text style={styles.manageBtnText}>Manage</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={{ paddingVertical: 24 }}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : (
            <ScrollView>
              {(pools || []).map((p) => {
                const isActive = selectedPoolId === p.id;
                const plats = poolIdToPlatforms[p.id] || [];
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => setSelectedPoolId(p.id)}
                    style={[styles.listItem, isActive && styles.listItemActive]}
                  >
                    <Text style={styles.listItemText}>{p.name}</Text>
                    {renderPoolRowBadges(plats)}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <TouchableOpacity style={styles.createBtn} onPress={onPressCreateNew}>
            <Icon name="plus" size={18} color="#fff" />
            <Text style={styles.createBtnText}>Create New Location/Group</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.manageHeader}>
            <Text style={styles.manageTitle}>Manage Locations</Text>
            <TouchableOpacity onPress={() => setMode('list')}>
              <Icon name="close" size={22} />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabsRow}>
            <View style={[styles.tab, manageKind === 'location' ? styles.tabActive : styles.tabGhost]}>
              <Text style={[styles.tabText, manageKind === 'location' && styles.tabTextActive]}>Location</Text>
              <Icon name="map-marker-outline" size={16} style={{ marginLeft: 6 }} />
            </View>
            <TouchableOpacity onPress={() => setManageKind('group')} style={[styles.tab, manageKind === 'group' ? styles.tabActive : styles.tabGhost]}>
              <Text style={[styles.tabText, manageKind === 'group' && styles.tabTextActive]}>Location Group</Text>
              <Icon name="account-group-outline" size={16} style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          </View>

          {/* Group Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Location Group Name</Text>
            <TextInput
              value={groupName}
              onChangeText={setGroupName}
              placeholder="Atlanta"
              style={styles.textInput}
            />
          </View>

          {/* Connection rows with dropdowns */}
          <ScrollView style={{ maxHeight: 360 }}>
            {available.map((platform) => {
              const Logo = PLATFORM_LOGOS[platform.platformType as keyof typeof PLATFORM_LOGOS];
              return (
                <View key={platform.platformType} style={{ marginBottom: 12 }}>
                  {platform.connections.map((conn) => (
                    <View key={conn.connectionId} style={styles.connRow}>
                      <View style={styles.connLeft}>
                        {Logo ? <Logo width={28} height={28} /> : null}
                        <Text style={styles.connName}>{conn.connectionName}</Text>
                      </View>
                      <View style={styles.pickerShell}>
                        <Picker
                          selectedValue={selectedByConnection[conn.connectionId] || ''}
                          onValueChange={(v) => setSelection(conn.connectionId, String(v))}
                          style={{ height: 44 }}
                        >
                          <Picker.Item label="Select location" value="" />
                          {conn.locations.map((l) => (
                            <Picker.Item key={l.id} label={l.name} value={l.id} />
                          ))}
                        </Picker>
                      </View>
                    </View>
                  ))}
                </View>
              );
            })}

            {/* Add another location (visual only as all connections already listed) */}
            <View style={styles.addAnotherRow}>
              <Icon name="plus" size={18} color="#777" />
              <Text style={styles.addAnotherText}>Add Another Location</Text>
            </View>
          </ScrollView>

          <Button
            title="Save Changes"
            onPress={selectedPoolId ? handleSaveExisting : handleCreateNew}
            style={{ marginTop: 8 }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minHeight: 400,
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
    paddingVertical: 14,
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
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  createBtn: {
    marginTop: 12,
    backgroundColor: '#8BC34A',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  createBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  manageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  manageTitle: {
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
  pickerShell: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    overflow: 'hidden',
    minWidth: 200,
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
});
