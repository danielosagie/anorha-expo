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
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { CHAT_COLORS, CHAT_FONT } from '../../../../design/chatGlass';
import type { ActivityPayload, ValueChange } from '../../types';
import ValueDiff from './ValueDiff';
import RoutineCard from './RoutineCard';
import { TypingIndicator } from './Typing';
import { activityGlyph, changeKindGlyph, humanizeChannel, toolActivePhrase } from './humanizers';

export interface ActivityCardProps {
  payload: ActivityPayload;
  streaming: boolean;
  onOpenTray?: (payload: ActivityPayload) => void;
  onOpenItem?: (productId: string) => void;
}

export default function ActivityCard({ payload, streaming, onOpenTray }: ActivityCardProps) {
  switch (payload.kind) {
    case 'routine':
    case 'reminder':
      return <RoutineCard payload={payload} onOpenTray={onOpenTray} />;
    case 'tool-run':
      return <ToolRunCard payload={payload} streaming={streaming} onOpenTray={onOpenTray} />;
    case 'value-change':
    case 'publish':
      return <RichActivityCard payload={payload} onOpenTray={onOpenTray} />;
    default:
      return null;
  }
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
  const reasoning = payload.reasoning;
  const hasReasoning = !!(reasoning && reasoning.trim().length);
  const count = steps.length;

  if (!streaming && !count && !hasReasoning) return null;

  const totalMs = steps.reduce((sum, s) => sum + (typeof s.durationMs === 'number' ? s.durationMs : 0), 0);
  const totalSecs = totalMs > 0 ? (totalMs / 1000).toFixed(1) : null;

  const lastStep = count ? steps[count - 1] : null;
  const livePhrase = lastStep ? toolActivePhrase(lastStep.tool) : 'Working on it';
  const doneSummary =
    count > 0 ? `Done · ${count} step${count === 1 ? '' : 's'}${totalSecs ? ` · ${totalSecs}s` : ''}` : 'Thought it through';

  const canOpen = !streaming && (count > 0 || hasReasoning);
  const press = () => {
    if (!canOpen) return;
    Haptics.selectionAsync().catch(() => undefined);
    onOpenTray?.(payload);
  };

  return (
    <TouchableOpacity
      style={[styles.activityCard, streaming && styles.activityCardLive]}
      activeOpacity={canOpen ? 0.7 : 1}
      disabled={!canOpen}
      onPress={press}
    >
      <View style={styles.activityHeader}>
        {streaming ? (
          <ActivityIndicator size="small" color="#8A95A3" style={styles.activitySpinner} />
        ) : (
          <View style={styles.activityDoneChip}>
            <Icon name="check" size={11} color={CHAT_COLORS.brandDeep} />
          </View>
        )}
        <Text style={[styles.activityHeaderText, streaming && styles.activityHeaderTextLive]} numberOfLines={1}>
          {streaming ? livePhrase : doneSummary}
        </Text>
        {streaming ? <TypingIndicator color="#B6BCC4" size={4} /> : null}
        <View style={styles.activitySpacer} />
        {canOpen ? <Icon name="chevron-right" size={15} color="#C4C4CC" /> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // ── Rich (value-change / publish) card ──
  richCard: {
    alignSelf: 'flex-start',
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

  // ── Tool-run receipt (live pill + tappable done summary) ──
  activityCard: {
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: '#FAFAF7',
    borderWidth: 1,
    borderColor: '#ECEBE6',
    overflow: 'hidden',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  activityCardLive: { backgroundColor: '#F1F2F0', borderWidth: 0, borderRadius: 16 },
  activityDoneChip: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(147,200,34,0.16)',
    marginRight: 1,
  },
  activityHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  activityHeaderText: { fontSize: 12, color: CHAT_COLORS.faint, fontFamily: CHAT_FONT.medium, letterSpacing: 0.1 },
  activityHeaderTextLive: { color: '#52525B', fontFamily: CHAT_FONT.medium, flexShrink: 1 },
  activitySpacer: { flex: 1 },
  activitySpinner: { transform: [{ scale: 0.7 }], marginRight: 2 },
});
