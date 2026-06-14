// The import review experience: one ordered queue of binary cards.
//
// GROUP → SAME → KEEP. The backend owns everything — it sends the ordered units,
// each with its variant, reason, and recommended choice. This screen is a pure
// renderer: show the current card, post the answer, render whatever draft comes
// back. "Back" reopens a decision server-side; nothing is committed until Done.

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Progress from 'react-native-progress';

import { MappingSuggestion, DraftUnit, ImportDraft, DraftAnswer, DraftDecision } from '../../types/importSession';
import { BRAND_PRIMARY } from '../../design/tokens';

interface DecisionQueueProps {
  theme: any;
  insets: { top: number; bottom: number; left: number; right: number };
  /** The server-built plan: ordered units, auto-resolved, summary. */
  draft: ImportDraft;
  /** The local decision log — drives which unit is current and progress. */
  log: DraftDecision[];
  /** Record a choice locally (saved + pushed by the hook). No round-trip. */
  onRecord: (decision: DraftDecision) => void;
  /** Step back into a decision (drops it from the log; the unit returns). */
  onReopen: (unitId: string) => void;
  /** Open inventory search to pick a different match ("Show others"). */
  onSearch: (item: MappingSuggestion) => void;
  onClose: () => void;
  /** Queue is empty — commit the import. */
  onCommit: () => void;
  searchSheet?: React.ReactNode;
}

const now = () => new Date().toISOString();

interface CardCopy {
  badge: string;
  badgeColor: string;
  title: string;
  sub?: string;
  primary: string;
  secondary: string;
}

const QUESTION_BADGE: Record<'group' | 'same' | 'keep', { label: string; color: string }> = {
  group: { label: 'GROUP', color: '#7C3AED' },
  same: { label: 'SAME', color: '#2563EB' },
  keep: { label: 'KEEP', color: '#15803D' },
};

// Presentation only: the server decides the variant; we choose the words.
function copyFor(unit: DraftUnit): CardCopy {
  const badge = QUESTION_BADGE[unit.question];
  const base = { badge: badge.label, badgeColor: badge.color };
  const sub = unit.kind === 'group' ? unit.title : unit.item.platformProduct.title;

  switch (unit.variant) {
    case 'combine':
      return { ...base, title: `These ${unit.kind === 'group' ? unit.members.length : 2} look like one product`, sub, primary: 'Combine', secondary: 'Keep separate' };
    case 'duplicate':
      return { ...base, title: 'These point at the same product', sub, primary: 'Merge', secondary: 'Keep separate' };
    case 'family':
      return { ...base, title: 'Part of a product family', sub, primary: 'Add as new', secondary: 'Skip' };
    case 'split': {
      const n = (unit.kind === 'single' ? unit.item.bundleParts?.length : 0) || 2;
      return { ...base, title: `This row is really ${n} products`, sub, primary: `Split into ${n}`, secondary: 'Keep as one' };
    }
    case 'kit':
      return { ...base, title: 'This set is made of items you stock', sub, primary: 'Add as new', secondary: 'Skip' };
    case 'collision':
      return { ...base, title: 'Which one is it?', sub, primary: 'Yes, it’s this', secondary: 'Show others' };
    case 'value':
      return { ...base, title: 'A detail doesn’t match', sub, primary: 'Keep yours', secondary: 'Use theirs' };
    case 'match':
      return { ...base, title: 'Same product?', sub, primary: 'Yes, link', secondary: 'No' };
    case 'stale':
      return { ...base, title: 'This link broke', sub, primary: 'Keep', secondary: 'Unlink' };
    case 'new':
    default:
      return { ...base, title: 'Add this product?', sub, primary: 'Add as new', secondary: 'Skip' };
  }
}

function Thumb({ uri, size = 44 }: { uri?: string | null; size?: number }) {
  return (
    <View style={[styles.thumb, { width: size, height: size, borderRadius: size * 0.28 }]}>
      {uri ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size * 0.28 }} /> : <Icon name="package-variant" size={size * 0.45} color="#9CA3AF" />}
    </View>
  );
}

