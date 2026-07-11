import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config/env';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import { useImportHub } from '../hooks/useImportHub';
import { createLogger } from '../utils/logger';
const log = createLogger('SyncRulesScreen');

// --- System-B palette (matches ConnectionsScreen) — this screen was revived out
// of the legacy useTheme()/System-A look into the same hardcoded language. ---
const INK = '#18181B';
const SUBTLE = '#71717A';
const MUTED = '#9CA3AF';
const BG = '#F6F7F4';
const SURFACE = '#FFFFFF';
const BORDER = '#ECEBE6';
const HAIRLINE = '#F1F1EE';
const GREEN = '#93C822';
const GREEN_DARK = '#43631A';
const GREEN_TINT = 'rgba(147,200,34,0.12)';
const AMBER = '#A2611A';
const AMBER_TINT = 'rgba(162,97,26,0.12)';

// Canonical backend enums (sync-rules.service.ts SyncRules) — keep these in
// lockstep with the engine so saved directives are actually readable/enforced.
type SyncDirection = 'bidirectional' | 'push_only' | 'pull_only';
type SourceOfTruth = 'ANORHA' | 'PLATFORM';

type SyncRulesScreenRouteProp = RouteProp<AppStackParamList, 'SyncRules'>;
type SyncRulesScreenNavigationProp = StackNavigationProp<AppStackParamList, 'SyncRules'>;

