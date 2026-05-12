import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { supabase } from '../../lib/supabase';
import { ensureSupabaseJwt, getSupabaseJwtState, isSupabaseBridgeWarmingUp } from '../../lib/supabase';
import { SessionContext } from '../context/SessionContext';

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
}

interface UseOrgNudgesReturn {
  insight: DashboardInsight | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  cacheExpiresAt: string | null; // ISO timestamp for refresh timer
  refetch: () => Promise<void>;
  forceRefresh: () => Promise<void>;
}

const ALLOWED_SEVERITIES = new Set<DashboardInsight['severity']>(['good', 'neutral', 'warning', 'critical']);
const ALLOWED_URGENCIES = new Set<InsightUrgency>(['now', 'today', 'this-week']);

const coerceText = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
};

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

/**
 * Hook to fetch AI-generated dashboard insights for an organization
 * Handles idle → loading → error → success state flow
 */
export function useOrgNudges(orgId: string | undefined): UseOrgNudgesReturn {
  const session = useContext(SessionContext);
  const [insight, setInsight] = useState<DashboardInsight | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [cacheExpiresAt, setCacheExpiresAt] = useState<string | null>(null);
  const prevOrgIdRef = useRef<string | undefined>(undefined);

  const fetchNudges = useCallback(async () => {
    if (!orgId) {
      setInsight(null);
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

    try {
      const token = await ensureSupabaseJwt();

      if (!token) {
        const jwtState = getSupabaseJwtState().state;
        console.error(`[useOrgNudges] ❌ No token available from bridge (${jwtState})`);
        throw new Error(
          isSupabaseBridgeWarmingUp(jwtState)
            ? 'Refreshing your live session before loading insights.'
            : 'Live insights are temporarily unavailable.',
        );
      }

      const base = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
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
          console.warn(`[useOrgNudges] 403 for org ${orgId} (org context may be syncing)`);
          throw new Error('Insights are syncing for this workspace.');
        }
        console.error(`[useOrgNudges] ❌ Fetch failed: ${response.status} ${response.statusText}`);
        console.error(`[useOrgNudges] ❌ Error body: ${errorText.substring(0, 200)}`);
        throw new Error(`Failed to fetch insights: ${response.status} - ${errorText.substring(0, 100)}`);
      }

      const data = await response.json() as NudgesResponse & { insight?: unknown };
      const normalizedInsight = normalizeInsight(data?.insight);

      if (!normalizedInsight) {
        console.warn('[useOrgNudges] ⚠️ Response missing or invalid insight data');
        throw new Error('Invalid response: missing insight');
      }

      setInsight(normalizedInsight);
      const resolvedTimestamp = coerceText(data?.timestamp, normalizedInsight.timestamp || new Date().toISOString());
      setLastUpdated(resolvedTimestamp);
      setCacheExpiresAt(coerceText(data?.cacheExpiresAt) || null);
      setError(null);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to fetch insights';
      const isSoftError = errorMessage.includes('syncing for this workspace');
      if (!isSoftError) {
        console.error('[useOrgNudges] ❌ Fetch error:', errorMessage);
      }
      setError(errorMessage);
      setInsight(null);
    } finally {
      setLoading(false);
    }
  }, [orgId, session?.bridgeReady]);

  useEffect(() => {
    if (orgId) {
      if (!session?.bridgeReady) {
        setLoading(false);
        return;
      }
      fetchNudges();
    }

    prevOrgIdRef.current = orgId;
  }, [orgId, fetchNudges, session?.bridgeReady]);

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

      const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
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
        console.warn(`[useOrgNudges] Failed to clear cache: ${clearResponse.status}`);
      }

      // Then fetch new insight
      await fetchNudges();
    } catch (e) {
      console.error('[useOrgNudges] Force refresh error:', e);
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
    const base = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
    const url = `${base}/api/insights/orgs/${orgId}/nudges/action?link=${encodeURIComponent(actionLink)}&title=${encodeURIComponent(insightTitle)}`;

    await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log(`[trackInsightAction] Tracked action: ${insightTitle}`);
  } catch (e) {
    console.error('[trackInsightAction] Failed to track action:', e);
    // Don't throw - telemetry failures shouldn't break the app
  }
}
