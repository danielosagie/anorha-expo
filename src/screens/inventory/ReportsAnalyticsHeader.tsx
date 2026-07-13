import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { API_BASE_URL } from '../../config/env';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { createLogger } from '../../utils/logger';

const log = createLogger('ReportsAnalyticsHeader');

// A hung mobile request must not leave the header loading forever.
const FETCH_TIMEOUT_MS = 15000;

// Authed GET with one deadline over the WHOLE chain. The token step can hang
// too, and an AbortController only cancels the fetch — so the deadline is a
// race, not just an abort. Callers abort the controller on unmount; that also
// settles the race immediately instead of waiting out a stuck token call.
async function fetchJsonAuthed(path: string, controller: AbortController): Promise<any> {
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await Promise.race([
      (async () => {
        const token = await ensureSupabaseJwt();
        if (!token) throw new Error('no token');
        const res = await fetch(`${API_BASE_URL}${path}`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })(),
      new Promise<never>((_, reject) => {
        const onAbort = () => reject(new Error('request timed out'));
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

// Analytics strip at the top of the Reports tab: what actually happened,
// summarized (30d sales, revenue, avg sale) plus a single-series revenue line
// for the last 14 days. Pulls the same /api/activity feed the Orders tab reads,
// so it needs no new backend. The reports list scrolls beneath it.

const INK = '#18181B';
const DIM = '#6B7280';
const BRAND = '#93C822';
const BRAND_DARK = '#4E6B12';
const FONT = { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' };

const isOrderEvent = (eventType: string): boolean =>
  /order|sale|sold|purchase|checkout/i.test(String(eventType || '')) && !/refund|cancel/i.test(String(eventType || ''));

const pickAmount = (details: Record<string, any>): number => {
  for (const k of ['total', 'amount', 'orderTotal', 'totalPrice', 'total_price', 'subtotal_price', 'price', 'grandTotal']) {
    const v = details?.[k];
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (typeof n === 'number' && isFinite(n) && n > 0) return n;
  }
  return 0;
};

const money = (n: number): string =>
  `$${Math.round(n).toLocaleString()}`;

interface DayPoint { label: string; revenue: number }

interface PlatformRow { name: string; revenue: number; sales: number }

interface CampaignRow {
  id: string;
  strategyId: string | null;
  collected: number;
  target: number;
  progressPct: number;
  daysLeft: number | null;
  pace: 'on pace' | 'behind' | 'final hours' | 'no deadline';
  listed: number;
  sold: number;
}

interface AnalyticsState {
  loading: boolean;
  sales30d: number;
  revenue30d: number;
  avgSale: number;
  series: DayPoint[];
  /** Which platforms the sales came from (30d), ranked by revenue. */
  platforms: PlatformRow[];
}

export function useInventoryAnalytics(): AnalyticsState {
  const [state, setState] = useState<AnalyticsState>({
    loading: true, sales30d: 0, revenue30d: 0, avgSale: 0, series: [], platforms: [],
  });

  useEffect(() => {
    let cancelled = false;
    // One controller PER attempt: fetchJsonAuthed aborts its controller on timeout,
    // so a shared one would leave the activity fallback with an already-dead signal.
    // Track the live one so unmount still aborts whichever request is in flight.
    let activeController: AbortController | null = null;
    const authed = (path: string) => {
      const ctrl = new AbortController();
      activeController = ctrl;
      return fetchJsonAuthed(path, ctrl);
    };

    // 'YYYY-MM-DD' → 'M/D' (timezone-safe: parse the parts, don't new Date()).
    const dayLabel = (isoDate: string): string => {
      const parts = String(isoDate).split('-');
      return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : String(isoDate);
    };

    // Legacy path: derive the numbers by scraping order-shaped /api/activity
    // entries. Kept ONLY as a degraded fallback for when the real orders summary
    // endpoint is unavailable, so the header still shows something.
    const computeFromActivity = async (): Promise<AnalyticsState> => {
      const data = await authed('/api/activity?limit=200');
      const events: any[] = Array.isArray(data?.events) ? data.events : [];
      const now = Date.now();
      const cutoff30 = now - 30 * 86400000;
      const cutoff14 = now - 14 * 86400000;

      let sales = 0;
      let revenue = 0;
      const byDay = new Map<string, number>();
      const byPlatform = new Map<string, { revenue: number; sales: number }>();
      for (const e of events) {
        if (!isOrderEvent(e.EventType)) continue;
        const t = Date.parse(e.Timestamp);
        if (!Number.isFinite(t) || t < cutoff30) continue;
        const amount = pickAmount(e.Details || {});
        sales += 1;
        revenue += amount;
        const platform = String(e.PlatformType || 'other').toLowerCase();
        const p = byPlatform.get(platform) || { revenue: 0, sales: 0 };
        p.revenue += amount;
        p.sales += 1;
        byPlatform.set(platform, p);
        if (t >= cutoff14) {
          const day = new Date(t).toISOString().slice(0, 10);
          byDay.set(day, (byDay.get(day) || 0) + amount);
        }
      }
      const platforms: PlatformRow[] = [...byPlatform.entries()]
        .map(([name, p]) => ({ name, revenue: p.revenue, sales: p.sales }))
        .sort((a, b) => b.revenue - a.revenue || b.sales - a.sales)
        .slice(0, 5);

      // Continuous last-14-days series (zero-filled) so the line reads as a
      // timeline, not a scatter of only the days that had sales.
      const series: DayPoint[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now - i * 86400000);
        const key = d.toISOString().slice(0, 10);
        series.push({
          // Label from the same UTC key the revenue lookup uses — local-time accessors
          // shift the label a day in nonzero UTC offsets.
          label: dayLabel(key),
          revenue: Math.round((byDay.get(key) || 0) * 100) / 100,
        });
      }

      return {
        loading: false,
        sales30d: sales,
        revenue30d: revenue,
        avgSale: sales > 0 ? revenue / sales : 0,
        series,
        platforms,
      };
    };

    (async () => {
      try {
        // Preferred: real order metrics computed server-side from the Orders
        // table (GET /api/orders/summary). Feed the tiles/chart the real numbers.
        const summary = await authed('/api/orders/summary');
        if (summary && typeof summary === 'object' && Array.isArray(summary.revenueByDay)) {
          const series: DayPoint[] = summary.revenueByDay.map((d: any) => ({
            label: dayLabel(d.date),
            revenue: Math.round((Number(d.amount) || 0) * 100) / 100,
          }));
          // The summary's revenueByPlatform carries revenue only (no per-platform
          // count); sales stays 0 and the breakdown row hides the count when 0.
          const platforms: PlatformRow[] = (Array.isArray(summary.revenueByPlatform) ? summary.revenueByPlatform : [])
            .map((p: any) => ({ name: String(p.platform || 'other'), revenue: Number(p.amount) || 0, sales: 0 }))
            .slice(0, 5);
          if (!cancelled) {
            setState({
              loading: false,
              sales30d: Number(summary.orderCount30d) || 0,
              revenue30d: Number(summary.totalRevenue30d) || 0,
              avgSale: Number(summary.avgOrderValue30d) || 0,
              series,
              platforms,
            });
          }
          return;
        }
        throw new Error('unexpected summary shape');
      } catch (e) {
        // Degrade to the activity-based numbers rather than crashing/blanking.
        if (cancelled) return;
        try {
          const fallback = await computeFromActivity();
          if (!cancelled) setState(fallback);
        } catch (e2) {
          if (cancelled) return;
          log.warn('[analytics] fetch failed:', e2 instanceof Error ? e2.message : e2);
          setState((s) => ({ ...s, loading: false }));
        }
      }
    })();
    return () => { cancelled = true; activeController?.abort(); };
  }, []);

  return state;
}

interface RecoverySummary { soldCount: number; recoveryRatePct: number | null; avgDaysToSale: number | null }
interface PoolRow { id: string | null; name: string; units: number }

/**
 * Server-computed portfolio metrics: RECOVERY (how much of suggested value
 * sold items captured, and how fast — the cost-basis-free P&L) overall and per
 * campaign, plus which pools hold the units.
 */
function usePortfolioMetrics(): {
  loading: boolean;
  recovery: RecoverySummary | null;
  recoveryByStrategy: Map<string, RecoverySummary>;
  pools: PoolRow[];
} {
  const [state, setState] = useState<{
    loading: boolean;
    recovery: RecoverySummary | null;
    recoveryByStrategy: Map<string, RecoverySummary>;
    pools: PoolRow[];
  }>({ loading: true, recovery: null, recoveryByStrategy: new Map(), pools: [] });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const data = await fetchJsonAuthed('/api/agent/analytics/portfolio', controller);
        const recovery: RecoverySummary | null =
          data?.recovery && typeof data.recovery === 'object' ? data.recovery : null;
        const recoveryByStrategy = new Map<string, RecoverySummary>(
          (Array.isArray(data?.campaigns) ? data.campaigns : [])
            .filter((c: any) => c?.strategyId)
            .map((c: any) => [String(c.strategyId), c as RecoverySummary]),
        );
        const pools: PoolRow[] = (Array.isArray(data?.pools) ? data.pools : [])
          .filter((p: any) => p && typeof p.units === 'number' && p.units > 0)
          .map((p: any) => ({ id: p.id ?? null, name: String(p.name || 'Pool'), units: p.units }));
        if (!cancelled) setState({ loading: false, recovery, recoveryByStrategy, pools });
      } catch (e) {
        if (cancelled) return;
        log.warn('[portfolio] fetch failed:', e instanceof Error ? e.message : e);
        setState((s) => ({ ...s, loading: false }));
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, []);

  return state;
}

/** Active campaigns as portfolio positions: collected vs target, pace, live/sold. */
function useCampaignPortfolio(): { loading: boolean; campaigns: CampaignRow[] } {
  const [state, setState] = useState<{ loading: boolean; campaigns: CampaignRow[] }>({ loading: true, campaigns: [] });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const data = await fetchJsonAuthed('/api/agent/sessions?type=liquidation&status=active', controller);
        const sessions: any[] = Array.isArray(data?.sessions) ? data.sessions : [];
        const now = Date.now();
        const campaigns: CampaignRow[] = sessions.slice(0, 6).map((s) => {
          const goal = s.goal || {};
          const st = s.state || {};
          const target = Number(st.revenueTarget) || Number(goal.targetRevenue) || 0;
          const collected = Number(st.revenueCollected) || 0;
          const progressPct = target > 0 ? Math.round((collected / target) * 100) : 0;
          const deadlineMs = goal.deadline ? Date.parse(goal.deadline) : NaN;
          const daysLeft = Number.isFinite(deadlineMs) ? Math.max(0, (deadlineMs - now) / 86400000) : null;
          const totalDays = Number(goal.timeframeDays) || 0;
          let pace: CampaignRow['pace'] = 'no deadline';
          if (daysLeft != null && totalDays > 0) {
            if (daysLeft <= 1 || daysLeft <= totalDays * 0.1) pace = 'final hours';
            else {
              const elapsedPct = ((totalDays - daysLeft) / totalDays) * 100;
              pace = progressPct >= elapsedPct - 5 ? 'on pace' : 'behind';
            }
          }
          return {
            id: String(s.id),
            strategyId: st.strategyId ? String(st.strategyId) : null,
            collected,
            target,
            progressPct,
            daysLeft: daysLeft != null ? Math.floor(daysLeft) : null,
            pace,
            listed: Number(st.itemsListed) || 0,
            sold: Number(st.itemsSold) || 0,
          };
        });
        if (!cancelled) setState({ loading: false, campaigns });
      } catch (e) {
        if (cancelled) return;
        log.warn('[campaigns] fetch failed:', e instanceof Error ? e.message : e);
        setState({ loading: false, campaigns: [] });
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, []);

  return state;
}

const PACE_STYLE: Record<CampaignRow['pace'], { bg: string; fg: string }> = {
  'on pace': { bg: '#E7F6D7', fg: '#4E6B12' },
  behind: { bg: '#FBEAD2', fg: '#A2611A' },
  'final hours': { bg: '#FEE2E2', fg: '#B91C1C' },
  'no deadline': { bg: '#F3F4F6', fg: '#4B5563' },
};

const ReportsAnalyticsHeader: React.FC = () => {
  const { loading, sales30d, revenue30d, avgSale, series, platforms } = useInventoryAnalytics();
  const portfolio = useCampaignPortfolio();
  const metrics = usePortfolioMetrics();

  const maxPlatformRevenue = useMemo(
    () => Math.max(...platforms.map((p) => p.revenue), 1),
    [platforms],
  );
  const totalPoolUnits = useMemo(
    () => metrics.pools.reduce((n, p) => n + p.units, 0) || 1,
    [metrics.pools],
  );

  const hasRevenue = useMemo(() => series.some((p) => p.revenue > 0), [series]);
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = windowWidth - 48;

  // Sparse x labels: first, middle, last — the axis stays recessive.
  const labels = useMemo(
    () => series.map((p, i) => (i === 0 || i === Math.floor(series.length / 2) || i === series.length - 1 ? p.label : '')),
    [series],
  );

  // Wait for all three sources so the header appears once, whole — no sections
  // popping in as the slower fetches resolve. Each is deadline-bounded above.
  if (loading || portfolio.loading || metrics.loading) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.tileRow}>
        <View style={styles.tile}>
          <Text style={styles.tileValue}>{money(revenue30d)}</Text>
          <Text style={styles.tileLabel}>Revenue · 30d</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileValue}>{sales30d}</Text>
          <Text style={styles.tileLabel}>Sales · 30d</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileValue}>{sales30d > 0 ? money(avgSale) : '—'}</Text>
          <Text style={styles.tileLabel}>Avg sale</Text>
        </View>
      </View>

      {/* Recovery: the cost-basis-free P&L. How much of the suggested value
          sold items captured, and how fast. */}
      {metrics.recovery && metrics.recovery.soldCount > 0 ? (
        <View style={styles.tileRow}>
          <View style={styles.tile}>
            <Text style={styles.tileValue}>
              {metrics.recovery.recoveryRatePct != null ? `${metrics.recovery.recoveryRatePct}%` : '—'}
            </Text>
            <Text style={styles.tileLabel}>Value recovered</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileValue}>
              {metrics.recovery.avgDaysToSale != null ? `${metrics.recovery.avgDaysToSale}d` : '—'}
            </Text>
            <Text style={styles.tileLabel}>Avg time to sale</Text>
          </View>
          <View style={styles.tile}>
            <Text style={styles.tileValue}>{metrics.recovery.soldCount}</Text>
            <Text style={styles.tileLabel}>Items sold</Text>
          </View>
        </View>
      ) : null}

      {hasRevenue ? (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Revenue · last 14 days</Text>
          <LineChart
            data={{ labels, datasets: [{ data: series.map((p) => p.revenue) }] }}
            width={chartWidth}
            height={140}
            withDots={false}
            withInnerLines={false}
            withOuterLines={false}
            withShadow={false}
            fromZero
            chartConfig={{
              backgroundGradientFrom: '#FFFFFF',
              backgroundGradientTo: '#FFFFFF',
              decimalPlaces: 0,
              color: () => BRAND,
              labelColor: () => DIM,
              strokeWidth: 2,
              propsForLabels: { fontSize: 10 },
            }}
            style={styles.chart}
            bezier={false}
          />
        </View>
      ) : (
        <View style={styles.chartEmpty}>
          <Text style={styles.chartEmptyText}>No sales in the last 14 days yet. When they land, the trend shows here.</Text>
        </View>
      )}

      {/* Which platforms the sales came from (30d), Shopify-analytics style. */}
      {platforms.length > 0 ? (
        <View style={styles.campaignCard}>
          <Text style={styles.chartTitle}>Sales by platform · 30d</Text>
          {platforms.map((p) => (
            <View key={p.name} style={styles.breakdownRow}>
              <Text style={styles.breakdownName} numberOfLines={1}>{p.name}</Text>
              <View style={styles.breakdownBarArea}>
                <View style={styles.paceTrack}>
                  <View style={[styles.paceFill, { width: `${Math.max(4, Math.round((p.revenue / maxPlatformRevenue) * 100))}%` }]} />
                </View>
              </View>
              <Text style={styles.breakdownValue}>{money(p.revenue)}{p.sales > 0 ? ` · ${p.sales}` : ''}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Which pools hold the inventory. */}
      {metrics.pools.length > 0 ? (
        <View style={styles.campaignCard}>
          <Text style={styles.chartTitle}>Inventory by pool</Text>
          {metrics.pools.map((p, idx) => (
            <View key={p.id ?? `unassigned-${idx}`} style={styles.breakdownRow}>
              <Text style={styles.breakdownName} numberOfLines={1}>{p.name}</Text>
              <View style={styles.breakdownBarArea}>
                <View style={styles.paceTrack}>
                  <View style={[styles.paceFill, { width: `${Math.max(4, Math.round((p.units / totalPoolUnits) * 100))}%` }]} />
                </View>
              </View>
              <Text style={styles.breakdownValue}>{p.units.toLocaleString()} units</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Campaigns as portfolio positions: collected vs target, pace, live/sold,
          and recovery when the campaign has sales. */}
      {portfolio.campaigns.length > 0 ? (
        <View style={styles.campaignCard}>
          <Text style={styles.chartTitle}>Campaigns</Text>
          {portfolio.campaigns.map((c) => {
            const paceStyle = PACE_STYLE[c.pace];
            const recovery = c.strategyId ? metrics.recoveryByStrategy.get(c.strategyId) : undefined;
            return (
              <View key={c.id} style={styles.campaignRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.campaignMain} numberOfLines={1}>
                    {money(c.collected)} of {money(c.target)} · {c.progressPct}%
                  </Text>
                  <Text style={styles.campaignSub} numberOfLines={1}>
                    {c.sold} sold · {c.listed} live{c.daysLeft != null ? ` · ${c.daysLeft}d left` : ''}
                    {recovery?.recoveryRatePct != null ? ` · ${recovery.recoveryRatePct}% recovered` : ''}
                  </Text>
                  <View style={styles.paceTrack}>
                    <View style={[styles.paceFill, { width: `${Math.min(c.progressPct, 100)}%` }]} />
                  </View>
                </View>
                <View style={[styles.pacePill, { backgroundColor: paceStyle.bg }]}>
                  <Text style={[styles.pacePillText, { color: paceStyle.fg }]}>{c.pace}</Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>Reports</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 4, paddingBottom: 4 },
  tileRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tile: {
    flex: 1, backgroundColor: '#F4F4F1', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 10,
  },
  tileValue: { fontSize: 17, fontFamily: FONT.bold, color: INK },
  tileLabel: { fontSize: 11.5, fontFamily: FONT.medium, color: DIM, marginTop: 2 },
  chartCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#F1F2F4',
    paddingTop: 10, marginBottom: 6, overflow: 'hidden',
  },
  chartTitle: { fontSize: 12.5, fontFamily: FONT.semibold, color: BRAND_DARK, paddingHorizontal: 12, marginBottom: 2 },
  chart: { marginLeft: -8 },
  chartEmpty: {
    backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#F1F2F4',
    padding: 14, marginBottom: 6,
  },
  chartEmptyText: { fontSize: 12.5, fontFamily: FONT.regular, color: DIM },
  campaignCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#F1F2F4',
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 8, marginBottom: 6, gap: 10,
  },
  campaignRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campaignMain: { fontSize: 13.5, fontFamily: FONT.semibold, color: INK },
  campaignSub: { fontSize: 11.5, fontFamily: FONT.regular, color: DIM, marginTop: 1 },
  paceTrack: { height: 4, borderRadius: 999, backgroundColor: '#F1F2F4', marginTop: 6, overflow: 'hidden' },
  paceFill: { height: 4, borderRadius: 999, backgroundColor: BRAND },
  pacePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pacePillText: { fontSize: 10.5, fontFamily: FONT.semibold },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownName: { width: 92, fontSize: 12.5, fontFamily: FONT.semibold, color: INK, textTransform: 'capitalize' },
  breakdownBarArea: { flex: 1 },
  breakdownValue: { fontSize: 11.5, fontFamily: FONT.medium, color: DIM, minWidth: 74, textAlign: 'right' },
  sectionLabel: { fontSize: 13, fontFamily: FONT.semibold, color: DIM, marginTop: 10, marginBottom: 2, paddingHorizontal: 2 },
});

export default ReportsAnalyticsHeader;
