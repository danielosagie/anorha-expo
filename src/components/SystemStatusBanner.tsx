import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSystemStatus } from '../context/SystemStatusContext';

const SystemStatusBanner: React.FC = () => {
  const insets = useSafeAreaInsets();
  const systemStatus = useSystemStatus();

  if (!systemStatus.message) {
    return null;
  }

  const bannerStyle =
    systemStatus.effectiveMode === 'offline'
      ? styles.offline
      : systemStatus.authBridgeState === 'unavailable'
        ? styles.auth
        : systemStatus.effectiveMode === 'degraded'
          ? styles.degraded
          : systemStatus.authBridgeState === 'refreshing'
            ? styles.refreshing
            : styles.maintenance;

  return (
    <View style={[styles.container, bannerStyle, { paddingTop: Math.max(insets.top, 8) }]}>
      <Text style={styles.text}>{systemStatus.message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#1F2937',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  offline: {
    backgroundColor: '#FDE68A',
  },
  degraded: {
    backgroundColor: '#FCD34D',
  },
  maintenance: {
    backgroundColor: '#FBCFE8',
  },
  refreshing: {
    backgroundColor: '#DBEAFE',
  },
  auth: {
    backgroundColor: '#FECACA',
  },
});

export default SystemStatusBanner;
