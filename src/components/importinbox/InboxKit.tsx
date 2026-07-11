// InboxKit — Avec-inspired primitives for the Import Inbox wrapper screens.
//
// The owner rejected the gamified first cut (icon tiles, green-tinted rows, count
// pills with arrows, heavy bold hero). This is the calm, editorial re-skin pulled
// from "Avec", the email-backlog app he loves — translated from its dark-mode
// reference into this app's light-only world:
//   • enormous whitespace, centered composition, system font (weights only)
//   • near-black ink + ONE muted gray + ONE accent (the brand green)
//   • no icons in rows beyond numbers / checks / chevrons
//   • no tinted card backgrounds, no bordered badge pills
//
// Used ONLY by ImportHubScreen, PublishConfirmationScreen's import-complete
// variant, and CSVColumnMappingScreen. Nothing else should import from here.

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

// ── Tokens ───────────────────────────────────────────────────────────────────
// The whole surface lives on these. `accent` is the ONLY saturated color allowed.
export const IC = {
  bg: '#FFFFFF',
  card: '#F4F4F2', // soft surface for every card / row
  cardActive: '#FFFFFF', // the current step pops a touch whiter
  ink: '#111214', // near-black text
  muted: '#8A8A8E', // the single muted gray (labels, subs, counts)
  hairline: '#E6E6E3', // dividers / rails
  accent: '#93C822', // brand green — the ONE saturated color
  accentInk: '#FFFFFF', // text/glyph on accent
  secondary: '#F1F1EF', // secondary (soft-gray) pill face
} as const;

