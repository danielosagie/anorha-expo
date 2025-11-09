import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface SyncRules {
  propagateCreates: boolean;
  propagateUpdates: boolean;
  propagateDeletes: boolean;
  syncInventory: boolean;
  syncPricing: boolean;
  productDetailsSoT: 'ANORHA' | 'PLATFORM';
  inventorySoT: 'ANORHA' | 'PLATFORM';
}

interface SyncRulesDisplayProps {
  rules: SyncRules;
  onEdit: () => void;
}

const SyncRulesDisplay: React.FC<SyncRulesDisplayProps> = ({ rules, onEdit }) => {
  const getStatusText = (value: boolean) => value ? 'Enabled' : 'Disabled';
  const getStatusColor = (value: boolean) => value ? '#4CAF50' : '#F44336';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Sync Rules</Text>
        <TouchableOpacity onPress={onEdit} style={styles.editButton}>
          <Text style={styles.editText}>Edit</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.rule}>
        <Text style={styles.label}>Propagate Creates:</Text>
        <Text style={[styles.value, { color: getStatusColor(rules.propagateCreates) }]}>
          {getStatusText(rules.propagateCreates)}
        </Text>
      </View>
      <View style={styles.rule}>
        <Text style={styles.label}>Propagate Updates:</Text>
        <Text style={[styles.value, { color: getStatusColor(rules.propagateUpdates) }]}>
          {getStatusText(rules.propagateUpdates)}
        </Text>
      </View>
      <View style={styles.rule}>
        <Text style={styles.label}>Propagate Deletes:</Text>
        <Text style={[styles.value, { color: getStatusColor(rules.propagateDeletes) }]}>
          {getStatusText(rules.propagateDeletes)}
        </Text>
      </View>
      <View style={styles.rule}>
        <Text style={styles.label}>Sync Inventory:</Text>
        <Text style={[styles.value, { color: getStatusColor(rules.syncInventory) }]}>
          {getStatusText(rules.syncInventory)}
        </Text>
      </View>
      <View style={styles.rule}>
        <Text style={styles.label}>Sync Pricing:</Text>
        <Text style={[styles.value, { color: getStatusColor(rules.syncPricing) }]}>
          {getStatusText(rules.syncPricing)}
        </Text>
      </View>
      <View style={styles.rule}>
        <Text style={styles.label}>Product Details Source of Truth:</Text>
        <Text style={styles.value}>{rules.productDetailsSoT}</Text>
      </View>
      <View style={styles.rule}>
        <Text style={styles.label}>Inventory Source of Truth:</Text>
        <Text style={styles.value}>{rules.inventorySoT}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 16,
    margin: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  editButton: {
    padding: 5,
  },
  editText: {
    color: '#2196F3',
    fontWeight: 'bold',
  },
  rule: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    padding: 8,
    backgroundColor: 'white',
    borderRadius: 4,
  },
  label: {
    flex: 1,
    fontSize: 14,
  },
  value: {
    fontSize: 14,
    fontWeight: 'bold',
  },
});

export default SyncRulesDisplay;
