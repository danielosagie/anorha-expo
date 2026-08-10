// ResolveKit — shared primitives for the Match & Optimize v2 resolver flow.
//
// Translated from the Anorha handoff lo-fi (wireframes-match-resolve / -optimize)
// into the app's production style: white surfaces, #E5E7EB hairlines, radius 12,
// the #93C822 green for the single primary action, and system font + weights
// (matching PublishConfirmation / InventoryOrders / AddProduct — no Jakarta).
//
// Live consumers: the optimizer views and LobbyKit (RC tokens), plus the small
// building blocks below (Thumb / Chip / Check / Row / Field / Banner).

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

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

const s = StyleSheet.create({
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

  // chip
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#fff', alignSelf: 'flex-start' },
  chipDot: { width: 5, height: 5, borderRadius: 5 },
  chipText: { fontWeight: '700' },

  // check
  check: { borderWidth: 1.5, borderRadius: 5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  // row — form-sized list row (ListingEditorForm scale)
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },

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
