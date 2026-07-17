// ActivityCard — the ONE typed inline card the chat feed renders for everything
// Sprout did in a turn. A thin switch over the ActivityPayload union:
//
//   tool-run     -> the calm receipt; while working it's the live pill, once done
//                   it's a tappable summary that opens the tray (steps overview)
//   value-change -> a rich card showing the diff at a glance; tap opens the tray
//   publish      -> same chassis (Draft -> Live on N channels)
//   routine /
//   reminder     -> the brand-tinted standing card (delegated to RoutineCard)
//
// Every finished activity is tappable and opens ONE review tray. Calm law: the
// normal finished turn stays quiet; only failed / out-of-sync goes loud.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { CHAT_COLORS, CHAT_FONT } from '../../../../design/chatGlass';
import type { ActivityPayload, CampaignItem, ValueChange } from '../../types';
import ValueDiff from './ValueDiff';
import RoutineCard from './RoutineCard';
import { TypingIndicator } from './Typing';
import { activityGlyph, changeKindGlyph, humanizeChannel, toolActivePhrase } from './humanizers';
import { sanitizeDisplayText } from '../../displayText';
import { campaignItemPrice, getPlanDisplayTitle, getPlanPricePreviews, matchPlanItem } from '../../planPresentation';
import { DiaTextReveal } from '../../../../components/DiaTextReveal';
import { useChatPreferences } from '../../chatPreferences';

export interface ActivityCardProps {
  payload: ActivityPayload;
  streaming: boolean;
  onOpenTray?: (payload: ActivityPayload) => void;
  onOpenItem?: (productId: string) => void;
  planItems?: CampaignItem[];
}

export default function ActivityCard({ payload, streaming, onOpenTray, planItems = [] }: ActivityCardProps) {
  switch (payload.kind) {
    case 'routine':
    case 'reminder':
      return <RoutineCard payload={payload} onOpenTray={onOpenTray} />;
    case 'tool-run':
      return <ToolRunCard payload={payload} streaming={streaming} onOpenTray={onOpenTray} />;
    case 'value-change':
    case 'publish':
      return <RichActivityCard payload={payload} onOpenTray={onOpenTray} />;
    case 'document':
      return <DocumentCard payload={payload} onOpenTray={onOpenTray} />;
    case 'plan':
      return <PlanActivityCard payload={payload} planItems={planItems} onOpenTray={onOpenTray} />;
    default:
      return null;
  }
}

// ── Plans and reports use the same compact artifact language as the home screen:
// a tilted document tile, an explicit type in the title, and one clear view action. ──

