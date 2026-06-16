import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft } from 'lucide-react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Button from '../components/Button';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { AppStackParamList } from '../navigation/AppNavigator';
import { JobResponse } from './MatchSelectionScreen';
import { CHAT_COLORS, CHAT_FONT, GLASS, GLASS_HEADER_STYLES } from '../design/chatGlass';
import { createLogger } from '../utils/logger';
const log = createLogger('PastScansScreen');


// --- Interfaces for Data Types ---

// For the "Generated Listings" tab (existing data structure)
interface PastScan {
  id: string;
  variantId: string;
  created_at: string;
  title: string;
  description: string;
  price: number;
  sku: string;
  barcode: string;
  images: string[];
  platform_details: any;
  status: 'draft' | 'active' | 'archived';
}

// For the "Match Jobs" tab
interface MatchJob {
  id: string; // This is the job_id from the table
  created_at: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  summary: {
    highConfidenceCount?: number;
    mediumConfidenceCount?: number;
    lowConfidenceCount?: number;
    totalProducts?: number;
  };
  results?: any[];
}

interface GenerationJob {
  id: string; // This is the job_id from the table
  created_at: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  matchJobId?: string | null;
  workflowGroupId?: string;
  workflowJobCount?: number;
  summary: {
    highConfidenceCount?: number;
    mediumConfidenceCount?: number;
    lowConfidenceCount?: number;
    totalProducts?: number;
    firstTitle?: string;
    firstThumb?: string;
  };
  results?: any[];
}

interface DraftScan {
  id: string;
  ScannedItems?: any[];
  scannedItems?: any[];
  MatchContext?: Record<string, any>;
  ShelfPhotoUri?: string | null;
  shelfPhotoUri?: string | null;
  ActiveItemId?: string | null;
  CreatedAt: string;
  UpdatedAt: string;
}

type PastScansScreenNavigationProp = StackNavigationProp<AppStackParamList, 'PastScans'>;

// Job status → chat-palette dot + label
const statusMeta = (status: string): { label: string; color: string } => {
  if (status === 'completed') return { label: 'Completed', color: CHAT_COLORS.success };
  if (status === 'failed' || status === 'cancelled') {
    return { label: status === 'failed' ? 'Failed' : 'Cancelled', color: CHAT_COLORS.error };
  }
  return { label: status === 'queued' ? 'Queued' : 'Processing', color: CHAT_COLORS.warning };
};

