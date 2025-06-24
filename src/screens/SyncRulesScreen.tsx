import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../../lib/supabase';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';

type SyncDirection = 'two-way' | 'push-only' | 'pull-only';
type SourceOfTruth = 'sssync' | 'platform';

type SyncRulesScreenRouteProp = RouteProp<AppStackParamList, 'SyncRules'>;
type SyncRulesScreenNavigationProp = StackNavigationProp<AppStackParamList, 'SyncRules'>;

const SyncRulesScreen = () => {
  const theme = useTheme();
  const route = useRoute<SyncRulesScreenRouteProp>();
  const navigation = useNavigation<SyncRulesScreenNavigationProp>();
  const { connectionId } = route.params;
  const platformName = 'Platform'; // Default platform name

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

  // Load existing sync rules
  useEffect(() => {
    loadSyncRules();
  }, [connectionId]);

  const loadSyncRules = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('PlatformConnections')
        .select('SyncRules')
        .eq('Id', connectionId)
        .single();

      if (error) {
        console.error('Error loading sync rules:', error);
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
      console.error('Error loading sync rules:', err);
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
      console.error('Error saving sync rules:', err);
      Alert.alert('Error', 'Failed to save sync rules. Please try again.');
    } finally {
      setSaving(false);
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
        <Text style={styles.headerTitle}>Sync Settings for {platformName}</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Quick Setup Presets */}
      <Card style={styles.ruleSection}>
          <Text style={styles.sectionTitle}>Quick Setup</Text>
          <Text style={styles.sectionSubtitle}>Choose a preset that matches your needs, then customize below</Text>
          
          <TouchableOpacity style={styles.presetCard} onPress={() => applyPreset('conservative')}>
            <Text style={styles.presetTitle}>🛡️ Conservative</Text>
            <Text style={styles.presetDescription}>
              Only pull data from {platformName}. No automatic changes to your platform.
            </Text>
            <View style={styles.presetButton}>
              <Text style={styles.presetButtonText}>Apply Conservative</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.presetCard} onPress={() => applyPreset('balanced')}>
            <Text style={styles.presetTitle}>⚖️ Balanced (Recommended)</Text>
            <Text style={styles.presetDescription}>
              Two-way sync with SSSync as the source of truth. Good for most users.
            </Text>
            <View style={styles.presetButton}>
              <Text style={styles.presetButtonText}>Apply Balanced</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.presetCard} onPress={() => applyPreset('aggressive')}>
            <Text style={styles.presetTitle}>🚀 Aggressive</Text>
            <Text style={styles.presetDescription}>
              Push SSSync data to {platformName}. Use when SSSync is your primary system.
            </Text>
            <View style={styles.presetButton}>
              <Text style={styles.presetButtonText}>Apply Aggressive</Text>
            </View>
          </TouchableOpacity>
      </Card>

      <Card style={styles.ruleSection}>
          <Text style={styles.sectionTitle}>Sync Direction</Text>
          <Text style={styles.sectionSubtitle}>How should data flow between SSSync and {platformName}?</Text>
          {renderSyncDirectionOption('two-way', 'Two-way sync', 'Changes flow in both directions', 'sync')}
          {renderSyncDirectionOption('push-only', 'Push to platform', 'SSSync updates your platform only', 'upload')}
          {renderSyncDirectionOption('pull-only', 'Pull from platform', 'Platform updates SSSync only', 'download')}
      </Card>

        <Card style={styles.ruleSection}>
          <Text style={styles.sectionTitle}>Conflict Resolution</Text>
          <Text style={styles.sectionSubtitle}>When product details differ, which should win?</Text>
          {renderSourceOption('sssync', 'SSSync wins', 'Use SSSync data when conflicts occur', 'shield-check')}
          {renderSourceOption('platform', `${platformName} wins`, `Use ${platformName} data when conflicts occur`, 'store')}
        </Card>

        <Card style={styles.ruleSection}>
          <Text style={styles.sectionTitle}>What to Sync</Text>
          <View style={styles.switchRow}>
            <View style={styles.switchLabelContainer}>
              <Icon name="package-variant" size={20} color={theme.colors.text} />
              <Text style={styles.switchLabel}>Inventory levels</Text>
            </View>
            <TouchableOpacity onPress={() => setSyncInventory(!syncInventory)}>
              <Icon 
                name={syncInventory ? 'toggle-switch' : 'toggle-switch-off'} 
                size={32} 
                color={syncInventory ? theme.colors.primary : theme.colors.textSecondary} 
              />
            </TouchableOpacity>
          </View>
          <View style={styles.switchRow}>
            <View style={styles.switchLabelContainer}>
              <Icon name="currency-usd" size={20} color={theme.colors.text} />
              <Text style={styles.switchLabel}>Pricing</Text>
            </View>
            <TouchableOpacity onPress={() => setSyncPricing(!syncPricing)}>
              <Icon 
                name={syncPricing ? 'toggle-switch' : 'toggle-switch-off'} 
                size={32} 
                color={syncPricing ? theme.colors.primary : theme.colors.textSecondary} 
              />
            </TouchableOpacity>
          </View>
        </Card>

        <TouchableOpacity 
          style={styles.advancedToggle} 
          onPress={() => setShowAdvancedRules(!showAdvancedRules)}
        >
          <Icon 
            name={showAdvancedRules ? 'chevron-down' : 'chevron-right'} 
            size={22} 
            color={theme.colors.primary} 
          />
          <Text style={styles.advancedText}>Advanced Settings</Text>
        </TouchableOpacity>
        
        {showAdvancedRules && (
          <Card style={styles.ruleSection}>
            <Text style={styles.sectionTitle}>Automatic Actions</Text>
            <View style={styles.switchRow}>
              <View style={styles.switchLabelContainer}>
                <Icon name="plus-circle" size={20} color={theme.colors.text} />
                <Text style={styles.switchLabel}>Auto-create new products</Text>
              </View>
              <TouchableOpacity onPress={() => setAutoCreate(!autoCreate)}>
                <Icon 
                  name={autoCreate ? 'toggle-switch' : 'toggle-switch-off'} 
                  size={32} 
                  color={autoCreate ? theme.colors.primary : theme.colors.textSecondary} 
                />
              </TouchableOpacity>
            </View>
            <View style={styles.switchRow}>
              <View style={styles.switchLabelContainer}>
                <Icon name="update" size={20} color={theme.colors.text} />
                <Text style={styles.switchLabel}>Auto-update existing products</Text>
              </View>
              <TouchableOpacity onPress={() => setAutoUpdate(!autoUpdate)}>
                <Icon 
                  name={autoUpdate ? 'toggle-switch' : 'toggle-switch-off'} 
                  size={32} 
                  color={autoUpdate ? theme.colors.primary : theme.colors.textSecondary} 
                />
              </TouchableOpacity>
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
      </View>
  );
};

export default SyncRulesScreen; 