// Quest design system — shared primitives for the import redesign.
// Spec: "Match & Optimizer Wireframes" eng handoff (HO7 — build first).
// Two reusable components carry the new system: QuestBar + QuestRow.
// QuestDone / QuestCTA / LessonShell assemble the lobby → lesson → done flow.

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ViewStyle,
  StyleProp,
  ScrollView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// ─── Tokens (extend existing — Anorha green #8cc63f/#70a826) ───────────────
export const QUEST = {
  bg: '#FAF7EE',
  surface: '#FFFFFF',
  ink: '#15181A',
  sub: '#6B6F73',
  muted: '#9B9D9F',
  border: '#ECE5CC',
  borderDark: '#D8D2BD',
  green: '#7AB93D',
  greenD: '#5A8420',
  greenSoft: '#F2F8E5',
  greenBorder: '#D4E3A8',
  yellow: '#F5B82E',
  yellowD: '#C4900A',
  yellowSoft: '#FFF6D9',
  yellowBorder: '#E8C870',
  orange: '#E07A3C',
  orangeD: '#B0541F',
  orangeSoft: '#FBEFE3',
  orangeBorder: '#F2C9A4',
  blue: '#3D7BC4',
  blueD: '#2A5A95',
  blueSoft: '#E5EEFB',
  // v2 import-lobby palette (Duolingo path + match lobby).
  // Amber is the single "active / next step" highlight; locked steps go grey.
  amber: '#F5A623',
  amberD: '#CC8312',
  amberSoft: '#FFF1D6',
  lock: '#ACAFB3',
  lockD: '#83878B',
  danger: '#E5484D',
  dangerSoft: '#FCEBEC',
  dangerBorder: '#F3B6B8',
} as const;

// Deterministic image-placeholder swatches (the colored squares in the
// inventory list when a product has no photo yet).
export const SWATCHES = [
  '#2F80ED', '#27AE60', '#F2994A', '#9B51E0',
  '#EB5757', '#2D9CDB', '#BB6BD9', '#F2C94C',
] as const;

export function swatchFor(seed: string | number): string {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}

export const QFONT = {
  x: 'PlusJakartaSans_800ExtraBold',
  b: 'PlusJakartaSans_700Bold',
  sb: 'PlusJakartaSans_600SemiBold',
  m: 'PlusJakartaSans_500Medium',
} as const;

// Chunky "0 Npx 0" offset shadow (Duolingo-ish). iOS uses a hard shadow,
// Android falls back to elevation.
export function hardShadow(color: string, depth = 3) {
  return Platform.select({
    ios: {
      shadowColor: color,
      shadowOffset: { width: 0, height: depth },
      shadowOpacity: 1,
      shadowRadius: 0,
    },
    android: { elevation: depth },
    default: {},
  }) as ViewStyle;
}

export interface QuestSegment {
  /** Relative width weight (item count). */
  n: number;
  done?: boolean;
  /** Active-segment fill color. */
  color?: string;
  /** Inline label shown only on the active segment. */
  label?: string;
  /** Tiny caption under the segment. */
  short?: string;
}

