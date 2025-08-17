import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

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
      {secondaryLabel ? (
        <TouchableOpacity disabled={!!secondaryDisabled} onPress={onSecondary} style={[styles.secondaryBtn, secondaryDisabled && styles.disabled]}>
          <Text style={styles.secondaryText}>{secondaryLabel}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity disabled={!!primaryDisabled} onPress={onPrimary} style={[styles.primaryBtn, primaryDisabled && styles.disabled]}> 
        <Text style={styles.primaryText}>{primaryLabel}</Text>
      </TouchableOpacity>
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
    backgroundColor: '#93C822',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondaryBtn: {
    backgroundColor: '#E5E5E5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: '#000', fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.6 },
});


