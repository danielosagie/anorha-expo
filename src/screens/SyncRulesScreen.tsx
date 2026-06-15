import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config/env';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../../lib/supabase';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import { createLogger } from '../utils/logger';
const log = createLogger('SyncRulesScreen');


type SyncDirection = 'two-way' | 'push-only' | 'pull-only';
type SourceOfTruth = 'sssync' | 'platform';

type SyncRulesScreenRouteProp = RouteProp<AppStackParamList, 'SyncRules'>;
type SyncRulesScreenNavigationProp = StackNavigationProp<AppStackParamList, 'SyncRules'>;

const SyncRulesScreen = () => {
  const theme = useTheme();
  const route = useRoute<SyncRulesScreenRouteProp>();
  const navigation = useNavigation<SyncRulesScreenNavigationProp>();
  const { connectionId } = route.params;
  const [platformName, setPlatformName] = useState<string>('Platform');
  const [displayName, setDisplayName] = useState<string>('');
  const SSSYNC_API_BASE_URL = API_BASE_URL;

  // Sync Rules State
  const [syncDirection, setSyncDirection] = useState<SyncDirection>('two-way');
  const [sourceOfTruth, setSourceOfTruth] = useState<SourceOfTruth>('sssync');
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
        setSyncDirection(rules.syncDirection || 'two-way');
        setSourceOfTruth(rules.sourceOfTruth || 'sssync');
        setAutoCreate(rules.autoCreate !== undefined ? rules.autoCreate : true);
        setAutoUpdate(rules.autoUpdate !== undefined ? rules.autoUpdate : true);
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
      const syncRules = {
        syncDirection,
        sourceOfTruth,
        autoCreate,
        autoUpdate,
        syncInventory,
        syncPricing,
        mode: syncMode,
        schedule: syncMode === 'batch' ? { dailyTimeUtc: batchTime } : null,
        destinations: { connectionIds: selectedDestinations },
        updatedAt: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('PlatformConnections')
        .update({ SyncRules: syncRules })
        .eq('Id', connectionId);

      if (error) {
        throw error;
      }

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
    navigation.navigate('ImportOverview', { connectionId, platformName });
  };

  const disconnectPlatform = async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error('Auth required');
      const res = await fetch(`${SSSYNC_API_BASE_URL}/api/platform-connections/${connectionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      Alert.alert('Disconnected', `${platformName} connection disabled.`);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Disconnect failed', e?.message || 'Please try again');
    }
  };

  const renderSyncDirectionOption = (option: SyncDirection, title: string, subtitle: string, icon: string) => (
    <TouchableOpacity
      style={[styles.optionButton, syncDirection === option && styles.optionButtonSelected]}
      onPress={() => setSyncDirection(option)}
    >
      <Icon
        name={icon}
        size={24}
        color={syncDirection === option ? theme.colors.primary : theme.colors.textSecondary}
        style={styles.optionIcon}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionTitle, syncDirection === option && styles.optionTitleSelected]}>{title}</Text>
        <Text style={[styles.optionSubtitle, syncDirection === option && styles.optionSubtitleSelected]}>{subtitle}</Text>
      </View>
      <Icon
        name={syncDirection === option ? 'radiobox-marked' : 'radiobox-blank'}
        size={20}
        color={syncDirection === option ? theme.colors.primary : theme.colors.textSecondary}
      />
    </TouchableOpacity>
  );

  const renderSourceOption = (option: SourceOfTruth, title: string, subtitle: string, icon: string) => (
    <TouchableOpacity
      style={[styles.optionButton, sourceOfTruth === option && styles.optionButtonSelected]}
      onPress={() => setSourceOfTruth(option)}
    >
      <Icon
        name={icon}
        size={24}
        color={sourceOfTruth === option ? theme.colors.primary : theme.colors.textSecondary}
        style={styles.optionIcon}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionTitle, sourceOfTruth === option && styles.optionTitleSelected]}>{title}</Text>
        <Text style={[styles.optionSubtitle, sourceOfTruth === option && styles.optionSubtitleSelected]}>{subtitle}</Text>
      </View>
      <Icon
        name={sourceOfTruth === option ? 'radiobox-marked' : 'radiobox-blank'}
        size={20}
        color={sourceOfTruth === option ? theme.colors.primary : theme.colors.textSecondary}
      />
    </TouchableOpacity>
  );

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 15,
      borderBottomWidth: 1,
      borderBottomColor: '#e0e0e0',
      backgroundColor: theme.colors.surface,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.text,
      marginLeft: 15,
    },
    content: {
      flex: 1,
      padding: 20,
    },
    ruleSection: {
      marginBottom: 20,
      padding: 20,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 5,
    },
    sectionSubtitle: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginBottom: 15,
      lineHeight: 20,
    },
    optionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 15,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#e0e0e0',
      marginBottom: 10,
      backgroundColor: theme.colors.background,
    },
    optionButtonSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary + '10',
    },
    optionIcon: {
      marginRight: 12,
    },
    optionTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: theme.colors.text,
    },
    optionTitleSelected: {
      color: theme.colors.primary,
    },
    optionSubtitle: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginTop: 2,
    },
    optionSubtitleSelected: {
      color: theme.colors.primary,
    },
    switchRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#e0e0e030',
    },
    switchLabelContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    switchLabel: {
      fontSize: 16,
      color: theme.colors.text,
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
      color: theme.colors.primary,
      fontWeight: '600',
      marginLeft: 8,
    },
    saveButton: {
      margin: 20,
    },
    presetCard: {
      marginBottom: 15,
      padding: 15,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#e0e0e0',
    },
    presetTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 5,
    },
    presetDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      lineHeight: 18,
    },
    presetButton: {
      marginTop: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
      backgroundColor: theme.colors.primary + '20',
      borderRadius: 8,
      alignSelf: 'flex-start',
    },
    presetButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.primary,
    },
  });

  const applyPreset = (preset: 'conservative' | 'balanced' | 'aggressive') => {
    switch (preset) {
      case 'conservative':
        setSyncDirection('pull-only');
        setSourceOfTruth('platform');
        setAutoCreate(false);
        setAutoUpdate(false);
        setSyncInventory(true);
        setSyncPricing(false);
        break;
      case 'balanced':
        setSyncDirection('two-way');
        setSourceOfTruth('sssync');
        setAutoCreate(true);
        setAutoUpdate(true);
        setSyncInventory(true);
        setSyncPricing(true);
        break;
      case 'aggressive':
        setSyncDirection('push-only');
        setSourceOfTruth('sssync');
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
        <Text style={{ color: theme.colors.text }}>Loading sync rules...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sync Settings for {displayName || platformName}</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Stepper */}
        <Card style={styles.ruleSection}>
          <Text style={styles.sectionTitle}>Setup</Text>
          <Text style={styles.sectionSubtitle}>Step {step} of 4</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[1, 2, 3, 4].map((n) => (
              <TouchableOpacity key={n} onPress={() => setStep(n)}>
                <Icon name={step === n ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={18} color={step === n ? theme.colors.primary : theme.colors.textSecondary} />
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
                <TouchableOpacity key={c.Id} style={styles.optionButton} onPress={() => setSelectedDestinations((prev) => selected ? prev.filter(id => id !== c.Id) : [...prev, c.Id])}>
                  <Icon name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} size={20} color={selected ? theme.colors.primary : theme.colors.textSecondary} style={styles.optionIcon} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{c.DisplayName}</Text>
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
            <TouchableOpacity style={styles.optionButton} onPress={() => setSyncMode('manual')}>
              <Icon name={syncMode === 'manual' ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={syncMode === 'manual' ? theme.colors.primary : theme.colors.textSecondary} style={styles.optionIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>Manual only</Text>
                <Text style={styles.optionSubtitle}>You decide when to sync</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.optionButton} onPress={() => setSyncMode('auto')}>
              <Icon name={syncMode === 'auto' ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={syncMode === 'auto' ? theme.colors.primary : theme.colors.textSecondary} style={styles.optionIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>Automatic</Text>
                <Text style={styles.optionSubtitle}>Sync as changes happen</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.optionButton} onPress={() => setSyncMode('batch')}>
              <Icon name={syncMode === 'batch' ? 'radiobox-marked' : 'radiobox-blank'} size={20} color={syncMode === 'batch' ? theme.colors.primary : theme.colors.textSecondary} style={styles.optionIcon} />
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>Batched</Text>
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
            {renderSyncDirectionOption('two-way', 'Two-way sync', 'Changes flow in both directions', 'sync')}
            {renderSyncDirectionOption('push-only', 'Push to platform', 'SSSync updates your platform only', 'upload')}
            {renderSyncDirectionOption('pull-only', 'Pull from platform', 'Platform updates SSSync only', 'download')}

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
        <Button title={`Disconnect ${platformName}`} onPress={disconnectPlatform} icon="link-off" />
      </View>
    </View>
  );
};

export default SyncRulesScreen; 