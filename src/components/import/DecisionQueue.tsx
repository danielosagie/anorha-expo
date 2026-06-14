// The import review experience: one ordered queue of binary cards.
//
// GROUP → SAME → KEEP. Each card has two buttons (plus Skip); answering resolves
// the unit so it leaves the queue. The only non-trivial card is the COMBINE
// group card (N rows → one product with variants). Reversibility lives in the
// parent: answers patch the suggestion list, nothing commits until "Complete".

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Progress from 'react-native-progress';

import { MappingSuggestion, DraftUnit } from '../../types/importSession';
import { BRAND_PRIMARY } from '../../design/tokens';
import { DecisionAnswer, DecisionUnit, buildUnits } from '../../features/import/decisions';

interface DecisionQueueProps {
  theme: any;
  insets: { top: number; bottom: number; left: number; right: number };
  suggestions: MappingSuggestion[];
  /** Total decision units captured when the queue opened — drives the progress bar. */
  initialTotal: number;
  onAnswer: (unit: DecisionUnit, answer: DecisionAnswer) => void;
  /** Remove one row from a proposed combine group (it falls back to its own card). */
  onDropFromGroup: (platformProductId: string) => void;
  /** Open inventory search to pick a different match ("Show others"). */
  onSearch: (item: MappingSuggestion) => void;
  onClose: () => void;
  onDone: () => void;
  /** The backend's processed units, keyed to enrich a card with its reason +
   *  recommended choice. Optional — cards render fine without it. */
  draftUnits?: DraftUnit[];
  searchSheet?: React.ReactNode;
}

interface CardCopy {
  badge: string;
  badgeColor: string;
  title: string;
  sub?: string;
  primary: string;
  secondary: string;
}

const QUESTION_BADGE: Record<DecisionUnit['question'], { label: string; color: string }> = {
  group: { label: 'GROUP', color: '#7C3AED' },
  same: { label: 'SAME', color: '#2563EB' },
  keep: { label: 'KEEP', color: '#15803D' },
};

function copyFor(unit: DecisionUnit): CardCopy {
  const badge = QUESTION_BADGE[unit.question];
  const base = { badge: badge.label, badgeColor: badge.color };

  if (unit.kind === 'group') {
    const n = unit.members.length;
    return {
      ...base,
      title: `These ${n} look like one product`,
      sub: `${unit.title} — in ${n} variants`,
      primary: 'Combine',
      secondary: 'Keep separate',
    };
  }

  const s = unit.item;
  // SPLIT — one row that's really several products.
  if (s.compositionType === 'bundle') {
    const n = s.bundleParts?.length || 2;
    return { ...base, title: `This row is really ${n} products`, sub: s.platformProduct.title, primary: `Split into ${n}`, secondary: 'Keep as one' };
  }
  // KIT — a set built from singles you already stock.
  if (s.compositionType === 'kit') {
    return { ...base, title: 'This set is made of items you stock', sub: s.platformProduct.title, primary: 'Add as new', secondary: 'Skip' };
  }
  // FAMILY — an incoming variant that belongs to an existing product family.
  if (s.familyDecisionReason) {
    return { ...base, title: 'Part of a product family', sub: s.platformProduct.title, primary: 'Add as new', secondary: 'Skip' };
  }
  // MATCH BROKE — an existing link's listing is gone.
  if (s.isStaleLink) {
    return { ...base, title: 'This link broke', sub: `${s.platformProduct.title} is gone from the platform`, primary: 'Keep', secondary: 'Unlink' };
  }
  // MATCH — confirm, pick, or reconcile a value conflict.
  if (s.question === 'same' && s.suggestedCanonicalProduct?.id) {
    if (s.fieldConflicts && s.fieldConflicts.length > 0) {
      return { ...base, title: 'A detail doesn’t match', sub: s.platformProduct.title, primary: 'Keep yours', secondary: 'Use theirs' };
    }
    if (s.candidateVariants && s.candidateVariants.length > 0) {
      return { ...base, title: 'Which one is it?', sub: s.platformProduct.title, primary: 'Yes, it’s this', secondary: 'Show others' };
    }
    return { ...base, title: 'Same product?', sub: s.platformProduct.title, primary: 'Yes, link', secondary: 'No' };
  }
  // NEW / KEEP — nothing matched.
  return { ...base, title: 'Add this product?', sub: s.platformProduct.title, primary: 'Add as new', secondary: 'Skip' };
}

