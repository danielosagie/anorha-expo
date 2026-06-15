// PoolLocationPicker — shared location picker for pool flows (create + add).
// Renders available platform locations grouped per platform/connection with
// simple checkbox rows. Sync behavior is not configurable here: locations in
// a pool always sync inventory & pricing.

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Check } from 'lucide-react-native';
import PlatformAvatar from '../PlatformAvatar';

export interface GroupedPlatform {
  platformType: string;
  connections: Array<{
    connectionId: string;
    connectionName: string;
    locations: Array<{ id: string; name: string }>;
  }>;
}

interface PoolLocationPickerProps {
  available: GroupedPlatform[];
  pickedIds: Set<string>;
  onToggle: (id: string) => void;
}

/**
 * Groups the GET /api/pools/locations/available response —
 * Record<connId, { platformType, connectionName, locations: [{id, name}] }> —
 * by platformType, dropping any location ids in `excludeIds` (e.g. already in
 * the pool). Connections left with no locations are omitted.
 */
export const groupAvailableLocations = (
  record: Record<string, {
    platformType?: string;
    connectionName?: string;
    locations?: Array<{ platformLocationId?: string; locationName?: string; id?: string; name?: string }>;
  }>,
  excludeIds?: Set<string>,
): GroupedPlatform[] => {
  const byPlatform = new Map<string, GroupedPlatform>();
  for (const [connectionId, conn] of Object.entries(record || {})) {
    if (!conn) continue;
    // The API returns locations as { platformLocationId, locationName }; normalize to
    // { id, name }. Dropping any without a real id is what keeps each checkbox
    // independent — an empty id would be shared across every row, so selecting one
    // would mark them all.
    const locations = (conn.locations || [])
      .map((loc) => {
        const id = loc?.platformLocationId ?? loc?.id ?? '';
        const name = loc?.locationName ?? loc?.name ?? '';
        return { id, name: name || id };
      })
      .filter((loc) => loc.id && !excludeIds?.has(loc.id));
    if (locations.length === 0) continue;
    const platformType = (conn.platformType || 'platform').toLowerCase();
    let group = byPlatform.get(platformType);
    if (!group) {
      group = { platformType, connections: [] };
      byPlatform.set(platformType, group);
    }
    group.connections.push({
      connectionId,
      connectionName: conn.connectionName || '',
      locations,
    });
  }
  return Array.from(byPlatform.values());
};

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const PoolLocationPicker: React.FC<PoolLocationPickerProps> = ({ available, pickedIds, onToggle }) => (
  <View>
    {available.map((platform, pi) =>
      platform.connections.map((conn, ci) => (
        <View key={conn.connectionId}>
          <View style={[styles.groupHeader, (pi > 0 || ci > 0) && styles.divider]}>
            <PlatformAvatar platformType={platform.platformType} size="small" />
            <Text style={styles.groupTitle} numberOfLines={1}>
              {capitalize(platform.platformType)}
              {conn.connectionName ? <Text style={styles.groupSub}>  {conn.connectionName}</Text> : null}
            </Text>
          </View>
          {conn.locations.map((loc) => {
            const picked = pickedIds.has(loc.id);
            return (
              <TouchableOpacity
                key={loc.id}
                style={[styles.locationRow, picked && styles.locationRowOn]}
                activeOpacity={0.7}
                onPress={() => onToggle(loc.id)}
              >
                <View style={[styles.checkbox, picked && styles.checkboxOn]}>
                  {picked && <Check size={14} color="#FFFFFF" />}
                </View>
                <Text style={styles.locationName} numberOfLines={1}>{loc.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )),
    )}
  </View>
);

const styles = StyleSheet.create({
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: '#F1F1EE' },
  groupTitle: { flex: 1, fontSize: 14, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  groupSub: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular' },

  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 10, borderRadius: 12 },
  locationRowOn: { backgroundColor: '#F4F9E8' },
  checkbox: {
    width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: '#D4D4D8',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#93C822', borderColor: '#93C822' },
  locationName: { flex: 1, fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
});

export default PoolLocationPicker;