const DecisionQueue: React.FC<DecisionQueueProps> = ({
  theme, insets, draft, log, onRecord, onReopen, onSearch, onClose, onCommit, searchSheet,
}) => {
  // Walk the fixed plan, filtering out what the log already answered.
  const answeredIds = useMemo(() => new Set(log.filter((d) => d.kind === 'answer').map((d) => (d as any).unitId)), [log]);
  const droppedIds = useMemo(() => new Set(log.filter((d) => d.kind === 'drop').map((d) => (d as any).itemId)), [log]);
  const pending = useMemo(() => draft.units.filter((u) => !answeredIds.has(u.id)), [draft.units, answeredIds]);
  const lastAnsweredId = useMemo(() => {
    for (let i = log.length - 1; i >= 0; i--) if (log[i].kind === 'answer') return (log[i] as any).unitId as string;
    return undefined;
  }, [log]);

  const total = draft.units.length;
  const done = total - pending.length;

  if (pending.length === 0) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top + 24 }]}>
        <View style={styles.allClear}>
          <Icon name="check-circle-outline" size={40} color={theme.colors.primary} />
          <Text style={[styles.allClearTitle, { color: theme.colors.text }]}>All reviewed</Text>
          <Text style={[styles.allClearSub, { color: theme.colors.textSecondary }]}>Every item has a decision. Tap below to finish.</Text>
          {lastAnsweredId ? (
            <TouchableOpacity onPress={() => onReopen(lastAnsweredId)} style={styles.undoLink} hitSlop={8}>
              <Icon name="undo-variant" size={15} color={theme.colors.textSecondary} />
              <Text style={[styles.undoText, { color: theme.colors.textSecondary }]}>Undo last</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={onCommit} style={[styles.primaryBtn, { backgroundColor: theme.colors.primary, marginTop: 20, paddingHorizontal: 28 }]}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const unit = pending[0];
  const copy = copyFor(unit);
  const answer = (a: DraftAnswer, parts?: number[]) =>
    onRecord({ kind: 'answer', unitId: unit.id, answer: a, parts, at: now() });
  const onSecondary = () => {
    // "Show others" routes to search instead of resolving the collision here.
    if (unit.variant === 'collision' && unit.kind === 'single') {
      onSearch(unit.item);
      return;
    }
    answer('secondary');
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
          <Text style={[styles.headerSub, { color: theme.colors.textSecondary }]}>{done} of {total} done</Text>
        </View>
        {lastAnsweredId ? (
          <TouchableOpacity onPress={() => onReopen(lastAnsweredId)} style={styles.undoLink} hitSlop={8}>
            <Icon name="undo-variant" size={16} color={theme.colors.textSecondary} />
            <Text style={[styles.undoText, { color: theme.colors.textSecondary }]}>Back</Text>
          </TouchableOpacity>
        ) : null}
        <View style={[styles.qBadge, { backgroundColor: `${copy.badgeColor}14` }]}>
          <Text style={[styles.qBadgeText, { color: copy.badgeColor }]}>{copy.badge}</Text>
        </View>
      </View>
      <View style={styles.progWrap}>
        <Progress.Bar progress={total ? done / total : 0} width={null} height={4} borderRadius={2} color={theme.colors.primary} unfilledColor="#E5E7EB" borderWidth={0} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={[styles.cardTitle, { color: theme.colors.text }]}>{copy.title}</Text>
        {copy.sub ? <Text style={[styles.cardSub, { color: theme.colors.textSecondary }]}>{copy.sub}</Text> : null}
        {unit.reason ? (
          <View style={styles.reasonRow}>
            <Icon name="information-outline" size={13} color={theme.colors.textSecondary} />
            <Text style={[styles.reasonText, { color: theme.colors.textSecondary }]}>{unit.reason}</Text>
          </View>
        ) : null}

        {unit.kind === 'group' ? (
          <View style={styles.groupGrid}>
            {unit.members.filter((m) => !droppedIds.has(m.platformProduct.id)).map((m) => (
              <View key={m.platformProduct.id} style={styles.groupChip}>
                <View>
                  <Thumb uri={m.platformProduct.imageUrl} size={56} />
                  {!m.groupCover && (
                    <TouchableOpacity style={styles.dropBtn} onPress={() => onRecord({ kind: 'drop', itemId: m.platformProduct.id, at: now() })} hitSlop={6}>
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

      {/* Actions — split gets its own collapse/expand control */}
      {unit.kind === 'single' && unit.variant === 'split' ? (
        <SplitActions key={unit.id} theme={theme} insets={insets} parts={unit.item.bundleParts || []} onAnswer={answer} />
      ) : (
        <View style={[styles.actions, { paddingBottom: insets.bottom + 14 }]}>
          {unit.recommended ? (
            <Text style={[styles.suggestText, { color: theme.colors.primary }]}>
              ★ Suggested: {unit.recommended === 'primary' ? copy.primary : copy.secondary}
            </Text>
          ) : null}
          <View style={styles.actionRow}>
            <TouchableOpacity onPress={onSecondary} style={[styles.secondaryBtn]} activeOpacity={0.85}>
              <Text style={[styles.secondaryBtnText, { color: theme.colors.textSecondary }]}>{copy.secondary}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => answer('primary')} style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]} activeOpacity={0.85}>
              <Icon name="check" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>{copy.primary}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => answer('skip')} style={styles.skipBtn} hitSlop={6}>
            <Text style={[styles.skipText, { color: theme.colors.textSecondary }]}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      )}

      {searchSheet}
    </View>
  );
};

// SPLIT — collapsed it's one tap ("Add all parts as new"); the ✕ expands it into
// per-part include/skip toggles, and the bulk "Add all as new" button stays.
function SplitActions({
  theme, insets, parts, onAnswer,
}: {
  theme: any;
  insets: { bottom: number };
  parts: { sku: string | null; title?: string | null }[];
  onAnswer: (answer: DraftAnswer, parts?: number[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [included, setIncluded] = useState<Set<number>>(() => new Set(parts.map((_, i) => i)));
  const toggle = (i: number) => setIncluded((prev) => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  if (!expanded) {
    return (
      <View style={[styles.actions, { paddingBottom: insets.bottom + 14 }]}>
        <Text style={[styles.suggestText, { color: theme.colors.primary }]}>★ Suggested: Add all {parts.length} as new</Text>
        <View style={styles.actionRow}>
          <TouchableOpacity onPress={() => onAnswer('secondary')} style={styles.secondaryBtn} activeOpacity={0.85}>
            <Text style={[styles.secondaryBtnText, { color: theme.colors.textSecondary }]}>Keep as one</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onAnswer('primary')} style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]} activeOpacity={0.85}>
            <Icon name="check" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Add all {parts.length} as new</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => setExpanded(true)} style={styles.skipBtn} hitSlop={6}>
          <Text style={[styles.skipText, { color: theme.colors.textSecondary }]}>Choose which parts…</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const chosen = parts.map((_, i) => i).filter((i) => included.has(i));
  return (
    <View style={[styles.actions, { paddingBottom: insets.bottom + 14 }]}>
      <ScrollView style={styles.partsPick} showsVerticalScrollIndicator={false}>
        {parts.map((p, i) => (
          <TouchableOpacity key={i} onPress={() => toggle(i)} style={styles.partPickRow} activeOpacity={0.7}>
            <Icon name={included.has(i) ? 'checkbox-marked' : 'checkbox-blank-outline'} size={20} color={included.has(i) ? theme.colors.primary : '#9CA3AF'} />
            <Text style={[styles.partPickText, { color: theme.colors.text }]} numberOfLines={1}>{p.title || p.sku || `Part ${i + 1}`}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={styles.actionRow}>
        <TouchableOpacity onPress={() => onAnswer('primary')} style={styles.secondaryBtn} activeOpacity={0.85}>
          <Text style={[styles.secondaryBtnText, { color: theme.colors.textSecondary }]}>Add all as new</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => (chosen.length === 0 ? onAnswer('skip') : onAnswer('primary', chosen))}
          style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
          activeOpacity={0.85}
        >
          <Icon name="check" size={16} color="#fff" />
          <Text style={styles.primaryBtnText}>{chosen.length === 0 ? 'Skip all' : `Add ${chosen.length}`}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

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
  undoLink: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 4 },
  undoText: { fontSize: 13, fontFamily: 'PlusJakartaSans_600SemiBold' },
  partsPick: { maxHeight: 180, marginBottom: 10 },
  partPickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  partPickText: { fontSize: 15, flex: 1, fontFamily: 'PlusJakartaSans_500Medium' },

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
