import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureSupabaseJwt, getSupabaseJwtState, isSupabaseBridgeWarmingUp } from '../../lib/supabase';
import { SessionContext } from '../context/SessionContext';
import { API_BASE_URL } from '../config/env';
import { createLogger } from '../utils/logger';
const log = createLogger('useOrgNudges');


export type InsightUrgency = 'now' | 'today' | 'this-week';

export interface DashboardInsightMetric {
  label: string;
  value: string;
  status?: 'good' | 'warning' | 'critical' | 'info';
}

export interface DashboardInsightChart {
  type: 'line' | 'bar' | 'forecast';
  dataPoints: Array<{ x: string | number; y: number; type?: 'actual' | 'forecast'; annotation?: string }>;
  config?: Record<string, any>;
}

export interface DashboardInsight {
  id?: string;
  topDIN: {
    category: string;
    headline: string;
  };
  bottomDIN: {
    title: string;
    description: string;
    metrics?: DashboardInsightMetric[];
    chartData?: DashboardInsightChart;
    footer?: string;
    action?: {
      label: string;
      link: string;
      count?: number;
    };
    // Product-level evidence for actionable insights
    affectedProducts?: Array<{
      id: string;
      name: string;
      sku?: string;
      quantity: number;
      price: number;
      daysSinceSale?: number;
      estimatedValue?: number;
      suggestedPrice?: number;
      discountPercent?: number;
    }>;
  };
  severity: 'good' | 'neutral' | 'warning' | 'critical';
  urgency?: InsightUrgency;
  timestamp?: string;
  reasoning?: string;
  sources?: Array<{
    type: 'database' | 'web';
    title?: string;
    url?: string;
    snippet?: string;
    query?: string; // SQL query for database sources
  }>;
  suggestionOnly?: boolean;
  suggestionText?: string;
  timeframe?: 'short_term' | 'medium_term' | 'long_term';
  insights?: DashboardInsight[]; // If present, this is a multi-insight container (carousel)
  // Confidence and transparency fields
  confidence?: 'high' | 'medium' | 'low';
  confidenceReasons?: string[];
  caveats?: string[];
  // Ready-to-send task for the chat agent — tap fires it into a Sprout thread.
  handoff?: {
    prompt: string;
    campaignId?: string;
    label?: string;
  };
  suggestedQuestions?: string[];
  // Full report document backing this insight (same shape the chat's report
  // bottom sheet renders) plus its id in the org-wide reports list. When
  // present, the home card opens the report sheet directly — no chat handoff.
  report?: import('../features/liquidationConversation/types').ReportDocument;
  reportId?: string;
  dataQuality?: {
    queriesRun?: number;
    searchesRun?: number;
    queries?: Array<{
      description: string;
      rowsReturned: number;
      timestamp?: string;
    }>;
  };
}


export interface NudgesResponse {
  insight: DashboardInsight;
  timestamp: string;
  cacheExpiresAt: string | null;
  id?: string;
  recommendationId?: string;
  generatedAt?: string;
  nextRefreshAt?: string;
}

interface UseOrgNudgesReturn {
  insight: DashboardInsight | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  cacheExpiresAt: string | null; // ISO timestamp for refresh timer
  generatedAt: string | null;
  nextRefreshAt: string | null;
  refetch: () => Promise<void>;
  forceRefresh: () => Promise<void>;
}

interface PersistedInsightSnapshot {
  version: 1;
  insight: DashboardInsight;
  recommendationId: string | null;
  contentHash: string;
  generatedAt: string | null;
  nextRefreshAt: string | null;
}

const INSIGHT_STORAGE_PREFIX = 'sssync:last-good-org-insight:v1';
const ALLOWED_SEVERITIES = new Set<DashboardInsight['severity']>(['good', 'neutral', 'warning', 'critical']);
const ALLOWED_URGENCIES = new Set<InsightUrgency>(['now', 'today', 'this-week']);

const coerceText = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
};

const normalizeIsoDate = (value: unknown): string | null => {
  const text = coerceText(value);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
};

const storageKeyFor = (userId: string, orgId: string): string =>
  `${INSIGHT_STORAGE_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(orgId)}`;

