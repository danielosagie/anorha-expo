import React from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';

interface PlatformSync {
  platform: string;
  status: 'success' | 'pending' | 'error';
  errors: string[];
  syncedAt?: Date;
}

interface SyncStatusIndicatorProps {
  platforms: PlatformSync[];
  onPress?: (platform: string) => void;
}

const SyncStatusIndicator: React.FC<SyncStatusIndicatorProps> = ({ platforms, onPress }) => {
  const getStatusColor = (status: PlatformSync['status']) => {
    switch (status) {
      case 'success': return '#4CAF50';
      case 'pending': return '#FF9800';
      case 'error': return '#F44336';
      default: return '#9E9E9E';
    }
  };

  const renderPlatformItem = ({ item }: { item: PlatformSync }) => (
    <View style={[styles.item, { borderLeftColor: getStatusColor(item.status) }]}>
      <Text style={styles.platform}>{item.platform}</Text>
      <Text style={[styles.status, { color: getStatusColor(item.status) }]}>
        {item.status.toUpperCase()}
      </Text>
      {item.syncedAt && <Text style={styles.time}>Synced: {item.syncedAt.toLocaleString()}</Text>}
      {item.errors.length > 0 && (
        <View>
          {item.errors.map((error, idx) => (
            <Text key={idx} style={styles.error}>{error}</Text>
          ))}
        </View>
      )}
      {item.status === 'pending' && <ActivityIndicator style={styles.spinner} />}
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sync Status</Text>
      <FlatList
        data={platforms}
        renderItem={renderPlatformItem}
        keyExtractor={(item, index) => `${item.platform}-${index}`}
        style={styles.list}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
    padding: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  list: {
    maxHeight: 200,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    marginVertical: 2,
    backgroundColor: 'white',
    borderRadius: 5,
    borderLeftWidth: 4,
  },
  platform: {
    flex: 1,
    fontSize: 14,
  },
  status: {
    fontSize: 12,
    fontWeight: 'bold',
    marginRight: 10,
  },
  time: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  error: {
    fontSize: 12,
    color: 'red',
    marginTop: 2,
  },
  spinner: {
    marginLeft: 10,
  },
});

export default SyncStatusIndicator;
