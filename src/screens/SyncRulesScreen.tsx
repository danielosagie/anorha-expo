import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { TouchableOpacity } from 'react-native-gesture-handler';
import Card from '../components/Card';
import { Switch } from 'react-native-paper';

type SyncDirection = 'two-way' | 'push-only' | 'pull-only';
type SourceOfTruth = 'sssync' | 'platform';

const SyncRulesScreen = () => {
  const theme = useTheme();
  const [syncDirection, setSyncDirection] = useState<SyncDirection>('two-way');
  const [sourceOfTruth, setSourceOfTruth] = useState<SourceOfTruth>('sssync');
  const [autoCreate, setAutoCreate] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const renderDirectionOption = (option: SyncDirection, title: string, subtitle: string) => (
    <TouchableOpacity
      style={[styles.optionButton, syncDirection === option && styles.optionButtonSelected]}
      onPress={() => setSyncDirection(option)}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionTitle, syncDirection === option && styles.optionTitleSelected]}>{title}</Text>
        <Text style={[styles.optionSubtitle, syncDirection === option && styles.optionSubtitleSelected]}>{subtitle}</Text>
      </View>
      <Icon 
        name={syncDirection === option ? 'radiobox-marked' : 'radiobox-blank'} 
        size={24} 
        color={syncDirection === option ? theme.colors.primary : theme.colors.textSecondary} 
      />
    </TouchableOpacity>
  );

  const renderSourceOption = (option: SourceOfTruth, title: string, subtitle: string) => (
    <TouchableOpacity
      style={[styles.optionButton, sourceOfTruth === option && styles.optionButtonSelected]}
      onPress={() => setSourceOfTruth(option)}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionTitle, sourceOfTruth === option && styles.optionTitleSelected]}>{title}</Text>
        <Text style={[styles.optionSubtitle, sourceOfTruth === option && styles.optionSubtitleSelected]}>{subtitle}</Text>
      </View>
      <Icon 
        name={sourceOfTruth === option ? 'radiobox-marked' : 'radiobox-blank'} 
        size={24} 
        color={sourceOfTruth === option ? theme.colors.primary : theme.colors.textSecondary} 
      />
    </TouchableOpacity>
  );

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollViewContent: {
      padding: 20,
    },
    header: {
      marginBottom: 20,
      alignItems: 'center',
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.colors.text,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      marginTop: 8,
      textAlign: 'center',
      lineHeight: 22,
    },
    ruleSection: {
      marginBottom: 20,
      padding: 20,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 15,
    },
    optionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 15,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#eee',
      marginBottom: 10,
    },
    optionButtonSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary + '10',
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
      marginTop: 4,
    },
    optionSubtitleSelected: {
      color: theme.colors.primary,
    },
    switchRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 10,
    },
    advancedToggle: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 10,
    },
    advancedText: {
      fontSize: 16,
      color: theme.colors.primary,
      fontWeight: '600',
      marginLeft: 8,
    },
    footer: {
      marginTop: 20,
    },
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollViewContent}>
      <View style={styles.header}>
        <Text style={styles.title}>Final Step: Sync Settings</Text>
        <Text style={styles.subtitle}>
          Just a few settings before we activate your sync. Choose the options that best fit your workflow.
        </Text>
      </View>

      <Card style={styles.ruleSection}>
        <Text style={styles.sectionTitle}>Where should data flow?</Text>
        {renderDirectionOption('two-way', 'Sync both ways (Recommended)', 'Changes flow between SSSync and your platform.')}
        {renderDirectionOption('push-only', 'Only send changes to Platform', 'Changes in SSSync will update your platform.')}
        {renderDirectionOption('pull-only', 'Only get changes from Platform', 'Changes on your platform will update SSSync.')}
      </Card>

      <Card style={styles.ruleSection}>
        <Text style={styles.sectionTitle}>If product details don't match...</Text>
        {renderSourceOption('sssync', 'Prefer SSSync\'s version', 'SSSync will be the source of truth.')}
        {renderSourceOption('platform', 'Prefer your Platform\'s version', 'Your platform will be the source of truth.')}
      </Card>

      <TouchableOpacity style={styles.advancedToggle} onPress={() => setShowAdvanced(!showAdvanced)}>
        <Icon name={showAdvanced ? 'chevron-down' : 'chevron-right'} size={22} color={theme.colors.primary} />
        <Text style={styles.advancedText}>Advanced Settings</Text>
      </TouchableOpacity>
      
      {showAdvanced && (
        <Card style={styles.ruleSection}>
          <Text style={styles.sectionTitle}>Automatic Actions</Text>
          <View style={styles.switchRow}>
            <Text style={styles.optionTitle}>Auto-create products</Text>
            <Switch value={autoCreate} onValueChange={setAutoCreate} />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.optionTitle}>Auto-update products</Text>
            <Switch value={autoUpdate} onValueChange={setAutoUpdate} />
          </View>
        </Card>
      )}

      <View style={styles.footer}>
        <Button
          title="Save & Activate Sync"
          onPress={() => { /* Implement save and sync logic */ }}
          icon="check-decagram-outline"
        />
      </View>
    </ScrollView>
  );
};

export default SyncRulesScreen; 