const hashText = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const contentHashFor = (insight: DashboardInsight): string =>
  hashText(
    JSON.stringify(insight, (key, value) =>
      key === 'timestamp' || key === 'documentId' ? undefined : value,
    ),
  );

const normalizeMetric = (metric: any): DashboardInsightMetric | null => {
  const label = coerceText(metric?.label);
  const value = coerceText(metric?.value);

  if (!label || !value) return null;

  return {
    label,
    value,
    status: ['good', 'warning', 'critical', 'info'].includes(metric?.status) ? metric.status : undefined,
  };
};

const isInsightMetric = (metric: DashboardInsightMetric | null): metric is DashboardInsightMetric => metric !== null;

const normalizeAction = (action: any) => {
  const label = coerceText(action?.label);
  const link = coerceText(action?.link);

  if (!label || !link) return undefined;

  return {
    label,
    link,
    count: Number.isFinite(Number(action?.count)) ? Number(action.count) : undefined,
  };
};

const normalizeSuggestedQuestions = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const questions = value
    .filter((question): question is string => typeof question === 'string')
    .map((question) => question.trim())
    .filter(Boolean)
    .map((question) => {
      const words = question
        .replace(/[?.!]+$/g, '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 7);
      return words.length ? `${words.join(' ')}?` : '';
    })
    .filter(Boolean)
    .slice(0, 3);
  return questions.length ? questions : undefined;
};

const normalizeAffectedProduct = (product: any) => {
  const id = coerceText(product?.id);
  const name = coerceText(product?.name || product?.title);

  if (!id || !name) return null;

  return {
    id,
    name,
    sku: coerceText(product?.sku) || undefined,
    quantity: Number.isFinite(Number(product?.quantity)) ? Number(product.quantity) : 0,
    price: Number.isFinite(Number(product?.price)) ? Number(product.price) : 0,
    daysSinceSale: Number.isFinite(Number(product?.daysSinceSale)) ? Number(product.daysSinceSale) : undefined,
    estimatedValue: Number.isFinite(Number(product?.estimatedValue)) ? Number(product.estimatedValue) : undefined,
    suggestedPrice: Number.isFinite(Number(product?.suggestedPrice)) ? Number(product.suggestedPrice) : undefined,
    discountPercent: Number.isFinite(Number(product?.discountPercent)) ? Number(product.discountPercent) : undefined,
  };
};

const isAffectedProduct = (
  product: ReturnType<typeof normalizeAffectedProduct>,
): product is NonNullable<ReturnType<typeof normalizeAffectedProduct>> => product !== null;

