import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { API_BASE_URL } from '../../config/env';
import { ensureSupabaseJwt } from '../../lib/supabase';

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

interface AnalyticsState {
  loading: boolean;
  sales30d: number;
  revenue30d: number;
  avgSale: number;
  series: DayPoint[];
}

export function useInventoryAnalytics(): AnalyticsState {
  const [state, setState] = useState<AnalyticsState>({
    loading: true, sales30d: 0, revenue30d: 0, avgSale: 0, series: [],
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await ensureSupabaseJwt();
        if (!token) throw new Error('no token');
        const res = await fetch(`${API_BASE_URL}/api/activity?limit=200`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const events: any[] = Array.isArray(data?.events) ? data.events : [];
        const now = Date.now();
        const cutoff30 = now - 30 * 86400000;
        const cutoff14 = now - 14 * 86400000;

        let sales = 0;
        let revenue = 0;
        const byDay = new Map<string, number>();
        for (const e of events) {
          if (!isOrderEvent(e.EventType)) continue;
          const t = Date.parse(e.Timestamp);
          if (!Number.isFinite(t) || t < cutoff30) continue;
          const amount = pickAmount(e.Details || {});
          sales += 1;
          revenue += amount;
          if (t >= cutoff14) {
            const day = new Date(t).toISOString().slice(0, 10);
            byDay.set(day, (byDay.get(day) || 0) + amount);
          }
        }

        // Continuous last-14-days series (zero-filled) so the line reads as a
        // timeline, not a scatter of only the days that had sales.
        const series: DayPoint[] = [];
        for (let i = 13; i >= 0; i--) {
          const d = new Date(now - i * 86400000);
          const key = d.toISOString().slice(0, 10);
          series.push({
            label: `${d.getMonth() + 1}/${d.getDate()}`,
            revenue: Math.round((byDay.get(key) || 0) * 100) / 100,
          });
        }

        if (!cancelled) {
          setState({
            loading: false,
            sales30d: sales,
            revenue30d: revenue,
            avgSale: sales > 0 ? revenue / sales : 0,
            series,
          });
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}

const ReportsAnalyticsHeader: React.FC = () => {
  const { loading, sales30d, revenue30d, avgSale, series } = useInventoryAnalytics();

  const hasRevenue = useMemo(() => series.some((p) => p.revenue > 0), [series]);
  const chartWidth = Dimensions.get('window').width - 48;

  // Sparse x labels: first, middle, last — the axis stays recessive.
  const labels = useMemo(
    () => series.map((p, i) => (i === 0 || i === Math.floor(series.length / 2) || i === series.length - 1 ? p.label : '')),
    [series],
  );

  if (loading) return null;

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
  sectionLabel: { fontSize: 13, fontFamily: FONT.semibold, color: DIM, marginTop: 10, marginBottom: 2, paddingHorizontal: 2 },
});

export default ReportsAnalyticsHeader;
