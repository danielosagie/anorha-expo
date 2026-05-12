import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../lib/supabase';

type Props = StackScreenProps<AppStackParamList, 'GenerateJobOverviewScreen'>;

type OverviewBucket = 'ready' | 'needs_review' | 'failed' | 'not_generated';

type WorkflowOverviewItem = {
  index: number;
  title: string;
  status: OverviewBucket;
  reason?: string;
};

function hasReviewGap(result: any): boolean {
  const platforms = result?.platforms || {};
  const firstKey = Object.keys(platforms)[0];
  if (!firstKey) return true;
  const listing = platforms[firstKey] || {};
  const missingTitle = !String(listing.title || '').trim();
  const missingDescription = !String(listing.description || '').trim();
  const missingPrice = listing.price === undefined || listing.price === null || String(listing.price).trim() === '';
  return missingTitle || missingDescription || missingPrice;
}

const GenerateJobOverviewScreen: React.FC<Props> = ({ route, navigation }) => {
  const params = route.params || ({} as any);
  const jobId = params.jobId;
  const matchJobId = params.matchJobId;
  const seedItems = Array.isArray(params.items) ? params.items : [];
  const seedJobMap = params.jobMap || {};

  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<any[]>([]);
  const [jobMap, setJobMap] = useState<Record<number, { jobId: string; status?: string }>>(seedJobMap);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!jobId) return;
        const { data } = await supabase
          .from('generate_jobs')
          .select('results')
          .eq('job_id', jobId)
          .maybeSingle();
        if (cancelled) return;
        const loadedResults = Array.isArray(data?.results) ? data.results : [];
        setResults(loadedResults);
        if (!Object.keys(seedJobMap).length && loadedResults.length > 0) {
          const nextMap: Record<number, { jobId: string; status?: string }> = {};
          loadedResults.forEach((r: any, index: number) => {
            const idx = typeof r?.productIndex === 'number' ? r.productIndex : index;
            nextMap[idx] = { jobId, status: r?.error ? 'failed' : 'completed' };
          });
          setJobMap(nextMap);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, seedJobMap]);

  const normalizedItems = useMemo(() => {
    if (seedItems.length > 0) {
      return seedItems.map((item: any, idx: number) => ({
        index: typeof item?.index === 'number' ? item.index : idx,
        title: item?.title || `Item ${idx + 1}`,
      }));
    }
    if (results.length > 0) {
      return results.map((result: any, idx: number) => ({
        index: typeof result?.productIndex === 'number' ? result.productIndex : idx,
        title:
          result?.platforms?.shopify?.title ||
          result?.platforms?.amazon?.title ||
          result?.platforms?.ebay?.title ||
          `Item ${idx + 1}`,
      }));
    }
    return [];
  }, [results, seedItems]);

  const overviewItems = useMemo<WorkflowOverviewItem[]>(() => {
    return normalizedItems.map((item) => {
      const byIndex = results.find((r: any, idx: number) => {
        const productIndex = typeof r?.productIndex === 'number' ? r.productIndex : idx;
        return productIndex === item.index;
      });
      const statusFromMap = jobMap[item.index]?.status;
      if (statusFromMap === 'failed' || byIndex?.error) {
        return { ...item, status: 'failed', reason: byIndex?.error || 'Generation failed' };
      }
      if (!byIndex && statusFromMap !== 'completed') {
        return { ...item, status: 'not_generated' };
      }
      if (hasReviewGap(byIndex)) {
        return { ...item, status: 'needs_review', reason: 'Missing title, description, or price' };
      }
      return { ...item, status: 'ready' };
    });
  }, [jobMap, normalizedItems, results]);

  const buckets = useMemo(() => {
    const base = {
      ready: [] as WorkflowOverviewItem[],
      needs_review: [] as WorkflowOverviewItem[],
      failed: [] as WorkflowOverviewItem[],
      not_generated: [] as WorkflowOverviewItem[],
    };
    overviewItems.forEach(item => {
      base[item.status].push(item);
    });
    return base;
  }, [overviewItems]);

  const openGenerateDetails = (focusIndex?: number) => {
    navigation.navigate('GenerateDetailsScreen', {
      jobId,
      status: 'completed',
      results,
      summary: [],
      completedAt: '',
      matchJobId,
      items: normalizedItems,
      jobMap,
      focusIndex,
    } as any);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#93C822" />
        <Text style={styles.loadingText}>Loading workflow overview...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Generation Overview</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryCount}>{buckets.ready.length}</Text>
            <Text style={styles.summaryLabel}>Ready</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryCount}>{buckets.needs_review.length}</Text>
            <Text style={styles.summaryLabel}>Needs review</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryCount}>{buckets.failed.length}</Text>
            <Text style={styles.summaryLabel}>Failed</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryCount}>{buckets.not_generated.length}</Text>
            <Text style={styles.summaryLabel}>Not generated</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, buckets.ready.length === 0 && styles.actionButtonDisabled]}
            disabled={buckets.ready.length === 0}
            onPress={() => openGenerateDetails(buckets.ready[0]?.index)}
          >
            <Text style={styles.actionText}>Open all ready</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, buckets.not_generated.length === 0 && styles.actionButtonDisabled]}
            disabled={buckets.not_generated.length === 0}
            onPress={() => openGenerateDetails(buckets.not_generated[0]?.index)}
          >
            <Text style={styles.actionText}>Generate remaining</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, buckets.failed.length === 0 && styles.actionButtonDisabled]}
            disabled={buckets.failed.length === 0}
            onPress={() => openGenerateDetails(buckets.failed[0]?.index)}
          >
            <Text style={styles.actionText}>Retry failed</Text>
          </TouchableOpacity>
        </View>

        {overviewItems.map((item) => (
          <TouchableOpacity
            key={`overview-${item.index}`}
            style={styles.itemRow}
            onPress={() => openGenerateDetails(item.index)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
              {!!item.reason && <Text style={styles.itemReason}>{item.reason}</Text>}
            </View>
            <View
              style={[
                styles.badge,
                item.status === 'ready'
                  ? styles.badgeReady
                  : item.status === 'needs_review'
                    ? styles.badgeNeedsReview
                    : item.status === 'failed'
                      ? styles.badgeFailed
                      : styles.badgeNotGenerated
              ]}
            >
              <Text style={styles.badgeText}>
                {item.status === 'needs_review' ? 'Needs review' : item.status.replace('_', ' ')}
              </Text>
            </View>
            <Icon name="chevron-right" size={20} color="#64748B" />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748B',
  },
  header: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  content: {
    padding: 16,
    paddingBottom: 34,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  summaryCount: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  summaryLabel: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748B',
  },
  actions: {
    marginTop: 14,
    gap: 8,
  },
  actionButton: {
    backgroundColor: '#93C822',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  itemRow: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  itemReason: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
  },
  badge: {
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeReady: { backgroundColor: '#DCFCE7' },
  badgeNeedsReview: { backgroundColor: '#FEF3C7' },
  badgeFailed: { backgroundColor: '#FEE2E2' },
  badgeNotGenerated: { backgroundColor: '#E2E8F0' },
  badgeText: {
    fontSize: 11,
    color: '#1F2937',
    fontWeight: '700',
    textTransform: 'capitalize',
  },
});

export default GenerateJobOverviewScreen;