const normalizeSingleInsight = (raw: any): DashboardInsight | null => {
  if (!raw || typeof raw !== 'object') return null;

  const headline = coerceText(raw?.topDIN?.headline || raw?.headline || raw?.title);
  const description = coerceText(
    raw?.bottomDIN?.description || raw?.description || raw?.reasoning || raw?.suggestionText,
  );
  const title = coerceText(raw?.bottomDIN?.title || raw?.title || headline || 'Insight');

  if (!headline || !description) return null;

  const rawMetrics = raw?.bottomDIN?.metrics || raw?.metrics;
  const rawAffectedProducts = raw?.bottomDIN?.affectedProducts || raw?.affectedProducts;

  return {
    id: coerceText(raw?.id || raw?.insightId || raw?.recommendationId) || undefined,
    topDIN: {
      category: coerceText(raw?.topDIN?.category, 'Priority'),
      headline,
    },
    bottomDIN: {
      title,
      description,
      metrics: Array.isArray(rawMetrics) ? rawMetrics.map(normalizeMetric).filter(isInsightMetric) : [],
      chartData: raw?.bottomDIN?.chartData || raw?.chartData,
      footer: coerceText(raw?.bottomDIN?.footer || raw?.footer) || undefined,
      action: normalizeAction(raw?.bottomDIN?.action || raw?.action),
      affectedProducts: Array.isArray(rawAffectedProducts)
        ? rawAffectedProducts.map(normalizeAffectedProduct).filter(isAffectedProduct)
        : [],
    },
    severity: ALLOWED_SEVERITIES.has(raw?.severity) ? raw.severity : 'neutral',
    urgency: ALLOWED_URGENCIES.has(raw?.urgency) ? raw.urgency : undefined,
    timestamp: coerceText(raw?.timestamp, new Date().toISOString()),
    reasoning: coerceText(raw?.reasoning) || undefined,
    sources: Array.isArray(raw?.sources) ? raw.sources : undefined,
    suggestionOnly: Boolean(raw?.suggestionOnly),
    suggestionText: coerceText(raw?.suggestionText) || undefined,
    timeframe: ['short_term', 'medium_term', 'long_term'].includes(raw?.timeframe) ? raw.timeframe : undefined,
    confidence: ['high', 'medium', 'low'].includes(raw?.confidence) ? raw.confidence : undefined,
    confidenceReasons: Array.isArray(raw?.confidenceReasons)
      ? raw.confidenceReasons.filter((item: unknown) => typeof item === 'string')
      : undefined,
    caveats: Array.isArray(raw?.caveats)
      ? raw.caveats.filter((item: unknown) => typeof item === 'string')
      : undefined,
    dataQuality: raw?.dataQuality,
    handoff: coerceText(raw?.handoff?.prompt)
      ? {
          prompt: coerceText(raw.handoff.prompt),
          campaignId: coerceText(raw?.handoff?.campaignId) || undefined,
          label: coerceText(raw?.handoff?.label) || undefined,
        }
      : undefined,
    suggestedQuestions: normalizeSuggestedQuestions(raw?.suggestedQuestions),
    report:
      raw?.report && typeof raw.report === 'object' && Array.isArray(raw.report.sections) && raw.report.sections.length
        ? {
            documentId: coerceText(raw.report.documentId) || `report_insight_${Date.now()}`,
            title: coerceText(raw.report.title, headline),
            summary: coerceText(raw.report.summary),
            format: 'report' as const,
            sections: raw.report.sections,
          }
        : undefined,
    reportId: coerceText(raw?.reportId) || undefined,
  };
};

const normalizeInsight = (raw: any): DashboardInsight | null => {
  if (Array.isArray(raw?.insights)) {
    const insights = raw.insights.map(normalizeSingleInsight).filter(Boolean) as DashboardInsight[];
    if (!insights.length) return null;
    return {
      ...insights[0],
      insights,
    };
  }

  return normalizeSingleInsight(raw);
};

const snapshotFromResponse = (
  insight: DashboardInsight,
  generatedAt: string | null,
  nextRefreshAt: string | null,
): PersistedInsightSnapshot => ({
  version: 1,
  insight,
  recommendationId: insight.id || null,
  contentHash: contentHashFor(insight),
  generatedAt,
  nextRefreshAt,
});

const normalizePersistedSnapshot = (raw: unknown): PersistedInsightSnapshot | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<PersistedInsightSnapshot>;
  const insight = normalizeInsight(record.insight);
  if (!insight) return null;

  return snapshotFromResponse(
    insight,
    normalizeIsoDate(record.generatedAt),
    normalizeIsoDate(record.nextRefreshAt),
  );
};

const resolveSnapshot = (
  previous: PersistedInsightSnapshot | null,
  incoming: PersistedInsightSnapshot,
): PersistedInsightSnapshot => {
  if (!previous) return incoming;

  const previousTime = previous.generatedAt ? Date.parse(previous.generatedAt) : NaN;
  const incomingTime = incoming.generatedAt ? Date.parse(incoming.generatedAt) : NaN;
  if (Number.isFinite(previousTime) && Number.isFinite(incomingTime) && incomingTime < previousTime) {
    return previous;
  }

  const identityChanged =
    (incoming.recommendationId !== null && incoming.recommendationId !== previous.recommendationId) ||
    incoming.contentHash !== previous.contentHash ||
    (incoming.generatedAt !== null && incoming.generatedAt !== previous.generatedAt);

  if (identityChanged) return incoming;

  return {
    ...previous,
    generatedAt: incoming.generatedAt ?? previous.generatedAt,
    nextRefreshAt: incoming.nextRefreshAt ?? previous.nextRefreshAt,
  };
};

/**
 * Hook to fetch AI-generated dashboard insights for an organization
 * Handles idle → loading → error → success state flow
 */
