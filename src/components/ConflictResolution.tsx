import React from 'react';
import { View, Text, Button, StyleSheet, ScrollView } from 'react-native';

interface Conflict {
  field: string;
  anorhaValue: any;
  platformValue: any;
  connectionId: string;
  platform: string;
}

interface ConflictResolutionProps {
  conflicts: Conflict[];
  onResolve: (field: string, connectionId: string, value: any, source: 'anorha' | 'platform') => void;
}

const ConflictResolution: React.FC<ConflictResolutionProps> = ({ conflicts, onResolve }) => {
  if (conflicts.length === 0) return null;

  const renderConflict = (conflict: Conflict) => (
    <View key={`${conflict.connectionId}-${conflict.field}`} style={styles.conflict}>
      <Text style={styles.field}>Field: {conflict.field}</Text>
      <View style={styles.values}>
        <View style={styles.valueContainer}>
          <Text style={styles.label}>Anorha:</Text>
          <Text style={styles.value}>{JSON.stringify(conflict.anorhaValue)}</Text>
        </View>
        <View style={styles.valueContainer}>
          <Text style={styles.label}>{conflict.platform}:</Text>
          <Text style={styles.value}>{JSON.stringify(conflict.platformValue)}</Text>
        </View>
      </View>
      <View style={styles.buttons}>
        <Button
          title="Use Anorha"
          onPress={() => onResolve(conflict.field, conflict.connectionId, conflict.anorhaValue, 'anorha')}
          color="#4CAF50"
        />
        <Button
          title="Use Platform"
          onPress={() => onResolve(conflict.field, conflict.connectionId, conflict.platformValue, 'platform')}
          color="#2196F3"
        />
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Resolve Conflicts</Text>
      <ScrollView style={styles.scroll}>
        {conflicts.map(renderConflict)}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    margin: 10,
    padding: 10,
    backgroundColor: '#fff3cd',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffeaa7',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  scroll: {
    maxHeight: 300,
  },
  conflict: {
    marginBottom: 20,
    padding: 10,
    backgroundColor: 'white',
    borderRadius: 5,
  },
  field: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  values: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  valueContainer: {
    flex: 1,
    marginHorizontal: 5,
  },
  label: {
    fontWeight: 'bold',
  },
  value: {
    marginTop: 5,
    padding: 5,
    backgroundColor: '#f8f9fa',
    borderRadius: 3,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
});

export default ConflictResolution;
