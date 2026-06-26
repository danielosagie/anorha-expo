// CompsPriceChart — a sold-comp distribution for PricingGuidanceCard.
//
// Replaces the flat "90-day median" sparkline (which collapses to a straight line
// when the backend only has one median). Instead it charts the ACTUAL comps:
//   X = sold price, bar height = how many sold in that price range,
//   bar color = how fast they sold (green = fast → amber = slow).
// Drag a finger across to read a price band's count + average days-to-sell.

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import type { PricingComp } from './PricingGuidanceCard';

const GREEN = '#93C822';
const AMBER = '#BA7517';
const LABEL = '#8E8E93';
const TEXT = '#0A0A0B';
const TRACK = '#EAEAEF';

const CHART_H = 132; // bar area height
const TOP_PAD = 22; // room above bars for the tallest bar's count label
const GAP = 3; // px between bars

const money = (n: number) => `$${Math.round(n)}`;

// lerp two hex colors by t∈[0,1]
function mix(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

type Bin = { lo: number; hi: number; count: number; avgDays: number | null; color: string };

export const CompsPriceChart: React.FC<{ samples: PricingComp[] }> = ({ samples }) => {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const priced = useMemo(
    () => samples.filter((s) => typeof s.price === 'number' && (s.price as number) > 0),
    [samples],
  );

  const { bins, minP, maxP } = useMemo(() => {
    const prices = priced.map((s) => s.price as number);
    if (prices.length === 0) return { bins: [] as Bin[], minP: 0, maxP: 0 };
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const binCount = lo === hi ? 1 : Math.min(10, Math.max(4, Math.round(Math.sqrt(prices.length)) + 2));
    const span = hi - lo || 1;
    const raw: { count: number; days: number[] }[] = Array.from({ length: binCount }, () => ({ count: 0, days: [] }));
    for (const s of priced) {
      const idx = lo === hi ? 0 : Math.min(binCount - 1, Math.floor(((s.price as number) - lo) / span * binCount));
      raw[idx].count += 1;
      if (typeof s.estimatedDaysToSell === 'number' && s.estimatedDaysToSell > 0) raw[idx].days.push(s.estimatedDaysToSell);
    }
    // speed color: scale each bin's avg days across the observed min/max
    const allAvgs = raw.filter((r) => r.days.length).map((r) => r.days.reduce((a, b) => a + b, 0) / r.days.length);
    const dLo = allAvgs.length ? Math.min(...allAvgs) : 0;
    const dHi = allAvgs.length ? Math.max(...allAvgs) : 1;
    const out: Bin[] = raw.map((r, i) => {
      const binLo = lo === hi ? lo : lo + (span * i) / binCount;
      const binHi = lo === hi ? hi : lo + (span * (i + 1)) / binCount;
      const avgDays = r.days.length ? r.days.reduce((a, b) => a + b, 0) / r.days.length : null;
      const t = avgDays != null && dHi > dLo ? (avgDays - dLo) / (dHi - dLo) : 0;
      return { lo: binLo, hi: binHi, count: r.count, avgDays, color: mix(GREEN, AMBER, t) };
    });
    return { bins: out, minP: lo, maxP: hi };
  }, [priced]);

  const maxCount = useMemo(() => bins.reduce((m, b) => Math.max(m, b.count), 0), [bins]);

  const pickBin = (x: number) => {
    if (!width || bins.length === 0) return;
    const slot = width / bins.length;
    const i = Math.max(0, Math.min(bins.length - 1, Math.floor(x / slot)));
    setActive(i);
  };

  // Only claim HORIZONTAL drags so vertical scrolling of the parent sheet still works
  // when the finger passes over the chart.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 3,
      onPanResponderGrant: (e) => pickBin(e.nativeEvent.locationX),
      onPanResponderMove: (e) => pickBin(e.nativeEvent.locationX),
      onPanResponderTerminationRequest: () => true,
    }),
  ).current;

  if (priced.length < 3) return null;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const slot = width && bins.length ? width / bins.length : 0;
  const activeBin = active != null ? bins[active] : null;
  const tipW = 132;
  const tipLeft = active != null ? Math.max(0, Math.min(width - tipW, (active + 0.5) * slot - tipW / 2)) : 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.kicker}>SOLD PRICES · {priced.length}</Text>
        <View style={styles.legend}>
          <View style={[styles.dot, { backgroundColor: GREEN }]} />
          <Text style={styles.legendText}>fast</Text>
          <View style={[styles.dot, { backgroundColor: AMBER, marginLeft: 8 }]} />
          <Text style={styles.legendText}>slow</Text>
        </View>
      </View>

      <View style={styles.chartArea} onLayout={onLayout} {...pan.panHandlers}>
        {/* tooltip */}
        {activeBin ? (
          <View style={[styles.tooltip, { left: tipLeft, width: tipW }]} pointerEvents="none">
            <Text style={styles.tipPrice}>{money(activeBin.lo)}–{money(activeBin.hi)}</Text>
            <Text style={styles.tipMeta}>
              {activeBin.count} sold{activeBin.avgDays != null ? ` · ~${Math.round(activeBin.avgDays)}d avg` : ''}
            </Text>
          </View>
        ) : (
          <Text style={styles.hint} pointerEvents="none">Drag to explore</Text>
        )}

        {width > 0 && (
          <Svg width={width} height={CHART_H + TOP_PAD}>
            {bins.map((b, i) => {
              const h = maxCount > 0 ? Math.max(2, (b.count / maxCount) * CHART_H) : 2;
              const x = i * slot + GAP / 2;
              const w = Math.max(1, slot - GAP);
              const y = TOP_PAD + (CHART_H - h);
              const isActive = active === i;
              return (
                <Rect
                  key={i}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={3}
                  fill={b.color}
                  opacity={active == null || isActive ? 1 : 0.35}
                />
              );
            })}
            {/* baseline */}
            <Line x1={0} y1={TOP_PAD + CHART_H} x2={width} y2={TOP_PAD + CHART_H} stroke={TRACK} strokeWidth={1} />
            {/* cursor */}
            {active != null && (
              <Line
                x1={(active + 0.5) * slot}
                y1={TOP_PAD}
                x2={(active + 0.5) * slot}
                y2={TOP_PAD + CHART_H}
                stroke={TEXT}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.35}
              />
            )}
          </Svg>
        )}
      </View>

      <View style={styles.axis}>
        <Text style={styles.axisLabel}>{money(minP)}</Text>
        <Text style={styles.axisLabel}>{money(maxP)}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  kicker: { color: LABEL, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  legend: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
  legendText: { color: LABEL, fontSize: 11, fontWeight: '600' },
  chartArea: { height: CHART_H + TOP_PAD, position: 'relative' },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisLabel: { color: LABEL, fontSize: 11, fontWeight: '600' },
  hint: { position: 'absolute', top: 0, alignSelf: 'center', color: LABEL, fontSize: 11, fontWeight: '600' },
  tooltip: {
    position: 'absolute',
    top: 0,
    zIndex: 5,
    backgroundColor: TEXT,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  tipPrice: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  tipMeta: { color: '#E5E5EA', fontSize: 11, fontWeight: '600', marginTop: 1 },
});
