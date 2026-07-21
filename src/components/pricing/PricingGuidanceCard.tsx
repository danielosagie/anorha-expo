// PricingGuidanceCard — THE pricing research/overview for the whole app.
//
// Extracted from MatchPreview's "Pricing guidance" section (the add-product
// page) so every surface that shows price research renders the same thing:
// current-value range, average/median, suggested-range slider, recent comps.
// MatchPreview embeds it on the preview page; ListingEditorForm and
// PricingResearchModal show it inside their bottom-sheet modals with
// `onApplyPrice` chips so a tap can fill the price field.

import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { PriceHistorySlider, HistoryPoint } from './PriceHistorySlider';
import { CompsPriceChart } from './CompsPriceChart';
import { resolveImageUri } from '../../utils/resolveImageUri';

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
  /** The exact product wasn't listed — these comps are SIMILAR items (ballpark), not the item itself. */
  isSimilar?: boolean;
}

export interface PricingGuidanceCardProps {
  pricing?: PricingGuidanceData;
  /** Tap handler for a comp row; defaults to opening the comp's url. */
  onOpenComp?: (comp: PricingComp, index: number) => void;
  /** When set, renders Fast sale / Recommended / Max profit chips that apply a price. */
  onApplyPrice?: (price: number, kind: 'fast' | 'recommended' | 'max') => void;
  /** The price currently on the listing — highlights whichever chip is closest to it. */
  currentPrice?: number;
  /** 'screen' renders the big section headers (preview page); 'none' for modals with their own title. */
  headers?: 'screen' | 'none';
  /** Pricing research is still in flight — show a "Finding comps…" state instead of blank dashes. */
  loading?: boolean;
}

