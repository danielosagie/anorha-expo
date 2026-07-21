import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Circle, Polygon, Polyline, Text as SvgText } from 'react-native-svg';
import { API_BASE_URL } from '../../config/env';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { createLogger } from '../../utils/logger';

const log = createLogger('ReportsAnalyticsHeader');
const FETCH_TIMEOUT_MS = 15000;
const DAY_MS = 86400000;
const DELTA_GREEN = '#4A7C00';
const DELTA_RED = '#D8434F';
const PREVIOUS_LINE = '#C4C8CE';

export type ReportsSection = 'overview' | 'sales' | 'platforms' | 'campaigns' | 'reports';
type TimeRange = '7D' | '30D' | '90D' | '1Y';

interface ReportsAnalyticsHeaderProps {
  activeSection: ReportsSection;
  onSectionChange: (section: ReportsSection) => void;
  showReportsHeading: boolean;
}

interface DayPoint {
  label: string;
  revenue: number;
}

interface PlatformRow {
  name: string;
  revenue: number;
  sales: number;
}

interface SoldItem {
  id: string;
  title: string;
  platform: string;
  amount: number;
  soldAt: string;
  daysToSale: number | null;
  imageUrl: string | null;
}

interface CampaignRow {
  id: string;
  name: string;
  collected: number;
  target: number;
  progressPct: number;
  daysLeft: number | null;
  pace: 'on pace' | 'behind' | 'final hours' | 'no deadline';
}

interface AnalyticsState {
  loading: boolean;
  sales30d: number;
  revenue30d: number;
  avgSale: number;
  series: DayPoint[];
  previousSeries: DayPoint[];
  previousSales30d: number | null;
  previousRevenue30d: number | null;
  previousAvgSale: number | null;
  platforms: PlatformRow[];
  soldItems: SoldItem[];
}

interface RecoverySummary {
  soldCount: number;
  recoveryRatePct: number | null;
  avgDaysToSale: number | null;
}

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

const isOrderEvent = (eventType: string): boolean =>
  /order|sale|sold|purchase|checkout/i.test(String(eventType || '')) &&
  !/refund|cancel/i.test(String(eventType || ''));