const PastScansScreen = () => {
  const navigation = useNavigation<PastScansScreenNavigationProp>();
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(140);

  const [activeTab, setActiveTab] = useState<'drafts' | 'matches' | 'listings'>('listings');
  const [matchJobs, setMatchJobs] = useState<MatchJob[]>([]);
  const [generationJobs, setGenerationJobs] = useState<GenerationJob[]>([]);
  const [draftScans, setDraftScans] = useState<DraftScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMatchJobs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No authenticated user');

      const { data, error } = await supabase
        .from('match_jobs')
        .select('job_id, created_at, status, summary, results')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        log.error('Error fetching match jobs:', error);
        throw new Error('Failed to fetch match jobs.');
      }

      // The table has `job_id`, but our keyExtractor needs `id`. Let's map it.
      const formattedJobs = data.map(job => ({ ...job, id: job.job_id })) as MatchJob[];
      setMatchJobs(formattedJobs);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPastGenerations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No authenticated user');

      let data: any[] | null = null;
      const primaryQuery = await supabase
        .from("generate_jobs")
        .select('job_id, match_job_id, created_at, status, summary, results')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (primaryQuery.error?.code === '42703') {
        log.warn('[PastScans] generate_jobs.match_job_id missing; falling back to schema-compatible select');
        const fallbackQuery = await supabase
          .from("generate_jobs")
          .select('job_id, created_at, status, summary, results')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (fallbackQuery.error) {
          log.error('Database error (fallback query):', fallbackQuery.error);
          throw new Error('Failed to fetch past scans');
        }
        data = fallbackQuery.data;
      } else if (primaryQuery.error) {
        log.error('Database error:', primaryQuery.error);
        throw new Error('Failed to fetch past scans');
      } else {
        data = primaryQuery.data;
      }

      if (!data) {
        setGenerationJobs([]);
        return;
      }

      const rawJobs = data as any[];

      // Collect all unique variantIds from results across jobs
      const variantIdSet = new Set<string>();
      rawJobs.forEach(job => {
        const results = Array.isArray(job.results) ? job.results : [];
        results.forEach((r: any) => {
          if (r && typeof r.variantId === 'string' && r.variantId) {
            variantIdSet.add(r.variantId);
          }
        });
      });

      // Fetch PrimaryImageUrl (cover image) for all variants we found
      let variantCoverMap: Record<string, string> = {};
      const variantIds = Array.from(variantIdSet);

      if (variantIds.length > 0) {
        const { data: variants, error: variantError } = await supabase
          .from('ProductVariants')
          .select('Id, PrimaryImageUrl')
          .in('Id', variantIds);

        if (variantError) {
          log.error('Error fetching ProductVariants for generate_jobs:', variantError);
        } else if (Array.isArray(variants)) {
          variantCoverMap = variants.reduce((acc: Record<string, string>, v: any) => {
            const id = v?.Id;
            const cover = v?.PrimaryImageUrl;
            if (typeof id === 'string' && typeof cover === 'string' && cover) {
              acc[id] = cover;
            }
            return acc;
          }, {});
        }
      }

      // The table has `job_id`, but our keyExtractor needs `id`. Let's map it.
      const formattedJobs = rawJobs.map(job => {
        const results = Array.isArray(job.results) ? job.results : [];
        const first = results[0] || null;
        const firstVariantId = first?.variantId;
        const coverFromVariant = firstVariantId ? variantCoverMap[firstVariantId] : undefined;

        const platforms = (first && first.platforms) ? first.platforms : {};
        const title =
          job.summary?.firstTitle ||
          first?.title ||
          first?.generatedTitle ||
          first?.listingTitle ||
          first?.productTitle ||
          platforms?.shopify?.title ||
          platforms?.amazon?.title ||
          platforms?.ebay?.title ||
          'Generated Listing';

        const thumb =
          coverFromVariant ||
          job.summary?.firstThumb ||
          first?.sourceImageUrl ||
          '';

        const summary = { ...(job.summary || {}), firstTitle: title, firstThumb: thumb };
        const matchJobId = job.match_job_id || first?.matchJobId || first?.match_job_id || null;
        return { ...job, id: job.job_id, summary, results, matchJobId } as GenerationJob;
      });

      const groupedByWorkflow = formattedJobs.reduce((acc, job) => {
        const workflowKey = job.matchJobId || `solo-${job.id}`;
        const existing = acc.get(workflowKey);
        if (!existing) {
          acc.set(workflowKey, { ...job, workflowGroupId: workflowKey, workflowJobCount: 1 });
        } else {
          const nextCount = (existing.workflowJobCount || 1) + 1;
          const latest = new Date(job.created_at).getTime() > new Date(existing.created_at).getTime() ? job : existing;
          acc.set(workflowKey, {
            ...latest,
            workflowGroupId: workflowKey,
            workflowJobCount: nextCount,
          });
        }
        return acc;
      }, new Map<string, GenerationJob>());

      setGenerationJobs(Array.from(groupedByWorkflow.values()));
    } catch (err: any) {
      log.error('Error in fetchPastGenerations:', err);
      setError(err.message || 'Failed to fetch past scans');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDraftScans = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error('Not authenticated');
      const API_BASE = API_BASE_URL;
      const res = await fetch(`${API_BASE}/api/products/quick-scan-sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const responseText = await res.text();
      let data: any = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        data = null;
      }

      if (!res.ok) {
        const message = data?.message || data?.error || `Failed to fetch draft scans (${res.status})`;
        throw new Error(message);
      }

      const raw = Array.isArray(data)
        ? data
        : Array.isArray(data?.sessions)
          ? data.sessions
          : Array.isArray(data?.data)
            ? data.data
            : [];
      setDraftScans(raw.map((d: any) => ({ ...d, id: d.Id ?? d.id })));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'matches') {
      fetchMatchJobs();
    } else if (activeTab === 'listings') {
      fetchPastGenerations();
    } else if (activeTab === 'drafts') {
      fetchDraftScans();
    }
  }, [activeTab, fetchMatchJobs, fetchPastGenerations, fetchDraftScans]);

  const handleLoadMatchJob = (job: MatchJob) => {
    // Legacy surface: only unfinished/historical match jobs still open the selection screen.
    navigation.navigate('MatchSelectionScreen', {
      response: { jobId: job.id }
    });
  };

  const handleLoadGeneration = (job: GenerationJob) => {
    if (job.status === 'completed') {
      navigation.navigate('GenerateDetailsScreen', {
        jobId: job.id,
        status: 'completed',
        results: Array.isArray(job.results) ? job.results : [],
        summary: [],
        completedAt: job.created_at || '',
        matchJobId: job.matchJobId || undefined,
        focusIndex: 0,
      } as any);
    } else {
      log.debug(`Job status is '${job.status}', cannot view results yet.`);
    }
  };

  const handleLoadDraft = (draft: DraftScan) => {
    try {
      navigation.navigate('TabNavigator' as any, {
        screen: 'AddProduct',
        params: { sessionId: draft.id },
      } as any);
    } catch {
      navigation.navigate('AddProduct', { sessionId: draft.id });
    }
  };

  // Shared row chrome: thumb + count badge
  const renderThumb = (uri: string | undefined, itemCount: number, fallbackIcon: string) => (
    <View style={styles.thumbWrap}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Icon name={fallbackIcon} size={22} color={CHAT_COLORS.faint} />
        </View>
      )}
      {itemCount > 1 ? (
        <View style={styles.thumbBadge}>
          <Text style={styles.thumbBadgeText}>{itemCount}</Text>
        </View>
      ) : null}
    </View>
  );

  const renderMatchJobItem = ({ item }: { item: MatchJob }) => {
    const results = (item as any)?.results || [];
    const images = results
      .map((r: any) => (
        r?.serpApiData?.[0]?.image ||
        r?.serpApiData?.[0]?.thumbnail ||
        r?.images?.[0]?.url ||
        r?.sourceImageUrl ||
        r?.coverImage ||
        ''
      ))
      .filter((uri: string) => !!uri);
    const meta = statusMeta(item.status);
    return (
      <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => handleLoadMatchJob(item)}>
        {renderThumb(images[0], results.length, 'image-off')}
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle} numberOfLines={1}>Match job</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>{new Date(item.created_at).toLocaleString()}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
            <Text style={[styles.statusText, { color: meta.color === CHAT_COLORS.success ? CHAT_COLORS.brandDeep : meta.color }]}>
              {meta.label}
            </Text>
          </View>
        </View>
        <Icon name="chevron-right" size={22} color={CHAT_COLORS.faint} />
      </TouchableOpacity>
    );
  };

  const renderScanItem = ({ item }: { item: GenerationJob }) => {
    const results = item.results || [];
    const images = results
      .map((r: any) => (
        r?.sourceImageUrl ||
        r?.images?.[0] || // If array of strings
        r?.images?.[0]?.url || // If array of objects
        r?.platforms?.shopify?.images?.[0] || // Try platform specific
        ''
      ))
      .filter((uri: string) => !!uri);
    const firstImage = images[0] || (item as any)?.summary?.firstThumb;
    const meta = statusMeta(item.status);
    return (
      <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => handleLoadGeneration(item)}>
        {renderThumb(firstImage, results.length, 'image-off')}
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle} numberOfLines={1}>{(item as any)?.summary?.firstTitle || 'Generated Listing'}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {new Date(item.created_at).toLocaleDateString()}
            {item.workflowJobCount && item.workflowJobCount > 1 ? ` · ${item.workflowJobCount} runs` : ''}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
            <Text style={[styles.statusText, { color: meta.color === CHAT_COLORS.success ? CHAT_COLORS.brandDeep : meta.color }]}>
              {item.status === 'completed' ? 'Ready to review' : meta.label}
            </Text>
          </View>
        </View>
        <Icon name="chevron-right" size={22} color={CHAT_COLORS.faint} />
      </TouchableOpacity>
    );
  };

  const renderDraftItem = ({ item }: { item: DraftScan }) => {
    const items = item.ScannedItems ?? item.scannedItems ?? [];
    const count = items.length;
    const thumb = item.ShelfPhotoUri ?? item.shelfPhotoUri ?? items[0]?.photos?.[0]?.uri ?? '';
    return (
      <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => handleLoadDraft(item)}>
        {renderThumb(thumb, count, 'file-document-outline')}
        <View style={styles.rowInfo}>
          <Text style={styles.rowTitle} numberOfLines={1}>Draft scan</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>{new Date(item.UpdatedAt ?? item.CreatedAt ?? 0).toLocaleString()}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{count} item{count !== 1 ? 's' : ''} · Tap to resume</Text>
        </View>
        <Icon name="chevron-right" size={22} color={CHAT_COLORS.faint} />
      </TouchableOpacity>
    );
  };

  const listTopPadding = { paddingTop: headerH + 8 };

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={CHAT_COLORS.brand} />
        </View>
      );
    }

    if (error) {
      const retryFn = activeTab === 'matches' ? fetchMatchJobs : activeTab === 'listings' ? fetchPastGenerations : fetchDraftScans;
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <Button title="Try Again" onPress={retryFn} style={styles.retryButton} />
        </View>
      );
    }

    if (activeTab === 'matches') {
      return (
        <FlatList
          data={matchJobs}
          renderItem={renderMatchJobItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, listTopPadding]}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="history" size={44} color={CHAT_COLORS.faint} />
              <Text style={styles.emptyText}>No match jobs found</Text>
            </View>
          }
        />
      );
    }

    if (activeTab === 'listings') {
      return (
        <FlatList
          data={generationJobs}
          renderItem={renderScanItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, listTopPadding]}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="history" size={44} color={CHAT_COLORS.faint} />
              <Text style={styles.emptyText}>No generated listings found</Text>
            </View>
          }
        />
      );
    }

    return (
      <FlatList
        data={draftScans}
        renderItem={renderDraftItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, listTopPadding]}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="history" size={44} color={CHAT_COLORS.faint} />
            <Text style={styles.emptyText}>No draft scans</Text>
          </View>
        }
      />
    );
  };

  const TABS: Array<{ key: 'drafts' | 'matches' | 'listings'; label: string }> = [
    { key: 'drafts', label: 'Scan carts' },
    //{ key: 'matches', label: 'Matches' },
    { key: 'listings', label: 'Listings' },
  ];

  return (
    <View style={styles.container}>
      {renderContent()}

      {/* ── Floating glass header (chat-style): back · title pill · tab chips ── */}
      <View
        style={[styles.glassHeader, { paddingTop: insets.top + 6 }]}
        onLayout={e => setHeaderH(e.nativeEvent.layout.height)}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView intensity={GLASS.blurIntensity} tint="light" style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={['#FFFFFF', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={styles.glassHeaderRow}>
          <TouchableOpacity style={styles.navCircle} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <ChevronLeft size={22} color={CHAT_COLORS.ink} />
          </TouchableOpacity>
          <View style={styles.titlePill}>
            <Text style={styles.pillTitle}>History</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.tabChips}>
          {TABS.map(t => {
            const active = activeTab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.tabChip, active && styles.tabChipActive]}
                onPress={() => setActiveTab(t.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabChipText, active && styles.tabChipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CHAT_COLORS.white,
  },

  // Chat-style floating glass header
  glassHeader: { ...GLASS_HEADER_STYLES.header },
  glassHeaderRow: { ...GLASS_HEADER_STYLES.headerRow },
  navCircle: { ...GLASS_HEADER_STYLES.navCircle },
  titlePill: { ...GLASS_HEADER_STYLES.titlePill },
  pillTitle: { ...GLASS_HEADER_STYLES.pillTitle },

  // Segmented chips (chat quick-chip styling)
  tabChips: { flexDirection: 'row', gap: 4, marginTop: 10, justifyContent: 'center' },
  tabChip: {
    flex: 1,
    minWidth: 150,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: CHAT_COLORS.surface,
    marginHorizontal: 12,
  },
  tabChipActive: { backgroundColor: CHAT_COLORS.ink },
  tabChipText: { textAlign: "center", fontSize: 14, color: '#52525B', fontFamily: CHAT_FONT.medium },
  tabChipTextActive: { color: CHAT_COLORS.white, fontFamily: CHAT_FONT.semibold },

  // List rows (chat card language: white, rounded 18, glass shadow)
  listContent: { padding: 16, paddingBottom: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CHAT_COLORS.white,
    borderRadius: 18,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  rowInfo: { flex: 1, marginRight: 8 },
  rowTitle: { fontSize: 15, color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold },
  rowMeta: { fontSize: 12, color: CHAT_COLORS.faint, fontFamily: CHAT_FONT.medium, marginTop: 2 },
  rowSub: { fontSize: 12, color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.medium, marginTop: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: CHAT_FONT.medium },

  thumbWrap: { width: 64, height: 64, marginRight: 12 },
  thumb: { width: 64, height: 64, borderRadius: 14, backgroundColor: CHAT_COLORS.bubble },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  thumbBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: CHAT_COLORS.ink,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 2,
    borderColor: CHAT_COLORS.white,
  },
  thumbBadgeText: { color: CHAT_COLORS.white, fontSize: 11, fontFamily: CHAT_FONT.bold },

  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  errorText: {
    color: CHAT_COLORS.error,
    fontFamily: CHAT_FONT.medium,
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    minWidth: 120,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    marginTop: 50,
  },
  emptyText: {
    marginTop: 14,
    fontSize: 15,
    color: CHAT_COLORS.dim,
    fontFamily: CHAT_FONT.medium,
    textAlign: 'center',
  },
});

export default PastScansScreen;