export function useOrgNudges(orgId: string | undefined): UseOrgNudgesReturn {
  const session = useContext(SessionContext);
  const userId = session?.user?.id;
  const persistenceKey = userId && orgId ? storageKeyFor(userId, orgId) : null;
  const [insight, setInsight] = useState<DashboardInsight | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [cacheExpiresAt, setCacheExpiresAt] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [nextRefreshAt, setNextRefreshAt] = useState<string | null>(null);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);
  const activeStorageKeyRef = useRef<string | null>(null);
  const snapshotRef = useRef<PersistedInsightSnapshot | null>(null);
  const fetchSequenceRef = useRef(0);
  const storageWriteRef = useRef<Promise<void>>(Promise.resolve());

  const applySnapshot = useCallback((snapshot: PersistedInsightSnapshot) => {
    snapshotRef.current = snapshot;
    setInsight(snapshot.insight);
    setGeneratedAt(snapshot.generatedAt);
    setNextRefreshAt(snapshot.nextRefreshAt);
    setLastUpdated(snapshot.generatedAt || snapshot.insight.timestamp || null);
  }, []);

  useEffect(() => {
    activeStorageKeyRef.current = persistenceKey;
    fetchSequenceRef.current += 1;
    snapshotRef.current = null;
    setInsight(null);
    setGeneratedAt(null);
    setNextRefreshAt(null);
    setLastUpdated(null);
    setCacheExpiresAt(null);
    setError(null);
    setHydratedStorageKey(null);

    if (!persistenceKey) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    AsyncStorage.getItem(persistenceKey)
      .then((stored) => {
        if (cancelled || activeStorageKeyRef.current !== persistenceKey || !stored) return;
        const persisted = normalizePersistedSnapshot(JSON.parse(stored));
        if (persisted) applySnapshot(persisted);
      })
      .catch((storageError) => {
        log.warn('[useOrgNudges] Failed to hydrate the last good insight:', storageError);
      })
      .finally(() => {
        if (!cancelled && activeStorageKeyRef.current === persistenceKey) {
          setHydratedStorageKey(persistenceKey);
        }
      });

    return () => {
      cancelled = true;
      if (activeStorageKeyRef.current === persistenceKey) {
        activeStorageKeyRef.current = null;
        fetchSequenceRef.current += 1;
      }
    };
  }, [applySnapshot, persistenceKey]);

  const fetchNudges = useCallback(async () => {
    if (!orgId || !persistenceKey || hydratedStorageKey !== persistenceKey) {
      setLoading(false);
      return;
    }

    if (!session?.bridgeReady) {
      const jwtState = getSupabaseJwtState().state;
      const nextError = isSupabaseBridgeWarmingUp(jwtState)
        ? 'Refreshing your live session before loading insights.'
        : 'Live insights are temporarily unavailable.';
      setLoading(false);
      setError(nextError);
      return;
    }

    setLoading(true);
    setError(null);
    const requestSequence = ++fetchSequenceRef.current;
    const requestStorageKey = persistenceKey;

    try {
      const token = await ensureSupabaseJwt();

      if (!token) {
        const jwtState = getSupabaseJwtState().state;
        log.error(`[useOrgNudges] ❌ No token available from bridge (${jwtState})`);
        throw new Error(
          isSupabaseBridgeWarmingUp(jwtState)
            ? 'Refreshing your live session before loading insights.'
            : 'Live insights are temporarily unavailable.',
        );
      }

      const base = API_BASE_URL;
      const url = `${base}/api/insights/orgs/${orgId}/nudges`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        const isForbidden = response.status === 403;
        if (isForbidden) {
          log.warn(`[useOrgNudges] 403 for org ${orgId} (org context may be syncing)`);
          throw new Error('Insights are syncing for this workspace.');
        }
        log.error(`[useOrgNudges] ❌ Fetch failed: ${response.status} ${response.statusText}`);
        log.error(`[useOrgNudges] ❌ Error body: ${errorText.substring(0, 200)}`);
        throw new Error(`Failed to fetch insights: ${response.status} - ${errorText.substring(0, 100)}`);
      }

      const data = await response.json() as NudgesResponse & { insight?: unknown };
      const normalizedInsight = normalizeInsight(data?.insight);

      if (!normalizedInsight) {
        log.warn('[useOrgNudges] ⚠️ Response missing or invalid insight data');
        return;
      }

      if (
        requestSequence !== fetchSequenceRef.current ||
        activeStorageKeyRef.current !== requestStorageKey
      ) {
        return;
      }

      const rawInsight = data?.insight as { generatedAt?: unknown; nextRefreshAt?: unknown } | undefined;
      const responseInsightId = coerceText(data?.id || data?.recommendationId);
      const identifiedInsight = responseInsightId && !normalizedInsight.id
        ? { ...normalizedInsight, id: responseInsightId }
        : normalizedInsight;
      const incoming = snapshotFromResponse(
        identifiedInsight,
        normalizeIsoDate(data?.generatedAt ?? rawInsight?.generatedAt),
        normalizeIsoDate(data?.nextRefreshAt ?? rawInsight?.nextRefreshAt),
      );
      const resolved = resolveSnapshot(snapshotRef.current, incoming);
      applySnapshot(resolved);
      const resolvedTimestamp = coerceText(data?.timestamp, identifiedInsight.timestamp || new Date().toISOString());
      setLastUpdated(resolvedTimestamp);
      setCacheExpiresAt(coerceText(data?.cacheExpiresAt) || null);
      setError(null);

      const write = storageWriteRef.current
        .catch(() => undefined)
        .then(() => AsyncStorage.setItem(requestStorageKey, JSON.stringify(resolved)));
      storageWriteRef.current = write;
      try {
        await write;
      } catch (storageError) {
        log.warn('[useOrgNudges] Failed to persist the last good insight:', storageError);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to fetch insights';
      const isSoftError = errorMessage.includes('syncing for this workspace');
      if (!isSoftError) {
        log.error('[useOrgNudges] ❌ Fetch error:', errorMessage);
      }
      if (
        requestSequence === fetchSequenceRef.current &&
        activeStorageKeyRef.current === requestStorageKey
      ) {
        setError(errorMessage);
      }
    } finally {
      if (
        requestSequence === fetchSequenceRef.current &&
        activeStorageKeyRef.current === requestStorageKey
      ) {
        setLoading(false);
      }
    }
  }, [applySnapshot, hydratedStorageKey, orgId, persistenceKey, session?.bridgeReady]);

  useEffect(() => {
    if (orgId && persistenceKey && hydratedStorageKey === persistenceKey) {
      if (!session?.bridgeReady) {
        setLoading(false);
        return;
      }
      void fetchNudges();
    }
  }, [fetchNudges, hydratedStorageKey, orgId, persistenceKey, session?.bridgeReady]);

  const forceRefresh = useCallback(async () => {
    if (!orgId) return;
    if (!session?.bridgeReady) {
      setError('Live insights are temporarily unavailable while the session reconnects.');
      return;
    }

    try {
      const token = await ensureSupabaseJwt();
      if (!token) {
        throw new Error('No JWT token available');
      }

      const apiBase = API_BASE_URL;
      const url = `${apiBase}/api/insights/orgs/${orgId}/nudges`;

      // Clear cache on backend
      const clearResponse = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!clearResponse.ok) {
        log.warn(`[useOrgNudges] Failed to clear cache: ${clearResponse.status}`);
      }

      // Then fetch new insight
      await fetchNudges();
    } catch (e) {
      log.error('[useOrgNudges] Force refresh error:', e);
      // Still try to fetch
      await fetchNudges();
    }
  }, [orgId, fetchNudges, session?.bridgeReady]);

  return {
    insight,
    loading,
    error,
    lastUpdated,
    cacheExpiresAt,
    generatedAt,
    nextRefreshAt,
    refetch: fetchNudges,
    forceRefresh,
  };
}

/**
 * Track when user clicks on an insight action
 */
export async function trackInsightAction(
  orgId: string,
  actionLink: string,
  insightTitle: string,
): Promise<void> {
  try {
    const token = await ensureSupabaseJwt();
    const base = API_BASE_URL;
    const url = `${base}/api/insights/orgs/${orgId}/nudges/action?link=${encodeURIComponent(actionLink)}&title=${encodeURIComponent(insightTitle)}`;

    await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    log.debug(`[trackInsightAction] Tracked action: ${insightTitle}`);
  } catch (e) {
    log.error('[trackInsightAction] Failed to track action:', e);
    // Don't throw - telemetry failures shouldn't break the app
  }
}