const pickAmount = (details: Record<string, any>): number => {
  for (const key of ['total', 'amount', 'orderTotal', 'totalPrice', 'total_price', 'subtotal_price', 'price', 'grandTotal']) {
    const value = details?.[key];
    const number = typeof value === 'string' ? parseFloat(value) : value;
    if (typeof number === 'number' && Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};

const firstText = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

const dayLabel = (isoDate: string): string => {
  const parts = String(isoDate).split('-');
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : String(isoDate);
};

const money = (amount: number, cents = false): string =>
  `$${amount.toLocaleString(undefined, {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })}`;

const platformLabel = (platform: string): string => {
  const value = String(platform || 'Other').trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Other';
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const continuousSeries = (
  now: number,
  days: number,
  offsetDays: number,
  revenueByDay: Map<string, number>,
): DayPoint[] => {
  const points: DayPoint[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now - (index + offsetDays) * DAY_MS);
    const key = date.toISOString().slice(0, 10);
    points.push({ label: dayLabel(key), revenue: roundMoney(revenueByDay.get(key) || 0) });
  }
  return points;
};

const soldItemFromEvent = (event: any, amount: number, timestamp: number): SoldItem | null => {
  const details = event?.Details || {};
  const product = details.product || details.Product || {};
  const item = details.item || details.Item || details.lineItem || {};
  const title = firstText(
    details.productTitle,
    details.title,
    details.name,
    product.title,
    product.Title,
    product.name,
    item.title,
    item.name,
  );
  if (!title || amount <= 0) return null;

  const imageValue = firstText(
    details.imageUrl,
    details.image_url,
    details.thumbnailUrl,
    details.thumbnail,
    product.imageUrl,
    product.image_url,
    product.thumbnailUrl,
    item.imageUrl,
    item.image_url,
    product.images?.[0]?.url,
    product.images?.[0]?.src,
  );
  const listedAt = firstText(details.listedAt, details.createdAt, product.listedAt, product.createdAt);
  const explicitDays = Number(details.daysToSale ?? product.daysToSale);
  const listedTimestamp = listedAt ? Date.parse(listedAt) : NaN;
  const daysToSale = Number.isFinite(explicitDays) && explicitDays >= 0
    ? Math.round(explicitDays)
    : Number.isFinite(listedTimestamp)
      ? Math.max(0, Math.round((timestamp - listedTimestamp) / DAY_MS))
      : null;

  return {
    id: String(event?.Id || `${timestamp}-${title}`),
    title,
    platform: firstText(event?.PlatformType, details.platform, details.platformType) || 'Other',
    amount,
    soldAt: String(event?.Timestamp || ''),
    daysToSale,
    imageUrl: imageValue,
  };
};

const analyticsFromActivity = (data: any): Omit<AnalyticsState, 'loading'> => {
  const events: any[] = Array.isArray(data?.events) ? data.events : [];
  const now = Date.now();
  const currentCutoff = now - 30 * DAY_MS;
  const previousCutoff = now - 60 * DAY_MS;
  const eventTimestamps = events
    .map((event) => Date.parse(event?.Timestamp))
    .filter((timestamp): timestamp is number => Number.isFinite(timestamp));
  const earliestTimestamp = eventTimestamps.length > 0 ? Math.min(...eventTimestamps) : Infinity;
  const priorWindowCovered = data?.hasMore === false || events.length < 200 || earliestTimestamp <= previousCutoff;
  let sales30d = 0;
  let revenue30d = 0;
  let previousSales30d = 0;
  let previousRevenue30d = 0;
  const revenueByDay = new Map<string, number>();
  const byPlatform = new Map<string, { revenue: number; sales: number }>();
  const soldItems: SoldItem[] = [];

  for (const event of events) {
    if (!isOrderEvent(event?.EventType)) continue;
    const timestamp = Date.parse(event?.Timestamp);
    if (!Number.isFinite(timestamp) || timestamp < previousCutoff) continue;
    const amount = pickAmount(event?.Details || {});
    const key = new Date(timestamp).toISOString().slice(0, 10);
    revenueByDay.set(key, (revenueByDay.get(key) || 0) + amount);

    if (timestamp >= currentCutoff) {
      sales30d += 1;
      revenue30d += amount;
      const platform = String(event?.PlatformType || event?.Details?.platform || 'other').toLowerCase();
      const aggregate = byPlatform.get(platform) || { revenue: 0, sales: 0 };
      aggregate.revenue += amount;
      aggregate.sales += 1;
      byPlatform.set(platform, aggregate);
      const soldItem = soldItemFromEvent(event, amount, timestamp);
      if (soldItem) soldItems.push(soldItem);
    } else {
      previousSales30d += 1;
      previousRevenue30d += amount;
    }
  }

  const platforms = [...byPlatform.entries()]
    .map(([name, aggregate]) => ({ name, ...aggregate }))
    .sort((a, b) => b.revenue - a.revenue || b.sales - a.sales)
    .slice(0, 5);

  return {
    sales30d,
    revenue30d: roundMoney(revenue30d),
    avgSale: sales30d > 0 ? revenue30d / sales30d : 0,
    series: continuousSeries(now, 30, 0, revenueByDay),
    previousSeries: priorWindowCovered ? continuousSeries(now, 30, 30, revenueByDay) : [],
    previousSales30d: priorWindowCovered ? previousSales30d : null,
    previousRevenue30d: priorWindowCovered ? roundMoney(previousRevenue30d) : null,
    previousAvgSale: priorWindowCovered && previousSales30d > 0 ? previousRevenue30d / previousSales30d : null,
    platforms,
    soldItems: soldItems
      .sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt))
      .slice(0, 5),
  };
};

