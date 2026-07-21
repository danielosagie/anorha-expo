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

interface SalesDayPoint {
  label: string;
  sales: number;
}

interface WeekdayPoint {
  label: string;
  sales: number;
}

interface PlatformRow {
  name: string;
  revenue: number;
  sales: number | null;
}

interface PlatformActivityRow {
  name: string;
  revenue: number;
  sales: number;
  series: DayPoint[];
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
  collected: number | null;
  target: number | null;
  progressPct: number | null;
  daysLeft: number | null;
  pace: 'on pace' | 'behind' | 'final hours' | 'no deadline';
  listedCount: number | null;
  soldCount: number | null;
}

interface AnalyticsState {
  loading: boolean;
  available: boolean;
  sales30d: number;
  revenue30d: number;
  avgSale: number;
  series: DayPoint[];
  previousSeries: DayPoint[];
  salesSeries: SalesDayPoint[];
  previousSalesSeries: SalesDayPoint[];
  weekdaySales: WeekdayPoint[];
  previousSales30d: number | null;
  previousRevenue30d: number | null;
  previousAvgSale: number | null;
  platforms: PlatformRow[];
  platformActivity: PlatformActivityRow[];
  soldItems: SoldItem[];
  activityLoading: boolean;
  activityAvailable: boolean;
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

const firstFiniteNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
    if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
};

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

const continuousSalesSeries = (
  now: number,
  days: number,
  offsetDays: number,
  salesByDay: Map<string, number>,
): SalesDayPoint[] => {
  const points: SalesDayPoint[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now - (index + offsetDays) * DAY_MS);
    const key = date.toISOString().slice(0, 10);
    points.push({ label: dayLabel(key), sales: salesByDay.get(key) || 0 });
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
  const salesByDay = new Map<string, number>();
  const byPlatform = new Map<string, { revenue: number; sales: number }>();
  const revenueByPlatformDay = new Map<string, Map<string, number>>();
  const weekdaySales = [0, 0, 0, 0, 0, 0, 0];
  const soldItems: SoldItem[] = [];

  for (const event of events) {
    if (!isOrderEvent(event?.EventType)) continue;
    const timestamp = Date.parse(event?.Timestamp);
    if (!Number.isFinite(timestamp) || timestamp < previousCutoff) continue;
    const amount = pickAmount(event?.Details || {});
    const key = new Date(timestamp).toISOString().slice(0, 10);
    revenueByDay.set(key, (revenueByDay.get(key) || 0) + amount);
    salesByDay.set(key, (salesByDay.get(key) || 0) + 1);

    if (timestamp >= currentCutoff) {
      sales30d += 1;
      revenue30d += amount;
      const platform = String(event?.PlatformType || event?.Details?.platform || 'other').toLowerCase();
      const aggregate = byPlatform.get(platform) || { revenue: 0, sales: 0 };
      aggregate.revenue += amount;
      aggregate.sales += 1;
      byPlatform.set(platform, aggregate);
      const platformByDay = revenueByPlatformDay.get(platform) || new Map<string, number>();
      platformByDay.set(key, (platformByDay.get(key) || 0) + amount);
      revenueByPlatformDay.set(platform, platformByDay);
      weekdaySales[new Date(timestamp).getDay()] += 1;
      const soldItem = soldItemFromEvent(event, amount, timestamp);
      if (soldItem) soldItems.push(soldItem);
    } else {
      previousSales30d += 1;
      previousRevenue30d += amount;
    }
  }

  const platforms = [...byPlatform.entries()]
    .map(([name, aggregate]) => ({ name, ...aggregate }))
    .sort((a, b) => b.revenue - a.revenue || b.sales - a.sales);
  const platformActivity = platforms.map((platform) => ({
    ...platform,
    series: continuousSeries(now, 30, 0, revenueByPlatformDay.get(platform.name) || new Map()),
  }));
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return {
    available: true,
    activityLoading: false,
    activityAvailable: true,
    sales30d,
    revenue30d: roundMoney(revenue30d),
    avgSale: sales30d > 0 ? revenue30d / sales30d : 0,
    series: continuousSeries(now, 30, 0, revenueByDay),
    previousSeries: priorWindowCovered ? continuousSeries(now, 30, 30, revenueByDay) : [],
    salesSeries: continuousSalesSeries(now, 30, 0, salesByDay),
    previousSalesSeries: priorWindowCovered ? continuousSalesSeries(now, 30, 30, salesByDay) : [],
    weekdaySales: weekdayLabels.map((label, index) => ({ label, sales: weekdaySales[index] })),
    previousSales30d: priorWindowCovered ? previousSales30d : null,
    previousRevenue30d: priorWindowCovered ? roundMoney(previousRevenue30d) : null,
    previousAvgSale: priorWindowCovered && previousSales30d > 0 ? previousRevenue30d / previousSales30d : null,
    platforms,
    platformActivity,
    soldItems: soldItems
      .sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt)),
  };
};

