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
import SwipeCard from '../import/SwipeCard';
import Animated, { useSharedValue, useAnimatedStyle, interpolate, Extrapolation } from 'react-native-reanimated';

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

// The five-card mental model: every resolver case carries one of these badges
// so the seller always knows which of the five questions they're answering.
// Match supplies it via <ResolveBadge.Provider>; the optimize side leaves it
// null, so its shells render unchanged.
export const ResolveBadge = React.createContext<{ label: string; color: string } | null>(null);

// Per-card edit/explain entry points, provided by the deck. Cards that don't
// supply them (the optimize side) render no affordance.
export const ResolveActions = React.createContext<{ onEdit?: () => void; onExplain?: () => void } | null>(null);

// Deck-level chrome (the ⋯ menu and the always-present ignore), provided by the
// match deck so TinderShell's header/footer can reach them. `intro` is the
// one-time "what we found" confidence beat — shown on the first card only, it
// dismisses itself the moment the deck reports the first decision is made.
export const DeckChrome = React.createContext<{
  onMenu?: () => void;
  onIgnore?: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  onRedo?: () => void;
  canRedo?: boolean;
  intro?: { cameIn: number; needYou: number } | null;
} | null>(null);

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
  const Comp: any = onPress ? TouchableOpacity : View;
  return (
    <View style={half ? { flex: 1 } : undefined}>
      <View style={s.fieldLabelRow}>
        <Text style={s.fieldLabel}>{label.toUpperCase()}</Text>
        {required && !filled && <Text style={s.fieldReq}>required</Text>}
      </View>
      <Comp
        activeOpacity={0.7}
        onPress={onPress}
        style={[s.field, { borderColor: filled ? RC.ink : required ? RC.danger : RC.line, backgroundColor: filled ? '#fff' : RC.surface }]}
      >
        <Text style={[s.fieldValue, { color: filled ? RC.ink : RC.faint }]} numberOfLines={1}>
          {value || placeholder}
        </Text>
      </Comp>
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
  const badge = React.useContext(ResolveBadge);
  const actions = React.useContext(ResolveActions);
  const canUsePrimary = primaryReady && !!onPrimary;
  const canUseAlt = !!onAlt;
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

      {!!badge && (
        <View style={[s.cardBadge, { backgroundColor: `${badge.color}14` }]}>
          <View style={[s.cardBadgeDot, { backgroundColor: badge.color }]} />
          <Text style={[s.cardBadgeText, { color: badge.color }]} numberOfLines={1}>{badge.label.toUpperCase()}</Text>
        </View>
      )}

      <View style={s.titleRow}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
      </View>
      {!!note && <Text style={s.note}>{note}</Text>}

      {actions && (actions.onEdit || actions.onExplain) ? (
        <View style={s.actionsRow}>
          {actions.onEdit ? (
            <TouchableOpacity onPress={actions.onEdit} hitSlop={6} activeOpacity={0.7} style={s.actionLink}>
              <MaterialCommunityIcons name="pencil-outline" size={15} color={RC.muted} />
              <Text style={s.actionLinkText}>Edit details</Text>
            </TouchableOpacity>
          ) : null}
          {actions.onExplain ? (
            <TouchableOpacity onPress={actions.onExplain} hitSlop={6} activeOpacity={0.7} style={s.actionLink}>
              <MaterialCommunityIcons name="comment-question-outline" size={15} color={RC.muted} />
              <Text style={s.actionLinkText}>Explain</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

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
          activeOpacity={canUsePrimary ? 0.88 : 1}
          disabled={!canUsePrimary}
          onPress={canUsePrimary ? onPrimary : undefined}
          style={[s.primaryBtn, !canUsePrimary && s.primaryBtnDim]}
        >
          {!!primaryIcon && <MaterialCommunityIcons name={primaryIcon} size={20} color={canUsePrimary ? '#fff' : RC.faint} />}
          <Text style={[s.primaryText, !canUsePrimary && { color: RC.faint }]}>{primary}</Text>
        </TouchableOpacity>
        {!!alt && (
          <TouchableOpacity
            onPress={canUseAlt ? onAlt : undefined}
            activeOpacity={canUseAlt ? 0.85 : 1}
            disabled={!canUseAlt}
            style={[s.secondaryBtn, !canUseAlt && s.secondaryBtnDim]}
          >
            <Text style={[s.secondaryText, !canUseAlt && { color: RC.faint }]} numberOfLines={1}>{alt}</Text>
          </TouchableOpacity>
        )}
        {onIgnore ? (
          <TouchableOpacity onPress={onIgnore} activeOpacity={0.7} style={s.ignoreBottom}>
            <MaterialCommunityIcons name="trash-can-outline" size={14} color={RC.faint} />
            <Text style={s.ignoreBottomText}>Ignore — don’t import</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

// ── TinderShell — the Paper J/H "deck card" chrome ─────────────────────────
// Light-gray screen, a peek of the cards behind, then the white decision card:
//   ✕ · green progress · "N left"   →  badge · title · note · body  →  a single
//   horizontal action bar: ← back · secondary · green primary · ✕ ignore.
// Same props as ResolveShell, so every match resolver renders this by swapping
// one import. Optimize keeps ResolveShell.
export function TinderShell({
  idx,
  total,
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
  onIgnore?: () => void;
  topInset?: number;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const badge = React.useContext(ResolveBadge);
  const actions = React.useContext(ResolveActions);
  const chrome = React.useContext(DeckChrome);
  const pct = total ? Math.round((idx / total) * 100) : 0;
  const left = Math.max(0, total - idx + 1);
  const ignore = chrome?.onIgnore || onIgnore;
  const canUsePrimary = primaryReady && !!onPrimary;
  const canUseAlt = !!onAlt;

  // Down-drag progress (0→1): fades the action bar out and the ignore tray in.
  const downV = useSharedValue(0);
  const barFade = useAnimatedStyle(() => ({ opacity: interpolate(downV.value, [0, 0.6], [1, 0], Extrapolation.CLAMP) }));
  const trayFade = useAnimatedStyle(() => ({ opacity: interpolate(downV.value, [0.05, 0.7], [0, 1], Extrapolation.CLAMP) }));

  return (
    <View style={[ts.screen, { paddingTop: topInset + 10, paddingBottom: insets.bottom + 10 }]}>
      {/* HEADER — outside the card, stays put while the card swipes */}
      <View style={ts.header}>
        <TouchableOpacity onPress={onBack} hitSlop={HIT} activeOpacity={0.7} style={ts.iconBtn}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={RC.muted} />
        </TouchableOpacity>
        <View style={ts.progTrack}>
          <View style={[ts.progFill, { width: `${pct}%` }]} />
        </View>
        <View style={ts.leftPill}>
          <Text style={ts.leftPillText}>{left} left</Text>
        </View>
        {chrome?.onMenu ? (
          <TouchableOpacity onPress={chrome.onMenu} hitSlop={HIT} activeOpacity={0.7} style={ts.iconBtn}>
            <MaterialCommunityIcons name="dots-horizontal" size={20} color={RC.muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* INTRO BEAT — "what we found" on the first card; tells the seller most of
          their import was handled and exactly how few need them. Disappears once
          they make the first decision. */}
      {chrome?.intro ? (
        <View style={ts.introStrip}>
          <Text style={ts.introStripText}>
            <Text style={ts.introStripStrong}>{chrome.intro.cameIn}</Text> came in
            {'   ·   '}
            <Text style={ts.introStripAccent}>{chrome.intro.needYou} need you</Text>
          </Text>
        </View>
      ) : null}

      {/* CARD — the only thing that swipes */}
      <View style={ts.cardArea}>
        <View style={ts.peek2} pointerEvents="none" />
        <View style={ts.peek1} pointerEvents="none" />
        <SwipeCard onYes={canUsePrimary ? onPrimary : undefined} onNo={onAlt} onIgnore={ignore} downShared={downV}>
          <View style={ts.card}>
            {!!badge && (
              <View style={[ts.badge, { backgroundColor: `${badge.color}14` }]}>
                <View style={[ts.badgeDot, { backgroundColor: badge.color }]} />
                <Text style={[ts.badgeText, { color: badge.color }]}>{badge.label.toUpperCase()}</Text>
              </View>
            )}
            <Text style={ts.title} numberOfLines={2}>{title}</Text>
            {!!note && <Text style={ts.note}>{note}</Text>}

            {actions && (actions.onEdit || actions.onExplain) ? (
              <View style={ts.linksRow}>
                {actions.onEdit ? (
                  <TouchableOpacity onPress={actions.onEdit} hitSlop={6} activeOpacity={0.7} style={ts.link}>
                    <MaterialCommunityIcons name="pencil-outline" size={15} color={RC.muted} />
                    <Text style={ts.linkText}>Edit details</Text>
                  </TouchableOpacity>
                ) : null}
                {actions.onExplain ? (
                  <TouchableOpacity onPress={actions.onExplain} hitSlop={6} activeOpacity={0.7} style={ts.link}>
                    <MaterialCommunityIcons name="comment-question-outline" size={15} color={RC.muted} />
                    <Text style={ts.linkText}>Explain</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {scroll ? (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={ts.body} showsVerticalScrollIndicator={false}>
                {children}
              </ScrollView>
            ) : (
              <View style={[ts.body, { flex: 1 }]}>{children}</View>
            )}
          </View>
        </SwipeCard>
      </View>

      {/* FOOTER — the action bar; dragging the card down swaps it for the tray */}
      {!primaryReady && !!primaryGate && <Text style={ts.gate}>{primaryGate}</Text>}
      <View style={ts.footerWrap}>
        <Animated.View style={barFade}>
          <View style={ts.bar}>
            {chrome ? (
              <TouchableOpacity
                onPress={chrome.canUndo ? chrome.onUndo : undefined}
                disabled={!chrome.canUndo}
                hitSlop={HIT}
                activeOpacity={0.7}
                style={[ts.undoBtn, !chrome.canUndo && ts.undoBtnDim]}
              >
                <MaterialCommunityIcons name="undo-variant" size={20} color={chrome.canUndo ? RC.muted : RC.faint} />
              </TouchableOpacity>
            ) : null}
            {!!alt && (
              <TouchableOpacity
                onPress={canUseAlt ? onAlt : undefined}
                activeOpacity={canUseAlt ? 0.85 : 1}
                disabled={!canUseAlt}
                style={[ts.barSecondary, !canUseAlt && ts.barSecondaryDim]}
              >
                <Text style={[ts.barSecondaryText, !canUseAlt && { color: RC.faint }]} numberOfLines={1}>{alt}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={canUsePrimary ? onPrimary : undefined}
              activeOpacity={canUsePrimary ? 0.88 : 1}
              disabled={!canUsePrimary}
              style={[ts.barPrimary, !alt && { flex: 1 }, !canUsePrimary && ts.barPrimaryDim]}
            >
              <Text style={[ts.barPrimaryText, !canUsePrimary && { color: RC.faint }]} numberOfLines={1}>{primary}</Text>
            </TouchableOpacity>
            {chrome ? (
              <TouchableOpacity
                onPress={chrome.canRedo ? chrome.onRedo : undefined}
                disabled={!chrome.canRedo}
                hitSlop={HIT}
                activeOpacity={0.7}
                style={[ts.undoBtn, !chrome.canRedo && ts.undoBtnDim]}
              >
                <MaterialCommunityIcons name="redo-variant" size={20} color={chrome.canRedo ? RC.muted : RC.faint} />
              </TouchableOpacity>
            ) : null}
          </View>
        </Animated.View>
        {ignore ? (
          <Animated.View pointerEvents="none" style={[ts.ignoreTray, trayFade]}>
            <MaterialCommunityIcons name="trash-can-outline" size={20} color="#B91C1C" />
            <Text style={ts.ignoreTrayText}>Release to ignore</Text>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const ts = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F5F7', paddingHorizontal: 16 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: RC.line, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  progTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#E3E6EA', overflow: 'hidden' },
  progFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: RC.green, borderRadius: 3 },
  leftPill: { backgroundColor: '#fff', borderWidth: 1, borderColor: RC.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 0 },
  leftPillText: { fontSize: 13, fontWeight: '700', color: RC.muted, fontVariant: ['tabular-nums'] },

  introStrip: { alignSelf: 'center', marginTop: 12, marginBottom: -4, backgroundColor: RC.surface2, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  introStripText: { fontSize: 13.5, fontWeight: '600', color: RC.muted, fontVariant: ['tabular-nums'] },
  introStripStrong: { color: RC.ink, fontWeight: '800' },
  introStripAccent: { color: RC.greenDark, fontWeight: '800' },

  cardArea: { flex: 1, position: 'relative', paddingTop: 16, marginTop: 12 },
  peek2: { position: 'absolute', top: 0, left: 34, right: 34, height: 40, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#E9EBEF' },
  peek1: { position: 'absolute', top: 6, left: 24, right: 24, height: 40, backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: '#E1E4E9' },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: RC.line,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 5,
  },

  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  title: { fontSize: 24, fontWeight: '800', color: RC.ink, letterSpacing: -0.4, marginTop: 12, lineHeight: 29 },
  note: { fontSize: 15, fontWeight: '500', color: RC.muted, marginTop: 5 },

  linksRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: RC.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  linkText: { fontSize: 13, fontWeight: '600', color: RC.muted },

  body: { paddingTop: 16, paddingBottom: 8, gap: 10 },

  gate: { fontSize: 13, fontWeight: '600', color: RC.danger, textAlign: 'center', marginTop: 10 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barSecondary: { flex: 1, height: 54, borderRadius: 27, borderWidth: 1.5, borderColor: RC.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', paddingHorizontal: 10 },
  barSecondaryDim: { backgroundColor: RC.surface2, borderColor: RC.line },
  barSecondaryText: { fontSize: 16, fontWeight: '700', color: RC.muted },
  barPrimary: { flex: 1.3, height: 54, borderRadius: 27, backgroundColor: RC.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10 },
  barPrimaryDim: { backgroundColor: RC.surface2 },
  barPrimaryText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  trashBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff', borderWidth: 1.5, borderColor: RC.line, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  undoBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff', borderWidth: 1.5, borderColor: RC.line, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  undoBtnDim: { opacity: 0.4 },
  footerWrap: { marginTop: 12, position: 'relative' },
  ignoreTray: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 27, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  ignoreTrayText: { color: '#B91C1C', fontSize: 15, fontWeight: '800' },
});

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

  // edit / explain quick links (under the note)
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionLink: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: RC.line, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  actionLinkText: { fontSize: 13, fontWeight: '600', color: RC.muted },

  // five-card badge — the question type, shown above the title
  cardBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  cardBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  cardBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

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
  secondaryBtnDim: { backgroundColor: RC.surface2 },
  secondaryText: { fontSize: 16, fontWeight: '600', color: '#71717A' },
  gate: { fontSize: 13, fontWeight: '600', color: RC.danger, textAlign: 'center', marginBottom: 2 },

  // ignore — the quiet bottom escape hatch (sits under the two decision buttons)
  ignoreBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16, marginTop: 2 },
  ignoreBottomText: { fontSize: 13.5, fontWeight: '600', color: RC.faint },

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
