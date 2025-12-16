import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { ensureSupabaseJwt } from '../../lib/supabase';

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

/**
 * Hook to fetch AI-generated dashboard insights for an organization
 * Handles idle → loading → error → success state flow
 */
export function useOrgNudges(orgId: string | undefined): UseOrgNudgesReturn {
  const [insight, setInsight] = useState<DashboardInsight | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [cacheExpiresAt, setCacheExpiresAt] = useState<string | null>(null);
  const prevOrgIdRef = useRef<string | undefined>(undefined);

  const fetchNudges = useCallback(async () => {
    console.log(`[useOrgNudges] fetchNudges called with orgId: ${orgId || 'UNDEFINED'}`);

    if (!orgId) {
      console.log(`[useOrgNudges] ❌ No orgId provided, skipping fetch`);
      setInsight(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log(`[useOrgNudges] 🔐 Getting JWT token via Supabase bridge...`);
      const token = await ensureSupabaseJwt();

      if (!token) {
        console.error(`[useOrgNudges] ❌ No token available from bridge`);
        throw new Error('No JWT token available');
      }

      console.log(`[useOrgNudges] ✅ JWT token obtained, length: ${token.length}`);

      const base = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
      const url = `${base}/api/insights/orgs/${orgId}/nudges`;

      console.log(`[useOrgNudges] 📡 ==========================================`);
      console.log(`[useOrgNudges] 📡 FETCH REQUEST DETAILS:`);
      console.log(`[useOrgNudges] 📡   Base URL: ${base}`);
      console.log(`[useOrgNudges] 📡   Full URL: ${url}`);
      console.log(`[useOrgNudges] 📡   OrgId: ${orgId}`);
      console.log(`[useOrgNudges] 📡   Method: GET`);
      console.log(`[useOrgNudges] 📡   Has Token: ${!!token}`);
      console.log(`[useOrgNudges] 📡 ==========================================`);

      console.log(`[useOrgNudges] 🚀 Making fetch request...`);
      const startTime = Date.now();

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const duration = Date.now() - startTime;
      console.log(`[useOrgNudges] 📥 Response received in ${duration}ms: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[useOrgNudges] ❌ Fetch failed: ${response.status} ${response.statusText}`);
        console.error(`[useOrgNudges] ❌ Error body: ${errorText.substring(0, 200)}`);
        throw new Error(`Failed to fetch insights: ${response.status} - ${errorText.substring(0, 100)}`);
      }

      const data: NudgesResponse = await response.json();

      if (!data.insight) {
        console.warn(`[useOrgNudges] ⚠️ Response missing insight data:`, data);
        throw new Error('Invalid response: missing insight');
      }

      console.log(`[useOrgNudges] ✅ Received insight: ${data.insight.severity} - ${data.insight.topDIN.headline}`);

      setInsight(data.insight);
      setLastUpdated(data.timestamp);
      // Calculate cache expiration (6 hours from insight timestamp)
      const cacheMs = 6 * 60 * 60 * 1000; // 6 hours
      const expiresAt = new Date(new Date(data.timestamp).getTime() + cacheMs);
      setCacheExpiresAt(expiresAt.toISOString());
      setError(null);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to fetch insights';
      console.error('[useOrgNudges] ❌ ==========================================');
      console.error('[useOrgNudges] ❌ ERROR CAUGHT:');
      console.error('[useOrgNudges] ❌   Message:', errorMessage);
      if (e instanceof Error) {
        console.error('[useOrgNudges] ❌   Stack:', e.stack);
      }
      console.error('[useOrgNudges] ❌ ==========================================');
      setError(errorMessage);
      setInsight(null);
    } finally {
      setLoading(false);
      console.log(`[useOrgNudges] ✅ Fetch complete, loading: false`);
    }
  }, [orgId]);

  useEffect(() => {
    const prevOrgId = prevOrgIdRef.current;
    console.log(`[useOrgNudges] useEffect triggered, orgId: ${orgId || 'UNDEFINED'}`);

    if (orgId) {
      if (prevOrgId !== orgId) {
        console.log(`[useOrgNudges] 🎯 orgId changed from ${prevOrgId || 'UNDEFINED'} to ${orgId} - will fetch insights!`);
      }
      console.log(`[useOrgNudges] 🚀 Calling fetchNudges for orgId: ${orgId}`);
      fetchNudges();
    } else {
      console.log(`[useOrgNudges] ⏭️ Skipping fetchNudges - no orgId (waiting for currentOrg to load...)`);
    }

    prevOrgIdRef.current = orgId;
  }, [orgId, fetchNudges]);

  const forceRefresh = useCallback(async () => {
    if (!orgId) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No session available');
      }

      const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
      const url = `${apiBase}/api/insights/orgs/${orgId}/nudges`;

      console.log(`[useOrgNudges] Force refreshing insights for org ${orgId}`);

      // Clear cache on backend
      const clearResponse = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
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
  }, [orgId, fetchNudges]);

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