export function useInventoryAnalytics(): AnalyticsState {
  const [state, setState] = useState<AnalyticsState>({
    loading: true,
    available: false,
    sales30d: 0,
    revenue30d: 0,
    avgSale: 0,
    series: [],
    previousSeries: [],
    salesSeries: [],
    previousSalesSeries: [],
    weekdaySales: [],
    previousSales30d: null,
    previousRevenue30d: null,
    previousAvgSale: null,
    platforms: [],
    platformActivity: [],
    soldItems: [],
    activityLoading: true,
    activityAvailable: false,
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
        if (!cancelled) {
          setState((current) => ({
            ...current,
            activityLoading: false,
            activityAvailable: true,
            salesSeries: activity.salesSeries,
            previousSalesSeries: activity.previousSalesSeries,
            weekdaySales: activity.weekdaySales,
            platformActivity: activity.platformActivity,
            soldItems: activity.soldItems,
          }));
        }
        return activity;
      })
      .catch(() => {
        if (!cancelled) setState((current) => ({ ...current, activityLoading: false }));
        return null;
      });

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
            sales: null,
          }))
          .sort((a: PlatformRow, b: PlatformRow) => b.revenue - a.revenue);

        if (!cancelled) {
          setState((current) => ({
            ...current,
            loading: false,
            available: true,
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

function useCampaignPortfolio(): { loading: boolean; available: boolean; campaigns: CampaignRow[] } {
  const [state, setState] = useState<{ loading: boolean; available: boolean; campaigns: CampaignRow[] }>({
    loading: true,
    available: false,
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
        const campaigns = sessions.map((session): CampaignRow => {
          const goal = session.goal || {};
          const campaignState = session.state || {};
          const stats = session.stats || campaignState.stats || {};
          const target = firstFiniteNumber(
            campaignState.revenueTarget,
            session.target,
            goal.targetRevenue,
          );
          const collected = firstFiniteNumber(
            campaignState.revenueCollected,
            session.collected,
            session.raised,
          );
          const suppliedProgress = firstFiniteNumber(campaignState.progressPct, session.progressPct);
          const progressPct = suppliedProgress
            ?? (target != null && target > 0 && collected != null ? Math.round((collected / target) * 100) : null);
          const deadlineValue = firstText(goal.deadline, campaignState.deadline, session.deadline);
          const deadline = deadlineValue ? Date.parse(deadlineValue) : NaN;
          const suppliedDaysLeft = firstFiniteNumber(session.daysLeft, campaignState.daysLeft);
          const daysLeft = suppliedDaysLeft ?? (Number.isFinite(deadline) ? Math.max(0, (deadline - now) / DAY_MS) : null);
          const totalDays = firstFiniteNumber(goal.timeframeDays, session.timeframeDays) || 0;
          const suppliedPace = firstText(session.pace, campaignState.pace)?.toLowerCase();
          let pace: CampaignRow['pace'] = suppliedPace === 'on pace'
            || suppliedPace === 'behind'
            || suppliedPace === 'final hours'
            || suppliedPace === 'no deadline'
            ? suppliedPace
            : 'no deadline';
          if (!suppliedPace && daysLeft != null && totalDays > 0 && progressPct != null) {
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
            listedCount: firstFiniteNumber(
              stats.listedCount,
              campaignState.listedCount,
              session.listedCount,
              stats.totalCount,
            ),
            soldCount: firstFiniteNumber(stats.soldCount, campaignState.soldCount, session.soldCount),
          };
        });
        if (!cancelled) setState({ loading: false, available: true, campaigns });
      } catch (error) {
        if (cancelled) return;
        log.warn('[campaigns] fetch failed:', error instanceof Error ? error.message : error);
        setState({ loading: false, available: false, campaigns: [] });
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

interface MetricPoint {
  label: string;
  value: number;
}

const MetricLineChart: React.FC<{
  series: MetricPoint[];
  previousSeries?: MetricPoint[];
  compact?: boolean;
  emptyMessage: string;
}> = ({ series, previousSeries = [], compact = false, emptyMessage }) => {
  const [width, setWidth] = useState(280);
  const chartHeight = compact ? 46 : 158;
  const plotTop = compact ? 3 : 8;
  const plotBottom = compact ? 43 : 122;
  const usableWidth = Math.max(1, width);
  const previous = previousSeries.length > 1 ? previousSeries.slice(-series.length) : [];
  const allValues = [...series, ...previous].map((point) => point.value);
  const maxValue = Math.max(...allValues, 1);
  const yFor = (value: number) => plotBottom - (value / maxValue) * (plotBottom - plotTop);
  const pointsFor = (points: MetricPoint[]): string => points
    .map((point, index) => {
      const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * usableWidth;
      return `${x},${yFor(point.value)}`;
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
    return <Text style={styles.chartEmpty}>{emptyMessage}</Text>;
  }

  return (
    <View
      style={compact ? styles.sparklineFrame : styles.chartFrame}
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
          <Circle cx={terminalX} cy={yFor(terminal.value)} r={compact ? 2.5 : 3.5} fill={CHAT_COLORS.brand} />
        ) : null}
        {!compact ? labelIndexes.map((index) => {
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
        }) : null}
      </Svg>
    </View>
  );
};

const RevenueChart: React.FC<{
  series: DayPoint[];
  previousSeries: DayPoint[];
}> = ({ series, previousSeries }) => (
  <MetricLineChart
    series={series.map((point) => ({ label: point.label, value: point.revenue }))}
    previousSeries={previousSeries.map((point) => ({ label: point.label, value: point.revenue }))}
    emptyMessage="Revenue history will appear here."
  />
);

const SalesChart: React.FC<{
  series: SalesDayPoint[];
  previousSeries: SalesDayPoint[];
}> = ({ series, previousSeries }) => (
  <MetricLineChart
    series={series.map((point) => ({ label: point.label, value: point.sales }))}
    previousSeries={previousSeries.map((point) => ({ label: point.label, value: point.sales }))}
    emptyMessage="No daily sales yet."
  />
);

const ChartLegend: React.FC = () => (
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
);

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

const DeltaChip: React.FC<{ value: number }> = ({ value }) => (
  <View style={[styles.deltaChip, value < 0 ? styles.deltaChipNegative : null]}>
    <Icon
      name={value >= 0 ? 'trending-up' : 'trending-down'}
      size={13}
      color={value >= 0 ? DELTA_GREEN : DELTA_RED}
    />
    <Text style={[styles.deltaChipText, value < 0 ? styles.deltaChipTextNegative : null]}>
      {Math.abs(value)}%
    </Text>
  </View>
);

const TimeRangeControl: React.FC<{
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}> = ({ value, onChange }) => (
  <View style={styles.timeRangeTrack}>
    {(['7D', '30D', '90D', '1Y'] as const).map((range) => {
      const active = value === range;
      return (
        <Pressable
          key={range}
          onPress={() => onChange(range)}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          style={[styles.timeRangeSegment, active ? styles.timeRangeSegmentActive : null]}
        >
          <Text style={[styles.timeRangeText, active ? styles.timeRangeTextActive : null]}>{range}</Text>
        </Pressable>
      );
    })}
  </View>
);

const SellerRows: React.FC<{ items: SoldItem[] }> = ({ items }) => (
  <>
    {items.map((item) => (
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
  </>
);

const CampaignCards: React.FC<{ campaigns: CampaignRow[]; detailed?: boolean }> = ({
  campaigns,
  detailed = false,
}) => (
  <View style={styles.campaignList}>
    {campaigns.map((campaign) => {
      const onPace = campaign.pace === 'on pace';
      return (
        <View key={campaign.id} style={styles.campaignCard}>
          <View style={styles.campaignHeader}>
            <Text style={styles.campaignName} numberOfLines={1}>{campaign.name}</Text>
            <Text style={[styles.paceLabel, { color: onPace ? CHAT_COLORS.brandDeep : CHAT_COLORS.amber }]}>
              {campaign.pace}
            </Text>
          </View>
          {detailed && (campaign.listedCount != null || campaign.soldCount != null) ? (
            <View style={styles.campaignCounts}>
              {campaign.listedCount != null ? (
                <Text style={styles.campaignCount}><Text style={styles.campaignCountValue}>{campaign.listedCount}</Text> listed</Text>
              ) : null}
              {campaign.soldCount != null ? (
                <Text style={styles.campaignCount}><Text style={styles.campaignCountValue}>{campaign.soldCount}</Text> sold</Text>
              ) : null}
            </View>
          ) : null}
          {campaign.progressPct != null ? (
            <View style={styles.campaignTrack}>
              <View
                style={[
                  styles.campaignFill,
                  { width: `${Math.min(100, Math.max(0, campaign.progressPct))}%` },
                ]}
              />
            </View>
          ) : null}
          <View style={styles.campaignFooter}>
            {campaign.collected != null && campaign.target != null ? (
              <Text style={styles.campaignCollected}>
                {money(campaign.collected)} of {money(campaign.target)}
              </Text>
            ) : <View />}
            <Text style={styles.campaignDays}>
              {campaign.daysLeft != null ? `${campaign.daysLeft} days left` : 'No deadline'}
            </Text>
          </View>
        </View>
      );
    })}
  </View>
);

const WeekdaySalesChart: React.FC<{ points: WeekdayPoint[] }> = ({ points }) => {
  const maxSales = Math.max(...points.map((point) => point.sales), 0);
  const maxIndex = points.findIndex((point) => point.sales === maxSales);
  if (maxSales <= 0) return <Text style={styles.quietEmpty}>No weekday sales yet.</Text>;

  return (
    <View style={styles.weekdayChart}>
      {points.map((point, index) => {
        const height = Math.max(5, Math.round((point.sales / maxSales) * 72));
        const highlighted = index === maxIndex;
        return (
          <View key={point.label} style={styles.weekdayColumn}>
            <Text style={styles.weekdayValue}>{point.sales || ''}</Text>
            <View
              style={[
                styles.weekdayBar,
                highlighted ? styles.weekdayBarActive : null,
                { height },
              ]}
            />
            <Text style={[styles.weekdayLabel, highlighted ? styles.weekdayLabelActive : null]}>{point.label}</Text>
          </View>
        );
      })}
    </View>
  );
};

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
    () => timeRange === '7D' ? analytics.series.slice(-14, -7) : analytics.previousSeries,
    [analytics.previousSeries, analytics.series, timeRange],
  );
  const visibleSalesSeries = useMemo(
    () => timeRange === '7D' ? analytics.salesSeries.slice(-7) : analytics.salesSeries,
    [analytics.salesSeries, timeRange],
  );
  const visiblePreviousSalesSeries = useMemo(
    () => timeRange === '7D' ? analytics.salesSeries.slice(-14, -7) : analytics.previousSalesSeries,
    [analytics.previousSalesSeries, analytics.salesSeries, timeRange],
  );
  const totalPlatformRevenue = useMemo(
    () => analytics.platforms.reduce((total, platform) => total + platform.revenue, 0),
    [analytics.platforms],
  );
  const platformDetails = useMemo(() => {
    const activityByName = new Map(
      analytics.platformActivity.map((platform) => [platform.name.toLowerCase(), platform]),
    );
    const rows = analytics.platforms.map((platform) => {
      const key = platform.name.toLowerCase();
      const activity = activityByName.get(key);
      activityByName.delete(key);
      return {
        name: platform.name,
        revenue: platform.revenue,
        sales: activity?.sales ?? platform.sales,
        series: activity?.series || [],
      };
    });
    activityByName.forEach((activity) => rows.push(activity));
    return rows.sort((a, b) => b.revenue - a.revenue || (b.sales || 0) - (a.sales || 0));
  }, [analytics.platformActivity, analytics.platforms]);
  const totalDeepPlatformRevenue = useMemo(
    () => platformDetails.reduce((total, platform) => total + platform.revenue, 0),
    [platformDetails],
  );
  const revenueDelta = deltaPercent(analytics.revenue30d, analytics.previousRevenue30d);
  const salesDelta = deltaPercent(analytics.sales30d, analytics.previousSales30d);
  const avgSaleDelta = deltaPercent(analytics.avgSale, analytics.previousAvgSale);
  const isOverview = activeSection === 'overview';
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

      {isOverview && !analytics.loading && analytics.available ? (
        <>
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Revenue</Text>
            <View style={styles.heroValueRow}>
              <Text style={styles.heroValue}>{money(analytics.revenue30d)}</Text>
              {revenueDelta != null ? <DeltaChip value={revenueDelta} /> : null}
            </View>
            <Text style={styles.heroContext}>vs previous 30 days</Text>
            <RevenueChart series={visibleSeries} previousSeries={visiblePreviousSeries} />
            {priorLineRenders ? <ChartLegend /> : null}
          </View>

          <TimeRangeControl value={timeRange} onChange={setTimeRange} />

          <View style={styles.statGrid}>
            <StatCard label="Sales" value={analytics.sales30d.toLocaleString()} delta={salesDelta} />
            <StatCard
              label="Avg sale"
              value={analytics.sales30d > 0 ? money(analytics.avgSale) : 'N/A'}
              delta={avgSaleDelta}
            />
            {!metrics.loading ? (
              <StatCard
                label="Value recovered"
                value={metrics.recovery?.recoveryRatePct != null ? `${metrics.recovery.recoveryRatePct}%` : 'N/A'}
              />
            ) : null}
            {!metrics.loading ? (
              <StatCard
                label="Time to sale"
                value={metrics.recovery?.avgDaysToSale != null ? `${metrics.recovery.avgDaysToSale} days` : 'N/A'}
                higherIsGood={false}
              />
            ) : null}
          </View>

          {analytics.soldItems.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Top sellers</Text>
              <SellerRows items={analytics.soldItems.slice(0, 5)} />
            </View>
          ) : null}
        </>
      ) : null}

      {isOverview && !analytics.loading && analytics.available ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Where it sold</Text>
          {analytics.platforms.length > 0 ? analytics.platforms.slice(0, 5).map((platform) => {
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

      {isOverview && !campaignPortfolio.loading && campaignPortfolio.available && campaignPortfolio.campaigns.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Campaigns</Text>
          <CampaignCards campaigns={campaignPortfolio.campaigns} />
        </View>
      ) : null}

      {activeSection === 'sales' ? (
        <>
          {!analytics.loading && analytics.available ? (
            <>
              <View style={styles.heroCard}>
                <Text style={styles.heroLabel}>Sales</Text>
                <View style={styles.heroValueRow}>
                  <Text style={styles.heroValue}>{analytics.sales30d.toLocaleString()}</Text>
                  {salesDelta != null ? <DeltaChip value={salesDelta} /> : null}
                </View>
                <Text style={styles.heroContext}>
                  {salesDelta != null ? 'vs previous 30 days' : 'Last 30 days'}
                </Text>
                {!analytics.activityLoading ? (
                  visibleSalesSeries.some((point) => point.sales > 0) ? (
                    <>
                      <SalesChart series={visibleSalesSeries} previousSeries={visiblePreviousSalesSeries} />
                      {visiblePreviousSalesSeries.length > 1 ? <ChartLegend /> : null}
                    </>
                  ) : (
                    <Text style={styles.chartEmpty}>No daily sales yet.</Text>
                  )
                ) : null}
              </View>
              <TimeRangeControl value={timeRange} onChange={setTimeRange} />
              <View style={styles.deepStatRow}>
                <View style={styles.deepStatCard}>
                  <Text style={styles.statLabel}>Avg sale</Text>
                  <Text style={styles.deepStatValue}>{analytics.sales30d > 0 ? money(analytics.avgSale) : 'N/A'}</Text>
                </View>
                <View style={styles.deepStatCard}>
                  <Text style={styles.statLabel}>Revenue</Text>
                  <Text style={styles.deepStatValue}>{money(analytics.revenue30d)}</Text>
                </View>
                {!metrics.loading && metrics.recovery?.soldCount != null ? (
                  <View style={styles.deepStatCard}>
                    <Text style={styles.statLabel}>Items sold</Text>
                    <Text style={styles.deepStatValue}>{metrics.recovery.soldCount.toLocaleString()}</Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : null}

          {!analytics.activityLoading && analytics.activityAvailable ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>By day of week</Text>
              <WeekdaySalesChart points={analytics.weekdaySales} />
            </View>
          ) : null}

          {!analytics.activityLoading && analytics.activityAvailable ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Top sellers</Text>
              {analytics.soldItems.length > 0 ? (
                <SellerRows items={analytics.soldItems} />
              ) : (
                <Text style={styles.quietEmpty}>No seller details yet.</Text>
              )}
            </View>
          ) : null}

          {!analytics.loading && !analytics.available && !analytics.activityLoading && !analytics.activityAvailable ? (
            <Text style={styles.quietEmpty}>Sales analytics could not load.</Text>
          ) : null}
        </>
      ) : null}

      {activeSection === 'platforms' ? (
        <View style={styles.deepPageSection}>
          <Text style={styles.sectionHeading}>Platform performance</Text>
          {platformDetails.length > 0 ? platformDetails.map((platform) => {
            const share = totalDeepPlatformRevenue > 0
              ? Math.round((platform.revenue / totalDeepPlatformRevenue) * 100)
              : 0;
            const hasTimeline = platform.series.some((point) => point.revenue > 0);
            return (
              <View key={platform.name} style={styles.platformCard}>
                <Text style={styles.platformCardName}>{platformLabel(platform.name)}</Text>
                <View style={styles.platformMetricRow}>
                  <View>
                    <Text style={styles.platformRevenue}>{money(platform.revenue)}</Text>
                    <Text style={styles.platformMetricLabel}>Revenue</Text>
                  </View>
                  {platform.sales != null ? (
                    <View style={styles.platformSalesBlock}>
                      <Text style={styles.platformSales}>{platform.sales.toLocaleString()}</Text>
                      <Text style={styles.platformMetricLabel}>Sales</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.platformShareLabels}>
                  <Text style={styles.platformMetricLabel}>Share of revenue</Text>
                  <Text style={styles.platformShare}>{share}%</Text>
                </View>
                <View style={styles.platformTrack}>
                  <View style={[styles.platformFill, { width: `${share}%` }]} />
                </View>
                {hasTimeline ? (
                  <MetricLineChart
                    compact
                    series={platform.series.map((point) => ({ label: point.label, value: point.revenue }))}
                    emptyMessage=""
                  />
                ) : null}
              </View>
            );
          }) : !analytics.loading && !analytics.activityLoading ? (
            <Text style={styles.quietEmpty}>
              {analytics.available || analytics.activityAvailable
                ? 'No platform sales yet.'
                : 'Platform analytics could not load.'}
            </Text>
          ) : null}
        </View>
      ) : null}

      {activeSection === 'campaigns' && !campaignPortfolio.loading ? (
        <View style={styles.deepPageSection}>
          <Text style={styles.sectionHeading}>Active campaigns</Text>
          {campaignPortfolio.available && campaignPortfolio.campaigns.length > 0 ? (
            <CampaignCards campaigns={campaignPortfolio.campaigns} detailed />
          ) : !campaignPortfolio.available ? (
            <Text style={styles.quietEmpty}>Campaigns could not load.</Text>
          ) : (
            <Text style={styles.quietEmpty}>No campaigns running</Text>
          )}
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
  sparklineFrame: { height: 46, marginTop: 13, overflow: 'hidden' },
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
  deepStatRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  deepStatCard: { flex: 1, minWidth: 0, borderRadius: 14, backgroundColor: CHAT_COLORS.surface, padding: 12 },
  deepStatValue: {
    color: CHAT_COLORS.ink,
    fontFamily: CHAT_FONT.bold,
    fontSize: 18,
    marginTop: 5,
    fontVariant: ['tabular-nums'],
  },
  section: { marginTop: 24 },
  deepPageSection: { marginTop: 2 },
  sectionHeading: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold, fontSize: 16, marginBottom: 12 },
  platformRow: { marginBottom: 13 },
  platformLabels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  platformName: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.medium, fontSize: 13.5 },
  platformPercent: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold, fontSize: 13, fontVariant: ['tabular-nums'] },
  platformTrack: { height: 5, borderRadius: 999, backgroundColor: '#F1F2F4', overflow: 'hidden' },
  platformFill: { height: 5, borderRadius: 999, backgroundColor: CHAT_COLORS.brand },
  platformCard: {
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    borderRadius: 16,
    backgroundColor: CHAT_COLORS.white,
    padding: 15,
    marginBottom: 10,
  },
  platformCardName: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold, fontSize: 14 },
  platformMetricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 },
  platformRevenue: {
    color: CHAT_COLORS.ink,
    fontFamily: CHAT_FONT.bold,
    fontSize: 27,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  platformSalesBlock: { alignItems: 'flex-end', paddingBottom: 2 },
  platformSales: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold, fontSize: 18, fontVariant: ['tabular-nums'] },
  platformMetricLabel: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.regular, fontSize: 11.5, marginTop: 2 },
  platformShareLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15, marginBottom: 7 },
  platformShare: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold, fontSize: 12, fontVariant: ['tabular-nums'] },
  quietEmpty: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.regular, fontSize: 13 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', minHeight: 54, marginBottom: 10 },
  sellerThumb: { width: 42, height: 42, borderRadius: 10, backgroundColor: '#E9E9E5', overflow: 'hidden' },
  sellerImage: { width: 42, height: 42 },
  sellerCopy: { flex: 1, minWidth: 0, marginLeft: 11, marginRight: 10 },
  sellerTitle: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold, fontSize: 14 },
  sellerSub: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.regular, fontSize: 12, marginTop: 3 },
  sellerPrice: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold, fontSize: 13.5, fontVariant: ['tabular-nums'] },
  weekdayChart: { flexDirection: 'row', alignItems: 'flex-end', height: 112, gap: 7 },
  weekdayColumn: { flex: 1, height: 112, alignItems: 'center', justifyContent: 'flex-end' },
  weekdayValue: { color: CHAT_COLORS.faint, fontFamily: CHAT_FONT.medium, fontSize: 10, marginBottom: 4, fontVariant: ['tabular-nums'] },
  weekdayBar: { width: '72%', minWidth: 9, borderRadius: 5, backgroundColor: CHAT_COLORS.border },
  weekdayBarActive: { backgroundColor: CHAT_COLORS.brand },
  weekdayLabel: { color: CHAT_COLORS.faint, fontFamily: CHAT_FONT.medium, fontSize: 10.5, marginTop: 6 },
  weekdayLabelActive: { color: CHAT_COLORS.brandDeep, fontFamily: CHAT_FONT.semibold },
  campaignList: { gap: 10 },
  campaignCard: { borderWidth: 1, borderColor: CHAT_COLORS.border, borderRadius: 14, padding: 14, backgroundColor: CHAT_COLORS.white },
  campaignHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  campaignName: { flex: 1, color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold, fontSize: 14 },
  paceLabel: { fontFamily: CHAT_FONT.semibold, fontSize: 11.5, textTransform: 'capitalize' },
  campaignCounts: { flexDirection: 'row', gap: 16, marginTop: 10 },
  campaignCount: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.regular, fontSize: 12 },
  campaignCountValue: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold, fontVariant: ['tabular-nums'] },
  campaignTrack: { height: 4, borderRadius: 999, backgroundColor: CHAT_COLORS.surfaceAlt, overflow: 'hidden', marginTop: 12 },
  campaignFill: { height: 4, borderRadius: 999, backgroundColor: CHAT_COLORS.brand },
  campaignFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 9 },
  campaignCollected: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.regular, fontSize: 12 },
  campaignDays: { color: CHAT_COLORS.faint, fontFamily: CHAT_FONT.regular, fontSize: 12 },
  reportsHeading: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold, fontSize: 16, marginTop: 24, marginBottom: 2 },
});

export default ReportsAnalyticsHeader;