// ── InboxHeader — 44px row: bare chevron-left (no circle) · centered title ─────
export function InboxHeader({
  title,
  onBack,
  right,
}: {
  title?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={s.header}>
      <TouchableOpacity
        onPress={onBack}
        hitSlop={HIT}
        activeOpacity={0.6}
        style={s.headerSide}
        accessibilityLabel="Go back"
      >
        <MaterialCommunityIcons name="chevron-left" size={26} color={IC.ink} />
      </TouchableOpacity>
      {!!title && (
        <View style={s.headerTitleWrap} pointerEvents="none">
          <Text style={s.headerTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
      )}
      <View style={[s.headerSide, s.headerRight]}>{right}</View>
    </View>
  );
}

// ── HeroNumeral — the enormous thin count + a small muted label under it ───────
export function HeroNumeral({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <View style={s.hero}>
      <Text style={s.heroNumeral} numberOfLines={1} allowFontScaling={false}>
        {value}
      </Text>
      <Text style={s.heroLabel}>{label}</Text>
    </View>
  );
}

// ── SuccessCheck — the filled accent circle with a white check ─────────────────
export function SuccessCheck({ size = 72 }: { size?: number }) {
  return (
    <View style={[s.successCircle, { width: size, height: size, borderRadius: size / 2 }]}>
      <MaterialCommunityIcons name="check" size={Math.round(size * 0.5)} color={IC.accentInk} />
    </View>
  );
}

// ── SuccessBlock — check circle · bold title · up to two muted status lines ─────
export function SuccessBlock({
  title,
  lines = [],
  circleSize = 72,
}: {
  title: string;
  lines?: (string | null | undefined)[];
  circleSize?: number;
}) {
  const shown = lines.filter(Boolean) as string[];
  return (
    <View style={s.success}>
      <SuccessCheck size={circleSize} />
      <Text style={s.successTitle}>{title}</Text>
      {shown.map((ln, i) => (
        <Text key={i} style={s.successLine}>
          {ln}
        </Text>
      ))}
    </View>
  );
}

// ── PillButton — full-width rounded pill; the only saturated action ────────────
export function PillButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const secondary = variant === 'secondary';
  const inactive = disabled || loading;
  const dim = disabled && !secondary;
  return (
    <TouchableOpacity
      activeOpacity={inactive ? 1 : 0.9}
      disabled={inactive}
      onPress={onPress}
      style={[s.pill, secondary ? s.pillSecondary : s.pillPrimary, dim && s.pillDim, style]}
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator color={secondary ? IC.ink : IC.accentInk} />
      ) : (
        <Text
          style={[
            s.pillText,
            secondary ? s.pillTextSecondary : s.pillTextPrimary,
            dim && s.pillTextDim,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

// ── CenteredParagraph — the calm explanatory line(s) under a header/hero ───────
export function CenteredParagraph({ children }: { children: React.ReactNode }) {
  return <Text style={s.paragraph}>{children}</Text>;
}

// ── NumberedCard — Avec's numbered step: "N." · bold title · muted sub · N › ────
// Done → the number becomes a plain accent check; active → a whiter surface with a
// hairline accent border. The count renders as a bare muted "N ›" (no pill/icons).
export function NumberedCard({
  index,
  done = false,
  title,
  sub,
  count,
  active = false,
  onPress,
}: {
  index: number;
  done?: boolean;
  title: string;
  sub?: string;
  count?: number | null;
  active?: boolean;
  onPress?: () => void;
}) {
  const Comp: any = onPress ? TouchableOpacity : View;
  const showCount = typeof count === 'number' && count > 0;
  return (
    <Comp activeOpacity={0.85} onPress={onPress} style={[s.card, active && s.cardActive]}>
      <View style={s.cardLeading}>
        {done ? (
          <MaterialCommunityIcons name="check" size={22} color={IC.accent} />
        ) : (
          <Text style={s.cardIndex}>{index}.</Text>
        )}
      </View>
      <View style={s.cardBody}>
        <Text style={s.cardTitle} numberOfLines={1}>
          {title}
        </Text>
        {!!sub && (
          <Text style={s.cardSub} numberOfLines={2}>
            {sub}
          </Text>
        )}
      </View>
      {showCount && (
        <View style={s.cardCount}>
          <Text style={s.cardCountText}>{count}</Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color={IC.muted} />
        </View>
      )}
    </Comp>
  );
}

// ── GroupRow — Avec's plain row: bold label left · muted count/chevron right ────
// Its own soft card. Used for the expanded per-connection rows (compact + indented).
export function GroupRow({
  label,
  count,
  right,
  onPress,
  compact = false,
  style,
}: {
  label: string;
  count?: number | null;
  right?: React.ReactNode;
  onPress?: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const Comp: any = onPress ? TouchableOpacity : View;
  const showCount = typeof count === 'number' && count > 0;
  return (
    <Comp
      activeOpacity={0.85}
      onPress={onPress}
      style={[s.groupRow, compact && s.groupRowCompact, style]}
    >
      <Text style={s.groupLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={s.groupRight}>
        {right != null ? right : showCount ? <Text style={s.groupCount}>{count}</Text> : null}
        {onPress ? <MaterialCommunityIcons name="chevron-right" size={20} color={IC.muted} /> : null}
      </View>
    </Comp>
  );
}

// ── FieldCard — CSV mapping row: bold field (+ muted Required) · sample · status ─
// Right side is either a muted "Choose ›" or the mapped column in ink + accent check.
export function FieldCard({
  label,
  required = false,
  mapped,
  sample,
  onPress,
}: {
  label: string;
  required?: boolean;
  mapped?: string;
  sample?: string;
  onPress?: () => void;
}) {
  const isMapped = !!mapped;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={s.fieldCard}
      accessibilityLabel={`Map ${label}`}
    >
      <View style={s.cardBody}>
        <View style={s.fieldLabelRow}>
          <Text style={s.cardTitle} numberOfLines={1}>
            {label}
          </Text>
          {required && <Text style={s.fieldRequired}>Required</Text>}
        </View>
        {isMapped && !!sample && (
          <Text style={s.cardSub} numberOfLines={1}>
            {sample}
          </Text>
        )}
      </View>
      <View style={s.fieldRight}>
        {isMapped ? (
          <>
            <Text style={s.fieldMapped} numberOfLines={1}>
              {mapped}
            </Text>
            <MaterialCommunityIcons name="check" size={18} color={IC.accent} />
          </>
        ) : (
          <>
            <Text style={s.fieldChoose}>Choose</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={IC.muted} />
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── TextTabs — plain centered text tabs; bold + ink underline on the active one ─
export function TextTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <View style={s.tabs}>
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <TouchableOpacity key={t.key} activeOpacity={0.7} onPress={() => onChange(t.key)} style={s.tab}>
            <Text style={[s.tabText, on ? s.tabTextOn : s.tabTextOff]}>{t.label}</Text>
            <View style={[s.tabUnderline, on && s.tabUnderlineOn]} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── ProgressLine — centered muted label over a hairline-thin accent bar ────────
export function ProgressLine({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={s.progress}>
      <Text style={s.progressLabel}>{label}</Text>
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${clamped}%` }]} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Header
  header: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  headerSide: { width: 40, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  headerRight: { alignItems: 'flex-end', marginLeft: 'auto' },
  headerTitleWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '600', color: IC.ink, letterSpacing: -0.2 },

  // Hero numeral
  hero: { alignItems: 'center', paddingTop: 36, paddingBottom: 30 },
  heroNumeral: { fontSize: 84, fontWeight: '300', color: IC.ink, letterSpacing: -3, lineHeight: 92, textAlign: 'center' },
  heroLabel: { fontSize: 16, color: IC.muted, marginTop: 4, textAlign: 'center' },

  // Success composition
  successCircle: { backgroundColor: IC.accent, alignItems: 'center', justifyContent: 'center' },
  success: { alignItems: 'center', paddingHorizontal: 24 },
  successTitle: { fontSize: 26, fontWeight: '700', color: IC.ink, letterSpacing: -0.6, marginTop: 20, textAlign: 'center' },
  successLine: { fontSize: 15, color: IC.muted, marginTop: 8, textAlign: 'center', lineHeight: 21 },

  // Pill button
  pill: { height: 54, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  pillPrimary: { backgroundColor: IC.accent },
  pillSecondary: { backgroundColor: IC.secondary },
  pillDim: { backgroundColor: IC.secondary },
  pillText: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  pillTextPrimary: { color: IC.accentInk },
  pillTextSecondary: { color: IC.ink },
  pillTextDim: { color: IC.muted },

  // Paragraph
  paragraph: { fontSize: 17, color: IC.muted, textAlign: 'center', lineHeight: 24, paddingHorizontal: 16 },

  // Numbered card
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: IC.card, borderRadius: 20, paddingVertical: 18, paddingHorizontal: 18, marginBottom: 12 },
  cardActive: { backgroundColor: IC.cardActive, borderWidth: 1, borderColor: IC.accent, paddingVertical: 17, paddingHorizontal: 17 },
  cardLeading: { width: 22, alignItems: 'flex-start', justifyContent: 'flex-start', paddingTop: 1 },
  cardIndex: { fontSize: 17, fontWeight: '400', color: IC.muted, lineHeight: 22 },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: IC.ink, letterSpacing: -0.2, lineHeight: 22 },
  cardSub: { fontSize: 15, color: IC.muted, marginTop: 3, lineHeight: 20 },
  cardCount: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: 1 },
  cardCountText: { fontSize: 16, color: IC.muted, fontVariant: ['tabular-nums'] },

  // Group row
  groupRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: IC.card, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 18, marginBottom: 10 },
  groupRowCompact: { paddingVertical: 13, paddingHorizontal: 16, borderRadius: 14 },
  groupLabel: { flex: 1, fontSize: 16, fontWeight: '700', color: IC.ink, letterSpacing: -0.2 },
  groupRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  groupCount: { fontSize: 16, color: IC.muted, fontVariant: ['tabular-nums'] },

  // Field card (CSV)
  fieldCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: IC.card, borderRadius: 20, paddingVertical: 16, paddingHorizontal: 18, marginBottom: 12 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldRequired: { fontSize: 12, fontWeight: '400', color: IC.muted },
  fieldRight: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '46%', flexShrink: 0 },
  fieldMapped: { fontSize: 15, fontWeight: '600', color: IC.ink, flexShrink: 1 },
  fieldChoose: { fontSize: 15, color: IC.muted },

  // Text tabs
  tabs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 26 },
  tab: { alignItems: 'center', paddingVertical: 4 },
  tabText: { fontSize: 15, letterSpacing: -0.1 },
  tabTextOn: { color: IC.ink, fontWeight: '700' },
  tabTextOff: { color: IC.muted, fontWeight: '500' },
  tabUnderline: { marginTop: 6, height: 2, width: 18, borderRadius: 1, backgroundColor: 'transparent' },
  tabUnderlineOn: { backgroundColor: IC.ink },

  // Progress line
  progress: { alignItems: 'center', gap: 8 },
  progressLabel: { fontSize: 14, color: IC.muted, textAlign: 'center' },
  progressTrack: { alignSelf: 'stretch', height: 3, borderRadius: 2, backgroundColor: IC.hairline, overflow: 'hidden' },
  progressFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: IC.accent, borderRadius: 2 },
});
