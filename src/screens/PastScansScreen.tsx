import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { API_BASE_URL } from '../config/env';
import BackButton from '../components/BackButton';
import { AppStackParamList } from '../navigation/AppNavigator';
import { JobResponse } from './MatchSelectionScreen';

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

const PastScansScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation<PastScansScreenNavigationProp>();

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
        console.error('Error fetching match jobs:', error);
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
        console.warn('[PastScans] generate_jobs.match_job_id missing; falling back to schema-compatible select');
        const fallbackQuery = await supabase
          .from("generate_jobs")
          .select('job_id, created_at, status, summary, results')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (fallbackQuery.error) {
          console.error('Database error (fallback query):', fallbackQuery.error);
          throw new Error('Failed to fetch past scans');
        }
        data = fallbackQuery.data;
      } else if (primaryQuery.error) {
        console.error('Database error:', primaryQuery.error);
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
          console.error('Error fetching ProductVariants for generate_jobs:', variantError);
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
      console.error('Error in fetchPastGenerations:', err);
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
    // Always navigate to selection; the screen will poll status and hydrate when ready
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
      console.log(`Job status is '${job.status}', cannot view results yet.`);
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

  const renderMatchJobItem = ({ item }: { item: MatchJob }) => (
    <Card style={styles.scanCard}>
      <TouchableOpacity
        style={styles.scanItem}
        onPress={() => handleLoadMatchJob(item)}
      >
        <View style={styles.thumbRow}>
          {(() => {
            const results = (item as any)?.results || [];
            // Robust image finding logic
            const images = results
              .map((r: any) => {
                // Try multiple paths for the image
                return r?.serpApiData?.[0]?.image ||
                  r?.serpApiData?.[0]?.thumbnail ||
                  r?.images?.[0]?.url ||
                  r?.sourceImageUrl ||
                  r?.coverImage ||
                  '';
              })
              .filter((uri: string) => !!uri);

            const firstImage = images[0];
            const itemCount = results.length;

            if (!firstImage) {
              return (
                <View style={[styles.thumb, { justifyContent: 'center', alignItems: 'center' }]}>
                  <Icon name="image-off" size={24} color="#94a3b8" />
                </View>
              );
            }

            return (
              <View style={{ width: 80, height: 80, marginRight: 12 }}>
                <Image
                  source={{ uri: firstImage }}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 10,
                    backgroundColor: '#f1f5f9',
                  }}
                />
                {itemCount > 1 && (
                  <View style={{
                    position: 'absolute',
                    bottom: -4,
                    right: -4,
                    backgroundColor: '#1e293b',
                    borderRadius: 12,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderWidth: 2,
                    borderColor: '#fff',
                  }}>
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                      {itemCount} items
                    </Text>
                  </View>
                )}
              </View>
            );
          })()}
        </View>
        <View style={styles.scanInfo}>

          <Text style={styles.scanTitle}>Match Job</Text>
          <Text style={styles.scanDate}>
            {new Date(item.created_at).toLocaleString()}
          </Text>
          <View style={styles.scanStatus}>
            <Icon
              name={item.status === 'completed' ? 'check-circle' : 'cogs'}
              size={16}
              color={item.status === 'completed' ? theme.colors.success : theme.colors.primary}
            />
            <Text style={[
              styles.statusText,
              { color: item.status === 'completed' ? theme.colors.success : theme.colors.primary }
            ]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
        </View>
        <Icon name="chevron-right" size={24} color={item.status === 'completed' ? theme.colors.textSecondary : '#ccc'} />
      </TouchableOpacity>
    </Card>
  );

  const renderScanItem = ({ item }: { item: GenerationJob }) => (
    <Card style={styles.scanCard}>
      <TouchableOpacity
        style={styles.scanItem}
        onPress={() => handleLoadGeneration(item)}
      >
        <View style={styles.scanDetails}>
          {(() => {
            const results = item.results || [];
            // Robust image finding logic
            const images = results
              .map((r: any) => {
                return r?.sourceImageUrl ||
                  r?.images?.[0] || // If array of strings
                  r?.images?.[0]?.url || // If array of objects
                  r?.platforms?.shopify?.images?.[0] || // Try platform specific
                  '';
              })
              .filter((uri: string) => !!uri);

            const firstImage = images[0] || (item as any)?.summary?.firstThumb;
            const itemCount = results.length;

            if (!firstImage) {
              return (
                <View style={[styles.thumb, { justifyContent: 'center', alignItems: 'center' }]}>
                  <Icon name="image-off" size={24} color="#94a3b8" />
                </View>
              );
            }

            return (
              <View style={{ width: 80, height: 80, marginRight: 12 }}>
                <Image
                  source={{ uri: firstImage }}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 10,
                    backgroundColor: '#f1f5f9',
                  }}
                />
                {itemCount > 1 && (
                  <View style={{
                    position: 'absolute',
                    bottom: -4,
                    right: -4,
                    backgroundColor: '#1e293b',
                    borderRadius: 12,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderWidth: 2,
                    borderColor: '#fff',
                  }}>
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                      {itemCount} items
                    </Text>
                  </View>
                )}
              </View>
            );
          })()}
        </View>
        <View style={styles.scanInfo}>
          <Text style={styles.scanTitle}>{(item as any)?.summary?.firstTitle || 'Generated Listing'}</Text>
          <Text style={styles.scanDate}>
            {new Date(item.created_at).toLocaleDateString()}
          </Text>
          {item.workflowJobCount && item.workflowJobCount > 1 && (
            <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 }}>
              Grouped workflow ({item.workflowJobCount} runs)
            </Text>
          )}

          <View style={styles.scanStatus}>
            <Icon
              name={item.status === 'completed' ? 'check-circle' : 'cogs'}
              size={16}
              color={item.status === 'completed' ? theme.colors.success : theme.colors.primary}
            />
            <Text style={[
              styles.statusText,
              { color: item.status === 'completed' ? theme.colors.success : theme.colors.primary }
            ]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>

        </View>
        <Icon name="chevron-right" size={24} color={theme.colors.textSecondary} />
      </TouchableOpacity>
    </Card>
  );

  const renderDraftItem = ({ item }: { item: DraftScan }) => {
    const items = item.ScannedItems ?? item.scannedItems ?? [];
    const count = items.length;
    const thumb = item.ShelfPhotoUri ?? item.shelfPhotoUri ?? items[0]?.photos?.[0]?.uri ?? '';
    return (
      <Card style={styles.scanCard}>
        <TouchableOpacity
          style={styles.scanItem}
          onPress={() => handleLoadDraft(item)}
        >
          <View style={styles.thumbRow}>
            {thumb ? (
              <Image source={{ uri: thumb }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, { justifyContent: 'center', alignItems: 'center' }]}>
                <Icon name="file-document-outline" size={24} color="#94a3b8" />
              </View>
            )}
          </View>
          <View style={styles.scanInfo}>
            <Text style={styles.scanTitle}>Draft Scan</Text>
            <Text style={styles.scanDate}>
              {new Date(item.UpdatedAt ?? item.CreatedAt ?? 0).toLocaleString()}
            </Text>
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginTop: 4 }}>
              {count} item{count !== 1 ? 's' : ''}
            </Text>
          </View>
          <Icon name="chevron-right" size={24} color={theme.colors.textSecondary} />
        </TouchableOpacity>
      </Card>
    );
  };

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
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
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="history" size={48} color={theme.colors.textSecondary} />
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
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="history" size={48} color={theme.colors.textSecondary} />
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
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="history" size={48} color={theme.colors.textSecondary} />
            <Text style={styles.emptyText}>No draft scans</Text>
          </View>
        }
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <BackButton style={styles.backButton} onPress={() => navigation.goBack()}/>
        
        <Text style={styles.headerTitle}>History</Text>
        <View>
          <TouchableOpacity style={{width: 80, marginRight: 16, borderColor: "#FFF"}}/>
        </View>
      </View>

      <View style={styles.tabContainer}>
         <TouchableOpacity
          style={[styles.tab, styles.tabThird, activeTab === 'drafts' && styles.activeTab]}
          onPress={() => setActiveTab('drafts')}
        >
          <Text style={[styles.tabText, activeTab === 'drafts' && styles.activeTabText]}>Scan Drafts</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, styles.tabThird, activeTab === 'matches' && styles.activeTab]}
          onPress={() => setActiveTab('matches')}
        >
          <Text style={[styles.tabText, activeTab === 'matches' && styles.activeTabText]}>Matches</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, styles.tabThird, activeTab === 'listings' && styles.activeTab]}
          onPress={() => setActiveTab('listings')}
        >
          <Text style={[styles.tabText, activeTab === 'listings' && styles.activeTabText]}>Listings</Text>
        </TouchableOpacity>
      </View>

      {renderContent()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: "space-around",
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 60, // Adjust for status bar
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  tabContainer: {
    paddingLeft: 5,
    paddingRight: 5,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#f8f8f8',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    width: '40%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabThird: {
    width: '31%',
  },
  activeTab: {
    backgroundColor: '#93C822', // theme.colors.primary
  },
  tabText: {
    fontWeight: '600',
    color: '#333',
  },
  activeTabText: {
    color: '#fff',
  },
  listContent: {
    padding: 16,
  },
  scanCard: {
    marginBottom: 12,
  },
  scanItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  scanInfo: {
    flex: 1,
  },
  scanTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  scanDate: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  scanDetails: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  scanDetail: {
    fontSize: 12,
    color: '#666',
    marginRight: 16,
  },
  scanStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    marginLeft: 4,
    textTransform: 'capitalize',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  errorText: {
    color: '#ff3b30',
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
    marginTop: 16,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  thumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  thumb: {
    width: 80,
    height: 80,
    borderRadius: 10,
    marginRight: 12,
    backgroundColor: '#f1f5f9',
  },
});

export default PastScansScreen;
