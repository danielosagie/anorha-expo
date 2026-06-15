import React, { useState, useCallback, useEffect } from 'react';
import { API_BASE_URL } from '../config/env';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Share,
  Platform,
  Modal,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ENABLED_PLATFORMS } from '../config/platforms';
import PlatformButton from '../components/PlatformButton';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '../context/ThemeContext';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useOrg } from '../context/OrgContext';
import { ensureSupabaseJwt } from '../lib/supabase';
import { AppStackParamList } from '../navigation/AppNavigator';
import { StackNavigationProp } from '@react-navigation/stack';
import { createLogger } from '../utils/logger';
const log = createLogger('BackupsScreen');


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

const API_BASE = API_BASE_URL;
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
  const [orgName, setOrgName] = useState<string | null>(null);
  const [backupFrequency, setBackupFrequency] = useState<'daily' | 'weekly' | 'off'>('daily');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [savingFrequency, setSavingFrequency] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportingCurrent, setExportingCurrent] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportStep, setExportStep] = useState<1 | 2>(1);
  const [selectedExportPlatforms, setSelectedExportPlatforms] = useState<string[]>([]);
  const [exportTimeChoice, setExportTimeChoice] = useState<'current' | 'snapshot' | 'custom'>('current');
  const [selectedExportSnapshotId, setSelectedExportSnapshotId] = useState<string | null>(null);
  const [customExportDate, setCustomExportDate] = useState(() => new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [exportOptionsExporting, setExportOptionsExporting] = useState(false);

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
      setOrgName(data.orgName ?? null);
    } catch (e) {
      log.warn('[Backups] loadSnapshots error:', e);
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
      log.warn('[Backups] loadBackupSettings error:', e);
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

  const handleCreateBackupNow = useCallback(async () => {
    if (!orgId) return;
    setCreatingBackup(true);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API_BASE}/api/organizations/${encodeURIComponent(orgId)}/snapshots`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerEvent: 'manual' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to create backup');
      }
      await loadSnapshots();
      Alert.alert('Backup created', 'Your backup has been saved. You can restore to it anytime from the list below.');
    } catch (e) {
      Alert.alert('Backup failed', (e as Error).message);
    } finally {
      setCreatingBackup(false);
    }
  }, [orgId, loadSnapshots]);

  const shareCsv = useCallback(async (csvText: string, filename: string) => {
    const dir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
    const path = `${dir}${filename}`;
    await FileSystem.writeAsStringAsync(path, csvText, { encoding: FileSystem.EncodingType.UTF8 });
    try {
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        await Share.share({ url: path, message: `Anorha export: ${filename}`, title: 'Export CSV' });
      }
    } catch (e) {
      Alert.alert('Export ready', `File saved. You can find it in your app documents.`);
    }
  }, []);

  const handleExportCurrent = useCallback(async () => {
    if (!orgId) return;
    setExportingCurrent(true);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(`${API_BASE}/api/organizations/${encodeURIComponent(orgId)}/export/current`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const csv = await res.text();
      const date = new Date().toISOString().slice(0, 10);
      await shareCsv(csv, `anorha-export-${date}.csv`);
    } catch (e) {
      Alert.alert('Export failed', (e as Error).message);
    } finally {
      setExportingCurrent(false);
    }
  }, [orgId, shareCsv]);

  const handleExportSnapshot = useCallback(async (snapshotId: string) => {
    if (!orgId) return;
    setExportingId(snapshotId);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error('Not authenticated');
      const res = await fetch(
        `${API_BASE}/api/organizations/${encodeURIComponent(orgId)}/snapshots/${encodeURIComponent(snapshotId)}/export?format=csv`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error('Export failed');
      const csv = await res.text();
      await shareCsv(csv, `anorha-snapshot-${snapshotId.slice(0, 8)}.csv`);
    } catch (e) {
      Alert.alert('Export failed', (e as Error).message);
    } finally {
      setExportingId(null);
    }
  }, [orgId, shareCsv]);

  const handleExportWithOptionsSubmit = useCallback(async () => {
    if (!orgId) return;
    setExportOptionsExporting(true);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error('Not authenticated');
      const platformsParam = selectedExportPlatforms.length > 0 ? selectedExportPlatforms.join(',') : '';

      if (exportTimeChoice === 'current') {
        const url = platformsParam
          ? `${API_BASE}/api/organizations/${encodeURIComponent(orgId)}/export/current?platforms=${encodeURIComponent(platformsParam)}`
          : `${API_BASE}/api/organizations/${encodeURIComponent(orgId)}/export/current`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('Export failed');
        const csv = await res.text();
        await shareCsv(csv, `anorha-export-${new Date().toISOString().slice(0, 10)}.csv`);
      } else if (exportTimeChoice === 'snapshot' && selectedExportSnapshotId) {
        const res = await fetch(
          `${API_BASE}/api/organizations/${encodeURIComponent(orgId)}/snapshots/${encodeURIComponent(selectedExportSnapshotId)}/export?format=csv`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error('Export failed');
        const csv = await res.text();
        await shareCsv(csv, `anorha-snapshot-${selectedExportSnapshotId.slice(0, 8)}.csv`);
      } else if (exportTimeChoice === 'custom') {
        const atIso = customExportDate.toISOString();
        const closestRes = await fetch(
          `${API_BASE}/api/organizations/${encodeURIComponent(orgId)}/snapshots/closest?at=${encodeURIComponent(atIso)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!closestRes.ok) throw new Error('Failed to find snapshot');
        const { snapshot } = await closestRes.json();
        if (!snapshot?.Id) {
          Alert.alert('No backup found', 'No backup exists at or before the selected date. Try "Current data" or pick a later date.');
          return;
        }
        const res = await fetch(
          `${API_BASE}/api/organizations/${encodeURIComponent(orgId)}/snapshots/${encodeURIComponent(snapshot.Id)}/export?format=csv`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error('Export failed');
        const csv = await res.text();
        await shareCsv(csv, `anorha-snapshot-${snapshot.Id.slice(0, 8)}.csv`);
      } else {
        Alert.alert('Select time', 'Choose Current data, a restore point, or a custom date.');
        return;
      }
      setExportModalVisible(false);
      setExportStep(1);
      setSelectedExportPlatforms([]);
      setExportTimeChoice('current');
      setSelectedExportSnapshotId(null);
    } catch (e) {
      Alert.alert('Export failed', (e as Error).message);
    } finally {
      setExportOptionsExporting(false);
    }
  }, [orgId, exportTimeChoice, selectedExportSnapshotId, customExportDate, selectedExportPlatforms, shareCsv]);

  const toggleExportPlatform = useCallback((platform: string) => {
    setSelectedExportPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    );
  }, []);

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
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
              {orgName ? `Backups for ${orgName}` : 'Organization state snapshots'}
            </Text>
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
          <TouchableOpacity
            style={[styles.createBackupBtn, { backgroundColor: ANORHA_GREEN }]}
            onPress={handleCreateBackupNow}
            disabled={creatingBackup}
          >
            {creatingBackup ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Icon name="content-save" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.createBackupBtnText}>Create backup now</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.exportCurrentBtn, { borderColor: ANORHA_GREEN }]}
            onPress={handleExportCurrent}
            disabled={exportingCurrent}
          >
            {exportingCurrent ? (
              <ActivityIndicator size="small" color={ANORHA_GREEN} />
            ) : (
              <>
                <Icon name="file-export" size={20} color={ANORHA_GREEN} style={{ marginRight: 8 }} />
                <Text style={[styles.exportCurrentBtnText, { color: ANORHA_GREEN }]}>Export current data</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.exportCurrentBtn, { borderColor: '#93a3b8' }]}
            onPress={() => { setExportModalVisible(true); setExportStep(1); }}
          >
            <Icon name="tune-variant" size={20} color="#64748b" style={{ marginRight: 8 }} />
            <Text style={[styles.exportCurrentBtnText, { color: '#64748b' }]}>Export with options (platforms & time)</Text>
          </TouchableOpacity>
          <Text style={[styles.uninstallCopy, { color: theme.colors.textSecondary }]}>
            Before uninstalling the app, tap Create backup now. After reinstall, sign in, open this org, then choose Restore on that backup.
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
                  style={[styles.exportSnapshotBtn, { borderColor: ANORHA_GREEN }]}
                  onPress={() => handleExportSnapshot(s.Id)}
                  disabled={exportingId !== null}
                >
                  {exportingId === s.Id ? (
                    <ActivityIndicator size="small" color={ANORHA_GREEN} />
                  ) : (
                    <Text style={[styles.exportSnapshotBtnText, { color: ANORHA_GREEN }]}>Export</Text>
                  )}
                </TouchableOpacity>
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

      <Modal visible={exportModalVisible} animationType="slide" transparent>
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.exportModalContent, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.exportModalHeader}>
              <Text style={[styles.exportModalTitle, { color: theme.colors.text }]}>Export data</Text>
              <TouchableOpacity onPress={() => setExportModalVisible(false)}>
                <Icon name="close" size={24} color={theme.colors.text} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.exportModalHint, { color: theme.colors.textSecondary }]}>
              You can always restore to any backup from Backups & restore.
            </Text>

            {exportStep === 1 && (
              <>
                <Text style={[styles.exportStepLabel, { color: theme.colors.text }]}>Which platform(s)? (optional)</Text>
                <View style={styles.exportPlatformGrid}>
                  {ENABLED_PLATFORMS.map((p) => (
                    <PlatformButton
                      key={p}
                      platform={p}
                      isSelected={selectedExportPlatforms.includes(p)}
                      onPress={() => toggleExportPlatform(p)}
                      isConnected={false}
                    />
                  ))}
                </View>
                <TouchableOpacity
                  style={[styles.exportModalNextBtn, { backgroundColor: ANORHA_GREEN }]}
                  onPress={() => setExportStep(2)}
                >
                  <Text style={styles.exportModalNextBtnText}>Next: Choose time</Text>
                </TouchableOpacity>
              </>
            )}

            {exportStep === 2 && (
              <>
                <TouchableOpacity onPress={() => setExportStep(1)} style={styles.exportModalBack}>
                  <Icon name="arrow-left" size={20} color={ANORHA_GREEN} />
                  <Text style={{ color: ANORHA_GREEN, marginLeft: 4 }}>Back</Text>
                </TouchableOpacity>
                <Text style={[styles.exportStepLabel, { color: theme.colors.text }]}>At which time?</Text>
                <TouchableOpacity
                  style={[styles.exportTimeOption, exportTimeChoice === 'current' && { borderColor: ANORHA_GREEN, backgroundColor: ANORHA_GREEN + '15' }]}
                  onPress={() => { setExportTimeChoice('current'); setSelectedExportSnapshotId(null); }}
                >
                  <Text style={[styles.exportTimeOptionText, { color: theme.colors.text }]}>Current data</Text>
                </TouchableOpacity>
                {snapshots.length > 0 && (
                  <>
                    <Text style={[styles.exportTimeOptionSub, { color: theme.colors.textSecondary }]}>Restore points:</Text>
                    {snapshots.slice(0, 5).map((s) => (
                      <TouchableOpacity
                        key={s.Id}
                        style={[styles.exportTimeOption, exportTimeChoice === 'snapshot' && selectedExportSnapshotId === s.Id && { borderColor: ANORHA_GREEN, backgroundColor: ANORHA_GREEN + '15' }]}
                        onPress={() => { setExportTimeChoice('snapshot'); setSelectedExportSnapshotId(s.Id); }}
                      >
                        <Text style={[styles.exportTimeOptionText, { color: theme.colors.text }]} numberOfLines={1}>
                          {triggerLabel(s.TriggerEvent)} – {formatDate(s.CreatedAt)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
                <Text style={[styles.exportTimeOptionSub, { color: theme.colors.textSecondary }]}>Custom date:</Text>
                <TouchableOpacity
                  style={[styles.exportTimeOption, exportTimeChoice === 'custom' && { borderColor: ANORHA_GREEN, backgroundColor: ANORHA_GREEN + '15' }]}
                  onPress={() => { setExportTimeChoice('custom'); setShowDatePicker(true); }}
                >
                  <Text style={[styles.exportTimeOptionText, { color: theme.colors.text }]}>
                    {customExportDate.toLocaleDateString(undefined, { dateStyle: 'medium' })} {customExportDate.toLocaleTimeString(undefined, { timeStyle: 'short' })}
                  </Text>
                </TouchableOpacity>
                {showDatePicker && (
                  <DateTimePicker
                    value={customExportDate}
                    mode="datetime"
                    display="default"
                    onChange={(_, d) => { if (d) setCustomExportDate(d); setShowDatePicker(false); }}
                  />
                )}
                <TouchableOpacity
                  style={[styles.exportModalNextBtn, { backgroundColor: ANORHA_GREEN }]}
                  onPress={handleExportWithOptionsSubmit}
                  disabled={exportOptionsExporting}
                >
                  {exportOptionsExporting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.exportModalNextBtnText}>Export CSV</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
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
  createBackupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 16,
  },
  createBackupBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  exportCurrentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
  },
  exportCurrentBtnText: { fontSize: 15, fontWeight: '600' },
  uninstallCopy: {
    fontSize: 12,
    marginBottom: 16,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  exportSnapshotBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
  },
  exportSnapshotBtnText: { fontWeight: '600', fontSize: 13 },
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
    gap: 8,
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
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  exportModalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  exportModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  exportModalTitle: { fontSize: 18, fontWeight: '600' },
  exportModalHint: { fontSize: 12, marginBottom: 16, fontStyle: 'italic' },
  exportStepLabel: { fontSize: 15, fontWeight: '600', marginBottom: 12 },
  exportPlatformGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
  },
  exportModalNextBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  exportModalNextBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  exportModalBack: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  exportTimeOption: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    marginBottom: 8,
  },
  exportTimeOptionText: { fontSize: 15, fontWeight: '500' },
  exportTimeOptionSub: { fontSize: 13, marginTop: 8, marginBottom: 4 },
});
