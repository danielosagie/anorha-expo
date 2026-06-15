// ResolveKit — shared primitives for the Match & Optimize v2 resolver flow.
//
// Translated from the Anorha handoff lo-fi (wireframes-match-resolve / -optimize)
// into the app's production style: white surfaces, #E5E7EB hairlines, radius 12,
// the #93C822 green for the single primary action, and system font + weights
// (matching PublishConfirmation / InventoryOrders / AddProduct — no Jakarta).
//
// The shape every resolver shares: a progress header, a short title + kind tag,
// the task body, and ONE footer decision (a single primary + a quiet alt).
// Nothing auto-fixes — the user decides every screen.

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// ── Production color tokens (match the confirmation page) ──────────────────
export const RC = {
  bg: '#FFFFFF',
  ink: '#111827',
  ink2: '#1F2937',
  label: '#71717A',
  muted: '#6B7280',
  faint: '#9CA3AF',
  line: '#E5E7EB',
  surface: '#F9FAFB',
  surface2: '#F3F4F6',
  green: '#93C822',
  greenSoft: '#EEFCE0',
  greenLine: '#BFE58A',
  greenDark: '#4A7C00',
  greenInk: '#34470D',
  danger: '#EF4444',
  dangerSoft: '#FEF2F2',
  dangerLine: '#FECACA',
  dangerInk: '#991B1B',
  warn: '#F59E0B',
  warnSoft: '#FFFBEB',
  warnLine: '#FCD34D',
  warnInk: '#92400E',
  // Lobby (Duolingo path) — orange is the "active step / next action" highlight.
  orange: '#F5A623',
  orangeDark: '#D4831A',
  orangeSoft: '#FFF3DC',
  orangeInk: '#7A4E0A',
  stone: '#7E8488', // locked stepping-stone face
  stoneDark: '#565B5F', // locked stepping-stone depth
  neutralBtn: '#7C8085', // the raised "Fix N Issues" button
  neutralBtnDark: '#565A5E',
  path: '#C9CED1', // dashed trail on white
} as const;

export type Tone = 'ok' | 'warn' | 'danger' | 'muted';
export function toneColor(t?: Tone): string {
  return t === 'warn' ? RC.warn : t === 'danger' ? RC.danger : t === 'muted' ? RC.muted : RC.green;
}

// ── Thumb — product image / hatched placeholder ────────────────────────────
export function Thumb({
  uri,
  size = 28,
  radius = 8,
  label,
}: {
  uri?: string | null;
  size?: number;
  radius?: number;
  label?: string;
}) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius, backgroundColor: RC.surface2 }} />;
  }
  return (
    <View
      style={[
        s.thumbEmpty,
        { width: size, height: size, borderRadius: radius },
      ]}
    >
      {!!label && size >= 40 && <Text style={s.thumbLabel} numberOfLines={1}>{label}</Text>}
    </View>
  );
}

// ── PlatTag — tiny uppercase platform/source tag ───────────────────────────
export function PlatTag({ name }: { name: string }) {
  return (
    <View style={s.platTag}>
      <Text style={s.platTagText}>{name.toUpperCase()}</Text>
    </View>
  );
}