function PlanActivityCard({
  payload,
  planItems,
  onOpenTray,
}: {
  payload: Extract<ActivityPayload, { kind: 'plan' }>;
  planItems: CampaignItem[];
  onOpenTray?: (payload: ActivityPayload) => void;
}) {
  const plan = payload.plan;
  const title = getPlanDisplayTitle(plan);
  const priceRows = getPlanPricePreviews(plan).slice(0, 2).map((change) => {
    const item = matchPlanItem(change.name, planItems);
    return { ...change, before: change.before || campaignItemPrice(item) };
  });
  const press = () => {
    Haptics.selectionAsync().catch(() => undefined);
    onOpenTray?.(payload);
  };
  return (
    <TouchableOpacity style={styles.artifactCard} activeOpacity={0.85} onPress={press}>
      <View style={styles.artifactHeader}>
        <View style={styles.artifactIconWrap}>
          <LinearGradient
            colors={['rgba(147,200,34,0.28)', 'rgba(147,200,34,0.10)']}
            style={styles.artifactIconChip}
          >
            <Icon name="clipboard-text-outline" size={20} color={CHAT_COLORS.brandDeep} />
          </LinearGradient>
        </View>
        <View style={styles.richTextCol}>
          <Text style={styles.artifactTitle} numberOfLines={2}>Plan: {title}</Text>
        </View>
        <View style={styles.artifactAction}>
          <Text style={styles.artifactActionText}>View plan</Text>
          <Icon name="chevron-right" size={15} color={CHAT_COLORS.brandDeep} />
        </View>
      </View>
      {priceRows.length ? (
        <View style={styles.planPricePreview}>
          {priceRows.map((change, index) => (
            <View key={`${change.name}-${index}`} style={styles.planPriceRow}>
              <Text style={styles.planPriceName} numberOfLines={1}>{change.name}</Text>
              {change.before ? <Text style={styles.planPriceBefore}>{change.before}</Text> : null}
              {change.before ? <Icon name="arrow-right" size={13} color={CHAT_COLORS.faint} /> : null}
              <Text style={styles.planPriceAfter}>{change.after}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// ── Document card: a tappable report summary. Tap opens the tray to the full,
// editable, shareable business sheet — never a wall of text in the chat feed. ──

function DocumentCard({
  payload,
  onOpenTray,
}: {
  payload: Extract<ActivityPayload, { kind: 'document' }>;
  onOpenTray?: (payload: ActivityPayload) => void;
}) {
  const doc = payload.document;
  const press = () => {
    Haptics.selectionAsync().catch(() => undefined);
    onOpenTray?.(payload);
  };
  return (
    <TouchableOpacity style={styles.artifactCard} activeOpacity={0.85} onPress={press}>
      <View style={styles.artifactHeader}>
        <View style={styles.artifactIconWrap}>
          <LinearGradient
            colors={['rgba(147,200,34,0.28)', 'rgba(147,200,34,0.10)']}
            style={styles.artifactIconChip}
          >
            <Icon name="file-document-outline" size={20} color={CHAT_COLORS.brandDeep} />
          </LinearGradient>
        </View>
        <View style={styles.richTextCol}>
          <Text style={styles.artifactTitle} numberOfLines={2}>
            Report: {sanitizeDisplayText(doc.title || payload.title)}
          </Text>
        </View>
        <View style={styles.artifactAction}>
          <Text style={styles.artifactActionText}>View report</Text>
          <Icon name="chevron-right" size={15} color={CHAT_COLORS.brandDeep} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Rich card: value-change / publish (the diff-at-a-glance, tap-for-tray card) ──

function RichActivityCard({
  payload,
  onOpenTray,
}: {
  payload: Extract<ActivityPayload, { kind: 'value-change' | 'publish' }>;
  onOpenTray?: (payload: ActivityPayload) => void;
}) {
  const changes: ValueChange[] = payload.changes ?? [];
  const failed = payload.status === 'failed';
  const syncing = payload.status === 'syncing';
  const itemRef = payload.itemRef;
  const channels = payload.kind === 'publish' ? payload.channels : undefined;

  const subParts: string[] = [];
  if (itemRef?.name) subParts.push(itemRef.name);
  if (itemRef?.listingCount) subParts.push(`${itemRef.listingCount} listing${itemRef.listingCount === 1 ? '' : 's'}`);
  else if (channels?.length) subParts.push(channels.length === 1 ? humanizeChannel(channels[0]) : `${channels.length} channels`);
  const subtitle = subParts.join(' · ');

  const single = changes.length === 1;
  const previewRows = changes.slice(0, 2);
  const moreCount = changes.length - previewRows.length;

  const press = () => {
    Haptics.selectionAsync().catch(() => undefined);
    onOpenTray?.(payload);
  };

  return (
    <TouchableOpacity style={styles.richCard} activeOpacity={0.85} onPress={press}>
      <View style={styles.richHeader}>
        <View style={[styles.tile, failed && styles.tileFail, syncing && styles.tileSync]}>
          <Icon
            name={activityGlyph(payload)}
            size={18}
            color={failed ? CHAT_COLORS.error : syncing ? CHAT_COLORS.amber : CHAT_COLORS.brandDeep}
          />
        </View>
        <View style={styles.richTextCol}>
          <Text style={styles.richTitle} numberOfLines={1}>{payload.title}</Text>
          {subtitle ? <Text style={styles.richSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <Icon name="chevron-right" size={18} color="#C4C4CC" />
      </View>

      {changes.length ? (
        <View style={styles.diffSection}>
          {single ? (
            <ValueDiff
              from={changes[0].from}
              to={changes[0].to}
              unit={changes[0].unit}
              kind={changes[0].kind}
              direction={changes[0].direction}
              variant="inline"
            />
          ) : (
            <>
              {previewRows.map((c, i) => (
                <View key={`${c.field}-${i}`} style={styles.previewRow}>
                  <Icon name={changeKindGlyph(c.kind)} size={14} color={CHAT_COLORS.dim} />
                  <Text style={styles.previewLabel} numberOfLines={1}>{c.itemName || c.label}</Text>
                  <View style={styles.previewDiff}>
                    <ValueDiff from={c.from} to={c.to} unit={c.unit} kind={c.kind} direction={c.direction} variant="preview" />
                  </View>
                </View>
              ))}
              {moreCount > 0 ? <Text style={styles.moreLine}>+{moreCount} more</Text> : null}
            </>
          )}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

// ── Tool-run receipt. While streaming, the calm "Creating task…" live pill
// (byte-identical to before). Once finished, a tappable summary that opens the
// tray to the full step list — so every activity is reviewable in one place. ──

function ToolRunCard({
  payload,
  streaming,
  onOpenTray,
}: {
  payload: Extract<ActivityPayload, { kind: 'tool-run' }>;
  streaming: boolean;
  onOpenTray?: (payload: ActivityPayload) => void;
}) {
  const steps = payload.steps ?? [];
  const reasoning = payload.reasoning?.trim();
  const hasReasoning = !!reasoning;
  const count = steps.length;
  const { expandedActivity } = useChatPreferences();
  const [expanded, setExpanded] = useState(expandedActivity);
  useEffect(() => setExpanded(expandedActivity), [expandedActivity]);

  if (!streaming && !count && !hasReasoning) return null;

  const lastStep = count ? steps[count - 1] : null;
  const livePhrase = lastStep ? toolActivePhrase(lastStep.tool) : 'Working on it';
  const doneSummary = sanitizeDisplayText(payload.title || 'Finished the checks');
  const canOpen = !streaming && (count > 0 || hasReasoning);
  const openTray = () => {
    if (!canOpen) return;
    Haptics.selectionAsync().catch(() => undefined);
    onOpenTray?.(payload);
  };

  // The reasoning trace, shown inline (not buried in the tray): it streams live while
  // the model is still thinking, then collapses to a tappable "Thought it through" row.
  const thinkingLive = streaming && count === 0;
  const showReasoningBody = hasReasoning && (expanded || thinkingLive);
  // Once tool steps have completed, the receipt already opens the tray containing
  // the reasoning. Rendering a second "Thought it through" card beside "Done" made
  // successful plan turns look like several unrelated operations.
  const showReasoningCard = hasReasoning && (streaming || count === 0);
  // Suppress the "Working on it" pill during the pure-thinking phase so the reasoning
  // block stands alone; once steps land (or there's no reasoning) the receipt shows.
  const showStepsRow = count > 0 || (streaming && !hasReasoning);

  return (
    <View style={styles.toolRunWrap}>
      {showReasoningCard ? (
        <TouchableOpacity style={styles.reasoningCard} activeOpacity={0.7} onPress={() => setExpanded((e) => !e)}>
          <View style={styles.reasoningHead}>
            <Icon name="lightbulb-on-outline" size={13} color={CHAT_COLORS.brandDeep} />
            <Text style={styles.reasoningLabel}>{thinkingLive ? 'Thinking' : 'Thought it through'}</Text>
            {thinkingLive ? <TypingIndicator color="#B6BCC4" size={4} /> : null}
            <View style={styles.activitySpacer} />
            <Icon name={showReasoningBody ? 'chevron-up' : 'chevron-down'} size={16} color="#C4C4CC" />
          </View>
          {showReasoningBody ? (
            <Text style={styles.reasoningBody} numberOfLines={expanded ? undefined : 8}>{reasoning}</Text>
          ) : null}
        </TouchableOpacity>
      ) : null}

      {showStepsRow ? (
        <Pressable
          style={styles.activitySummary}
          disabled={!canOpen}
          onPress={openTray}
          hitSlop={8}
          accessible={canOpen}
          accessibilityRole={canOpen ? 'button' : undefined}
          accessibilityLabel={canOpen ? `Open details for ${doneSummary}` : undefined}
          accessibilityHint={canOpen ? 'Opens the completed tool work in a bottom sheet' : undefined}
        >
          <DiaTextReveal
            key={streaming ? livePhrase : doneSummary}
            text={streaming ? livePhrase : doneSummary}
            style={styles.activitySummaryText}
            revealFrom={CHAT_COLORS.white}
            revealTo={streaming ? CHAT_COLORS.inkSoft : CHAT_COLORS.dim}
          />
          {canOpen ? <Icon name="chevron-right" size={17} color="#C4C4CC" /> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Rich (value-change / publish) card ──
  richCard: {
    alignSelf: 'flex-start',
    width: '100%',
    maxWidth: '100%',
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: CHAT_COLORS.white,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  richHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(147,200,34,0.14)',
  },
  tileFail: { backgroundColor: CHAT_COLORS.errorSurface },
  tileSync: { backgroundColor: 'rgba(245,158,11,0.14)' },
  richTextCol: { flex: 1, minWidth: 0 },
  richTitle: { fontSize: 13.5, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.ink },
  richSub: { fontSize: 12, fontFamily: CHAT_FONT.regular, color: CHAT_COLORS.dim, marginTop: 1 },
  diffSection: {
    marginTop: 11,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: CHAT_COLORS.divider,
    gap: 7,
  },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  previewLabel: { fontSize: 11.5, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.dim, flexShrink: 1 },
  previewDiff: { marginLeft: 'auto' },
  moreLine: { fontSize: 11.5, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.faint },

  // ── Plan / report artifact cards ──
  artifactCard: {
    alignSelf: 'flex-start',
    width: '100%',
    maxWidth: '100%',
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: CHAT_COLORS.white,
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  artifactHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  artifactIconWrap: { transform: [{ rotate: '-7deg' }] },
  artifactIconChip: {
    width: 38,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(59,109,17,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  artifactTitle: { fontSize: 14, lineHeight: 19, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.ink },
  artifactAction: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(59,109,17,0.20)',
    backgroundColor: 'rgba(147,200,34,0.10)',
    paddingHorizontal: 10,
  },
  artifactActionText: { fontSize: 11.5, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.brandDeep },
  planPricePreview: {
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: CHAT_COLORS.divider,
  },
  planPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planPriceName: { flex: 1, fontSize: 13.5, lineHeight: 18, color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.medium },
  planPriceBefore: { fontSize: 13.5, color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.medium },
  planPriceAfter: { fontSize: 13.5, color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold },

  // ── Tool-run receipt (reasoning block + live pill / done summary) ──
  toolRunWrap: { alignSelf: 'flex-start', maxWidth: '100%', gap: 6, marginBottom: 6 },
  reasoningCard: {
    borderRadius: 14,
    backgroundColor: '#FAFAF7',
    borderWidth: 1,
    borderColor: '#ECEBE6',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  reasoningHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reasoningLabel: { fontSize: 12, color: CHAT_COLORS.brandDeep, fontFamily: CHAT_FONT.semibold },
  reasoningBody: {
    marginTop: 7,
    fontSize: 12.5,
    lineHeight: 18,
    color: CHAT_COLORS.dim,
    fontFamily: CHAT_FONT.regular,
  },
  activitySummary: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 3,
  },
  activitySummaryText: { flexShrink: 1, fontSize: 14, lineHeight: 20, color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.medium },
  activitySpacer: { flex: 1 },
});
