// PricingGuidanceCard — THE pricing research/overview for the whole app.
//
// Extracted from MatchPreview's "Pricing guidance" section (the add-product
// page) so every surface that shows price research renders the same thing:
// current-value range, average/median, suggested-range slider, recent comps.
// MatchPreview embeds it on the preview page; ListingEditorForm and
// PricingResearchModal show it inside their bottom-sheet modals with
// `onApplyPrice` chips so a tap can fill the price field.

import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { PriceHistorySlider, HistoryPoint } from './PriceHistorySlider';

const GREEN = '#93C822';
const COLORS = {
  card: '#FFFFFF',
  hairline: '#E8E8ED',
  track: '#E5E5EA',
  text: '#0A0A0B',
  label: '#8E8E93',
};

export interface PricingComp {
  title?: string;
  price?: number;
  marketplace?: string;
  condition?: string;
  imageUrl?: string;
  url?: string;
  estimatedDaysToSell?: number;
}

export interface PricingGuidanceData {
  low?: number;
  high?: number;
  median?: number;
  average?: number;
  recommended?: number;
  sampleCount?: number;
  cachedAt?: string;
  samples?: PricingComp[];
  /** Current LIVE eBay asking prices (Browse API) — "listed right now" vs sold comps. */
  livePricing?: { low?: number | null; median?: number | null; high?: number | null; sampleCount?: number } | null;
  /** Backend time-to-sell estimate (preferred over the per-comp heuristic when present). */
  timeToSell?: { fastSaleAvgDays?: number; recommendedAvgDays?: number; maxProfitAvgDays?: number; basis?: string };
  /** 90-day sold-comp median history for the sparkline. */
  history?: { dataPoints: HistoryPoint[] };
}

export interface PricingGuidanceCardProps {
  pricing?: PricingGuidanceData;
  /** Tap handler for a comp row; defaults to opening the comp's url. */
  onOpenComp?: (comp: PricingComp, index: number) => void;
  /** When set, renders Fast sale / Recommended / Max profit chips that apply a price. */
  onApplyPrice?: (price: number, kind: 'fast' | 'recommended' | 'max') => void;
  /** 'screen' renders the big section headers (preview page); 'none' for modals with their own title. */
  headers?: 'screen' | 'none';
}

const money = (n?: number | null) => (typeof n === 'number' && isFinite(n) ? `$${Math.round(n)}` : '—');
const rangeText = (low?: number, high?: number) =>
  typeof low === 'number' && typeof high === 'number' ? `${money(low)} - ${money(high)}` : '—';