// ── Chip — soft status pill with optional dot ──────────────────────────────
export function Chip({
  label,
  tone = 'ok',
  dot = true,
  size = 12,
}: {
  label: string;
  tone?: Tone;
  dot?: boolean;
  size?: number;
}) {
  const c = toneColor(tone);
  return (
    <View style={[s.chip, { borderColor: c }]}>
      {dot && <View style={[s.chipDot, { backgroundColor: c }]} />}
      <Text style={[s.chipText, { color: c, fontSize: size }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// ── Check — square checkbox ────────────────────────────────────────────────
export function Check({ on = false, size = 20 }: { on?: boolean; size?: number }) {
  return (
    <View
      style={[
        s.check,
        { width: size, height: size, borderColor: on ? RC.green : RC.line, backgroundColor: on ? RC.greenSoft : '#fff' },
      ]}
    >
      {on && <MaterialCommunityIcons name="check" size={size * 0.66} color={RC.greenDark} />}
    </View>
  );
}

// ── Radio — round selector ─────────────────────────────────────────────────
export function Radio({ on = false, size = 18 }: { on?: boolean; size?: number }) {
  return (
    <View style={[s.radio, { width: size, height: size, borderColor: on ? RC.green : RC.line }]}>
      {on && <View style={{ width: size * 0.42, height: size * 0.42, borderRadius: size, backgroundColor: RC.green }} />}
    </View>
  );
}

// ── Row — generic bordered selectable row ──────────────────────────────────
export function Row({
  children,
  active = false,
  dim = false,
  danger = false,
  onPress,
  style,
}: {
  children: React.ReactNode;
  active?: boolean;
  dim?: boolean;
  danger?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const border = danger ? RC.danger : active ? RC.green : RC.line;
  const bg = danger ? RC.dangerSoft : active ? RC.greenSoft : dim ? RC.surface : '#fff';
  const Comp: any = onPress ? TouchableOpacity : View;
  return (
    <Comp
      activeOpacity={0.8}
      onPress={onPress}
      style={[s.row, { borderColor: border, backgroundColor: bg, opacity: dim ? 0.6 : 1 }, style]}
    >
      {children}
    </Comp>
  );
}

// ── OptionRow — radio strategy option (StratOpt / RouteCard) ───────────────
export function OptionRow({
  on,
  title,
  sub,
  icon,
  onPress,
}: {
  on: boolean;
  title: string;
  sub?: string;
  icon?: IconName;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[s.option, { borderColor: on ? RC.green : RC.line, backgroundColor: on ? RC.greenSoft : '#fff' }]}>
      <Radio on={on} />
      {!!icon && <MaterialCommunityIcons name={icon} size={18} color={on ? RC.greenDark : RC.muted} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.optionTitle, { color: on ? RC.greenDark : RC.ink }]} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={s.optionSub} numberOfLines={1}>{sub}</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ── ResultRow — a search/candidate result with a confidence hint ───────────
export function ResultRow({
  on,
  title,
  sub,
  hint,
  uri,
  onPress,
}: {
  on: boolean;
  title: string;
  sub?: string;
  hint?: string;
  uri?: string | null;
  onPress?: () => void;
}) {
  return (
    <Row active={on} onPress={onPress}>
      <Check on={on} size={18} />
      <Thumb uri={uri} size={30} radius={7} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.rowTitle} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={s.rowMeta} numberOfLines={1}>{sub}</Text>}
      </View>
      {!!hint && <Text style={[s.hint, { color: on ? RC.greenDark : RC.faint }]}>{hint}</Text>}
    </Row>
  );
}

// ── Field — a labeled input-looking field (manual fill) ────────────────────
export function Field({
  label,
  value,
  placeholder,
  required,
  half,
  onPress,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  half?: boolean;
  onPress?: () => void;
}) {
  const filled = !!value;
  return (
    <View style={half ? { flex: 1 } : undefined}>
      <View style={s.fieldLabelRow}>
        <Text style={s.fieldLabel}>{label.toUpperCase()}</Text>
        {required && !filled && <Text style={s.fieldReq}>required</Text>}
      </View>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={[s.field, { borderColor: filled ? RC.ink : required ? RC.danger : RC.line, backgroundColor: filled ? '#fff' : RC.surface }]}
      >
        <Text style={[s.fieldValue, { color: filled ? RC.ink : RC.faint }]} numberOfLines={1}>
          {value || placeholder}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Banner — inline warn/danger note ───────────────────────────────────────
export function Banner({ text, tone = 'warn', icon = 'alert' }: { text: string; tone?: 'warn' | 'danger'; icon?: IconName }) {
  const c = tone === 'danger' ? RC.danger : RC.warn;
  const bg = tone === 'danger' ? RC.dangerSoft : RC.warnSoft;
  const ink = tone === 'danger' ? RC.dangerInk : RC.warnInk;
  return (
    <View style={[s.banner, { backgroundColor: bg, borderColor: c }]}>
      <MaterialCommunityIcons name={icon} size={14} color={c} />
      <Text style={[s.bannerText, { color: ink }]}>{text}</Text>
    </View>
  );
}

// ── MiniProgress — thin labeled progress bar (optimize lobby) ──────────────
export function MiniProgress({ pct, left, right }: { pct: number; left?: string; right?: string }) {
  return (
    <View>
      {(left || right) && (
        <View style={s.progLabelRow}>
          {!!left && <Text style={s.progLabel}>{left}</Text>}
          {!!right && <Text style={[s.progLabel, { color: RC.greenDark, fontWeight: '700' }]}>{right}</Text>}
        </View>
      )}
      <View style={s.progTrackThick}>
        <View style={[s.progFill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} />
      </View>
    </View>
  );
}

// ── ResolveShell — progress · title · body · one footer decision ───────────
export function ResolveShell({
  idx,
  total,
  kind,
  title,
  note,
  onBack,
  children,
  primary,
  primaryIcon,
  primaryReady = true,
  primaryGate,
  alt,
  onPrimary,
  onAlt,
  onIgnore,
  topInset = 0,
  scroll = true,
}: {
  idx: number;
  total: number;
  kind?: string;
  title: string;
  note?: string;
  onBack?: () => void;
  children: React.ReactNode;
  primary: string;
  primaryIcon?: IconName;
  primaryReady?: boolean;
  primaryGate?: string;
  alt?: string;
  onPrimary?: () => void;
  onAlt?: () => void;
  /** Per-item "don't import this" — a quiet corner chip (Duolingo's report
   *  flag), NEVER a third footer button. The footer is always max two. */
  onIgnore?: () => void;
  topInset?: number;
  scroll?: boolean;
}) {
  const pct = total ? Math.round((idx / total) * 100) : 0;
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.shell, { paddingTop: topInset + 8 }]}>
      <View style={s.progRow}>
        <TouchableOpacity onPress={onBack} hitSlop={HIT} style={s.backHit}>
          <MaterialCommunityIcons name="chevron-left" size={24} color={RC.muted} />
        </TouchableOpacity>
        <View style={s.progTrack}>
          <View style={[s.progFill, { width: `${pct}%` }]} />
        </View>
        <Text style={s.progCount}>{idx}/{total}</Text>
      </View>

      <View style={s.titleRow}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {onIgnore ? (
          <TouchableOpacity onPress={onIgnore} hitSlop={HIT} activeOpacity={0.7} style={s.ignoreChip}>
            <MaterialCommunityIcons name="trash-can-outline" size={13} color={RC.muted} />
            <Text style={s.ignoreChipText}>Skip</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {!!note && <Text style={s.note}>{note}</Text>}

      {scroll ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[s.body, { flex: 1 }]}>{children}</View>
      )}

      <View style={[s.footer, { paddingBottom: insets.bottom + 14 }]}>
        {!primaryReady && !!primaryGate && <Text style={s.gate}>{primaryGate}</Text>}
        <TouchableOpacity
          activeOpacity={primaryReady ? 0.88 : 1}
          disabled={!primaryReady}
          onPress={primaryReady ? onPrimary : undefined}
          style={[s.primaryBtn, !primaryReady && s.primaryBtnDim]}
        >
          {!!primaryIcon && <MaterialCommunityIcons name={primaryIcon} size={20} color={primaryReady ? '#fff' : RC.faint} />}
          <Text style={[s.primaryText, !primaryReady && { color: RC.faint }]}>{primary}</Text>
        </TouchableOpacity>
        {!!alt && (
          <TouchableOpacity onPress={onAlt} activeOpacity={0.85} style={s.secondaryBtn}>
            <Text style={s.secondaryText} numberOfLines={1}>{alt}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: RC.bg, paddingHorizontal: 16 },

  // progress header
  progRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  backHit: { marginLeft: -6 },
  progTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: RC.line, overflow: 'hidden' },
  progTrackThick: { height: 8, borderRadius: 4, backgroundColor: RC.line, overflow: 'hidden' },
  progFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: RC.green, borderRadius: 4 },
  progCount: { fontSize: 15, fontWeight: '700', color: RC.muted, fontVariant: ['tabular-nums'] },
  progLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  progLabel: { fontSize: 13, fontWeight: '500', color: RC.muted },

  // title — app scale (add-product modal title is 20/700)
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: RC.ink, letterSpacing: -0.3 },
  kind: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: RC.faint },
  note: { fontSize: 15, fontWeight: '500', color: RC.muted, marginTop: 4 },

  // body
  body: { paddingTop: 16, paddingBottom: 12, gap: 9 },

  // footer — mirrors the shared BottomActionBar (green primary · grey alt)
  footer: { paddingTop: 12, gap: 10 },
  primaryBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: RC.green,
    borderRadius: 12,
    paddingVertical: 14,
  },
  primaryBtnDim: { backgroundColor: RC.surface2 },
  primaryText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  secondaryBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#E5E5E5',
    borderRadius: 12,
    paddingVertical: 14,
  },
  secondaryText: { fontSize: 16, fontWeight: '600', color: '#71717A' },
  gate: { fontSize: 13, fontWeight: '600', color: RC.danger, textAlign: 'center', marginBottom: 2 },

  // skip pill — quiet per-item escape hatch, floating at the title row's right
  // (the design's "skip floats top-right, out of the decision row")
  ignoreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: RC.line,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  ignoreChipText: { fontSize: 12.5, fontWeight: '800', color: RC.muted },

  // thumb
  thumbEmpty: {
    backgroundColor: RC.surface,
    borderWidth: 1,
    borderColor: RC.line,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbLabel: { fontSize: 11, fontWeight: '500', color: RC.faint, paddingHorizontal: 2, textAlign: 'center' },

  // plat tag
  platTag: { backgroundColor: RC.surface2, borderWidth: 1, borderColor: RC.line, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  platTagText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, color: RC.muted },

  // chip
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#fff', alignSelf: 'flex-start' },
  chipDot: { width: 5, height: 5, borderRadius: 5 },
  chipText: { fontWeight: '700' },

  // check / radio
  check: { borderWidth: 1.5, borderRadius: 5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  radio: { borderWidth: 1.5, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  // row — form-sized list row (ListingEditorForm scale)
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: RC.ink },
  rowMeta: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 2 },
  hint: { fontSize: 13, fontWeight: '700' },

  // option — form-sized radio option
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  optionTitle: { fontSize: 15, fontWeight: '600' },
  optionSub: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 2 },

  // field — ListingEditorForm input scale (12/600 label · 15px value · minHeight 48 · r12)
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  fieldLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, color: RC.muted },
  fieldReq: { fontSize: 11, fontWeight: '700', color: RC.danger },
  field: { borderWidth: 1.5, borderRadius: 12, minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  fieldValue: { fontSize: 15, fontWeight: '500' },

  // banner
  banner: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '600' },
});

export { s as resolveStyles };
