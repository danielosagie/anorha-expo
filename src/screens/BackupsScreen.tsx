import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useOrg } from '../context/OrgContext';
import { ensureSupabaseJwt } from '../lib/supabase';
import { AppStackParamList } from '../navigation/AppNavigator';
import { StackNavigationProp } from '@react-navigation/stack';

type BackupsScreenRouteProp = RouteProp<AppStackParamList, 'Backups'>;
type BackupsScreenNavProp = StackNavigationProp<AppStackParamList, 'Backups'>;

interface SnapshotMeta {
  Id: string;
  OrgId: string;
  SnapshotDate: string;
  TriggerEvent: string;
  ConnectionId: string | null;
  StoragePath: string;
  ByteSize: number | null;
  CreatedAt: string;
}

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
const ANORHA_GREEN = '#647653';

const FREQUENCY_OPTIONS: { value: 'daily' | 'weekly' | 'off'; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'off', label: 'Off' },
];

export default function BackupsScreen() {
  const theme = useTheme();
  const navigation = useNavigation<BackupsScreenNavProp>();
  const route = useRoute<BackupsScreenRouteProp>();
  const { currentOrg } = useOrg();
  const insets = useSafeAreaInsets();

  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [backupFrequency, setBackupFrequency] = useState<'daily' | 'weekly' | 'off'>('daily');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [savingFrequency, setSavingFrequency] = useState(false);

  const orgId = currentOrg?.id ?? (route.params as any)?.orgId;

  const loadSnapshots = useCallback(async () => {
    if (!orgId) return;
    try {
      const token = await ensureSupabaseJwt();
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/organizations/${encodeURIComponent(orgId)}/snapshots`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load snapshots');
      const data = await res.json();
      setSnapshots(data.snapshots || []);
    } catch (e) {
      console.warn('[Backups] loadSnapshots error:', e);
      setSnapshots([]);
    }
  }, [orgId]);

  const loadBackupSettings = useCallback(async () => {
    if (!orgId) return;
    try {
      const token = await ensureSupabaseJwt();
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/organizations/${encodeURIComponent(orgId)}/backup-settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setBackupFrequency(data.backupFrequency || 'daily');
    } catch (e) {
      console.warn('[Backups] loadBackupSettings error:', e);
    }
  }, [orgId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadSnapshots(), loadBackupSettings()]);
    setRefreshing(false);
  }, [loadSnapshots, loadBackupSettings]);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [orgId]);

  const handleRestore = (snapshotId: string, snapshotDate: string, triggerEvent: string) => {
    Alert.alert(
      'Restore from backup',
      `Restore your data to the state from ${snapshotDate} (${triggerEvent})? This will replace your current products, inventory, and mappings. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            if (!orgId) return;
            setRestoringId(snapshotId);
            try {
              const token = await ensureSupabaseJwt();
              if (!token) throw new Error('Not authenticated');
              const res = await fetch(`${API_BASE}/api/organizations/${encodeURIComponent(orgId)}/restore`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ snapshotId }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.message || 'Restore failed');
              Alert.alert('Restore complete', 'Your data has been restored. You may need to refresh the app.');
              refresh();
            } catch (e) {
              Alert.alert('Restore failed', (e as Error).message);
            } finally {
              setRestoringId(null);
            }
          },
        },
      ]
    );
  };

  const handleFrequencyChange = async (value: 'daily' | 'weekly' | 'off') => {
    if (!orgId) return;
    setSavingFrequency(true);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API_BASE}/api/organizations/${encodeURIComponent(orgId)}/backup-settings`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupFrequency: value }),
      });
      if (!res.ok) throw new Error('Failed to update');
      setBackupFrequency(value);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSavingFrequency(false);
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { dateStyle: 'medium' }) + ' ' + d.toLocaleTimeString(undefined, { timeStyle: 'short' });
    } catch {
      return iso;
    }
  };

  const triggerLabel = (event: string) => {
    switch (event) {
      case 'pre_initial_sync': return 'Before adding platform';
      case 'daily': return 'Daily backup';
      case 'weekly': return 'Weekly backup';
      case 'pre_disconnect': return 'Before disconnect';
      case 'manual': return 'Manual';
      default: return event;
    }
  };

  if (!orgId) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-left" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: theme.colors.text }]}>Backups & restore</Text>
        </View>
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>Select an organization to view backups.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: '#E5E7EB' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-left" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <View>
            <Text style={[styles.title, { color: theme.colors.text }]}>Backups & restore</Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>Organization state snapshots</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Backup frequency</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.textSecondary }]}>
            How often we save a snapshot of your data (this morning, a week ago, etc.).
          </Text>
          {FREQUENCY_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.frequencyRow,
                { borderColor: backupFrequency === opt.value ? ANORHA_GREEN : '#E5E7EB' },
                backupFrequency === opt.value && { backgroundColor: ANORHA_GREEN + '10' },
              ]}
              onPress={() => handleFrequencyChange(opt.value)}
              disabled={savingFrequency}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: backupFrequency === opt.value ? ANORHA_GREEN : '#D1D5DB',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {backupFrequency === opt.value && (
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ANORHA_GREEN }} />
                  )}
                </View>
                <Text style={[styles.frequencyLabel, { color: theme.colors.text }]}>{opt.label}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Restore points</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.textSecondary }]}>
            Restore your data to a previous snapshot. We also create a snapshot before you add a new platform so you can always go back to before Anorha.
          </Text>
          {loading && !refreshing ? (
            <ActivityIndicator size="small" color={theme.colors.primary} style={styles.loader} />
          ) : snapshots.length === 0 ? (
            <View style={styles.emptyStateContainer}>
              <View style={[styles.emptyStateIconBubble, { backgroundColor: ANORHA_GREEN + '15' }]}>
                <Icon name="safe-deposit" size={48} color={ANORHA_GREEN} />
              </View>
              <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>No snapshots yet</Text>
              <Text style={[styles.emptyStateDescription, { color: theme.colors.textSecondary }]}>
                Backups will appear here as they are created automatically based on your frequency settings.
              </Text>
            </View>
          ) : (
            snapshots.map((s) => (
              <View key={s.Id} style={[styles.snapshotRow, { borderColor: '#E5E7EB' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.snapshotDate, { color: theme.colors.text }]}>
                    {formatDate(s.CreatedAt)}
                  </Text>
                  <View style={styles.snapshotMeta}>
                    <View style={styles.snapshotTag}>
                      <Text style={styles.snapshotTagText}>{triggerLabel(s.TriggerEvent)}</Text>
                    </View>
                    {s.ByteSize ? (
                      <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                        {(s.ByteSize / 1024).toFixed(0)} KB
                      </Text>
                    ) : null}
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.restoreBtn, { backgroundColor: ANORHA_GREEN }]}
                  onPress={() => handleRestore(s.Id, s.SnapshotDate, s.TriggerEvent)}
                  disabled={restoringId !== null}
                >
                  {restoringId === s.Id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.restoreBtnText}>Restore</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { padding: 8, marginRight: 8 },
  title: { fontSize: 18, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  sectionSubtitle: { fontSize: 13, marginBottom: 12 },
  frequencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  frequencyLabel: { fontSize: 16, fontWeight: '500' },
  loader: { marginVertical: 16 },
  emptyText: { fontSize: 14, marginVertical: 12 },
  snapshotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  snapshotDate: { fontSize: 15, fontWeight: '600', marginBottom: 6 },
  snapshotMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  snapshotTag: {
    backgroundColor: '#F3F4F6',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  snapshotTagText: { fontSize: 12, color: '#4B5563', fontWeight: '500' },
  restoreBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  restoreBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  subtitle: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    marginTop: 10,
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
    maxWidth: '85%',
  },
});