// ─── QuestBar — segmented header, the persistent navigation anchor ─────────
export function QuestBar({
  segments,
  activeIdx,
  close = 'back',
  onClose,
  right,
}: {
  segments: QuestSegment[];
  activeIdx: number;
  close?: 'back' | 'x';
  onClose?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={kit.barWrap}>
      <TouchableOpacity
        onPress={onClose}
        style={kit.backBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons
          name={close === 'x' ? 'close' : 'chevron-left'}
          size={18}
          color={QUEST.ink}
        />
      </TouchableOpacity>

      <View style={kit.barCol}>
        <View style={kit.barTrack}>
          {segments.map((s, i) => {
            const isActive = i === activeIdx;
            const fill = s.done
              ? QUEST.green
              : isActive
                ? s.color || QUEST.ink
                : '#EAE4CD';
            return (
              <View key={i} style={[kit.barSeg, { flexGrow: Math.max(s.n, 1), backgroundColor: fill }]}>
                {isActive && !!s.label && (
                  <Text numberOfLines={1} style={kit.barSegLabel}>
                    {s.label.toUpperCase()}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
        <View style={kit.barCaptions}>
          {segments.map((s, i) => (
            <Text
              key={i}
              numberOfLines={1}
              style={[
                kit.barCaption,
                {
                  flexGrow: Math.max(s.n, 1),
                  color: s.done ? QUEST.greenD : i === activeIdx ? QUEST.ink : QUEST.muted,
                },
              ]}
            >
              {s.n} {s.short || ''}
            </Text>
          ))}
        </View>
      </View>

      {right}
    </View>
  );
}

// ─── CountTile — the "big number" element ──────────────────────────────────
export function CountTile({
  state,
  accent,
  accentDark,
  count,
  unit,
  size = 64,
}: {
  state: 'done' | 'active' | 'locked';
  accent: string;
  accentDark: string;
  count: number | string;
  unit: string;
  size?: number;
}) {
  const done = state === 'done';
  const active = state === 'active';
  return (
    <View
      style={[
        kit.tile,
        {
          width: size,
          height: size,
          backgroundColor: done ? QUEST.greenSoft : active ? accent + '1F' : QUEST.bg,
          borderColor: done ? QUEST.greenBorder : active ? accentDark : QUEST.border,
        },
      ]}
    >
      {done ? (
        <MaterialCommunityIcons name="check-bold" size={size * 0.42} color={QUEST.greenD} />
      ) : (
        <>
          <Text style={[kit.tileCount, { fontSize: size * 0.4 }]} numberOfLines={1}>
            {count}
          </Text>
          <Text style={kit.tileUnit} numberOfLines={1}>
            {unit.toUpperCase()}
          </Text>
        </>
      )}
    </View>
  );
}

// ─── QuestRow — count tile + title + sub + state pill ──────────────────────
export function QuestRow({
  state,
  accent,
  accentDark,
  count,
  unit,
  title,
  sub,
  onPress,
}: {
  state: 'done' | 'active' | 'locked';
  accent: string;
  accentDark: string;
  count: number | string;
  unit: string;
  title: string;
  sub: string;
  onPress?: () => void;
}) {
  const done = state === 'done';
  const active = state === 'active';
  const locked = state === 'locked';

  let pill: React.ReactNode = null;
  if (done) {
    pill = (
      <View style={[kit.pill, { backgroundColor: QUEST.greenSoft, borderColor: QUEST.greenBorder }]}>
        <Text style={[kit.pillText, { color: QUEST.greenD }]}>Done</Text>
      </View>
    );
  } else if (active) {
    pill = (
      <View style={[kit.pill, kit.pillActive, hardShadow('#000', 2)]}>
        <Text style={[kit.pillText, { color: '#fff' }]}>Start</Text>
        <MaterialCommunityIcons name="chevron-right" size={13} color="#fff" />
      </View>
    );
  } else {
    pill = (
      <View style={[kit.pill, { borderColor: QUEST.border }]}>
        <Text style={[kit.pillText, { color: QUEST.muted }]}>Locked</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={locked ? 1 : 0.85}
      disabled={locked || !onPress}
      onPress={onPress}
      style={[
        kit.row,
        {
          borderColor: active ? QUEST.ink : QUEST.border,
          borderWidth: active ? 1.5 : 1,
          opacity: locked ? 0.55 : 1,
        },
        active ? hardShadow('rgba(21,24,26,0.9)', 3) : undefined,
      ]}
    >
      <CountTile state={state} accent={accent} accentDark={accentDark} count={count} unit={unit} />
      <View style={kit.rowBody}>
        <Text style={kit.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={kit.rowSub} numberOfLines={2}>
          {sub}
        </Text>
      </View>
      {pill}
    </TouchableOpacity>
  );
}

// ─── QuestCTA — generic pill button (footers / lesson actions) ─────────────
export function QuestCTA({
  label,
  icon,
  color = QUEST.ink,
  dark = '#000',
  textColor = '#fff',
  disabled,
  onPress,
  style,
  flex,
}: {
  label: string;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  color?: string;
  dark?: string;
  textColor?: string;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  flex?: number;
}) {
  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.85}
      disabled={disabled}
      onPress={onPress}
      style={[
        kit.cta,
        { backgroundColor: color, opacity: disabled ? 0.35 : 1 },
        flex != null ? { flex } : null,
        hardShadow(dark, 3),
        style,
      ]}
    >
      {!!icon && <MaterialCommunityIcons name={icon} size={16} color={textColor} />}
      <Text style={[kit.ctaText, { color: textColor }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── LessonShell — QuestBar + the focused white ink-bordered card ──────────
export function LessonShell({
  segments,
  activeIdx,
  onClose,
  topInset,
  children,
  scroll = true,
}: {
  segments: QuestSegment[];
  activeIdx: number;
  onClose?: () => void;
  topInset: number;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const body = (
    <View style={kit.lessonCard}>{children}</View>
  );
  return (
    <View style={[kit.screen, { paddingTop: topInset + 6 }]}>
      <QuestBar segments={segments} activeIdx={activeIdx} close="x" onClose={onClose} />
      {scroll ? (
        <ScrollView
          contentContainerStyle={kit.lessonScroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={kit.lessonScroll}>{body}</View>
      )}
    </View>
  );
}

// ─── QuestDone — the celebrate + up-next screen between lessons ────────────
export function QuestDone({
  segments,
  activeIdx,
  onClose,
  topInset,
  icon = 'check-bold',
  count,
  label,
  next,
  onContinue,
}: {
  segments: QuestSegment[];
  activeIdx: number;
  onClose?: () => void;
  topInset: number;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  count: number | string;
  label: string;
  next?: {
    count: number | string;
    unit: string;
    title: string;
    sub: string;
    accent: string;
    tag?: string;
  };
  onContinue?: () => void;
}) {
  return (
    <View style={[kit.screen, { paddingTop: topInset + 6 }]}>
      <QuestBar segments={segments} activeIdx={activeIdx} close="x" onClose={onClose} />
      <View style={kit.donePad}>
        <View style={kit.doneBadge}>
          <MaterialCommunityIcons name={icon} size={48} color="#fff" />
        </View>
        <Text style={kit.doneCount}>{count}</Text>
        <Text style={kit.doneLabel}>{label}</Text>

        {next && (
          <View style={kit.nextCard}>
            <View
              style={[
                kit.nextTile,
                { backgroundColor: next.accent + '1F', borderColor: next.accent },
              ]}
            >
              <Text style={kit.nextTileCount}>{next.count}</Text>
              <Text style={kit.nextTileUnit}>{next.unit.toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={kit.nextTag}>{(next.tag || 'UP NEXT').toUpperCase()}</Text>
              <Text style={kit.nextTitle} numberOfLines={1}>
                {next.title}
              </Text>
              <Text style={kit.nextSub} numberOfLines={2}>
                {next.sub}
              </Text>
            </View>
          </View>
        )}

        <View style={{ marginTop: 28, width: '100%' }}>
          <QuestCTA label="Continue" icon="chevron-right" onPress={onContinue} />
        </View>
        <Text style={kit.doneHint}>or close to step away</Text>
      </View>
    </View>
  );
}

const kit = StyleSheet.create({
  screen: { flex: 1, backgroundColor: QUEST.bg },

  // QuestBar
  barWrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 14,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: QUEST.surface,
    borderWidth: 1,
    borderColor: QUEST.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barCol: { flex: 1, minWidth: 0, paddingTop: 4 },
  barTrack: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#EAE4CD',
  },
  barSeg: {
    flexBasis: 0,
    marginRight: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barSegLabel: {
    fontSize: 9,
    fontFamily: QFONT.x,
    color: QUEST.ink,
    letterSpacing: 0.3,
    paddingHorizontal: 4,
  },
  barCaptions: { flexDirection: 'row', marginTop: 6 },
  barCaption: { flexBasis: 0, fontSize: 10, fontFamily: QFONT.b },

  // CountTile
  tile: {
    flexShrink: 0,
    borderWidth: 1.5,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileCount: {
    fontFamily: QFONT.x,
    color: QUEST.ink,
    letterSpacing: -0.5,
    lineHeight: undefined,
  },
  tileUnit: {
    fontSize: 9,
    fontFamily: QFONT.b,
    color: QUEST.sub,
    marginTop: 3,
    letterSpacing: 0.4,
  },

  // QuestRow
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: QUEST.surface,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontSize: 15,
    fontFamily: QFONT.b,
    color: QUEST.ink,
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  rowSub: { fontSize: 12, fontFamily: QFONT.m, color: QUEST.sub, lineHeight: 16 },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 100,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pillActive: { backgroundColor: QUEST.ink, borderColor: QUEST.ink },
  pillText: { fontSize: 12, fontFamily: QFONT.b },

  // QuestCTA
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 100,
  },
  ctaText: { fontSize: 14, fontFamily: QFONT.b, letterSpacing: -0.1 },

  // LessonShell
  lessonScroll: { paddingHorizontal: 18, paddingBottom: 40 },
  lessonCard: {
    backgroundColor: QUEST.surface,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: QUEST.ink,
    padding: 18,
    ...hardShadow('rgba(21,24,26,0.92)', 4),
  },

  // QuestDone
  donePad: { paddingHorizontal: 24, paddingTop: 40, alignItems: 'center' },
  doneBadge: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: QUEST.green,
    borderWidth: 2.5,
    borderColor: QUEST.greenD,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
    ...hardShadow(QUEST.greenD, 5),
  },
  doneCount: {
    fontFamily: QFONT.x,
    fontSize: 56,
    color: QUEST.ink,
    letterSpacing: -2,
  },
  doneLabel: {
    fontSize: 15,
    fontFamily: QFONT.b,
    color: QUEST.sub,
    marginTop: 6,
    textAlign: 'center',
  },
  nextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    alignSelf: 'stretch',
    backgroundColor: QUEST.surface,
    borderWidth: 1,
    borderColor: QUEST.border,
    borderRadius: 18,
    padding: 16,
    marginTop: 34,
  },
  nextTile: {
    width: 60,
    height: 60,
    flexShrink: 0,
    borderWidth: 1.5,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextTileCount: { fontFamily: QFONT.x, fontSize: 22, color: QUEST.ink },
  nextTileUnit: {
    fontSize: 8.5,
    fontFamily: QFONT.x,
    color: QUEST.sub,
    marginTop: 3,
    letterSpacing: 0.4,
  },
  nextTag: {
    fontSize: 9.5,
    fontFamily: QFONT.x,
    color: QUEST.sub,
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  nextTitle: { fontSize: 14, fontFamily: QFONT.b, color: QUEST.ink, letterSpacing: -0.2 },
  nextSub: { fontSize: 11.5, fontFamily: QFONT.m, color: QUEST.sub, marginTop: 2 },
  doneHint: { marginTop: 14, fontSize: 12, fontFamily: QFONT.sb, color: QUEST.muted },
});
