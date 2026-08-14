import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { HorizontalFadeScroll } from './HorizontalFadeScroll';
import type { CampaignItem, DecisionPrompt } from '../types';
import { getSproutTheme } from '../../../design/sproutTheme';

type Props = {
  prompt: DecisionPrompt;
  onDecision: (prompt: DecisionPrompt, action: 'approve' | 'revise' | 'follow_up') => void;
  submitting?: boolean;
  /** Catalog the payload's ids are resolved against, so the card shows what it touches. */
  items?: CampaignItem[];
  dark?: boolean;
};

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every id the payload names, in payload order, deduped across steps. */
const collectIds = (prompt: DecisionPrompt): string[] => {
  const ids: string[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      if (ID_RE.test(value) && !seen.has(value)) {
        seen.add(value);
        ids.push(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const step of prompt.steps || []) {
    const text = (step.detail || '').trim();
    if (!text.startsWith('{') && !text.startsWith('[')) continue;
    try {
      visit(JSON.parse(text));
    } catch {
      // Not JSON after all — describeDetail renders it as prose.
    }
  }
  return ids;
};

const price = (value: number | undefined): string =>
  typeof value === 'number' && value > 0 ? `$${value.toFixed(2).replace(/\.00$/, '')}` : '';

const inventoryActionLabel = (action: NonNullable<DecisionPrompt['inventoryAction']>['action']) => {
  if (action === 'archive') return 'Archive';
  if (action === 'delete') return 'Delete';
  return 'Add tag';
};

// Step details arrive straight from the tool call, so they are often a raw JSON payload —
// the seller was being shown two screens of variant uuids to approve. Anything that parses
// as JSON is reduced to what it actually means: how many things this touches. Anything that
// doesn't parse is prose, and prose is shown as written.
const describeDetail = (detail: string): string | null => {
  const text = detail.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return text || null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const counts: string[] = [];
  const visit = (value: unknown, key?: string) => {
    if (Array.isArray(value)) {
      const noun = key ? key.replace(/Ids?$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() : 'item';
      counts.push(`${value.length} ${noun}${value.length === 1 ? '' : 's'}`);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  visit(parsed);
  return counts.length ? counts.join(' · ') : null;
};

// Plans use three actions. Approval writes use Approve and Reject.
const PlanCard = ({ prompt, onDecision, submitting, items, dark = false }: Props) => {
  const theme = getSproutTheme(dark);
  const isApproval = prompt.decisionType === 'approval';
  const isUnsupported = prompt.decisionType === 'unsupported';
  const kicker = isUnsupported
    ? 'New request'
    : isApproval
      ? 'Approval'
      : `Plan${prompt.planType ? `: ${prompt.planType.replace(/_/g, ' ')}` : ''}`;

  // "Approve removing 9 items" is not a decision anyone can make. Resolve the payload's
  // ids against the catalog and show the actual things, scrollable, so the seller approves
  // what they can see. Unresolvable ids fall back to the counted summary below.
  const affected = useMemo(() => {
    if (!items?.length) return [];
    const byId = new Map<string, CampaignItem>();
    for (const item of items) {
      byId.set(item.id, item);
      if (item.productId) byId.set(item.productId, item);
    }
    const seen = new Set<string>();
    return collectIds(prompt)
      .map(id => byId.get(id))
      .filter((item): item is CampaignItem => {
        if (!item || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
  }, [items, prompt]);

  // Ids that name nothing we can show are almost always a stale approval — the items were
  // already removed. Saying so beats a bare count the seller can't check.
  const unresolved = items?.length && !affected.length ? collectIds(prompt).length : 0;

  // A tool echoes its payload twice — once as "Input", once as "Draft" — so the card read
  // "9 items" and then "9 items" again. Identical details collapse to one step.
  const visibleSteps = useMemo(() => {
    const seen = new Set<string>();
    return (prompt.steps || []).filter(step => {
      const key = describeDetail(step.detail || '') ?? '';
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [prompt.steps]);

  return (
    <View style={[s.card, dark && { backgroundColor: theme.chat.surface, borderColor: theme.chat.border }]}>
      <View style={s.header}>
        <Icon
          name={isUnsupported ? 'alert-circle-outline' : 'clipboard-check-outline'}
          size={16}
          color={dark ? theme.colors.primary : '#93C822'}
        />
        <Text style={[s.kicker, dark && { color: theme.colors.primary }]}>{kicker}</Text>
      </View>
      <Text style={[s.title, dark && { color: theme.chat.text }]}>{prompt.title}</Text>
      {prompt.inventoryAction ? (
        <View style={[s.inventoryMeta, dark && { backgroundColor: theme.chat.surfaceMuted }]}>
          <Text style={[s.inventoryAction, dark && { color: theme.colors.primary }]}>{inventoryActionLabel(prompt.inventoryAction.action)}</Text>
          <Text style={[s.inventoryCount, dark && { color: theme.chat.textSecondary }]}>
            {prompt.inventoryAction.count} item{prompt.inventoryAction.count === 1 ? '' : 's'}
          </Text>
        </View>
      ) : null}
      {prompt.summary ? <Text style={[s.summary, dark && { color: theme.chat.textSecondary }]}>{prompt.summary}</Text> : null}
      {affected.length ? (
        <HorizontalFadeScroll fadeColor={theme.chat.surface} style={s.affected} contentStyle={s.affectedRow}>
          {affected.map(item => (
            <View key={item.id} style={[s.itemCard, dark && { backgroundColor: theme.chat.surfaceElevated, borderColor: theme.chat.border }]}>
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={s.itemThumb} />
              ) : (
                <View style={[s.itemThumb, s.itemThumbEmpty]}>
                  <Icon name="package-variant" size={18} color="#A1A1AA" />
                </View>
              )}
              <Text style={[s.itemName, dark && { color: theme.chat.text }]} numberOfLines={2}>{item.name}</Text>
              {price(item.currentPrice) ? (
                <Text style={[s.itemPrice, dark && { color: theme.colors.primary }]}>{price(item.currentPrice)}</Text>
              ) : null}
            </View>
          ))}
        </HorizontalFadeScroll>
      ) : null}
      {/* The steps are the tool's own payload echoed twice (input, then draft). Once the
          items are on screen they say nothing the cards don't. */}
      {unresolved ? (
        <Text style={[s.unresolved, dark && { color: theme.chat.textSecondary }]}>
          {`${unresolved} item${unresolved === 1 ? '' : 's'} · no longer in this campaign`}
        </Text>
      ) : null}
      {!affected.length && !unresolved && visibleSteps.length ? (
        <View style={s.steps}>
          {visibleSteps.map((step, i) => (
            <View key={i} style={s.stepRow}>
              <Text style={[s.stepNum, dark && { backgroundColor: theme.chat.surfaceMuted, color: theme.colors.primary }]}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.stepTitle, dark && { color: theme.chat.text }]}>{step.title}</Text>
                {step.detail && describeDetail(step.detail)
                  ? <Text style={[s.stepDetail, dark && { color: theme.chat.textSecondary }]}>{describeDetail(step.detail)}</Text>
                  : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {!isUnsupported ? (
        <View style={s.actions}>
          <TouchableOpacity
            style={[s.btn, s.primary, submitting && s.btnDisabled]}
            activeOpacity={0.85}
            disabled={submitting}
            onPress={() => onDecision(prompt, 'approve')}
          >
            <Text style={[s.primaryText, { color: theme.colors.onPrimary }]}>{prompt.approveLabel || 'Approve'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.btn, s.secondary, dark && { backgroundColor: theme.chat.surfaceMuted }, submitting && s.btnDisabled]}
            activeOpacity={0.85}
            disabled={submitting}
            onPress={() => onDecision(prompt, 'revise')}
          >
            <Text style={[s.secondaryText, dark && { color: theme.chat.text }]}>{prompt.reviseLabel || 'Revise'}</Text>
          </TouchableOpacity>
          {!isApproval ? (
            <TouchableOpacity
              style={[s.btn, s.secondary, dark && { backgroundColor: theme.chat.surfaceMuted }, submitting && s.btnDisabled]}
              activeOpacity={0.85}
              disabled={submitting}
              onPress={() => onDecision(prompt, 'follow_up')}
            >
              <Text style={[s.secondaryText, dark && { color: theme.chat.text }]}>{prompt.followUpLabel || 'Follow-up'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

export default PlanCard;

const s = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E4EFC9',
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  affected: { marginTop: 10, marginHorizontal: -14 },
  affectedRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14 },
  itemCard: {
    width: 116,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E9EDE1',
    backgroundColor: '#FBFCF8',
    padding: 8,
    gap: 6,
  },
  itemThumb: { width: '100%', height: 76, borderRadius: 10, backgroundColor: '#EFF1EA' },
  itemThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  itemName: { fontSize: 12, lineHeight: 16, color: '#27272A', fontFamily: 'Inter_600SemiBold' },
  itemPrice: { fontSize: 12, color: '#93C822', fontFamily: 'Inter_700Bold' },
  unresolved: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    color: '#71717A',
    fontFamily: 'Inter_500Medium',
  },
  kicker: {
    fontSize: 12, color: '#93C822', fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  title: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 4 },
  inventoryMeta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#EFF7E0',
  },
  inventoryAction: { fontSize: 12, color: '#93C822', fontFamily: 'Inter_700Bold' },
  inventoryCount: { fontSize: 12, color: '#93C822', fontFamily: 'Inter_600SemiBold' },
  summary: { fontSize: 14, color: '#52525B', fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 10 },
  steps: { gap: 8, marginBottom: 12 },
  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNum: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#EFF7E0', color: '#93C822',
    fontSize: 12, fontFamily: 'Inter_700Bold', textAlign: 'center', lineHeight: 20, overflow: 'hidden',
  },
  stepTitle: { fontSize: 14, color: '#27272A', fontFamily: 'Inter_600SemiBold' },
  stepDetail: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular', lineHeight: 18, marginTop: 1 },
  actions: { gap: 8, marginTop: 12 },
  btn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.5 },
  primary: { backgroundColor: '#93C822' },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_700Bold' },
  secondary: { backgroundColor: '#F4F4F1' },
  secondaryText: { color: '#3F3F46', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