function Thumb({ uri, size = 44 }: { uri?: string | null; size?: number }) {
  return (
    <View style={[styles.thumb, { width: size, height: size, borderRadius: size * 0.28 }]}>
      {uri ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size * 0.28 }} /> : <Icon name="package-variant" size={size * 0.45} color="#9CA3AF" />}
    </View>
  );
}

const DecisionQueue: React.FC<DecisionQueueProps> = ({
  theme, insets, suggestions, initialTotal, onAnswer, onDropFromGroup, onSearch, onClose, onDone, draftUnits, searchSheet,
}) => {
  const units = useMemo(() => buildUnits(suggestions), [suggestions]);
  // The backend's per-unit reason + recommended choice, looked up by unit id.
  const draftById = useMemo(() => {
    const m = new Map<string, DraftUnit>();
    for (const u of draftUnits || []) m.set(u.id, u);
    return m;
  }, [draftUnits]);

  const remaining = units.length;
  const total = Math.max(initialTotal, remaining);
  const completed = total - remaining;

  if (remaining === 0) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top + 24 }]}>
        <View style={styles.allClear}>
          <Icon name="check-circle-outline" size={40} color={theme.colors.primary} />
          <Text style={[styles.allClearTitle, { color: theme.colors.text }]}>All reviewed</Text>
          <Text style={[styles.allClearSub, { color: theme.colors.textSecondary }]}>Every item has a decision. Tap below to finish.</Text>
          <TouchableOpacity onPress={onDone} style={[styles.primaryBtn, { backgroundColor: theme.colors.primary, marginTop: 20, paddingHorizontal: 28 }]}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const unit = units[0];
  const copy = copyFor(unit);
  const hint = draftById.get(unit.id);
  const onSecondary = () => {
    // "Show others" routes to search instead of resolving.
    if (unit.kind === 'single' && unit.item.candidateVariants && unit.item.candidateVariants.length > 0 && !unit.item.fieldConflicts?.length) {
      onSearch(unit.item);
      return;
    }
    onAnswer(unit, 'secondary');
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top + 8 }]}>
      {/* Header + progress */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn} hitSlop={8}>
          <Icon name="arrow-left" size={20} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Review</Text>
          <Text style={[styles.headerSub, { color: theme.colors.textSecondary }]}>{completed} of {total} done</Text>
        </View>
        <View style={[styles.qBadge, { backgroundColor: `${copy.badgeColor}14` }]}>
          <Text style={[styles.qBadgeText, { color: copy.badgeColor }]}>{copy.badge}</Text>
        </View>
      </View>
      <View style={styles.progWrap}>
        <Progress.Bar progress={total ? completed / total : 0} width={null} height={4} borderRadius={2} color={theme.colors.primary} unfilledColor="#E5E7EB" borderWidth={0} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={[styles.cardTitle, { color: theme.colors.text }]}>{copy.title}</Text>
        {copy.sub ? <Text style={[styles.cardSub, { color: theme.colors.textSecondary }]}>{copy.sub}</Text> : null}
        {hint?.reason ? (
          <View style={styles.reasonRow}>
            <Icon name="information-outline" size={13} color={theme.colors.textSecondary} />
            <Text style={[styles.reasonText, { color: theme.colors.textSecondary }]}>{hint.reason}</Text>
          </View>
        ) : null}

        {unit.kind === 'group' ? (
          <View style={styles.groupGrid}>
            {unit.members.map((m) => (
              <View key={m.platformProduct.id} style={styles.groupChip}>
                <View>
                  <Thumb uri={m.platformProduct.imageUrl} size={56} />
                  {!m.groupCover && (
                    <TouchableOpacity style={styles.dropBtn} onPress={() => onDropFromGroup(m.platformProduct.id)} hitSlop={6}>
                      <Icon name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  )}
                  {m.groupCover && (
                    <View style={styles.coverStar}><Icon name="star" size={11} color="#fff" /></View>
                  )}
                </View>
                <Text style={[styles.groupChipText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                  {variantLabel(m)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <SingleBody theme={theme} item={unit.item} />
        )}
      </ScrollView>

      {/* Two buttons + Skip */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + 14 }]}>
        {hint?.recommended ? (
          <Text style={[styles.suggestText, { color: theme.colors.primary }]}>
            ★ Suggested: {hint.recommended === 'primary' ? copy.primary : copy.secondary}
          </Text>
        ) : null}
        <View style={styles.actionRow}>
          <TouchableOpacity onPress={onSecondary} style={[styles.secondaryBtn]} activeOpacity={0.85}>
            <Text style={[styles.secondaryBtnText, { color: theme.colors.textSecondary }]}>{copy.secondary}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onAnswer(unit, 'primary')} style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]} activeOpacity={0.85}>
            <Icon name="check" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>{copy.primary}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => onAnswer(unit, 'skip')} style={styles.skipBtn} hitSlop={6}>
          <Text style={[styles.skipText, { color: theme.colors.textSecondary }]}>Skip for now</Text>
        </TouchableOpacity>
      </View>

      {searchSheet}
    </View>
  );
};