// Average days-to-sell of the samples priced nearest the target (mirrors backend logic).
const averageDaysNearTarget = (targetPrice: number, samples: PricingComp[]): number | undefined => {
  const withDays = samples.filter((s) => typeof s.estimatedDaysToSell === 'number' && Number.isFinite(s.estimatedDaysToSell));
  if (!withDays.length) return undefined;
  const nearest = withDays
    .map((s) => ({ ...s, dist: Math.abs(Number(s.price) - targetPrice) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, Math.min(5, withDays.length));
  const avg = nearest.reduce((sum, s) => sum + Number(s.estimatedDaysToSell || 0), 0) / nearest.length;
  return Math.round(avg);
};

const cachedLabel = (cachedAt?: string): string | null => {
  if (!cachedAt) return null;
  const mins = Math.round((Date.now() - new Date(cachedAt).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return null;
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
};

export const PricingGuidanceCard: React.FC<PricingGuidanceCardProps> = ({
  pricing,
  onOpenComp,
  onApplyPrice,
  headers = 'screen',
}) => {
  const p = pricing ?? {};
  const samples = p.samples ?? [];

  const low = p.low;
  const high = p.high;
  const median = p.median;
  const average =
    typeof p.average === 'number'
      ? p.average
      : samples.length
      ? samples.reduce((s, c) => s + (c.price ?? 0), 0) / samples.length
      : median;

  // Slider band: pad the suggested [low, high] range outward for context.
  const hasRange = typeof low === 'number' && typeof high === 'number';
  const sliderMin = hasRange ? Math.round(low! * 0.8) : 0;
  const sliderMax = hasRange ? Math.round(high! * 1.2) : 0;
  const span = Math.max(1, sliderMax - sliderMin);
  const pct = (v: number) => Math.max(0, Math.min(1, (v - sliderMin) / span));
  const fillLeft = hasRange ? pct(low!) : 0;
  const fillRight = hasRange ? pct(high!) : 1;
  const centerVal = typeof median === 'number' ? median : hasRange ? (low! + high!) / 2 : 0;

  // Live eBay asking price (Browse API) — "listed right now", shown next to the
  // sold-comp metrics so the seller sees both at a glance.
  const live =
    p.livePricing && (typeof p.livePricing.median === 'number' || typeof p.livePricing.low === 'number')
      ? p.livePricing
      : null;
  const liveValue = live ? live.median ?? live.high ?? live.low : undefined;

  const recommended = typeof p.recommended === 'number' ? p.recommended : median;
  const sampleCount = p.sampleCount ?? (samples.length || undefined);
  const cached = cachedLabel(p.cachedAt);
  const metaLine = sampleCount
    ? `Based on ${sampleCount} sold listings${cached ? ` · ${cached}` : ''}`
    : null;

  const applyOptions = onApplyPrice && hasRange
    ? ([
        { kind: 'fast' as const, label: 'Fast sale', price: low! },
        { kind: 'recommended' as const, label: 'Recommended', price: recommended ?? (low! + high!) / 2 },
        { kind: 'max' as const, label: 'Max profit', price: high! },
      ])
    : null;

  return (
    <View>
      {headers === 'screen' ? <Text style={styles.sectionHeader}>Pricing guidance</Text> : null}

      <View style={styles.priceCard}>
        <Text style={styles.kicker}>CURRENT VALUE</Text>
        <Text style={styles.bigValue}>{rangeText(low, high)}</Text>
        {metaLine ? <Text style={styles.metaLine}>{metaLine}</Text> : null}

        <View style={styles.metricRow}>
          <View style={styles.metricCol}>
            <Text style={styles.kicker}>SOLD AVG</Text>
            <Text style={styles.metricValue}>{money(average)}</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.kicker}>SOLD MED</Text>
            <Text style={styles.metricValue}>{money(median)}</Text>
          </View>
          {live ? (
            <View style={styles.metricCol}>
              <Text style={[styles.kicker, styles.liveKicker]}>● LIVE</Text>
              <Text style={styles.metricValue}>{money(liveValue)}</Text>
            </View>
          ) : null}
        </View>
        {live && typeof live.sampleCount === 'number' ? (
          <Text style={styles.liveMeta}>
            {live.sampleCount} listed now{typeof live.low === 'number' && typeof live.high === 'number' ? ` · ${rangeText(live.low, live.high)}` : ''}
          </Text>
        ) : null}

        <View style={styles.divider} />

        <View style={styles.suggestedRow}>
          <Text style={styles.suggestedLabel}>Suggested range</Text>
          <Text style={styles.suggestedValue}>{rangeText(low, high)}</Text>
        </View>

        {/* Slider band */}
        <View style={styles.sliderTrack}>
          <View
            style={[
              styles.sliderFill,
              { left: `${fillLeft * 100}%`, right: `${(1 - fillRight) * 100}%` },
            ]}
          />
          <View style={[styles.sliderTick, { left: `${pct(centerVal) * 100}%` }]} />
        </View>
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderLabel}>{money(sliderMin)}</Text>
          <Text style={styles.sliderLabel}>{money(centerVal)}</Text>
          <Text style={styles.sliderLabel}>{money(sliderMax)}</Text>
        </View>

        {applyOptions ? (
          <View style={styles.applyRow}>
            {applyOptions.map((opt) => {
              // Prefer the backend time-to-sell estimate; fall back to the per-comp heuristic.
              const backendDays =
                opt.kind === 'fast'
                  ? p.timeToSell?.fastSaleAvgDays
                  : opt.kind === 'recommended'
                  ? p.timeToSell?.recommendedAvgDays
                  : p.timeToSell?.maxProfitAvgDays;
              const days = typeof backendDays === 'number' ? Math.round(backendDays) : averageDaysNearTarget(opt.price, samples);
              const highlight = opt.kind === 'recommended';
              return (
                <TouchableOpacity
                  key={opt.kind}
                  style={[styles.applyChip, highlight && styles.applyChipHighlight]}
                  activeOpacity={0.8}
                  onPress={() => onApplyPrice!(opt.price, opt.kind)}
                >
                  <Text style={[styles.applyLabel, highlight && styles.applyLabelHighlight]}>{opt.label}</Text>
                  <Text style={[styles.applyPrice, highlight && styles.applyLabelHighlight]}>
                    ${opt.price.toFixed(2)}
                  </Text>
                  <Text style={[styles.applyDays, highlight && styles.applyLabelHighlight]}>
                    {typeof days === 'number' ? `~${days}d avg` : ' '}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {/* 90-day sold-comp median history */}
        {p.history?.dataPoints && p.history.dataPoints.length >= 2 ? (
          <>
            <View style={styles.divider} />
            <PriceHistorySlider dataPoints={p.history.dataPoints} />
          </>
        ) : null}
      </View>

      {/* Recent comps */}
      {samples.length > 0 && (
        <>
          {headers === 'screen' ? (
            <Text style={styles.sectionHeader}>Recent comps</Text>
          ) : (
            <Text style={styles.compsKicker}>RECENT COMPS</Text>
          )}
          <View style={styles.compsCard}>
            {samples.map((c, i) => (
              <TouchableOpacity
                key={`comp-${i}`}
                activeOpacity={0.65}
                onPress={() => {
                  if (onOpenComp) onOpenComp(c, i);
                  else if (c.url) Linking.openURL(c.url).catch(() => undefined);
                }}
                style={[styles.compRow, i < samples.length - 1 && styles.compRowDivider]}
              >
                {c.imageUrl ? (
                  <Image source={{ uri: c.imageUrl }} style={styles.compThumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.compThumb, styles.compThumbEmpty]}>
                    <Icon name="image-off-outline" size={18} color="#C7C7CC" />
                  </View>
                )}
                <View style={styles.compMid}>
                  <Text style={styles.compTitle} numberOfLines={1}>
                    {c.title || 'Listing'}
                  </Text>
                  <Text style={styles.compSub} numberOfLines={1}>
                    {[
                      c.marketplace,
                      c.condition,
                      typeof c.estimatedDaysToSell === 'number' ? `~${Math.round(c.estimatedDaysToSell)}d to sell` : null,
                    ]
                      .filter(Boolean)
                      .join('  •  ')}
                  </Text>
                </View>
                <Text style={styles.compPrice}>{money(c.price)}</Text>
                <Icon name="chevron-right" size={22} color="#5A5A5E" />
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  sectionHeader: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 26,
    marginBottom: 12,
    marginHorizontal: 20,
  },

  priceCard: { marginHorizontal: 12, padding: 22, borderRadius: 22, backgroundColor: COLORS.card },
  kicker: { color: COLORS.label, fontSize: 12.5, fontWeight: '700', letterSpacing: 1 },
  bigValue: { color: COLORS.text, fontSize: 52, fontWeight: '800', letterSpacing: -1.5, marginTop: 8 },
  metaLine: { color: COLORS.label, fontSize: 13, marginTop: 6 },

  metricRow: { flexDirection: 'row', marginTop: 18 },
  metricCol: { flex: 1 },
  metricValue: { color: COLORS.text, fontSize: 22, fontWeight: '700', marginTop: 6 },
  liveKicker: { color: GREEN },
  liveMeta: { color: COLORS.label, fontSize: 12.5, marginTop: 8 },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.hairline, marginVertical: 20 },

  suggestedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  suggestedLabel: { color: COLORS.label, fontSize: 16 },
  suggestedValue: { color: COLORS.text, fontSize: 18, fontWeight: '700' },

  sliderTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.track,
    marginTop: 16,
    justifyContent: 'center',
  },
  sliderFill: { position: 'absolute', height: 8, borderRadius: 4, backgroundColor: GREEN },
  sliderTick: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.card,
    marginLeft: -2,
  },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  sliderLabel: { color: COLORS.label, fontSize: 15 },

  applyRow: { flexDirection: 'row', gap: 8, marginTop: 18 },
  applyChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    alignItems: 'center',
    backgroundColor: COLORS.card,
  },
  applyChipHighlight: { borderColor: GREEN, backgroundColor: 'rgba(147,200,34,0.12)' },
  applyLabel: { fontSize: 11, color: COLORS.label, fontWeight: '600' },
  applyLabelHighlight: { color: '#3F6212' },
  applyPrice: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginTop: 2 },
  applyDays: { fontSize: 10, color: COLORS.label, marginTop: 2 },

  compsKicker: {
    color: COLORS.label,
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 10,
    marginHorizontal: 20,
  },
  compsCard: { marginHorizontal: 12, borderRadius: 22, backgroundColor: COLORS.card, overflow: 'hidden' },
  compRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14 },
  compRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.hairline },
  compThumb: { width: 52, height: 52, borderRadius: 12, backgroundColor: '#EFEFF2' },
  compThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  compMid: { flex: 1, marginLeft: 14, marginRight: 10 },
  compTitle: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  compSub: { color: COLORS.label, fontSize: 13, marginTop: 4 },
  compPrice: { color: COLORS.text, fontSize: 17, fontWeight: '700', marginRight: 4 },
});
