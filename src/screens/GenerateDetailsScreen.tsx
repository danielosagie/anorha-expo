import React, { useMemo, useState, useEffect } from 'react';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { CameraView } from 'expo-camera';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import ItemJobsModal from '../components/ItemJobsModal';
import PyramidGrid from '../components/PyramidGrid';
import { getPlatformRequirements } from '../utils/platformRequirements';
import { Boxes, X, Sparkles } from 'lucide-react-native';
import BottomActionBar from '../components/BottomActionBar';
import ListingEditorForm from '../components/ListingEditorForm';

type Props = StackScreenProps<AppStackParamList, 'GenerateDetailsScreen'>;

type GeneratedPlatformDetails = Record<string, any>;
type GeneratedResult = {
  productIndex: number;
  productId?: string;
  variantId?: string;
  platforms: GeneratedPlatformDetails;
  sourceImageUrl?: string;
  processingTimeMs?: number;
  source?: string;
};

function GenerateDetailsScreen({ route }: Props) {
  // Support both direct props and nested { response: {...} }
  const params: any = (route.params || {}) as any;
  const jobId = params.jobId ?? params.response?.jobId;
  const matchJobId = params.matchJobId ?? params.response?.matchJobId;
  const statusParam = params.status ?? params.response?.status;
  const resultsParam = params.results ?? params.response?.results;
  const summaryParam = params.summary ?? params.response?.summary;
  const completedAtParam = params.completedAt ?? params.response?.completedAt;

  const [fetched, setFetched] = useState(false);
  const [jobData, setJobData] = useState<{ status?: string; results?: GeneratedResult[]; summary?: any; completedAt?: string } | null>(null);

  // If we only get a jobId, fetch the job payload from Supabase once
  useEffect(() => {
    if (!jobId) return;
    if ((Array.isArray(resultsParam) && resultsParam.length > 0) || fetched) return;
    let canceled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('generate_jobs')
          .select('status, results, summary, completed_at')
          .eq('job_id', jobId)
          .maybeSingle();
        if (error) return;
        if (!canceled && data) {
          setJobData({
            status: data.status,
            results: Array.isArray(data.results) ? data.results : [],
            summary: data.summary,
            completedAt: data.completed_at,
          });
        }
      } catch {}
      finally {
        if (!canceled) setFetched(true);
      }
    })();
    return () => { canceled = true };
  }, [jobId, resultsParam, fetched]);

  const status = jobData?.status ?? statusParam;
  const results = jobData?.results ?? resultsParam;
  const summary = jobData?.summary ?? summaryParam;
  const completedAt = jobData?.completedAt ?? completedAtParam;

  // Debug (safe)
  console.log('[GEN-DETAILS] route.params keys:', Object.keys((route.params || {}) as any));
  console.log('[GEN-DETAILS] jobId:', jobId, 'status:', status);
  console.log('[GEN-DETAILS] results raw:', Array.isArray(results) ? `len=${results.length}` : typeof results);

  const first: GeneratedResult | null = useMemo(() => (Array.isArray(results) && results.length > 0 ? results[0] : null), [results]);
  const platforms: GeneratedPlatformDetails = useMemo(
    () => ((first && first.platforms) ? first.platforms : {}),
    [first]
  );
  const [displayedPlatforms, setDisplayedPlatforms] = useState<GeneratedPlatformDetails>(platforms);
  const platformKeys: string[] = useMemo(() => Object.keys(platforms as Record<string, any>), [platforms]);
  const [jobsModalVisible, setJobsModalVisible] = useState(false);
  const [userGenerateJobs, setUserGenerateJobs] = useState<Array<{ jobId: string; status: string; createdAt: string; completedAt?: string }>>([]);
  const [checklist, setChecklist] = useState<Record<string, { missing: string[]; ready: boolean }>>({});
  const [versionsSheetOpen, setVersionsSheetOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{ id: string; jobId: string; createdAt: string; platforms: any; sources?: Array<{ url: string; usedForFields?: string[] }> }>>([]);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [versionsTab, setVersionsTab] = useState<'versions'|'sources'>('versions');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isFilling, setIsFilling] = useState(false);
  const [recentlyFilledByPlatform, setRecentlyFilledByPlatform] = useState<Record<string, string[]>>({});
  const [fillSelectedFields, setFillSelectedFields] = useState<string[]>([
    'title','description','tags','price','sku','barcode','seoTitle','seoDescription','options'
  ]);
  const [lastFillCount, setLastFillCount] = useState<number>(0);
  const [refilledFieldsByPlatform, setRefilledFieldsByPlatform] = useState<Record<string, string[]>>({});
  const [fillOverlayOpen, setFillOverlayOpen] = useState<boolean>(false);
  
  // Try to pull items list from params if provided; fallback to single
  const items = useMemo(() => {
    const raw = ((route.params as any)?.items || []) as Array<{ index: number; title?: string; thumb?: string; matchesCount?: number }>;
    const normalized = (Array.isArray(raw) ? raw : []).map((it, i) => ({
      index: it.index ?? i,
      title: it.title ?? `Item ${i + 1}`,
      thumb: it.thumb ?? '',
      matchesCount: it.matchesCount ?? 0,
    }));
    if (normalized.length) return normalized;
    // Build from results if items not passed
    const fallback = Array.isArray(results) ? results.map((r, i) => ({ index: r.productIndex ?? i, title: `Item ${i + 1}`, thumb: r.sourceImageUrl || '', matchesCount: 0 })) : [];
    if (fallback.length) return fallback;
    return [{ index: first?.productIndex ?? 0, title: 'Item 1', thumb: first?.sourceImageUrl || '', matchesCount: 0 }];
  }, [route.params, first, results]);

  const jobMap = ((route.params as any)?.jobMap || {}) as Record<number, { jobId: string; status?: string }>;
  // Derive quick lookups for presence of jobs
  const hasGenerateForIndex = useMemo(() => (idx: number) => Boolean(jobMap[idx]?.jobId), [jobMap]);
  
  // Navigation state for modal integration (like MatchSelectionScreen)
  const [currentProductIndex, setCurrentProductIndex] = useState((first?.productIndex as number) ?? (items[0]?.index || 0));
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [bottomNavState, setBottomNavState] = useState<'empty' | 'selection' | 'template' | 'platform'>('empty');
  const [itemGenerateJobs, setItemGenerateJobs] = useState<Record<number, { jobId: string; status?: string }>>(jobMap || {});

  // Keep displayed platforms in sync with first result changes
  useEffect(() => {
    setDisplayedPlatforms(platforms);
    const requiredByPlatform = getPlatformRequirements();
    const next: Record<string, { missing: string[]; ready: boolean }> = {};
    for (const key of Object.keys(platforms)) {
      const data = platforms[key] || {};
      const req = requiredByPlatform[key] || [];
      const missing = req.filter(f => {
        if (f === 'images') {
          const imgs = data.images || data.imageUris || data.files || [];
          return !Array.isArray(imgs) || imgs.length < 1;
        }
        const v = data[f];
        return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
      });
      next[key] = { missing, ready: missing.length === 0 };
    }
    setChecklist(next);
  }, [platforms]);

  // Fetch versions when sheet opens
  useEffect(() => {
    if (!versionsSheetOpen) return;
    // Attempt to infer productId/variantId from current result if available in params
    const productId = (route.params as any)?.productId || first?.productId || null;
    const variantId = (route.params as any)?.variantId || first?.variantId || null;
    const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
    if (!baseUrl || !productId) return;
    (async () => {
      try {
        const token = await ensureSupabaseJwt();
        const res = await fetch(`${baseUrl}/api/products/generate/versions?productId=${encodeURIComponent(productId)}${variantId ? `&variantId=${encodeURIComponent(variantId)}` : ''}&limit=20&offset=0`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) throw new Error(`Versions fetch failed ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) setVersions(data);
      } catch (e) {
        // non-blocking
      }
    })();
  }, [versionsSheetOpen, first, route.params]);

  // Fetch user's generate jobs for modal display (counts and last generated timestamps)
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
        if (!baseUrl) return;
        const token = await ensureSupabaseJwt();
        const res = await fetch(`${baseUrl}/api/products/generate/jobs?limit=50`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!canceled && Array.isArray(data?.jobs)) {
          const jobs = data.jobs.map((j: any) => ({ jobId: j.jobId, status: j.status, createdAt: j.createdAt, completedAt: j.completedAt }));
          setUserGenerateJobs(jobs);
          
          // Update itemGenerateJobs with the latest job data for each product index
          const jobsByIndex: Record<number, { jobId: string; status?: string }> = {};
          
          // First, include any jobs passed in via jobMap
          Object.entries(jobMap || {}).forEach(([indexStr, jobInfo]) => {
            const idx = parseInt(indexStr, 10);
            if (!isNaN(idx)) {
              jobsByIndex[idx] = jobInfo;
            }
          });
          
          // Then add jobs from the API response
          jobs.forEach((job: any) => {
            // For generate jobs, we need to fetch results to map to indices
            // For now, if current jobId matches, map to current product index
            if (job.jobId === jobId) {
              const currentIdx = (first?.productIndex as number) ?? 0;
              jobsByIndex[currentIdx] = { jobId: job.jobId, status: job.status };
            }
          });
          
          console.log('[GenerateDetails] Updated jobsByIndex:', jobsByIndex);
          setItemGenerateJobs(jobsByIndex);
        }
      } catch {}
    })();
    return () => { canceled = true };
  }, []);

  // Helper: compute overall readiness
  const canPublish = useMemo(() => Object.values(checklist || {}).some(x => x.ready), [checklist]);

  // Field panel open handler
  const handleOpenFieldPanel = (fieldKey: string) => {
    setSelectedFieldKey(fieldKey);
    setVersionsTab('versions');
    setVersionsSheetOpen(true);
  };

  // Build publish/save payloads from displayed data
  const buildPlatformPayload = () => {
    // canonical: prefer "shopify" as base, else first platform
    const keys = Object.keys(displayedPlatforms || {});
    const canonicalKey = keys.includes('shopify') ? 'shopify' : keys[0];
    const canonical = (displayedPlatforms?.[canonicalKey] || {}) as any;
    return {
      platformDetails: {
        canonical: {
          title: canonical.title || '',
          sku: canonical.sku || `DRAFT-${(first?.productId||'').slice(0,8)}`,
          price: Number(canonical.price || 0),
          description: canonical.description || '',
          compareAtPrice: canonical.compareAtPrice || undefined,
          barcode: canonical.barcode || undefined,
          weight: canonical.weight || undefined,
          weightUnit: canonical.weightUnit || undefined,
          tags: Array.isArray(canonical.tags) ? canonical.tags : undefined,
          vendor: canonical.vendor || undefined,
          productType: canonical.productType || undefined,
          status: canonical.status || undefined,
          brand: canonical.brand || undefined,
          condition: canonical.condition || undefined,
          categorySuggestion: canonical.categorySuggestion || undefined,
        },
        ...displayedPlatforms,
      },
      media: (() => {
        // collect image urls from any platform or use sourceImageUrl
        const imgs = new Set<string>();
        for (const k of Object.keys(displayedPlatforms||{})) {
          const p = (displayedPlatforms as any)[k] || {};
          const arr = p.images || p.imageUris || [];
          if (Array.isArray(arr)) arr.forEach((u:string)=>{ if (typeof u === 'string' && u) imgs.add(u); });
        }
        if (imgs.size === 0 && first?.sourceImageUrl) imgs.add(first.sourceImageUrl);
        const imageUris = Array.from(imgs);
        return { imageUris, coverImageIndex: 0 };
      })(),
      selectedPlatformsToPublish: Object.keys(displayedPlatforms||{}),
    };
  };

  const fillTheRest = async () => {
    if (isFilling) return;
    try {
      setIsFilling(true);
      const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const productId = (route.params as any)?.productId || first?.productId;
      const variantId = (route.params as any)?.variantId || first?.variantId;
      if (!baseUrl || !productId || !variantId) return;

      const payload = buildPlatformPayload();
      const selectedPlatforms = Object.keys(displayedPlatforms || {});

      const res = await fetch(`${baseUrl}/api/products/generate-details`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          imageUris: payload.media.imageUris,
          coverImageIndex: payload.media.coverImageIndex,
          selectedPlatforms,
          selectedMatch: null,
          enhancedWebData: null,
        })
      });
      if (!res.ok) return;
      const data = await res.json();
      const gen = (data?.generatedDetails || data || {}) as any;
      const genPlatforms = (gen.platforms || {}) as Record<string, any>;

      const mergeFields = ['title','description','tags','price','weight','weightUnit','sku','barcode','images','options','seoTitle','seoDescription'];
      const next = { ...displayedPlatforms } as any;
      const changedMap: Record<string,string[]> = {};
      for (const k of Object.keys(genPlatforms)) {
        const incoming = genPlatforms[k] || {};
        const curr = next[k] || {};
        const merged: any = { ...curr };
        for (const f of mergeFields) {
          if (!fillSelectedFields.includes(f)) continue;
          const currVal = curr?.[f];
          const incomingVal = incoming?.[f];
          const isEmpty = (v: any) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
          if (isEmpty(currVal) && incomingVal !== undefined) {
            merged[f] = Array.isArray(incomingVal) ? [...incomingVal] : incomingVal;
            if (!changedMap[k]) changedMap[k] = [];
            changedMap[k].push(f);
          }
        }
        next[k] = merged;
      }
      setDisplayedPlatforms(next);
      setRecentlyFilledByPlatform(changedMap);
      // Track refilled fields per platform for pill badges
      setRefilledFieldsByPlatform(prev => {
        const merged: Record<string,string[]> = { ...prev };
        for (const k of Object.keys(changedMap)) {
          const prevArr = merged[k] || [];
          merged[k] = Array.from(new Set([ ...prevArr, ...changedMap[k] ]));
        }
        return merged;
      });
      // write into platform state so ListingEditorForm can render badge without screen prop threading
      setDisplayedPlatforms(prev => {
        const out: any = { ...prev };
        for (const k of Object.keys(changedMap)) {
          out[k] = { ...(out[k]||{}), __refilled: Array.from(new Set([ ...((out[k]?.__refilled)||[]), ...changedMap[k] ])) };
        }
        return out;
      });
    } catch {}
    finally {
      setIsFilling(false);
    }
  };

  const regenerateField = async (platformKey: string, fieldKey: string) => {
    try {
      const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const productId = (route.params as any)?.productId || first?.productId;
      const variantId = (route.params as any)?.variantId || first?.variantId;
      if (!baseUrl || !productId || !variantId) return;
      const payload = buildPlatformPayload();
      const res = await fetch(`${baseUrl}/api/products/generate-details`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          imageUris: payload.media.imageUris,
          coverImageIndex: payload.media.coverImageIndex,
          selectedPlatforms: [platformKey],
          fields: [fieldKey],
          selectedMatch: null,
          enhancedWebData: null,
        })
      });
      if (!res.ok) return;
      const data = await res.json();
      const gen = (data?.generatedDetails || data || {}) as any;
      const incomingPlatform = (gen.platforms || {})[platformKey] || {};
      if (incomingPlatform && Object.prototype.hasOwnProperty.call(incomingPlatform, fieldKey)) {
        setDisplayedPlatforms(prev => ({
          ...prev,
          [platformKey]: (() => {
            const curr = prev?.[platformKey] || {} as any;
            const __refilled = Array.from(new Set([...(curr.__refilled || []), fieldKey]));
            return {
              ...curr,
              [fieldKey]: Array.isArray(incomingPlatform[fieldKey]) ? [...incomingPlatform[fieldKey]] : incomingPlatform[fieldKey],
              __refilled,
            };
          })()
        }));
        setRefilledFieldsByPlatform(prev => ({
          ...prev,
          [platformKey]: Array.from(new Set([ ...(prev[platformKey]||[]), fieldKey ]))
        }));
      }
    } catch {}
  };

  const doSaveDraft = async () => {
    try {
      const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const productId = (route.params as any)?.productId || first?.productId;
      const variantId = (route.params as any)?.variantId || first?.variantId;
      if (!baseUrl || !productId || !variantId) return;
      const payload = buildPlatformPayload();
      const res = await fetch(`${baseUrl}/api/products/save-or-publish`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          publishIntent: 'SAVE_SSSYNC_DRAFT',
          platformDetails: payload.platformDetails,
          media: payload.media,
          selectedPlatformsToPublish: payload.selectedPlatformsToPublish,
        })
      });
      // non-blocking UX - you can add a toast here
    } catch {}
  };

  const doPublish = async () => {
    try {
      const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const productId = (route.params as any)?.productId || first?.productId;
      const variantId = (route.params as any)?.variantId || first?.variantId;
      if (!baseUrl || !productId || !variantId) return;
      const payload = buildPlatformPayload();
      const res = await fetch(`${baseUrl}/api/products/save-or-publish`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          publishIntent: 'PUBLISH_PLATFORM_DRAFT',
          platformDetails: payload.platformDetails,
          media: payload.media,
          selectedPlatformsToPublish: payload.selectedPlatformsToPublish,
        })
      });
    } catch {}
  };

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={{ position: 'absolute', top: -32, right: 16, zIndex: 4000, flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity onPress={() => setVersionsSheetOpen(true)} style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5' }}>
          <Text style={{ color: '#000', fontWeight: '600' }}>•••</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setFillOverlayOpen(true)} disabled={isFilling} style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: isFilling ? 'rgba(147,200,34,0.15)' : 'rgba(147,200,34,0.1)', borderRadius: 8, borderWidth: 1, borderColor: '#93C822', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Sparkles size={14} color={'#111'} />
          <Text style={{ color: '#000', fontWeight: '600' }}>{isFilling ? 'Filling…' : 'Fill remaining'}</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={() => setJobsModalVisible(true)} style={{ position: 'absolute', top: -32, left: 16, zIndex: 4000, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.9)', minHeight: 34, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5', flexDirection: 'row', alignItems: 'center' }}>
        <Boxes size={18} color={'#000'} />
        <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Current Jobs</Text>
      </TouchableOpacity>

      <ScrollView>
        {first ? (
          
          <>
          
            
            {/* Editor form that matches the product page design */}
            <ListingEditorForm
              platforms={displayedPlatforms}
              images={[first.sourceImageUrl || ''].filter(Boolean)}
              onChangePlatforms={setDisplayedPlatforms}
              onOpenFieldPanel={handleOpenFieldPanel}
              onRegenerateField={regenerateField}
              onOpenBarcodeScanner={(onResult)=>{
                setScannerOpen(true);
                // handler stored on closure
                (GenerateDetailsScreen as any)._scannerResultHandler = onResult;
              }}
              onOpenImageCapture={(done)=>{
                // Use AddProduct camera flow; pass a callback for captured images (photos only)
                (route as any).navigation?.navigate?.('AddProduct', { firstPhotos: [], bulkItems: [], captureOnly: true, onDone: (uris: string[]) => done(uris) } as any);
              }}
            />
          </>
        ) : (
          <Text style={styles.meta}>No results</Text>
        )}
      </ScrollView>
      


      <ItemJobsModal
        visible={jobsModalVisible}
        onClose={() => setJobsModalVisible(false)}
        items={items}
        currentIndex={currentProductIndex}
        scanColor={() => '#10B981'}
        matchColor={() => '#10B981'}
        detailsColor={(idx) => {
          const s = itemGenerateJobs[idx]?.status;
          if (s === 'completed') return '#93C822';
          if (s === 'failed') return '#e11d48';
          if (s) return '#FFD700';
          return '#4B5563';
        }}
        detailsEnabled={(idx) => !!itemGenerateJobs[idx]?.jobId}
        countLabel={'Generations'}
        getSecondaryText={(idx) => {
          const jid = itemGenerateJobs[idx]?.jobId;
          const rec = jid ? userGenerateJobs.find(j => j.jobId === jid) : null;
          if (!rec) return null;
          if (rec.status === 'completed') return 'Generated';
          if (rec.status === 'failed') return 'Generation failed';
          if (rec.status === 'processing' || rec.status === 'queued') return 'Generating…';
          const date = rec.completedAt || rec.createdAt;
          return date ? `Last: ${new Date(date).toLocaleString()}` : null;
        }}
         onQuickGenerate={async (idx) => {
           try {
             // TODO: Implement quick generate for this specific item
             // For now, navigate back to match selection to start the flow
             setCurrentProductIndex(idx);
             setJobsModalVisible(false);
             (route as any).navigation?.navigate?.('MatchSelectionScreen', { focusIndex: idx, items, jobMap: itemGenerateJobs } as any);
           } catch (e) {
             console.error('Quick generate failed:', e);
           }
         }}
         onPickScan={(idx) => {
          setCurrentProductIndex(idx);
          setSelectedIndices([]);
          setSelectedPlatforms([]);
          setSelectedTemplate(null);
          setJobsModalVisible(false);
          setBottomNavState('empty');
        }}
        onPickMatch={(idx) => {
          // Jump to match selection for this item, preserve match job id if we have it
          setCurrentProductIndex(idx);
          setJobsModalVisible(false);
          (route as any).navigation?.navigate?.('MatchSelectionScreen', { 
            jobId: matchJobId, 
            focusIndex: idx, 
            items, 
            jobMap: itemGenerateJobs 
          } as any);
        }}
         onPickDetails={(idx) => {
          const jid = itemGenerateJobs[idx]?.jobId;
          if (jid) {
            setCurrentProductIndex(idx);
            setJobsModalVisible(false);
            // Navigate via LoadingScreen to show proper loading state
            (route as any).navigation?.navigate?.('LoadingScreen', {
              processType: 'generate',
              payload: { jobId: jid, firstPhotos: [] },
              onCompleteRoute: { 
                screen: 'GenerateDetailsScreen', 
                params: { 
                  jobId: jid, 
                  items, 
                  jobMap: itemGenerateJobs,
                  focusIndex: idx 
                } 
              }
            } as any);
          }
        }}
      />
  
    </ScrollView>
    <View style={{backgroundColor: 'white'}}>
      <BottomActionBar
        primaryLabel={canPublish ? 'Publish listing' : 'Publish listing'}
        primaryDisabled={!canPublish}
        onPrimary={doPublish}
        secondaryLabel={'Save draft'}
        onSecondary={doSaveDraft}
      />
    </View>
    {!!lastFillCount && (
      <View style={{ position: 'absolute', bottom: 96, left: 16, right: 16, backgroundColor: 'rgba(17,17,17,0.92)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '600' }}>Filled {lastFillCount} field{lastFillCount === 1 ? '' : 's'}</Text>
      </View>
    )}
    {fillOverlayOpen && (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 6000 }} pointerEvents="box-none">
        <TouchableOpacity activeOpacity={1} onPress={() => setFillOverlayOpen(false)} style={{ height: 8 }} />
        <View style={{ backgroundColor: '#fff', borderBottomLeftRadius: 14, borderBottomRightRadius: 14, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#E5E5E5' }}>
          <Text style={{ color: '#000', fontWeight: '700', marginBottom: 8 }}>Choose fields to fill</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {['title','description','tags','price','sku','barcode','seoTitle','seoDescription','options'].map((f) => {
              const selected = fillSelectedFields.includes(f);
              return (
                <TouchableOpacity key={f} onPress={() => setFillSelectedFields(prev => selected ? prev.filter(x=>x!==f) : [...prev, f])} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: selected ? '#93C822' : '#E5E5E5', backgroundColor: selected ? 'rgba(147,200,34,0.08)' : '#fff', marginRight: 8, marginBottom: 8 }}>
                  <Text style={{ color: '#000' }}>{f}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
            <TouchableOpacity onPress={() => setFillOverlayOpen(false)} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 }}>
              <Text style={{ color: '#000' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setFillOverlayOpen(false); fillTheRest(); }} style={{ backgroundColor: '#93C822', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Sparkles size={16} color={'#111'} />
              <Text style={{ color: '#000', fontWeight: '700' }}>Fill selected</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    )}
    {scannerOpen && (
      <View style={styles.scannerDockFull} pointerEvents="box-none">
        <View style={styles.scannerFullBleed}>
          <CameraView
            style={{ width: '100%', height: 240 }}
            facing={'back'}
            onBarcodeScanned={(result:any) => {
              const code = result?.data || result?.rawValue;
              if (code && (GenerateDetailsScreen as any)._scannerResultHandler) {
                (GenerateDetailsScreen as any)._scannerResultHandler(code);
                setScannerOpen(false);
                (GenerateDetailsScreen as any)._scannerResultHandler = null;
              }
            }}
            barcodeScannerSettings={{ barcodeTypes: ['qr','ean13','upc_a','upc_e','code128'] }}
          />
          <TouchableOpacity onPress={() => { setScannerOpen(false); (GenerateDetailsScreen as any)._scannerResultHandler = null; }} style={styles.scannerCloseFull}>
            <Text style={{ color: '#fff', fontSize: 28 }}>×</Text>
          </TouchableOpacity>
        </View>
      </View>
    )}
    {versionsSheetOpen && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setVersionsSheetOpen(false)}
            style={styles.versionsBackdrop}
          />
          <View style={styles.versionsSheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={() => setVersionsTab('versions')} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: versionsTab==='versions'? '#93C822':'#E5E5E5', backgroundColor: versionsTab==='versions'?'rgba(147,200,34,0.08)':'#fff' }}>
                  <Text style={{ color: '#000', fontWeight: '600' }}>Versions</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setVersionsTab('sources')} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: versionsTab==='sources'? '#93C822':'#E5E5E5', backgroundColor: versionsTab==='sources'?'rgba(147,200,34,0.08)':'#fff' }}>
                  <Text style={{ color: '#000', fontWeight: '600' }}>Sources</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity onPress={() => setVersionsSheetOpen(false)} accessibilityLabel="Close versions panel" style={{ padding: 6 }}>
                  <X size={20} color={'#000'} />
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={{ marginTop: 12 }}>
              {versionsTab === 'versions' ? (
                versions.length === 0 ? (
                  <Text style={{ color: '#666' }}>No versions recorded yet.</Text>
                ) : versions.map(v => (
                  <TouchableOpacity key={v.id} onPress={() => {
                    setDisplayedPlatforms(v.platforms || {});
                    setVersionsSheetOpen(false);
                  }} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                    <Text style={{ color: '#000', fontWeight: '600' }}>{new Date(v.createdAt).toLocaleString()}</Text>
                    <Text style={{ color: '#000' }}>Platforms: {Object.keys(v.platforms || {}).join(', ')}</Text>
                    {Array.isArray(v.sources) && v.sources.length > 0 ? (
                      <Text style={{ color: '#000' }}>Sources: {v.sources.slice(0, 3).map(s=>s.url).join(', ')}{v.sources.length > 3 ? '…' : ''}</Text>
                    ) : null}
                  </TouchableOpacity>
                ))
              ) : (
                <View>
                  {!selectedFieldKey ? (
                    <Text style={{ color: '#666' }}>Tap the info icon next to a field to view sources for that field.</Text>
                  ) : (
                    <>
                      <Text style={{ color: '#000', fontWeight: '700', marginBottom: 6 }}>Sources for “{selectedFieldKey}”</Text>
                      {(() => {
                        const rows: Array<{ url: string }>= [];
                        for (const v of versions) {
                          const src = (v.sources || []).filter(s => !s.usedForFields || s.usedForFields.includes(selectedFieldKey));
                          src.forEach(s => rows.push({ url: s.url }));
                        }
                        const unique = Array.from(new Set(rows.map(r=>r.url)));
                        return unique.length === 0 ? (
                          <Text style={{ color: '#666' }}>No recorded field-level sources.</Text>
                        ) : unique.map(u => (
                          <View key={u} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                            <Text style={{ color: '#000' }}>{u}</Text>
                          </View>
                        ));
                      })()}
                    </>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );
}

export default GenerateDetailsScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: "20%" },
  content: { padding: 16, paddingBottom: 140 },
  heading: { color: '#000', fontSize: 24, fontWeight: '700', marginBottom: 6 },
  subheading: { color: '#000', fontSize: 18, fontWeight: '600', marginBottom: 4 },
  meta: { color: '#000', marginBottom: 4 },
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 12 },
  section: { marginTop: 8 },
  platform: { color: '#000', fontWeight: '700', marginBottom: 4 },
  field: { color: '#000', marginBottom: 2 },
  versionsBackdrop: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.2)' },
  versionsSheet: { position: 'absolute', top: 0, right: 0, bottom: 0, width: '70%', backgroundColor: '#fff', borderLeftColor: '#E5E5E5', borderLeftWidth: 1, paddingVertical: 70, paddingHorizontal: 20 },
  // Docked scanner close to the notch / bezel
  scannerDock: { position: 'absolute', top: 6, left: 56, right: 56, zIndex: 5000 },
  scannerCard: { backgroundColor: '#000', borderRadius: 18, borderWidth: 2, borderColor: '#111', overflow: 'hidden' },
  scannerClose: { position: 'absolute', top: 14, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  // Full-bleed variant that hugs the top bezel
  scannerDockFull: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5000 },
  scannerFullBleed: { backgroundColor: '#000', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, overflow: 'hidden' },
  scannerCloseFull: { position: 'absolute', top: 100, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});