export function useInventoryAnalytics(): AnalyticsState {
  const [state, setState] = useState<AnalyticsState>({
    loading: true,
    sales30d: 0,
    revenue30d: 0,
    avgSale: 0,
    series: [],
    previousSeries: [],
    previousSales30d: null,
    previousRevenue30d: null,
    previousAvgSale: null,
    platforms: [],
    soldItems: [],
  });

  useEffect(() => {
    let cancelled = false;
    const controllers: AbortController[] = [];
    const authed = (path: string) => {
      const controller = new AbortController();
      controllers.push(controller);
      return fetchJsonAuthed(path, controller);
    };

    const activityPromise = authed('/api/activity?limit=200')
      .then(analyticsFromActivity)
      .then((activity) => {
        if (!cancelled) setState((current) => ({ ...current, soldItems: activity.soldItems }));
        return activity;
      })
      .catch(() => null);

    (async () => {
      try {
        const summary = await authed('/api/orders/summary');
        if (!summary || typeof summary !== 'object' || !Array.isArray(summary.revenueByDay)) {
          throw new Error('unexpected summary shape');
        }
        const series = summary.revenueByDay.map((point: any) => ({
          label: dayLabel(point.date),
          revenue: roundMoney(Number(point.amount) || 0),
        }));
        const platforms: PlatformRow[] = (Array.isArray(summary.revenueByPlatform) ? summary.revenueByPlatform : [])
          .map((platform: any) => ({
            name: String(platform.platform || 'other'),
            revenue: Number(platform.amount) || 0,
            sales: 0,
          }))
          .sort((a: PlatformRow, b: PlatformRow) => b.revenue - a.revenue)
          .slice(0, 5);

        if (!cancelled) {
          setState((current) => ({
            ...current,
            loading: false,
            sales30d: Number(summary.orderCount30d) || 0,
            revenue30d: Number(summary.totalRevenue30d) || 0,
            avgSale: Number(summary.avgOrderValue30d) || 0,
            series,
            platforms,
            // The current summary contract has no comparable prior-period fields.
            previousSeries: [],
            previousSales30d: null,
            previousRevenue30d: null,
            previousAvgSale: null,
          }));
        }
      } catch (error) {
        if (cancelled) return;
        const fallback = await activityPromise;
        if (cancelled) return;
        if (fallback) setState({ ...fallback, loading: false });
        else {
          log.warn('[analytics] fetch failed:', error instanceof Error ? error.message : error);
          setState((current) => ({ ...current, loading: false }));
        }
      }
    })();

    return () => {
      cancelled = true;
      controllers.forEach((controller) => controller.abort());
    };
  }, []);

  return state;
}

