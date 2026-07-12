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
import PlatformLogo from '../PlatformLogo';

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

// ── useCountUp — a dependency-free, unmount-safe count-up ───────────────────────
// Drives a number from its last shown value up (or down) to `target` with an
// ease-out over `duration`ms, using the RN-global requestAnimationFrame. It only
// (re)animates when `target` changes materially — a poll tick that re-renders with
// the same target is a no-op, so the hero doesn't restart on every 20s refresh.
function useCountUp(target: number, duration = 800): number {
  const [display, setDisplay] = React.useState(0);
  const displayRef = React.useRef(0);
  const rafRef = React.useRef<number | null>(null);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  React.useEffect(() => {
    const from = displayRef.current;
    // No material change → leave the shown value exactly where it is (no restart).
    if (from === target) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const start = Date.now();
    const span = target - from;
    const tick = () => {
      if (!mountedRef.current) return;
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const next = t >= 1 ? target : Math.round(from + span * eased);
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [target, duration]);

  return display;
}

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
// When `value` is a number and `animate` is set, the numeral counts up from 0 on
// first appearance (and re-animates only when the value changes materially — see
// useCountUp). A non-numeric `value` (or animate off) renders verbatim.
export function HeroNumeral({
  value,
  label,
  animate = false,
}: {
  value: React.ReactNode;
  label: string;
  animate?: boolean;
}) {
  const isNumber = typeof value === 'number';
  const animating = animate && isNumber;
  // Hooks stay unconditional: the count-up runs against 0 (a no-op) when we're
  // not animating a numeric value.
  const counted = useCountUp(animating ? (value as number) : 0);
  const shown = animating ? counted : value;
  return (
    <View style={s.hero}>
      <Text style={s.heroNumeral} numberOfLines={1} allowFontScaling={false}>
        {shown}
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

// ── CenteredHeading — the semibold centered line that titles a section/explainer ─
export function CenteredHeading({ children }: { children: React.ReactNode }) {
  return <Text style={s.centeredHeading}>{children}</Text>;
}

// ── SectionCaption — a small muted caption above a group of rows ("Your stores") ─
export function SectionCaption({ children }: { children: React.ReactNode }) {
  return <Text style={s.sectionCaption}>{children}</Text>;
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

// ── ExplainerCard — NumberedCard's description-only sibling for the intro pass ──
// Pure teaching card: "N." · bold title · a full muted DESCRIPTION (up to 3 lines).
// No count, no chevron, no active/done state — it explains a step, it isn't one.
export function ExplainerCard({
  index,
  title,
  description,
}: {
  index: number;
  title: string;
  description: string;
}) {
  return (
    <View style={s.card}>
      <View style={s.cardLeading}>
        <Text style={s.cardIndex}>{index}.</Text>
      </View>
      <View style={s.cardBody}>
        <Text style={s.cardTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={s.explainerDesc} numberOfLines={3}>
          {description}
        </Text>
      </View>
    </View>
  );
}

// ── AccountRow — Avec's account list row: logo/initial circle · bold name +
// muted detail · right-aligned count+chevron (attention) or a quiet muted state ─
// Used for the hub's "Your stores" list. `count` renders the amber-free muted
// "N ›"; when there's no count, `rightLabel` (e.g. "Synced") shows in its place.
export function AccountRow({
  logoType,
  name,
  detail,
  count,
  rightLabel,
  highlighted = false,
  onPress,
}: {
  logoType?: string;
  name: string;
  detail?: string;
  count?: number | null;
  rightLabel?: string;
  highlighted?: boolean;
  onPress?: () => void;
}) {
  const Comp: any = onPress ? TouchableOpacity : View;
  const showCount = typeof count === 'number' && count > 0;
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <Comp
      activeOpacity={0.85}
      onPress={onPress}
      style={[s.accountRow, highlighted && s.accountRowHighlighted]}
    >
      <View style={s.accountAvatar}>
        {logoType ? (
          <PlatformLogo type={logoType} size={22} />
        ) : (
          <Text style={s.accountInitial}>{initial}</Text>
        )}
      </View>
      <View style={s.accountBody}>
        <Text style={s.accountName} numberOfLines={1}>
          {name}
        </Text>
        {!!detail && (
          <Text style={s.accountDetail} numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      <View style={s.accountRight}>
        {showCount ? (
          <Text style={s.accountCount}>{count}</Text>
        ) : rightLabel ? (
          <Text style={s.accountRightLabel}>{rightLabel}</Text>
        ) : null}
        {onPress ? (
          <MaterialCommunityIcons name="chevron-right" size={20} color={IC.muted} />
        ) : null}
      </View>
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
  centeredHeading: { fontSize: 20, fontWeight: '600', color: IC.ink, textAlign: 'center', letterSpacing: -0.4, lineHeight: 26, paddingHorizontal: 20 },
  sectionCaption: { fontSize: 13, color: IC.muted, letterSpacing: 0.1, marginBottom: 12, marginLeft: 4 },

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
  explainerDesc: { fontSize: 15, color: IC.muted, marginTop: 4, lineHeight: 21 },

  // Account row (Your stores)
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: IC.card, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 10 },
  accountRowHighlighted: { borderWidth: 1, borderColor: IC.accent, backgroundColor: IC.cardActive, paddingVertical: 12, paddingHorizontal: 13 },
  accountAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: IC.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  accountInitial: { fontSize: 17, fontWeight: '700', color: IC.ink },
  accountBody: { flex: 1, minWidth: 0 },
  accountName: { fontSize: 16, fontWeight: '700', color: IC.ink, letterSpacing: -0.2 },
  accountDetail: { fontSize: 14, color: IC.muted, marginTop: 2, textTransform: 'capitalize' },
  accountRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  accountCount: { fontSize: 16, color: IC.muted, fontVariant: ['tabular-nums'] },
  accountRightLabel: { fontSize: 14, color: IC.muted },

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
