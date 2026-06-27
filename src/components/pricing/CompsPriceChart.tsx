// CompsPriceChart — a sold-comp PERFORMANCE scatter for PricingGuidanceCard.
//
// The old version binned comps into a price histogram, which hid each comp's
// sell-time. This plots every comp so you can read performance directly:
//   X = sold price,  Y = days to sell (higher = sells FASTER, low days at the top),
//   dot colour = speed (green fast → amber slow). The single fastest seller is ringed
//   and called out. Drag across to snap to the nearest comp and read its price + days.

import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import type { PricingComp } from './PricingGuidanceCard';

const GREEN = '#93C822';
const AMBER = '#BA7517';
const LABEL = '#8E8E93';
const TEXT = '#0A0A0B';
const GRID = '#EDEDF1';

const PLOT_H = 150; // dot area height
const TOP = 16; // headroom above the plot
const LEFT = 34; // gutter for day labels
const RIGHT = 12; // gutter so the rightmost dot isn't clipped

const money = (n: number) => `$${Math.round(n)}`;
const days = (n: number) => `${Math.round(n)}d`;

function mix(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

type Pt = { price: number; days: number; title?: string; color: string };

export const CompsPriceChart: React.FC<{ samples: PricingComp[] }> = ({ samples }) => {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  // Performance scatter needs both a price AND a sell-time per comp.
  const { pts, minP, maxP, maxD, fastest, withoutDays } = useMemo(() => {
    const priced = samples.filter((s) => typeof s.price === 'number' && (s.price as number) > 0);
    const timed = priced.filter((s) => typeof s.estimatedDaysToSell === 'number' && (s.estimatedDaysToSell as number) > 0);
    if (timed.length === 0) {
      return { pts: [] as Pt[], minP: 0, maxP: 0, maxD: 0, fastest: -1, withoutDays: priced.length };
    }
    const prices = timed.map((s) => s.price as number);
    const ds = timed.map((s) => s.estimatedDaysToSell as number);
    const lo = Math.min(...prices), hi = Math.max(...prices);
    const dHi = Math.max(...ds);
    const list: Pt[] = timed.map((s) => ({
      price: s.price as number,
      days: s.estimatedDaysToSell as number,
      title: s.title,
      color: mix(GREEN, AMBER, dHi > 0 ? (s.estimatedDaysToSell as number) / dHi : 0),
    }));
    // fastest = lowest days; ties → lowest price (cheap-and-fast wins the callout)
    let fi = 0;
    for (let i = 1; i < list.length; i++) {
      if (list[i].days < list[fi].days || (list[i].days === list[fi].days && list[i].price < list[fi].price)) fi = i;
    }
    return { pts: list, minP: lo, maxP: hi, maxD: dHi, fastest: fi, withoutDays: priced.length - timed.length };
  }, [samples]);

  const plotW = Math.max(0, width - LEFT - RIGHT);
  const spanP = maxP - minP || 1;
  const xOf = (p: number) => LEFT + 6 + ((p - minP) / spanP) * (plotW - 12);
  const yOf = (d: number) => TOP + (maxD > 0 ? d / maxD : 0) * PLOT_H; // low days → top (fast)

  // Day gridlines (e.g. 10d / 20d / 30d), nicely stepped.
  const ticks = useMemo(() => {
    if (maxD <= 0) return [] as number[];
    const step = Math.max(1, Math.round(maxD / 3));
    const out: number[] = [];
    for (let t = step; t <= maxD + 0.001; t += step) out.push(t);
    return out;
  }, [maxD]);

  const pickNearest = (x: number) => {
    if (!width || pts.length === 0) return;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = Math.abs(xOf(pts[i].price) - x);
      if (dx < bd) { bd = dx; bi = i; }
    }
    setActive(bi);
  };

  // Horizontal drags only, so the parent sheet still scrolls vertically.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 3,
      onPanResponderGrant: (e) => pickNearest(e.nativeEvent.locationX),
      onPanResponderMove: (e) => pickNearest(e.nativeEvent.locationX),
      onPanResponderTerminationRequest: () => true,
    }),
  ).current;

  if (pts.length < 3) return null;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const sel = active != null ? pts[active] : null;
  const tipW = 140;
  const tipLeft = sel ? Math.max(0, Math.min(width - tipW, xOf(sel.price) - tipW / 2)) : 0;
  const fp = pts[fastest];

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.kicker}>SOLD COMPS · {pts.length}</Text>
        <View style={styles.legend}>
          <View style={[styles.dot, { backgroundColor: GREEN }]} />
          <Text style={styles.legendText}>fast</Text>
          <View style={[styles.dot, { backgroundColor: AMBER, marginLeft: 8 }]} />
          <Text style={styles.legendText}>slow</Text>
        </View>
      </View>
      <Text style={styles.subKicker}>Higher = sells faster · drag to read a comp</Text>

      <View style={styles.chartArea} onLayout={onLayout} {...pan.panHandlers}>
        {sel ? (
          <View style={[styles.tooltip, { left: tipLeft, width: tipW }]} pointerEvents="none">
            <Text style={styles.tipPrice}>{money(sel.price)} · {days(sel.days)}</Text>
            <Text style={styles.tipMeta} numberOfLines={1}>
              {active === fastest ? 'fastest seller' : sel.title ? sel.title : 'sold comp'}
            </Text>
          </View>
        ) : (
          <View style={[styles.fastestCallout, { left: Math.max(0, Math.min(width - 150, xOf(fp.price) - 75)) }]} pointerEvents="none">
            <Text style={styles.fastestText}>Fastest · {money(fp.price)} in {days(fp.days)}</Text>
          </View>
        )}

        {width > 0 && (
          <Svg width={width} height={TOP + PLOT_H + 6}>
            {/* day gridlines + labels */}
            {ticks.map((t) => (
              <React.Fragment key={`t${t}`}>
                <Line x1={LEFT} y1={yOf(t)} x2={width} y2={yOf(t)} stroke={GRID} strokeWidth={1} />
                <SvgText x={LEFT - 6} y={yOf(t) + 4} fill={LABEL} fontSize={10} fontWeight="600" textAnchor="end">{days(t)}</SvgText>
              </React.Fragment>
            ))}

            {/* cursor line */}
            {sel && <Line x1={xOf(sel.price)} y1={TOP - 6} x2={xOf(sel.price)} y2={TOP + PLOT_H} stroke={TEXT} strokeWidth={1} strokeDasharray="3 3" opacity={0.3} />}

            {/* comp dots */}
            {pts.map((p, i) => {
              const isSel = active === i;
              const isFast = i === fastest;
              const r = isSel ? 7 : isFast ? 6 : 4.5;
              return (
                <React.Fragment key={i}>
                  {(isFast || isSel) && <Circle cx={xOf(p.price)} cy={yOf(p.days)} r={r + 3} fill="none" stroke={isSel ? TEXT : GREEN} strokeWidth={1.5} opacity={isSel ? 0.5 : 0.6} />}
                  <Circle cx={xOf(p.price)} cy={yOf(p.days)} r={r} fill={p.color} opacity={active == null || isSel || isFast ? 1 : 0.4} />
                </React.Fragment>
              );
            })}
          </Svg>
        )}
      </View>

      <View style={styles.axis}>
        <Text style={styles.axisLabel}>{money(minP)}</Text>
        {withoutDays > 0 ? <Text style={styles.axisNote}>+{withoutDays} more without sell-time</Text> : null}
        <Text style={styles.axisLabel}>{money(maxP)}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { color: LABEL, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  subKicker: { color: LABEL, fontSize: 11, fontWeight: '500', marginTop: 3, marginBottom: 8 },
  legend: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
  legendText: { color: LABEL, fontSize: 11, fontWeight: '600' },
  chartArea: { height: TOP + PLOT_H + 6, position: 'relative' },
  axis: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, paddingLeft: LEFT - 6 },
  axisLabel: { color: LABEL, fontSize: 11, fontWeight: '600' },
  axisNote: { color: LABEL, fontSize: 10, fontWeight: '500' },
  tooltip: { position: 'absolute', top: 0, zIndex: 5, backgroundColor: TEXT, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10, alignItems: 'center' },
  tipPrice: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  tipMeta: { color: '#E5E5EA', fontSize: 11, fontWeight: '600', marginTop: 1 },
  fastestCallout: { position: 'absolute', top: 0, zIndex: 4, backgroundColor: '#F1FAE2', borderColor: '#CFE7A4', borderWidth: 1, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  fastestText: { color: '#3B6300', fontSize: 11, fontWeight: '700' },
});