function usePortfolioMetrics(): { loading: boolean; recovery: RecoverySummary | null } {
  const [state, setState] = useState<{ loading: boolean; recovery: RecoverySummary | null }>({
    loading: true,
    recovery: null,
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const data = await fetchJsonAuthed('/api/agent/analytics/portfolio', controller);
        const recovery = data?.recovery && typeof data.recovery === 'object'
          ? data.recovery as RecoverySummary
          : null;
        if (!cancelled) setState({ loading: false, recovery });
      } catch (error) {
        if (cancelled) return;
        log.warn('[portfolio] fetch failed:', error instanceof Error ? error.message : error);
        setState({ loading: false, recovery: null });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return state;
}

function useCampaignPortfolio(): { loading: boolean; campaigns: CampaignRow[] } {
  const [state, setState] = useState<{ loading: boolean; campaigns: CampaignRow[] }>({
    loading: true,
    campaigns: [],
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const data = await fetchJsonAuthed('/api/agent/sessions?type=liquidation&status=active', controller);
        const sessions: any[] = Array.isArray(data?.sessions) ? data.sessions : [];
        const now = Date.now();
        const campaigns = sessions.slice(0, 6).map((session): CampaignRow => {
          const goal = session.goal || {};
          const campaignState = session.state || {};
          const target = Number(campaignState.revenueTarget) || Number(goal.targetRevenue) || 0;
          const collected = Number(campaignState.revenueCollected) || 0;
          const progressPct = target > 0 ? Math.round((collected / target) * 100) : 0;
          const deadline = goal.deadline ? Date.parse(goal.deadline) : NaN;
          const daysLeft = Number.isFinite(deadline) ? Math.max(0, (deadline - now) / DAY_MS) : null;
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
            id: String(session.id),
            name: firstText(session.name, session.title, goal.name, goal.title, campaignState.name) || 'Campaign',
            collected,
            target,
            progressPct,
            daysLeft: daysLeft != null ? Math.floor(daysLeft) : null,
            pace,
          };
        });
        if (!cancelled) setState({ loading: false, campaigns });
      } catch (error) {
        if (cancelled) return;
        log.warn('[campaigns] fetch failed:', error instanceof Error ? error.message : error);
        setState({ loading: false, campaigns: [] });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return state;
}

const deltaPercent = (current: number, previous: number | null): number | null => {
  if (previous == null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
};

const DeltaText: React.FC<{ value: number; higherIsGood?: boolean }> = ({ value, higherIsGood = true }) => {
  const positive = value >= 0;
  const good = higherIsGood ? positive : !positive;
  return (
    <Text style={[styles.statDelta, { color: good ? DELTA_GREEN : DELTA_RED }]}>
      {positive ? '↑' : '↓'} {Math.abs(value)}%
    </Text>
  );
};

const RevenueChart: React.FC<{
  series: DayPoint[];
  previousSeries: DayPoint[];
}> = ({ series, previousSeries }) => {
  const [width, setWidth] = useState(280);
  const chartHeight = 158;
  const plotTop = 8;
  const plotBottom = 122;
  const usableWidth = Math.max(1, width);
  const previous = previousSeries.length > 1 ? previousSeries.slice(-series.length) : [];
  const allValues = [...series, ...previous].map((point) => point.revenue);
  const maxValue = Math.max(...allValues, 1);
  const yFor = (value: number) => plotBottom - (value / maxValue) * (plotBottom - plotTop);
  const pointsFor = (points: DayPoint[]): string => points
    .map((point, index) => {
      const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * usableWidth;
      return `${x},${yFor(point.revenue)}`;
    })
    .join(' ');
  const currentPoints = pointsFor(series);
  const previousPoints = pointsFor(previous);
  const fillPoints = series.length > 1
    ? `0,${plotBottom} ${currentPoints} ${usableWidth},${plotBottom}`
    : '';
  const terminal = series[series.length - 1];
  const terminalX = series.length <= 1 ? 0 : usableWidth;
  const labelIndexes = [...new Set([0, Math.round((series.length - 1) / 3), Math.round(((series.length - 1) * 2) / 3), series.length - 1])]
    .filter((index) => index >= 0);

  if (series.length < 2) {
    return <Text style={styles.chartEmpty}>Revenue history will appear here.</Text>;
  }

  return (
    <View
      style={styles.chartFrame}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <Svg width={width} height={chartHeight}>
        {fillPoints ? <Polygon points={fillPoints} fill="rgba(147,200,34,0.10)" /> : null}
        {previous.length > 1 ? (
          <Polyline
            points={previousPoints}
            fill="none"
            stroke={PREVIOUS_LINE}
            strokeWidth={1.6}
            strokeDasharray="5 5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        <Polyline
          points={currentPoints}
          fill="none"
          stroke={CHAT_COLORS.brand}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {terminal ? (
          <Circle cx={terminalX} cy={yFor(terminal.revenue)} r={3.5} fill={CHAT_COLORS.brand} />
        ) : null}
        {labelIndexes.map((index) => {
          const x = series.length <= 1 ? 0 : (index / (series.length - 1)) * usableWidth;
          const anchor = index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle';
          return (
            <SvgText
              key={`${series[index]?.label}-${index}`}
              x={x}
              y={150}
              fill={CHAT_COLORS.faint}
              fontSize={10.5}
              fontFamily={CHAT_FONT.regular}
              textAnchor={anchor}
            >
              {series[index]?.label || ''}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
};

const StatCard: React.FC<{
  label: string;
  value: string;
  delta?: number | null;
  higherIsGood?: boolean;
}> = ({ label, value, delta, higherIsGood }) => (
  <View style={styles.statCard}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{value}</Text>
    {delta != null ? <DeltaText value={delta} higherIsGood={higherIsGood} /> : null}
  </View>
);

const ReportsAnalyticsHeader: React.FC<ReportsAnalyticsHeaderProps> = ({
  activeSection,
  onSectionChange,
  showReportsHeading,
}) => {
  const analytics = useInventoryAnalytics();
  const metrics = usePortfolioMetrics();
  const campaignPortfolio = useCampaignPortfolio();
  const [timeRange, setTimeRange] = useState<TimeRange>('30D');

  // TODO: Once /api/orders/summary accepts a days parameter, refetch 90D and 1Y.
  // Until then those enabled controls intentionally retain the available series.
  const visibleSeries = useMemo(
    () => timeRange === '7D' ? analytics.series.slice(-7) : analytics.series,
    [analytics.series, timeRange],
  );
  const visiblePreviousSeries = useMemo(
    () => timeRange === '7D' ? analytics.previousSeries.slice(-7) : analytics.previousSeries,
    [analytics.previousSeries, timeRange],
  );
  const totalPlatformRevenue = useMemo(
    () => analytics.platforms.reduce((total, platform) => total + platform.revenue, 0),
    [analytics.platforms],
  );
  const revenueDelta = deltaPercent(analytics.revenue30d, analytics.previousRevenue30d);
  const salesDelta = deltaPercent(analytics.sales30d, analytics.previousSales30d);
  const avgSaleDelta = deltaPercent(analytics.avgSale, analytics.previousAvgSale);
  const showSales = activeSection === 'overview' || activeSection === 'sales';
  const showPlatforms = activeSection === 'overview' || activeSection === 'platforms';
  const showCampaigns = activeSection === 'overview' || activeSection === 'campaigns';
  const priorLineRenders = visiblePreviousSeries.length > 1;

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.segmentedTabs}
        accessibilityRole="tablist"
      >
        {([
          ['overview', 'Overview'],
          ['sales', 'Sales'],
          ['platforms', 'Platforms'],
          ['campaigns', 'Campaigns'],
          ['reports', 'Reports'],
        ] as const).map(([key, label]) => {
          const active = activeSection === key;
          return (
            <Pressable
              key={key}
              onPress={() => onSectionChange(key)}
              hitSlop={6}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.segmentTab, active ? styles.segmentTabActive : null]}
            >
              <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {showSales && !analytics.loading ? (
        <>
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Revenue</Text>
            <View style={styles.heroValueRow}>
              <Text style={styles.heroValue}>{money(analytics.revenue30d)}</Text>
              {revenueDelta != null ? (
                <View style={[
                  styles.deltaChip,
                  revenueDelta < 0 ? styles.deltaChipNegative : null,
                ]}>
                  <Icon
                    name={revenueDelta >= 0 ? 'trending-up' : 'trending-down'}
                    size={13}
                    color={revenueDelta >= 0 ? DELTA_GREEN : DELTA_RED}
                  />
                  <Text style={[
                    styles.deltaChipText,
                    revenueDelta < 0 ? styles.deltaChipTextNegative : null,
                  ]}>
                    {Math.abs(revenueDelta)}%
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.heroContext}>vs previous 30 days</Text>
            <RevenueChart series={visibleSeries} previousSeries={visiblePreviousSeries} />
            {priorLineRenders ? (
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendBar, styles.legendBarCurrent]} />
                  <Text style={styles.legendText}>This period</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendBar, styles.legendBarPrevious]} />
                  <Text style={styles.legendText}>Last period</Text>
                </View>
              </View>
            ) : null}
          </View>

          <View style={styles.timeRangeTrack}>
            {(['7D', '30D', '90D', '1Y'] as const).map((range) => {
              const active = timeRange === range;
              return (
                <Pressable
                  key={range}
                  onPress={() => setTimeRange(range)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.timeRangeSegment, active ? styles.timeRangeSegmentActive : null]}
                >
                  <Text style={[styles.timeRangeText, active ? styles.timeRangeTextActive : null]}>{range}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.statGrid}>
            <StatCard label="Sales" value={analytics.sales30d.toLocaleString()} delta={salesDelta} />
            <StatCard
              label="Avg sale"
              value={analytics.sales30d > 0 ? money(analytics.avgSale) : '—'}
              delta={avgSaleDelta}
            />
            {!metrics.loading ? (
              <StatCard
                label="Value recovered"
                value={metrics.recovery?.recoveryRatePct != null ? `${metrics.recovery.recoveryRatePct}%` : '—'}
              />
            ) : null}
            {!metrics.loading ? (
              <StatCard
                label="Time to sale"
                value={metrics.recovery?.avgDaysToSale != null ? `${metrics.recovery.avgDaysToSale} days` : '—'}
                higherIsGood={false}
              />
            ) : null}
          </View>

          {analytics.soldItems.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Top sellers</Text>
              {analytics.soldItems.map((item) => (
                <View key={item.id} style={styles.sellerRow}>
                  <View style={styles.sellerThumb}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.sellerImage} resizeMode="cover" />
                    ) : null}
                  </View>
                  <View style={styles.sellerCopy}>
                    <Text style={styles.sellerTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.sellerSub} numberOfLines={1}>
                      Sold on {platformLabel(item.platform)}
                      {item.daysToSale != null ? ` · ${item.daysToSale} days` : ''}
                    </Text>
                  </View>
                  <Text style={styles.sellerPrice}>{money(item.amount, true)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {showPlatforms && !analytics.loading ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Where it sold</Text>
          {analytics.platforms.length > 0 ? analytics.platforms.map((platform) => {
            const share = totalPlatformRevenue > 0
              ? Math.round((platform.revenue / totalPlatformRevenue) * 100)
              : 0;
            return (
              <View key={platform.name} style={styles.platformRow}>
                <View style={styles.platformLabels}>
                  <Text style={styles.platformName}>{platformLabel(platform.name)}</Text>
                  <Text style={styles.platformPercent}>{share}%</Text>
                </View>
                <View style={styles.platformTrack}>
                  <View style={[styles.platformFill, { width: `${share}%` }]} />
                </View>
              </View>
            );
          }) : (
            <Text style={styles.quietEmpty}>No platform sales yet.</Text>
          )}
        </View>
      ) : null}

      {showCampaigns && !campaignPortfolio.loading && campaignPortfolio.campaigns.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Campaigns</Text>
          <View style={styles.campaignList}>
            {campaignPortfolio.campaigns.map((campaign) => {
              const onPace = campaign.pace === 'on pace';
              return (
                <View key={campaign.id} style={styles.campaignCard}>
                  <View style={styles.campaignHeader}>
                    <Text style={styles.campaignName} numberOfLines={1}>{campaign.name}</Text>
                    <Text style={[styles.paceLabel, { color: onPace ? CHAT_COLORS.brandDeep : CHAT_COLORS.amber }]}>
                      {campaign.pace}
                    </Text>
                  </View>
                  <View style={styles.campaignTrack}>
                    <View
                      style={[
                        styles.campaignFill,
                        { width: `${Math.min(100, Math.max(0, campaign.progressPct))}%` },
                      ]}
                    />
                  </View>
                  <View style={styles.campaignFooter}>
                    <Text style={styles.campaignCollected}>
                      {money(campaign.collected)} of {money(campaign.target)}
                    </Text>
                    <Text style={styles.campaignDays}>
                      {campaign.daysLeft != null ? `${campaign.daysLeft} days left` : 'No deadline'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {showReportsHeading ? <Text style={styles.reportsHeading}>Reports</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { backgroundColor: CHAT_COLORS.white, paddingHorizontal: 4, paddingBottom: 2 },
  segmentedTabs: { gap: 3, paddingBottom: 16, paddingRight: 4 },
  segmentTab: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  segmentTabActive: { backgroundColor: CHAT_COLORS.ink },
  segmentText: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.medium, fontSize: 13 },
  segmentTextActive: { color: CHAT_COLORS.white, fontFamily: CHAT_FONT.semibold },
  heroCard: {
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    borderRadius: 16,
    padding: 16,
    backgroundColor: CHAT_COLORS.white,
  },
  heroLabel: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.medium, fontSize: 13 },
  heroValueRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 3 },
  heroValue: {
    color: CHAT_COLORS.ink,
    fontFamily: CHAT_FONT.bold,
    fontSize: 32,
    letterSpacing: -0.32,
    fontVariant: ['tabular-nums'],
  },
  heroContext: { color: CHAT_COLORS.faint, fontFamily: CHAT_FONT.regular, fontSize: 12, marginTop: 1 },
  deltaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(147,200,34,0.14)',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  deltaChipNegative: { backgroundColor: 'rgba(216,67,79,0.10)' },
  deltaChipText: { color: DELTA_GREEN, fontFamily: CHAT_FONT.bold, fontSize: 11.5 },
  deltaChipTextNegative: { color: DELTA_RED },
  chartFrame: { height: 158, marginTop: 12, overflow: 'hidden' },
  chartEmpty: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.regular, fontSize: 12, paddingVertical: 34 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 1 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendBar: { width: 14, height: 2.5, borderRadius: 999 },
  legendBarCurrent: { backgroundColor: CHAT_COLORS.brand },
  legendBarPrevious: { backgroundColor: PREVIOUS_LINE },
  legendText: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.medium, fontSize: 11 },
  timeRangeTrack: {
    flexDirection: 'row',
    borderRadius: 999,
    backgroundColor: CHAT_COLORS.surface,
    padding: 4,
    marginTop: 12,
  },
  timeRangeSegment: { flex: 1, alignItems: 'center', borderRadius: 999, paddingVertical: 7, borderWidth: 1, borderColor: 'transparent' },
  timeRangeSegmentActive: { backgroundColor: CHAT_COLORS.white, borderColor: CHAT_COLORS.border },
  timeRangeText: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.medium, fontSize: 12.5 },
  timeRangeTextActive: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 84,
    borderRadius: 14,
    backgroundColor: CHAT_COLORS.surface,
    padding: 13,
  },
  statLabel: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.medium, fontSize: 12 },
  statValue: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold, fontSize: 21, marginTop: 5, fontVariant: ['tabular-nums'] },
  statDelta: { fontFamily: CHAT_FONT.semibold, fontSize: 11, marginTop: 3 },
  section: { marginTop: 24 },
  sectionHeading: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold, fontSize: 16, marginBottom: 12 },
  platformRow: { marginBottom: 13 },
  platformLabels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  platformName: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.medium, fontSize: 13.5 },
  platformPercent: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold, fontSize: 13, fontVariant: ['tabular-nums'] },
  platformTrack: { height: 5, borderRadius: 999, backgroundColor: '#F1F2F4', overflow: 'hidden' },
  platformFill: { height: 5, borderRadius: 999, backgroundColor: CHAT_COLORS.brand },
  quietEmpty: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.regular, fontSize: 13 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 54, marginBottom: 10 },
  sellerThumb: { width: 42, height: 42, borderRadius: 10, backgroundColor: '#E9E9E5', overflow: 'hidden' },
  sellerImage: { width: 42, height: 42 },
  sellerCopy: { flex: 1, minWidth: 0, marginLeft: 11, marginRight: 10 },
  sellerTitle: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold, fontSize: 14 },
  sellerSub: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.regular, fontSize: 12, marginTop: 3 },
  sellerPrice: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold, fontSize: 13.5, fontVariant: ['tabular-nums'] },
  campaignList: { gap: 10 },
  campaignCard: { borderWidth: 1, borderColor: CHAT_COLORS.border, borderRadius: 14, padding: 14, backgroundColor: CHAT_COLORS.white },
  campaignHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campaignName: { flex: 1, color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold, fontSize: 14 },
  paceLabel: { fontFamily: CHAT_FONT.semibold, fontSize: 11.5, textTransform: 'capitalize' },
  campaignTrack: { height: 4, borderRadius: 999, backgroundColor: CHAT_COLORS.surfaceAlt, overflow: 'hidden', marginTop: 12 },
  campaignFill: { height: 4, borderRadius: 999, backgroundColor: CHAT_COLORS.brand },
  campaignFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 9 },
  campaignCollected: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.regular, fontSize: 12 },
  campaignDays: { color: CHAT_COLORS.faint, fontFamily: CHAT_FONT.regular, fontSize: 12 },
  reportsHeading: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold, fontSize: 16, marginTop: 24, marginBottom: 2 },
});

export default ReportsAnalyticsHeader;
