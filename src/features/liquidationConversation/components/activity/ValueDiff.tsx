// ValueDiff — the trust atom. ONE primitive that paints an old -> new change the
// SAME way wherever it appears: the inline feed token, the batch preview row, and
// the hero diff in the review tray. This identity is the whole point — a reprice
// the seller didn't ask for must read as auditable, not alarming.
//
// INVARIANT: old value = red, struck; new value = brandDeep green; the separator
// is always an Icon arrow (never a unicode/emoji glyph). Color encodes
// OLD-vs-NEW (red = superseded, green = current), NEVER good-vs-bad. A 12 -> 9
// inventory drop still paints the new value green and stays calm.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CHAT_COLORS, CHAT_FONT } from '../../../../design/chatGlass';
import type { ValueChange } from '../../types';
import { formatChangeValue, humanizeStatus, isFailureStatus, numericOf } from './humanizers';

export interface ValueDiffProps {
  from?: string | number | null;
  to: string | number | null;
  label?: string;
  unit?: string;
  kind?: ValueChange['kind'];
  direction?: 'up' | 'down' | 'neutral';
  variant: 'inline' | 'preview' | 'hero';
}

type SizeCfg = {
  old: number;
  arrow: number;
  neu: number;
  pill: number;
  gap: number;
};

const SIZES: Record<ValueDiffProps['variant'], SizeCfg> = {
  inline: { old: 12, arrow: 11, neu: 12.5, pill: 11, gap: 6 },
  preview: { old: 12, arrow: 11, neu: 12.5, pill: 11, gap: 6 },
  hero: { old: 18, arrow: 18, neu: 34, pill: 13, gap: 10 },
};

const tabular = { fontVariant: ['tabular-nums' as const] };

