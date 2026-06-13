// PriceHistorySlider — the 90-day sold-comp median sparkline for PricingGuidanceCard.
// Stateless except a local range toggle; styled from the card's tokens so it reads
// as one family (no new colors / sizes).

import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Polyline, Polygon, Circle } from 'react-native-svg';

const GREEN = '#93C822';
const LABEL = '#8E8E93';
const TEXT = '#0A0A0B';

export type HistoryPoint = { date: string; median: number; low?: number; high?: number; sampleCount?: number };

const money = (n?: number | null) => (typeof n === 'number' && isFinite(n) ? `$${Math.round(n)}` : '—');

const RANGES = [
  { k: '1M', days: 30 },
  { k: '3M', days: 90 },
] as const;

export const PriceHistorySlider: React.FC<{ dataPoints?: HistoryPoint[] }> = ({ dataPoints }) => {
  const [rangeDays, setRangeDays] = useState(90);
  const [width, setWidth] = useState(0);

  const sorted = useMemo(
    () =>
      [...(dataPoints || [])]
        .filter((d) => Number.isFinite(d?.median))
        .sort((a, b) => +new Date(a.date) - +new Date(b.date)),
    [dataPoints],
  );

  const points = useMemo(() => {
    const cutoff = Date.now() - rangeDays * 86400000;
    const within = sorted.filter((d) => +new Date(d.date) >= cutoff);
    return within.length >= 2 ? within : sorted; // never go empty if the range is sparse
  }, [sorted, rangeDays]);

  if (points.length < 2) return null;

  const H = 64;
  const PAD = 6;
  const W = width > 0 ? width : 0;

  const vals = points.map((p) => p.median);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = Math.max(1, maxV - minV);
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - minV) / range) * (H - 2 * PAD);

  const poly = W > 0 ? points.map((p, i) => `${x(i)},${y(p.median)}`).join(' ') : '';
  const area = W > 0 ? `${PAD},${H - PAD} ${poly} ${W - PAD},${H - PAD}` : '';
  const last = points[points.length - 1];

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w && w !== width) setWidth(w);
  };

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <View style={styles.header}>
        <Text style={styles.kicker}>90-DAY HISTORY</Text>
        <View style={{ flex: 1 }} />
        {RANGES.map((r) => {
          const on = rangeDays === r.days;
          return (
            <TouchableOpacity
              key={r.k}
              onPress={() => setRangeDays(r.days)}
              style={[styles.rangeChip, on && styles.rangeChipOn]}
              activeOpacity={0.7}
            >
              <Text style={[styles.rangeText, on && styles.rangeTextOn]}>{r.k}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {W > 0 ? (
        <Svg width={W} height={H}>
          <Polygon points={area} fill="rgba(147,200,34,0.12)" />
          <Polyline points={poly} fill="none" stroke={GREEN} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={x(points.length - 1)} cy={y(last.median)} r={3.5} fill={GREEN} />
        </Svg>
      ) : (
        <View style={{ height: H }} />
      )}

      <View style={styles.labels}>
        <Text style={styles.label}>{money(minV)}</Text>
        <Text style={styles.labelNow}>now {money(last.median)}</Text>
        <Text style={styles.label}>{money(maxV)}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  kicker: { color: LABEL, fontSize: 12.5, fontWeight: '700', letterSpacing: 1 },
  rangeChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, marginLeft: 6 },
  rangeChipOn: { backgroundColor: 'rgba(147,200,34,0.14)' },
  rangeText: { fontSize: 11, fontWeight: '700', color: LABEL },
  rangeTextOn: { color: '#3F6212' },
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  label: { color: LABEL, fontSize: 13 },
  labelNow: { color: TEXT, fontSize: 13, fontWeight: '700' },
});

export default PriceHistorySlider;
