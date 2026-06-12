// CreatePoolSheet — one clean focused pool-creation flow (campaign-sheet style):
// name + pick locations, done. Locations in a pool sync inventory & pricing by
// default, so there are no sync toggles — we always send both as true.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { API_BASE_URL } from '../../config/env';
import PoolLocationPicker, { GroupedPlatform, groupAvailableLocations } from './PoolLocationPicker';

interface CreatePoolSheetProps {
  visible: boolean;
  orgId: string;
  onClose: () => void;
  onCreated: () => void;
}

const CreatePoolSheet: React.FC<CreatePoolSheetProps> = ({ visible, orgId, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [available, setAvailable] = useState<GroupedPlatform[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName('');
    setPickedIds(new Set());
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await ensureSupabaseJwt();
        const r = await fetch(`${API_BASE_URL}/api/pools/locations/available?orgId=${orgId}`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (!r.ok) return;
        const record = await r.json();
        if (!cancelled) setAvailable(groupAvailableLocations(record || {}));
      } catch {
        // empty state covers it — locations can be added later
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, orgId]);

  const toggle = (id: string) =>
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const token = await ensureSupabaseJwt();
      const r = await fetch(`${API_BASE_URL}/api/pools`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          name: trimmed,
          syncInventory: true,
          syncPricing: true,
          location_ids: Array.from(pickedIds),
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({} as any));
        throw new Error(err?.message || 'Failed to create the pool.');
      }
      onCreated();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to create the pool.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>New pool</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Atlanta stores"
            placeholderTextColor="#C7C7CC"
            autoFocus
          />
          <Text style={styles.subtext}>Locations in a pool sync inventory & pricing automatically.</Text>
          {loading ? (
            <View style={styles.loadingRow}><ActivityIndicator color="#93C822" /></View>
          ) : available.length === 0 ? (
            <Text style={styles.empty}>No platform locations yet — you can add them later.</Text>
          ) : (
            <ScrollView style={styles.pickerScroll}>
              <PoolLocationPicker available={available} pickedIds={pickedIds} onToggle={toggle} />
            </ScrollView>
          )}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.createBtn, (!name.trim() || creating) && { opacity: 0.5 }]}
              onPress={create}
              disabled={!name.trim() || creating}
              activeOpacity={0.8}
            >
              {creating ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.createText}>Create</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 20, maxHeight: '80%' },
  title: { fontSize: 20, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 12 },

  input: {
    borderWidth: 1, borderColor: '#ECEBE6', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 15, color: '#18181B', fontFamily: 'Inter_400Regular', backgroundColor: '#FAFAF8',
  },
  subtext: { fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular', lineHeight: 18, marginTop: 8, marginBottom: 6 },

  loadingRow: { paddingVertical: 26, alignItems: 'center' },
  empty: {
    paddingVertical: 22, textAlign: 'center', color: '#9CA3AF', fontFamily: 'Inter_500Medium',
    fontSize: 13, paddingHorizontal: 8, lineHeight: 19,
  },
  pickerScroll: { maxHeight: 320 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: '#F1F1EE' },
  cancelText: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  createBtn: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: '#93C822' },
  createText: { fontSize: 15, color: '#FFFFFF', fontFamily: 'Inter_700Bold' },
});

export default CreatePoolSheet;
