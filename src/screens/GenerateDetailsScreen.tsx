import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';

type Props = StackScreenProps<AppStackParamList, 'GenerateDetailsScreen'>;

type GeneratedPlatformDetails = Record<string, any>;
type GeneratedResult = {
  productIndex: number;
  platforms: GeneratedPlatformDetails;
  sourceImageUrl?: string;
  processingTimeMs?: number;
  source?: string;
};

function GenerateDetailsScreen({ route }: Props) {
  const { jobId, status, results, summary, completedAt } = ((route.params || {}) as unknown) as {
    jobId: string;
    status: string;
    results: GeneratedResult[];
    summary?: { totalProducts: number; completed: number; failed: number; averageProcessingTimeMs: number };
    completedAt?: string;
  };

  const first: GeneratedResult | null = useMemo(() => Array.isArray(results) && results.length > 0 ? results[0] : null, [results]);
  const platforms: GeneratedPlatformDetails = (first && first.platforms) ? first.platforms : {};
  const platformKeys: string[] = Object.keys(platforms as Record<string, any>);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Generate Results</Text>
      <Text style={styles.meta}>Job: {jobId}</Text>
      <Text style={styles.meta}>Status: {status}</Text>
      {completedAt ? <Text style={styles.meta}>Completed: {completedAt}</Text> : null}

      {first ? (
        <View style={styles.card}>
          <Text style={styles.subheading}>Product {first.productIndex + 1}</Text>
          <Text style={styles.meta}>Image: {first.sourceImageUrl}</Text>
          <Text style={styles.meta}>Processing: {first.processingTimeMs} ms</Text>
          <Text style={styles.meta}>Source: {first.source}</Text>

          {platformKeys.map((p) => (
            <View key={p} style={styles.section}>
              <Text style={styles.platform}>{p.toUpperCase()}</Text>
              {platforms[p]?.title ? <Text style={styles.field}>Title: {String(platforms[p].title)}</Text> : null}
              {platforms[p]?.price !== undefined ? <Text style={styles.field}>Price: {String(platforms[p].price)}</Text> : null}
              {platforms[p]?.description ? (
                <Text style={styles.field} numberOfLines={4}>Desc: {String(platforms[p].description)}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.meta}>No results</Text>
      )}

      {summary ? (
        <View style={styles.card}>
          <Text style={styles.subheading}>Summary</Text>
          <Text style={styles.meta}>Total: {String(summary.totalProducts)}</Text>
          <Text style={styles.meta}>Completed: {String(summary.completed)}</Text>
          <Text style={styles.meta}>Failed: {String(summary.failed)}</Text>
          <Text style={styles.meta}>Avg ms: {String(summary.averageProcessingTimeMs)}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

export default GenerateDetailsScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, paddingBottom: 80 },
  heading: { color: '#000', fontSize: 24, fontWeight: '700', marginBottom: 6 },
  subheading: { color: '#000', fontSize: 18, fontWeight: '600', marginBottom: 4 },
  meta: { color: '#000', marginBottom: 4 },
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 12 },
  section: { marginTop: 8 },
  platform: { color: '#000', fontWeight: '700', marginBottom: 4 },
  field: { color: '#000', marginBottom: 2 },
});