export default function ValueDiff({ from, to, label, unit, kind = 'text', direction, variant }: ValueDiffProps) {
  const z = SIZES[variant];
  const hero = variant === 'hero';
  const isSetFirstTime = from === null || from === undefined || from === '';
  const isCleared = to === null || to === undefined || to === '';

  const oldText = formatChangeValue(from ?? null, kind);
  const newText = formatChangeValue(to ?? null, kind);

  // ── Status: two pills, not bare text ──
  if (kind === 'status') {
    const failure = isFailureStatus(to);
    const takedown = direction === 'down' && !failure; // intentional take-down reads neutral, not red
    return (
      <View style={[styles.row, { gap: z.gap }]}>
        {!isSetFirstTime ? (
          <>
            <View style={[styles.pill, styles.pillOld]}>
              <Text style={[styles.pillText, styles.pillTextOld, { fontSize: z.pill }]} numberOfLines={1}>
                {humanizeStatus(from)}
              </Text>
            </View>
            <Icon name="arrow-right" size={z.arrow} color={CHAT_COLORS.faint} />
          </>
        ) : null}
        <View
          style={[
            styles.pill,
            failure ? styles.pillFail : takedown ? styles.pillNeutral : styles.pillNew,
          ]}
        >
          <Text
            style={[
              styles.pillText,
              { fontSize: z.pill },
              failure ? styles.pillTextFail : takedown ? styles.pillTextNeutral : styles.pillTextNew,
            ]}
            numberOfLines={1}
          >
            {humanizeStatus(to)}
          </Text>
        </View>
      </View>
    );
  }

  // ── Set for the first time: just the new value + a quiet "Added" tag ──
  if (isSetFirstTime && !isCleared) {
    return (
      <View style={[styles.row, { gap: z.gap }]}>
        <Text style={[styles.newText, tabular, { fontSize: z.neu }]} numberOfLines={hero ? 2 : 1}>
          {newText}
          {unit ? <Text style={[styles.unit, { fontSize: z.old }]}> {unit}</Text> : null}
        </Text>
        {variant !== 'hero' ? <Text style={[styles.addedTag, { fontSize: z.pill }]}>Added</Text> : null}
      </View>
    );
  }

  // ── Cleared: old struck, no green target ──
  if (isCleared) {
    return (
      <View style={[styles.row, { gap: z.gap }]}>
        <Text style={[styles.oldText, tabular, { fontSize: z.old }]} numberOfLines={1}>
          {oldText}
        </Text>
        <Text style={[styles.clearedTag, { fontSize: z.pill }]}>cleared</Text>
      </View>
    );
  }

  // ── The common case: old (red strike) -> new (green) ──
  const delta = hero ? deltaChip(from, to, kind, direction) : null;

  return (
    <View style={hero ? styles.heroCol : undefined}>
      <View style={[styles.row, { gap: z.gap }]}>
        <Text style={[styles.oldText, tabular, { fontSize: z.old }, hero && styles.oldTextHero]} numberOfLines={1}>
          {oldText}
        </Text>
        <Icon name="arrow-right" size={z.arrow} color={CHAT_COLORS.faint} />
        <Text style={[styles.newText, tabular, { fontSize: z.neu }]} numberOfLines={1}>
          {newText}
          {unit ? <Text style={[styles.unit, { fontSize: hero ? 14 : z.old }]}> {unit}</Text> : null}
        </Text>
      </View>
      {delta ? (
        <View style={[styles.deltaChip, delta.tone === 'down' && styles.deltaChipDown, delta.tone === 'up' && styles.deltaChipUp]}>
          <Text
            style={[
              styles.deltaText,
              delta.tone === 'down' && styles.deltaTextDown,
              delta.tone === 'up' && styles.deltaTextUp,
            ]}
          >
            {delta.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

type Delta = { label: string; tone: 'up' | 'down' | 'neutral' };

function deltaChip(
  from: ValueDiffProps['from'],
  to: ValueDiffProps['to'],
  kind: ValueChange['kind'],
  direction?: ValueDiffProps['direction'],
): Delta | null {
  const a = numericOf(from);
  const b = numericOf(to);
  if (a === null || b === null) return null;
  const diff = b - a;
  if (diff === 0) return null;
  const tone: Delta['tone'] = direction ?? (diff < 0 ? 'down' : 'up');
  const sign = diff < 0 ? '−' : '+';
  const abs = Math.abs(diff);
  if (kind === 'price') {
    const pct = a !== 0 ? Math.round((diff / a) * 100) : null;
    const money = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
    const grouped = money.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return { label: `${sign}$${grouped}${pct !== null ? ` · ${pct > 0 ? '+' : ''}${pct}%` : ''}`, tone };
  }
  // inventory / counts — neutral framing, no good/bad
  return { label: `${sign}${abs}`, tone: 'neutral' };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline' },
  heroCol: { gap: 12 },

  oldText: {
    color: CHAT_COLORS.error,
    fontFamily: CHAT_FONT.medium,
    textDecorationLine: 'line-through',
    textDecorationColor: 'rgba(239,68,68,0.7)',
    opacity: 0.9,
  },
  oldTextHero: {
    color: CHAT_COLORS.errorDeep,
    textDecorationColor: 'rgba(185,28,28,0.5)',
  },
  newText: {
    color: CHAT_COLORS.brandDeep,
    fontFamily: CHAT_FONT.semibold,
  },
  unit: {
    color: CHAT_COLORS.faint,
    fontFamily: CHAT_FONT.regular,
  },
  addedTag: {
    color: CHAT_COLORS.brandDeep,
    fontFamily: CHAT_FONT.semibold,
    opacity: 0.8,
  },
  clearedTag: {
    color: CHAT_COLORS.dim,
    fontFamily: CHAT_FONT.medium,
    fontStyle: 'italic',
  },

  // Status pills
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontFamily: CHAT_FONT.semibold },
  pillOld: { backgroundColor: CHAT_COLORS.bubble },
  pillTextOld: {
    color: CHAT_COLORS.faint,
    fontFamily: CHAT_FONT.medium,
    textDecorationLine: 'line-through',
    textDecorationColor: 'rgba(113,113,122,0.5)',
  },
  pillNew: { backgroundColor: CHAT_COLORS.brandSoft },
  pillTextNew: { color: CHAT_COLORS.brandDeep },
  pillNeutral: { backgroundColor: CHAT_COLORS.bubble },
  pillTextNeutral: { color: CHAT_COLORS.dim },
  pillFail: { backgroundColor: CHAT_COLORS.errorSurface },
  pillTextFail: { color: CHAT_COLORS.errorDeep },

  // Hero delta chip
  deltaChip: {
    alignSelf: 'flex-start',
    backgroundColor: CHAT_COLORS.bubble,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  deltaChipDown: { backgroundColor: 'rgba(185,28,28,0.08)' },
  deltaChipUp: { backgroundColor: CHAT_COLORS.brandSoft },
  deltaText: { fontSize: 12.5, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.dim },
  deltaTextDown: { color: CHAT_COLORS.errorDeep },
  deltaTextUp: { color: CHAT_COLORS.brandDeep },
});