function variantLabel(s: MappingSuggestion): string {
  const t = s.platformProduct.title;
  const parts = t.split(/[\-—(/:|]/);
  if (parts.length > 1) return parts.slice(1).join(' ').replace(/\)/g, '').trim() || t;
  return s.platformProduct.sku || t;
}

function SingleBody({ theme, item }: { theme: any; item: MappingSuggestion }) {
  const c = item.suggestedCanonicalProduct;
  const conflict = item.fieldConflicts?.[0];
  return (
    <View style={styles.singleWrap}>
      <View style={styles.cmpRow}>
        <Thumb uri={item.platformProduct.imageUrl} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.cmpLabel, { color: theme.colors.textSecondary }]}>INCOMING</Text>
          <Text style={[styles.cmpName, { color: theme.colors.text }]} numberOfLines={2}>{item.platformProduct.title}</Text>
          <Text style={[styles.cmpMeta, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            {item.platformProduct.sku ? `SKU ${item.platformProduct.sku}` : ''}{item.platformProduct.price ? `  ·  $${Number(item.platformProduct.price).toFixed(2)}` : ''}
          </Text>
        </View>
      </View>

      {c?.id ? (
        <>
          <View style={styles.cmpDivider}><Icon name="arrow-down" size={16} color="#9CA3AF" /></View>
          <View style={[styles.cmpRow, styles.cmpMatch]}>
            <Thumb uri={c.imageUrl} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cmpLabel, { color: '#15803D' }]}>MATCH IN YOUR CATALOG</Text>
              <Text style={[styles.cmpName, { color: '#166534' }]} numberOfLines={2}>{c.title}</Text>
              <Text style={[styles.cmpMeta, { color: '#16A34A' }]} numberOfLines={1}>{c.sku ? `SKU ${c.sku}` : ''}</Text>
            </View>
          </View>
          {conflict && (
            <View style={styles.conflictRow}>
              <Text style={[styles.conflictField, { color: theme.colors.textSecondary }]}>{String(conflict.field).toUpperCase()}</Text>
              <Text style={[styles.conflictVal, { color: '#16A34A' }]}>yours: {String(conflict.canonicalValue)}</Text>
              <Text style={[styles.conflictVal, { color: '#B45309' }]}>theirs: {String(conflict.platformValue)}</Text>
            </View>
          )}
        </>
      ) : item.compositionType === 'bundle' && item.bundleParts?.length ? (
        <View style={styles.partsBox}>
          {item.bundleParts.map((p, i) => (
            <Text key={i} style={[styles.partLine, { color: theme.colors.textSecondary }]}>• {p.title || p.sku}</Text>
          ))}
        </View>
      ) : item.compositionType === 'kit' && item.kitComponents?.length ? (
        <View style={styles.partsBox}>
          {item.kitComponents.map((p) => (
            <Text key={p.id} style={[styles.partLine, { color: theme.colors.textSecondary }]}>• {p.title || p.sku}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12, marginBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontFamily: 'PlusJakartaSans_700Bold' },
  headerSub: { fontSize: 13, marginTop: 1, fontFamily: 'PlusJakartaSans_500Medium' },
  qBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  qBadgeText: { fontSize: 11, fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: 0.5 },
  progWrap: { paddingHorizontal: 16, marginBottom: 8 },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
  cardTitle: { fontSize: 22, fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: -0.3 },
  cardSub: { fontSize: 15, marginTop: 6, fontFamily: 'PlusJakartaSans_500Medium' },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  reasonText: { fontSize: 13, flex: 1, fontFamily: 'PlusJakartaSans_400Regular' },
  suggestText: { fontSize: 12, textAlign: 'center', marginBottom: 8, fontFamily: 'PlusJakartaSans_600SemiBold' },

  groupGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 22 },
  groupChip: { width: 72, alignItems: 'center', gap: 6 },
  groupChipText: { fontSize: 11, fontFamily: 'PlusJakartaSans_500Medium', textAlign: 'center' },
  dropBtn: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },
  coverStar: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: BRAND_PRIMARY, alignItems: 'center', justifyContent: 'center' },

  singleWrap: { marginTop: 20, gap: 4 },
  thumb: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cmpRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#F9FAFB' },
  cmpMatch: { backgroundColor: '#F0FDF4' },
  cmpDivider: { alignItems: 'center', paddingVertical: 4 },
  cmpLabel: { fontSize: 10, fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: 0.5 },
  cmpName: { fontSize: 15, marginTop: 2, fontFamily: 'PlusJakartaSans_700Bold' },
  cmpMeta: { fontSize: 12, marginTop: 2, fontFamily: 'PlusJakartaSans_500Medium' },
  conflictRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, paddingHorizontal: 12 },
  conflictField: { fontSize: 11, fontFamily: 'PlusJakartaSans_700Bold' },
  conflictVal: { fontSize: 13, fontFamily: 'PlusJakartaSans_500Medium' },
  partsBox: { marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: '#F9FAFB', gap: 4 },
  partLine: { fontSize: 14, fontFamily: 'PlusJakartaSans_500Medium' },

  actions: { paddingHorizontal: 20, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E7EB' },
  actionRow: { flexDirection: 'row', gap: 12 },
  secondaryBtn: { flex: 1, height: 52, borderRadius: 26, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  secondaryBtnText: { fontSize: 16, fontFamily: 'PlusJakartaSans_700Bold' },
  primaryBtn: { flex: 1, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontFamily: 'PlusJakartaSans_700Bold' },
  skipBtn: { alignItems: 'center', paddingVertical: 14 },
  skipText: { fontSize: 14, fontFamily: 'PlusJakartaSans_500Medium' },

  allClear: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  allClearTitle: { fontSize: 20, marginTop: 14, fontFamily: 'PlusJakartaSans_700Bold' },
  allClearSub: { fontSize: 14, marginTop: 6, textAlign: 'center', fontFamily: 'PlusJakartaSans_500Medium' },
});

export default DecisionQueue;
