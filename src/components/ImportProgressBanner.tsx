import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useImportProgress } from '../hooks/useImportProgress';

/**
 * Non-blocking banner that surfaces an in-flight / just-finished import so a
 * returning user can see resumable progress. Self-contained: renders nothing
 * when there is no stored import.
 */
export default function ImportProgressBanner() {
  const { progress, dismiss } = useImportProgress();
  const insets = useSafeAreaInsets();

  if (!progress) return null;

  const { status, processed, total, active } = progress;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const done = !active;

  return (
    <View style={[styles.container, { top: insets.top + 6 }]} pointerEvents="box-none">
      <View style={[styles.card, done && status === 'failed' ? styles.cardError : null]}>
        {active ? (
          <ActivityIndicator size="small" color="#5c9c00" />
        ) : (
          <Text style={styles.icon}>{status === 'failed' ? '⚠️' : '✅'}</Text>
        )}
        <View style={styles.body}>
          <Text style={styles.title}>
            {active
              ? `Importing… ${processed}/${total || '?'}`
              : status === 'failed'
                ? 'Import didn’t finish'
                : 'Import complete'}
          </Text>
          {active && total > 0 ? (
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${pct}%` }]} />
            </View>
          ) : null}
        </View>
        <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.dismiss}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', left: 12, right: 12, zIndex: 999 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  cardError: { backgroundColor: '#FFF4F4' },
  icon: { fontSize: 18 },
  body: { flex: 1, marginHorizontal: 12 },
  title: { fontSize: 14, fontWeight: '600', color: '#1A1A1A' },
  track: {
    marginTop: 6,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ECECEC',
    overflow: 'hidden',
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: '#5c9c00' },
  dismiss: { fontSize: 14, color: '#8A8A8A', paddingHorizontal: 4 },
});
