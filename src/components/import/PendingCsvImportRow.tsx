import React from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { ChevronRight, FileClock } from 'lucide-react-native';

interface PendingCsvImportRowProps {
  pendingItems: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export function PendingCsvImportRow({ pendingItems, onPress, style }: PendingCsvImportRowProps) {
  const pendingLabel = pendingItems > 0
    ? `${pendingItems} ${pendingItems === 1 ? 'item' : 'items'} pending`
    : 'Import in progress';
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Resume CSV import, ${pendingLabel}`}
      activeOpacity={0.75}
      onPress={onPress}
      style={[styles.row, style]}
    >
      <View style={styles.icon}>
        <FileClock size={21} color="#43631A" />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>Resume CSV import</Text>
        <Text style={styles.pending}>{pendingLabel}</Text>
      </View>
      <ChevronRight size={20} color="#A1A1AA" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 70,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DDE7C9',
    backgroundColor: '#F7FAF1',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#EAF2D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 3 },
  title: { color: '#18181B', fontSize: 15, fontWeight: '700' },
  pending: { color: '#5F6E45', fontSize: 13 },
});