const SyncRulesScreen = () => {
  const route = useRoute<SyncRulesScreenRouteProp>();
  const navigation = useNavigation<SyncRulesScreenNavigationProp>();
  const { connectionId } = route.params;
  // Senders (ConnectionsScreen / ConnectedPlatformItem / SettingsScreen) pass an
  // extra platformName so the header doesn't flash "Platform" before meta loads.
  const routeParams = route.params as any;
  const [platformName, setPlatformName] = useState<string>(routeParams?.platformName || 'Platform');
  const [displayName, setDisplayName] = useState<string>('');
  const API_ROOT = API_BASE_URL;

  // Passive "needs you" signal for this connection (email-inbox model): the deck
  // is reachable only from the explicit row below, never forced.
  const hub = useImportHub();
  const attn = hub.lanes.matches.byConnection.find((b) => b.connectionId === connectionId)?.count || 0;

  // Sync Rules State
  const [syncDirection, setSyncDirection] = useState<SyncDirection>('bidirectional');
  const [sourceOfTruth, setSourceOfTruth] = useState<SourceOfTruth>('ANORHA');
  const [autoCreate, setAutoCreate] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [syncInventory, setSyncInventory] = useState(true);
  const [syncPricing, setSyncPricing] = useState(true);
  const [showAdvancedRules, setShowAdvancedRules] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<number>(1);
  const [availableConnections, setAvailableConnections] = useState<Array<{ Id: string; DisplayName: string; PlatformType: string }>>([]);
  const [selectedDestinations, setSelectedDestinations] = useState<string[]>([]);
  const [syncMode, setSyncMode] = useState<'manual' | 'auto' | 'batch'>('manual');
  const [batchTime, setBatchTime] = useState<string>('02:00');

  // Load existing sync rules
  useEffect(() => {
    loadConnectionMeta();
    loadSyncRules();
  }, [connectionId]);

  useEffect(() => {
    (async () => {
      try {
        const { data: userRes } = await supabase.auth.getUser();
        const userId = userRes?.user?.id;
        if (!userId) return;
        const { data } = await supabase
          .from('PlatformConnections')
          .select('Id, DisplayName, PlatformType, IsEnabled')
          .eq('UserId', userId)
          .eq('IsEnabled', true);
        const rows = (data || []).map((r: any) => ({ Id: r.Id, DisplayName: r.DisplayName, PlatformType: r.PlatformType }));
        setAvailableConnections(rows);
        setSelectedDestinations((prev) => (prev.length ? prev : [connectionId]));
      } catch { }
    })();
  }, [connectionId]);

  const loadConnectionMeta = async () => {
    try {
      const { data, error } = await supabase
        .from('PlatformConnections')
        .select('DisplayName, PlatformType')
        .eq('Id', connectionId)
        .single();
      if (!error && data) {
        setDisplayName(data.DisplayName || '');
        setPlatformName(data.PlatformType || 'Platform');
      }
    } catch { }
  };

  const loadSyncRules = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('PlatformConnections')
        .select('SyncRules')
        .eq('Id', connectionId)
        .single();

      if (error) {
        log.error('Error loading sync rules:', error);
        return;
      }

      if (data?.SyncRules) {
        const rules = data.SyncRules;
        // Direction: canonical enum, with back-compat for any legacy hyphenated values.
        const legacyDir: Record<string, SyncDirection> = {
          'two-way': 'bidirectional',
          'push-only': 'push_only',
          'pull-only': 'pull_only',
        };
        const dir = rules.syncDirection;
        setSyncDirection((dir && legacyDir[dir]) || (dir as SyncDirection) || 'bidirectional');
        // Source of truth: backend stores productDetailsSoT/inventorySoT ('PLATFORM'|'ANORHA').
        // Fall back to the legacy 'sssync'/'platform' shape if present.
        const sot: SourceOfTruth | undefined =
          rules.productDetailsSoT ||
          rules.inventorySoT ||
          (rules.sourceOfTruth === 'platform' ? 'PLATFORM' : rules.sourceOfTruth === 'sssync' ? 'ANORHA' : undefined);
        setSourceOfTruth(sot || 'ANORHA');
        // createNew is the canonical auto-create flag; keep legacy autoCreate as fallback.
        setAutoCreate(rules.createNew !== undefined ? rules.createNew : rules.autoCreate !== undefined ? rules.autoCreate : true);
        setAutoUpdate(rules.propagateUpdates !== undefined ? rules.propagateUpdates : rules.autoUpdate !== undefined ? rules.autoUpdate : true);
        setSyncInventory(rules.syncInventory !== undefined ? rules.syncInventory : true);
        setSyncPricing(rules.syncPricing !== undefined ? rules.syncPricing : true);
      }
    } catch (err) {
      log.error('Error loading sync rules:', err);
    } finally {
      setLoading(false);
    }
  };

  const saveSyncRules = async () => {
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error('Auth required');

      // Route through the canonical sync-rules endpoint so the engine applies the
      // direction preset (push/pull/propagate flags) and persists field names it
      // actually reads. The server derives allowPush/allowPull/propagate* from
      // syncDirection, so we send the canonical intent fields only.
      const updates: Record<string, any> = {
        syncDirection,
        productDetailsSoT: sourceOfTruth,
        inventorySoT: sourceOfTruth,
        createNew: autoCreate,
        propagateUpdates: autoUpdate,
        syncInventory,
        syncPricing,
        // Additive UI-only scheduling/destination metadata (merged + persisted).
        mode: syncMode,
        schedule: syncMode === 'batch' ? { dailyTimeUtc: batchTime } : null,
        destinations: { connectionIds: selectedDestinations },
      };

      const res = await fetch(`${API_ROOT}/api/sync-rules/connections/${connectionId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);

      Alert.alert(
        'Success',
        'Sync rules have been saved successfully!',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (err: any) {
      log.error('Error saving sync rules:', err);
      Alert.alert('Error', 'Failed to save sync rules. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const gotoReview = () => {
    navigation.navigate('SyncInbox', { connectionId, platformName });
  };

  const disconnectPlatform = () => {
    Alert.alert(
      'Remove connection',
      `Disconnect ${platformName}? Your products stay in Anorha.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data: session } = await supabase.auth.getSession();
              const token = session?.session?.access_token;
              if (!token) throw new Error('Auth required');
              // Non-destructive disconnect: keep all products/inventory (mirrors
              // ConnectionsScreen). A hard DELETE would cull inventory, which the
              // copy never warned about.
              const res = await fetch(`${API_ROOT}/api/platform-connections/${connectionId}/disconnect`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ cleanupStrategy: 'keep' }),
              });
              if (!res.ok) throw new Error(`Failed (${res.status})`);
              Alert.alert('Disconnected', `${platformName} connection removed. Your products stay in Anorha.`);
              navigation.goBack();
            } catch (e: any) {
              Alert.alert('Disconnect failed', e?.message || 'Please try again');
            }
          },
        },
      ]
    );
  };

  const renderSyncDirectionOption = (option: SyncDirection, title: string, subtitle: string, icon: string) => {
    const selected = syncDirection === option;
    return (
      <TouchableOpacity
        style={[styles.optionButton, selected && styles.optionButtonSelected]}
        onPress={() => setSyncDirection(option)}
      >
        <Icon name={icon} size={24} color={selected ? GREEN_DARK : SUBTLE} style={styles.optionIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>{title}</Text>
          <Text style={[styles.optionSubtitle, selected && styles.optionSubtitleSelected]}>{subtitle}</Text>
        </View>
        <Icon name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={selected ? GREEN_DARK : SUBTLE} />
      </TouchableOpacity>
    );
  };

  const renderSourceOption = (option: SourceOfTruth, title: string, subtitle: string, icon: string) => {
    const selected = sourceOfTruth === option;
    return (
      <TouchableOpacity
        style={[styles.optionButton, selected && styles.optionButtonSelected]}
        onPress={() => setSourceOfTruth(option)}
      >
        <Icon name={icon} size={24} color={selected ? GREEN_DARK : SUBTLE} style={styles.optionIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>{title}</Text>
          <Text style={[styles.optionSubtitle, selected && styles.optionSubtitleSelected]}>{subtitle}</Text>
        </View>
        <Icon name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={selected ? GREEN_DARK : SUBTLE} />
      </TouchableOpacity>
    );
  };

  const applyPreset = (preset: 'conservative' | 'balanced' | 'aggressive') => {
    switch (preset) {
      case 'conservative':
        setSyncDirection('pull_only');
        setSourceOfTruth('PLATFORM');
        setAutoCreate(false);
        setAutoUpdate(false);
        setSyncInventory(true);
        setSyncPricing(false);
        break;
      case 'balanced':
        setSyncDirection('bidirectional');
        setSourceOfTruth('ANORHA');
        setAutoCreate(true);
        setAutoUpdate(true);
        setSyncInventory(true);
        setSyncPricing(true);
        break;
      case 'aggressive':
        setSyncDirection('push_only');
        setSourceOfTruth('ANORHA');
        setAutoCreate(true);
        setAutoUpdate(true);
        setSyncInventory(true);
        setSyncPricing(true);
        break;
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: INK, fontFamily: 'Inter_500Medium' }}>Loading sync rules...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="arrow-left" size={24} color={INK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Sync Settings · {displayName || platformName}</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 8 }}>
        {/* Needs you — passive attention row; the ONE explicit deep-link into the
            review deck for this connection. */}
        {attn > 0 && (
          <TouchableOpacity activeOpacity={0.85} onPress={gotoReview} style={styles.needsRow}>
            <View style={styles.needsIcon}>
              <Icon name="sync-alert" size={20} color={AMBER} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.needsTitle}>{attn} {attn === 1 ? 'item needs' : 'items need'} you</Text>
              <Text style={styles.needsSub} numberOfLines={1}>Review matches for {displayName || platformName}</Text>
            </View>
            <Icon name="chevron-right" size={22} color={MUTED} />
          </TouchableOpacity>
        )}

        {/* Stepper */}
        <Card style={styles.ruleSection}>
          <Text style={styles.sectionTitle}>Setup</Text>
          <Text style={styles.sectionSubtitle}>Step {step} of 4</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[1, 2, 3, 4].map((n) => (
              <TouchableOpacity key={n} onPress={() => setStep(n)}>
                <Icon name={step === n ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={18} color={step === n ? GREEN_DARK : SUBTLE} />
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        {step === 1 && (
          <Card style={styles.ruleSection}>
            <Text style={styles.sectionTitle}>Pulling data</Text>
            <Text style={styles.sectionSubtitle}>We fetch your latest products. You can reconcile now or continue.</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Reconcile now" onPress={gotoReview} icon="clipboard-list" />
              <Button title="Continue" onPress={() => setStep(2)} icon="arrow-right" />
            </View>
          </Card>
        )}

        {step === 2 && (
          <Card style={styles.ruleSection}>
            <Text style={styles.sectionTitle}>Destinations</Text>
            <Text style={styles.sectionSubtitle}>Choose platforms to sync this inventory to.</Text>
            {availableConnections.map((c) => {
              const selected = selectedDestinations.includes(c.Id);
              return (
                <TouchableOpacity key={c.Id} style={[styles.optionButton, selected && styles.optionButtonSelected]} onPress={() => setSelectedDestinations((prev) => selected ? prev.filter(id => id !== c.Id) : [...prev, c.Id])}>
                  <Icon name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} size={20} color={selected ? GREEN_DARK : SUBTLE} style={styles.optionIcon} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>{c.DisplayName}</Text>
                    <Text style={styles.optionSubtitle}>{c.PlatformType}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            <View style={{ marginTop: 10 }}>
              <Button title="Next" onPress={() => setStep(3)} icon="arrow-right" />
            </View>
          </Card>
        )}

        {step === 3 && (
          <Card style={styles.ruleSection}>
            <Text style={styles.sectionTitle}>Sync behavior</Text>
            <Text style={styles.sectionSubtitle}>Pick how and when changes flow.</Text>
            {/* Mode */}
            <TouchableOpacity style={[styles.optionButton, syncMode === 'manual' && styles.optionButtonSelected]} onPress={() => setSyncMode('manual')}>
              <Icon name={syncMode === 'manual' ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={syncMode === 'manual' ? GREEN_DARK : SUBTLE} style={styles.optionIcon} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, syncMode === 'manual' && styles.optionTitleSelected]}>Manual only</Text>
                <Text style={styles.optionSubtitle}>You decide when to sync</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.optionButton, syncMode === 'auto' && styles.optionButtonSelected]} onPress={() => setSyncMode('auto')}>
              <Icon name={syncMode === 'auto' ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={syncMode === 'auto' ? GREEN_DARK : SUBTLE} style={styles.optionIcon} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, syncMode === 'auto' && styles.optionTitleSelected]}>Automatic</Text>
                <Text style={styles.optionSubtitle}>Sync as changes happen</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.optionButton, syncMode === 'batch' && styles.optionButtonSelected]} onPress={() => setSyncMode('batch')}>
              <Icon name={syncMode === 'batch' ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={syncMode === 'batch' ? GREEN_DARK : SUBTLE} style={styles.optionIcon} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, syncMode === 'batch' && styles.optionTitleSelected]}>Batched</Text>
                <Text style={styles.optionSubtitle}>Run once daily</Text>
              </View>
            </TouchableOpacity>
            {syncMode === 'batch' && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.optionSubtitle}>Time (UTC): {batchTime}</Text>
              </View>
            )}

            {/* Direction */}
            <View style={{ height: 8 }} />
            {renderSyncDirectionOption('bidirectional', 'Two-way sync', 'Changes flow in both directions', 'sync')}
            {renderSyncDirectionOption('push_only', 'Push to platform', 'Anorha updates your platform only', 'upload')}
            {renderSyncDirectionOption('pull_only', 'Pull from platform', 'Platform updates Anorha only', 'download')}

            <View style={{ marginTop: 10 }}>
              <Button title="Next" onPress={() => setStep(4)} icon="arrow-right" />
            </View>
          </Card>
        )}

        {step === 4 && (
          <Card style={styles.ruleSection}>
            <Text style={styles.sectionTitle}>Confirm</Text>
            <Text style={styles.sectionSubtitle}>Summary</Text>
            <Text style={styles.optionTitle}>Destinations</Text>
            {availableConnections.filter(c => selectedDestinations.includes(c.Id)).map(c => (
              <Text key={c.Id} style={styles.optionSubtitle}>• {c.DisplayName} ({c.PlatformType})</Text>
            ))}
            <Text style={[styles.optionTitle, { marginTop: 8 }]}>Mode</Text>
            <Text style={styles.optionSubtitle}>{syncMode}</Text>
            <Text style={[styles.optionTitle, { marginTop: 8 }]}>Direction</Text>
            <Text style={styles.optionSubtitle}>{syncDirection}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Button title="Back" onPress={() => setStep(3)} icon="arrow-left" />
              <Button title="Save" onPress={saveSyncRules} loading={saving} icon="content-save" />
            </View>
          </Card>
        )}
      </ScrollView>

      <Button
        title="Save Sync Rules"
        onPress={saveSyncRules}
        loading={saving}
        style={styles.saveButton}
        icon="content-save"
      />

      <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        <Button title="Review & Sync" onPress={gotoReview} icon="playlist-check" />
        <View style={{ height: 10 }} />
        <Button title={`Disconnect ${platformName}`} onPress={disconnectPlatform} icon="link-off" outlined />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: SURFACE,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: INK,
    marginLeft: 15,
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  needsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  needsIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AMBER_TINT,
  },
  needsTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: INK,
  },
  needsSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: SUBTLE,
    marginTop: 2,
  },
  ruleSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: INK,
    marginBottom: 5,
  },
  sectionSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: SUBTLE,
    marginBottom: 15,
    lineHeight: 20,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 10,
    backgroundColor: SURFACE,
  },
  optionButtonSelected: {
    borderColor: GREEN,
    backgroundColor: GREEN_TINT,
  },
  optionIcon: {
    marginRight: 12,
  },
  optionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: INK,
  },
  optionTitleSelected: {
    color: GREEN_DARK,
  },
  optionSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: SUBTLE,
    marginTop: 2,
  },
  optionSubtitleSelected: {
    color: GREEN_DARK,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  switchLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  switchLabel: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: INK,
    marginLeft: 12,
  },
  advancedToggle: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 15,
  },
  advancedText: {
    fontSize: 16,
    color: GREEN_DARK,
    fontFamily: 'Inter_600SemiBold',
    marginLeft: 8,
  },
  saveButton: {
    marginHorizontal: 20,
    marginVertical: 12,
  },
  presetCard: {
    marginBottom: 15,
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  presetTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: INK,
    marginBottom: 5,
  },
  presetDescription: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: SUBTLE,
    lineHeight: 18,
  },
  presetButton: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: GREEN_TINT,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  presetButtonText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: GREEN_DARK,
  },
});

export default SyncRulesScreen;