const money = (n?: number | null) => (typeof n === 'number' && isFinite(n) ? `$${Math.round(n)}` : '—');
const rangeText = (low?: number, high?: number) =>
  typeof low === 'number' && typeof high === 'number' ? `${money(low)} - ${money(high)}` : '—';

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
  currentPrice,
  headers = 'screen',
  loading = false,
}) => {
  const p = pricing ?? {};
  const samples = p.samples ?? [];
  // Modals (headers="none") render the stripped-down sheet: sold avg/median + the
  // three price chips, then history/comps. The full preview screen keeps the
  // richer breakdown (current value + suggested-range slider).
  const compact = headers === 'none';

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

  // Highlight the tier closest to the price the seller actually has — not a hard-coded
  // "recommended", which made the middle chip always look selected. Falls back to
  // "recommended" only when there's no price set yet.
  const selectedKind: 'fast' | 'recommended' | 'max' | null = !applyOptions
    ? null
    : typeof currentPrice === 'number' && currentPrice > 0
    ? applyOptions.reduce((best, o) =>
        Math.abs(o.price - currentPrice) < Math.abs(best.price - currentPrice) ? o : best,
      ).kind
    : 'recommended';

  // Per-tier time-to-sell — must differ per tier (cheaper sells faster), and the
  // previous code showed the same number three times because the cached research
  // only keeps ~5 comps, so "average of the 5 nearest" collapses to one value.
  // Priority: (1) backend estimate when it genuinely varies; (2) anchor on the comps'
  // OWN median sell-time — the real number behind each "~Nd to sell" row — and spread
  // Fast/Max around it; (3) last resort, derive from the tier's position in the band.
  const tierDays: Record<'fast' | 'recommended' | 'max', number | undefined> = (() => {
    const t = p.timeToSell;
    const raw = [t?.fastSaleAvgDays, t?.recommendedAvgDays, t?.maxProfitAvgDays].map((d) =>
      typeof d === 'number' && Number.isFinite(d) ? Math.round(d) : undefined,
    );
    if (raw.every((d) => typeof d === 'number') && new Set(raw).size > 1) {
      return { fast: raw[0], recommended: raw[1], max: raw[2] };
    }
    const dayVals = samples
      .map((s) => s.estimatedDaysToSell)
      .filter((d): d is number => typeof d === 'number' && Number.isFinite(d))
      .sort((a, b) => a - b);
    if (dayVals.length) {
      const anchor = dayVals[Math.floor(dayVals.length / 2)]; // median of the comps' sell-times
      return {
        fast: Math.max(2, Math.round(anchor * 0.65)),
        recommended: Math.max(2, Math.round(anchor)),
        max: Math.round(anchor * 1.6),
      };
    }
    if (applyOptions && typeof low === 'number' && typeof high === 'number') {
      const span = Math.max(1, high - low);
      const daysFor = (price: number) =>
        Math.max(2, Math.round(4 + Math.min(1, Math.max(0, (price - low) / span)) * 18));
      return {
        fast: daysFor(applyOptions[0].price),
        recommended: daysFor(applyOptions[1].price),
        max: daysFor(applyOptions[2].price),
      };
    }
    return { fast: undefined, recommended: undefined, max: undefined };
  })();

  // Nothing usable to show yet: either still fetching ("Finding comps…") or the
  // research genuinely came back empty ("No recent comps found"). Either way, show
  // an explicit state instead of a card full of silent "—" dashes.
  const hasLive = !!(p.livePricing && (typeof p.livePricing.median === 'number' || typeof p.livePricing.low === 'number'));
  const hasAnyData = hasRange || typeof median === 'number' || samples.length > 0 || hasLive;
  if (!hasAnyData) {
    return (
      <View>
        {headers === 'screen' ? <Text style={styles.sectionHeader}>Pricing guidance</Text> : null}
        <View style={[styles.priceCard, styles.emptyState]}>
          {loading ? (
            <>
              <ActivityIndicator size="small" color={GREEN} />
              <Text style={styles.emptyText}>Finding comps…</Text>
            </>
          ) : (
            <>
              <Icon name="tag-search-outline" size={22} color="#C7C7CC" />
              <Text style={styles.emptyText}>No recent comps found</Text>
            </>
          )}
        </View>
      </View>
    );
  }

  return (
    <View>
      {headers === 'screen' ? <Text style={styles.sectionHeader}>Pricing guidance</Text> : null}

      <View style={styles.priceCard}>
        {!compact ? (
          <>
            <Text style={styles.kicker}>CURRENT VALUE</Text>
            <Text style={styles.bigValue}>{rangeText(low, high)}</Text>
          </>
        ) : null}

        <View style={[styles.metricRow, compact && styles.metricRowFirst]}>
          <View style={styles.metricCol}>
            <Text style={styles.kicker}>SOLD AVG</Text>
            <Text style={styles.metricValue}>{money(average)}</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.kicker}>SOLD MEDIAN</Text>
            <Text style={styles.metricValue}>{money(median)}</Text>
          </View>
        </View>

        {!compact ? (
          <>
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
          </>
        ) : null}

        {applyOptions ? (
          <View style={styles.applyRow}>
            {applyOptions.map((opt) => {
              const days = tierDays[opt.kind];
              const highlight = opt.kind === selectedKind;
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

        {/* Sold-comp distribution from the real comps (price × how many sold × how fast),
            draggable for a per-band tooltip. Falls back to the median sparkline only when
            there aren't enough priced comps to chart. */}
        {(() => {
          const pricedCount = samples.filter((s) => typeof s.price === 'number' && (s.price as number) > 0).length;
          if (pricedCount >= 3) {
            return (
              <>
                <View style={styles.divider} />
                <CompsPriceChart samples={samples} />
              </>
            );
          }
          if (p.history?.dataPoints && p.history.dataPoints.length >= 2) {
            return (
              <>
                <View style={styles.divider} />
                <PriceHistorySlider dataPoints={p.history.dataPoints} />
              </>
            );
          }
          return null;
        })()}
      </View>

      {/* Recent comps */}
      {samples.length > 0 && (
        <>
          {headers === 'screen' ? (
            <Text style={styles.sectionHeader}>{p.isSimilar ? "Couldn't find exact — similar item comps" : `Recent comps (${sampleCount})`}</Text>
          ) : (
            <Text style={styles.compsKicker}>{p.isSimilar ? `SIMILAR ITEM COMPS (${sampleCount})` : `RECENT COMPS (${sampleCount})`}</Text>
          )}
          <View style={styles.compsCard}>
            {samples.map((c, i) => {
              const imageUri = resolveImageUri(c);
              return (
                <TouchableOpacity
                  key={`comp-${i}`}
                  activeOpacity={0.65}
                  onPress={() => {
                    if (onOpenComp) onOpenComp(c, i);
                    else if (c.url) Linking.openURL(c.url).catch(() => undefined);
                  }}
                  style={[styles.compRow, i < samples.length - 1 && styles.compRowDivider]}
                >
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.compThumb} resizeMode="cover" />
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
              );
            })}
          </View>
        </>
      )}
    </View>
  );
};

// Inter (loaded app-wide) → chat-consistent type. Stripped to essentials: small labels,
// a modest value (no 52px hero), compact paddings.
const FONT = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

const styles = StyleSheet.create({
  sectionHeader: {
    color: COLORS.text,
    fontSize: 15,
    fontFamily: FONT.bold,
    letterSpacing: -0.2,
    marginTop: 18,
    marginBottom: 8,
    marginHorizontal: 4,
  },

  priceCard: { marginHorizontal: 0, padding: 16, borderRadius: 16, backgroundColor: COLORS.card },
  emptyState: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 22 },
  emptyText: { color: COLORS.label, fontSize: 13.5, fontFamily: FONT.medium },
  kicker: { color: COLORS.label, fontSize: 10.5, fontFamily: FONT.semibold, letterSpacing: 0.8 },
  bigValue: { color: COLORS.text, fontSize: 26, fontFamily: FONT.bold, letterSpacing: -0.5, marginTop: 4 },
  metaLine: { color: COLORS.label, fontSize: 11.5, fontFamily: FONT.regular, marginTop: 4 },

  metricRow: { flexDirection: 'row', marginTop: 14 },
  metricRowFirst: { marginTop: 0 },
  metricCol: { flex: 1 },
  metricValue: { color: COLORS.text, fontSize: 16, fontFamily: FONT.semibold, marginTop: 4 },
  liveKicker: { color: GREEN },
  liveMeta: { color: COLORS.label, fontSize: 11, fontFamily: FONT.regular, marginTop: 6 },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.hairline, marginVertical: 14 },

  suggestedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  suggestedLabel: { color: COLORS.label, fontSize: 14, fontFamily: FONT.regular },
  suggestedValue: { color: COLORS.text, fontSize: 14, fontFamily: FONT.semibold },

  sliderTrack: {
    height: 12,
    borderRadius: 3,
    backgroundColor: COLORS.track,
    marginTop: 12,
    justifyContent: 'center',
  },
  sliderFill: { position: 'absolute', height: 12, borderRadius: 3, backgroundColor: GREEN },
  sliderTick: {
    position: 'absolute',
    width: 4,
    height: 8,
    borderRadius: 9,
    backgroundColor: COLORS.card,
    marginLeft: -2,
  },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  sliderLabel: { color: COLORS.label, fontSize: 12, fontFamily: FONT.regular },

  applyRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  applyChip: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    alignItems: 'center',
    backgroundColor: COLORS.card,
  },
  applyChipHighlight: { borderColor: GREEN, backgroundColor: 'rgba(147,200,34,0.12)' },
  applyLabel: { fontSize: 10.5, color: COLORS.label, fontFamily: FONT.semibold },
  applyLabelHighlight: { color: '#3F6212' },
  applyPrice: { fontSize: 13.5, fontFamily: FONT.bold, color: COLORS.text, marginTop: 2 },
  applyDays: { fontSize: 9.5, color: COLORS.label, fontFamily: FONT.regular, marginTop: 2 },

  compsKicker: {
    color: COLORS.label,
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  compsCard: { marginHorizontal: 0, borderRadius: 16, backgroundColor: COLORS.card, overflow: 'hidden' },
  compRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  compRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.hairline },
  compThumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#EFEFF2' },
  compThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  compMid: { flex: 1, marginLeft: 12, marginRight: 10 },
  compTitle: { color: COLORS.text, fontSize: 13.5, fontFamily: FONT.semibold },
  compSub: { color: COLORS.label, fontSize: 11.5, fontFamily: FONT.regular, marginTop: 3 },
  compPrice: { color: COLORS.text, fontSize: 14, fontFamily: FONT.bold, marginRight: 4 },
});
