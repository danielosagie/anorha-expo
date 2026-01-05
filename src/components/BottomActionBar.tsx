import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

import { CloudUpload, Save } from 'lucide-react-native';

type Props = {
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  secondaryLabel?: string;
  secondaryDisabled?: boolean;
  onSecondary?: () => void;
};

export default function BottomActionBar({ primaryLabel, primaryDisabled, onPrimary, secondaryLabel, secondaryDisabled, onSecondary }: Props) {
  return (
    <View style={styles.container}>
      <TouchableOpacity disabled={!!primaryDisabled} onPress={onPrimary} style={[styles.primaryBtn, primaryDisabled && styles.disabled]}>

        <CloudUpload size={20} color="white" />
        <Text style={styles.primaryText}>{primaryLabel}</Text>
      </TouchableOpacity>
      {secondaryLabel ? (
        <TouchableOpacity disabled={!!secondaryDisabled} onPress={onSecondary} style={[styles.secondaryBtn, secondaryDisabled && styles.disabled]}>
          <Save size={20} color="#71717A" />
          <Text style={styles.secondaryText}>{secondaryLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    gap: 10,
  },
  primaryBtn: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#93C822',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondaryBtn: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#E5E5E5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: '#71717A', fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.6 },
});


