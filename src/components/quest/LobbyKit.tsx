// LobbyKit — the two import lobbies (Duolingo winding path + match queue).
//
// Cleaned up off the old QuestKit cream/amber/Jakarta tokens: now white
// surfaces, system font (weights only, like the rest of the app), and the
// orange "active step" highlight from the design. Shares the RC palette with
// the resolver flow; keeps only the hardShadow/swatchFor utilities.

import React, { useEffect } from 'react';
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
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { hardShadow, swatchFor } from './QuestKit';
import { RC } from '../resolve/ResolveKit';

import ShopifySvg from '../../assets/shopify.svg';
import SquareSvg from '../../assets/square.svg';
import CloverSvg from '../../assets/clover.svg';
import EbaySvg from '../../assets/ebay.svg';
import FacebookSvg from '../../assets/facebook.svg';
import AmazonSvg from '../../assets/amazon.svg';

export { swatchFor };

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
export type LobbyState = 'done' | 'active' | 'locked';

const PLATFORM_SVG: Record<string, React.ComponentType<any>> = {
  shopify: ShopifySvg,
  square: SquareSvg,
  clover: CloverSvg,
  ebay: EbaySvg,
  facebook: FacebookSvg,
  amazon: AmazonSvg,
};
function platformSvg(name: string): React.ComponentType<any> | null {
  const n = (name || '').toLowerCase();
  const hit = Object.keys(PLATFORM_SVG).find((k) => n.includes(k));
  return hit ? PLATFORM_SVG[hit] : null;
}

// ─── LobbyHeader — back circle · centered title · right slot ────────────────
export function LobbyHeader({
  title,
  countSuffix,
  onBack,
  right,
}: {
  title: string;
  countSuffix?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={lk.header}>
      <TouchableOpacity onPress={onBack} style={lk.circleBtn} hitSlop={HIT} activeOpacity={0.7}>
        <MaterialCommunityIcons name="chevron-left" size={20} color={RC.ink} />
      </TouchableOpacity>

      <View style={lk.headerTitleWrap} pointerEvents="none">
        <Text style={lk.headerTitle} numberOfLines={1}>
          {title}
          {!!countSuffix && <Text style={lk.headerTitleSub}> {countSuffix}</Text>}
        </Text>
      </View>

      <View style={lk.headerRight}>{right}</View>
    </View>
  );
}

export function HeaderIconBtn({ icon, onPress, tint = RC.ink }: { icon: IconName; onPress?: () => void; tint?: string }) {
  return (
    <TouchableOpacity onPress={onPress} style={lk.circleBtn} hitSlop={HIT} activeOpacity={0.7}>
      <MaterialCommunityIcons name={icon} size={18} color={tint} />
    </TouchableOpacity>
  );
}

export function HeaderPill({
  label,
  icon,
  iconColor,
  leading,
}: {
  label: string;
  icon?: IconName;
  iconColor?: string;
  leading?: React.ReactNode;
}) {
  return (
    <View style={lk.pill}>
      {leading}
      {!leading && !!icon && <MaterialCommunityIcons name={icon} size={14} color={iconColor || RC.muted} />}
      <Text style={lk.pillText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// ─── WindingPath — Duolingo stepping-stone trail ───────────────────────────
const NODE_W = 98;
const NODE_H = 60;
const LBL_W = 146;
const V_STEP = 152;
const V_PAD_TOP = 58;
const X_FRACS = [0.22, 0.74, 0.34, 0.6, 0.28, 0.7];

export interface PathNodeData {
  id: string;
  label: string;
  state: LobbyState;
  icon: IconName;
  onPress?: () => void;
}

export function WindingPath({ nodes, width, style }: { nodes: PathNodeData[]; width: number; style?: StyleProp<ViewStyle> }) {
  const centers = nodes.map((_, i) => ({
    x: width * (X_FRACS[i] ?? (i % 2 === 0 ? 0.28 : 0.7)),
    y: V_PAD_TOP + i * V_STEP,
  }));
  const height = V_PAD_TOP + (nodes.length - 1) * V_STEP + NODE_H / 2 + 66;

  let d = '';
  centers.forEach((c, i) => {
    if (i === 0) {
      d += `M ${c.x} ${c.y}`;
      return;
    }
    const p = centers[i - 1];
    const midY = (p.y + c.y) / 2;
    d += ` C ${p.x} ${midY}, ${c.x} ${midY}, ${c.x} ${c.y}`;
  });

  return (
    <View style={[{ width, height, alignSelf: 'center' }, style]}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Path d={d} stroke={RC.path} strokeWidth={7} strokeLinecap="round" strokeDasharray="0.1 20" fill="none" />
      </Svg>
      {nodes.map((n, i) => (
        <PathNode key={n.id} data={n} cx={centers[i].x} cy={centers[i].y} />
      ))}
    </View>
  );
}

function PathNode({ data, cx, cy }: { data: PathNodeData; cx: number; cy: number }) {
  const { state, icon, label, onPress } = data;
  const active = state === 'active';
  const done = state === 'done';

  const face = done ? RC.green : active ? RC.orange : RC.stone;
  const depth = done ? RC.greenDark : active ? RC.orangeDark : RC.stoneDark;
  const labelColor = done ? RC.greenDark : active ? RC.orangeDark : RC.faint;
  const iconColor = done || active ? '#fff' : '#EDEFF0';

  const bob = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      bob.value = 0;
      return;
    }
    bob.value = withRepeat(
      withSequence(
        withTiming(-5, { duration: 950, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 950, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [active]);
  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));

  return (
    <View style={[lk.nodeWrap, { left: cx - LBL_W / 2, top: cy - NODE_H / 2 }]} pointerEvents="box-none">
      <Animated.View style={bobStyle}>
        <TouchableOpacity
          activeOpacity={state === 'locked' ? 1 : 0.85}
          disabled={state === 'locked' || !onPress}
          onPress={onPress}
          style={[lk.stone, { backgroundColor: face }, hardShadow(depth, active ? 8 : 6)]}
        >
          <View style={lk.stoneSheen} pointerEvents="none" />
          {done ? (
            <MaterialCommunityIcons name="check-bold" size={28} color="#fff" />
          ) : (
            <MaterialCommunityIcons name={icon} size={26} color={iconColor} />
          )}
        </TouchableOpacity>
      </Animated.View>
      <Text style={[lk.stoneLabel, { color: labelColor }]} numberOfLines={1}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ─── LobbyCTACard — the big orange "next step" card ────────────────────────
export function LobbyCTACard({
  title,
  sub,
  color = RC.orange,
  dark = RC.orangeDark,
  icon = 'arrow-right',
  disabled,
  onPress,
}: {
  title: string;
  sub: string;
  color?: string;
  dark?: string;
  icon?: IconName;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.9}
      disabled={disabled}
      onPress={onPress}
      style={[lk.ctaCard, { backgroundColor: color, opacity: disabled ? 0.55 : 1 }, hardShadow(dark, 5)]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={lk.ctaTitle} numberOfLines={1}>{title}</Text>
        <Text style={lk.ctaSub} numberOfLines={1}>{sub}</Text>
      </View>
      <View style={[lk.ctaBtn, hardShadow('rgba(0,0,0,0.14)', 2)]}>
        <MaterialCommunityIcons name={icon} size={22} color={dark} />
      </View>
    </TouchableOpacity>
  );
}

// ─── RaisedBtn — the chunky footer button ("Fix N Issues") ─────────────────
export function RaisedBtn({
  label,
  icon,
  color = RC.neutralBtn,
  dark = RC.neutralBtnDark,
  textColor = '#fff',
  disabled,
  onPress,
}: {
  label: string;
  icon?: IconName;
  color?: string;
  dark?: string;
  textColor?: string;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.9}
      disabled={disabled}
      onPress={onPress}
      style={[lk.raised, { backgroundColor: color, opacity: disabled ? 0.6 : 1 }, hardShadow(dark, 4)]}
    >
      {!!icon && <MaterialCommunityIcons name={icon} size={16} color={textColor} />}
      <Text style={[lk.raisedText, { color: textColor }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── SegTabs — Issues / Inventory / Ignored switch ─────────────────────────
export function SegTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <View style={lk.segWrap}>
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <TouchableOpacity key={t.key} activeOpacity={0.8} onPress={() => onChange(t.key)} style={[lk.segItem, on && lk.segItemOn]}>
            <Text style={[lk.segText, { color: on ? RC.ink : RC.muted }]} numberOfLines={1}>
              {t.label}
              {typeof t.count === 'number' ? ` ${t.count}` : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── IssueCard — one grouped problem in the match queue ────────────────────
export function IssueCard({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress?: () => void }) {
  return (
    <TouchableOpacity activeOpacity={onPress ? 0.85 : 1} disabled={!onPress} onPress={onPress} style={lk.issueCard}>
      <View style={lk.issueIcon}>
        <MaterialCommunityIcons name={icon} size={22} color={RC.muted} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={lk.issueTitle} numberOfLines={1}>{title}</Text>
        <Text style={lk.issueSub} numberOfLines={2}>{sub}</Text>
      </View>
      {!!onPress && <MaterialCommunityIcons name="chevron-right" size={20} color={RC.faint} />}
    </TouchableOpacity>
  );
}

// ─── InventoryRow — a product line (Inventory / Ignored lists) ─────────────
export interface InventoryItemData {
  id: string;
  title: string;
  price?: string;
  sku?: string;
  imageUrl?: string | null;
  color?: string;
  lastSynced?: string;
  stale?: boolean;
  platforms?: string[];
  units?: number | null;
  lowStock?: boolean;
  statusLabel?: string;
  selected?: boolean;
}

export function InventoryRow({ item, onPress }: { item: InventoryItemData; onPress?: () => void }) {
  const swatch = item.color || swatchFor(item.id || item.title);
  const hasUnits = typeof item.units === 'number';

  return (
    <TouchableOpacity activeOpacity={onPress ? 0.8 : 1} disabled={!onPress} onPress={onPress} style={[lk.invRow, item.selected && lk.invRowSelected]}>
      {item.imageUrl ? (
        <Image source={{ uri: item.imageUrl }} style={lk.invThumb} />
      ) : (
        <View style={[lk.invThumb, { backgroundColor: swatch }]} />
      )}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={lk.invTitle} numberOfLines={2}>{item.title}</Text>
        {!!item.price && <Text style={lk.invPrice}>{item.price}</Text>}
        {!!item.sku && <Text style={lk.invMeta} numberOfLines={1}>SKU: {item.sku}</Text>}
        {!!item.lastSynced && (
          <Text style={lk.invMeta} numberOfLines={1}>
            Last synced: {item.lastSynced}
            {item.stale && <Text style={{ color: RC.orangeDark, fontWeight: '600' }}> · Stale</Text>}
          </Text>
        )}
        {!!(item.platforms && item.platforms.length) && (
          <View style={lk.platRow}>
            {item.platforms.slice(0, 4).map((p, i) => {
              const Svgc = platformSvg(p);
              return (
                <View key={`${p}-${i}`} style={lk.platBadge}>
                  {Svgc ? <Svgc width={12} height={12} /> : <Text style={lk.platLetter}>{p.charAt(0).toUpperCase()}</Text>}
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View style={lk.invPillCol}>
        {hasUnits ? (
          <View style={[lk.unitPill, item.lowStock && lk.unitPillLow]}>
            {item.lowStock && <MaterialCommunityIcons name="alert" size={11} color={RC.danger} style={{ marginRight: 3 }} />}
            <Text style={[lk.unitText, item.lowStock && { color: RC.danger }]} numberOfLines={1}>{item.units} Units Left</Text>
          </View>
        ) : item.statusLabel ? (
          <View style={lk.statusPill}>
            <Text style={lk.statusText} numberOfLines={1}>{item.statusLabel}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

const lk = StyleSheet.create({
  // Header
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12, gap: 12 },
  circleBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: RC.bg, borderWidth: 1, borderColor: RC.line, alignItems: 'center', justifyContent: 'center' },
  headerTitleWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: RC.ink, letterSpacing: -0.3 },
  headerTitleSub: { fontWeight: '500', color: RC.muted },
  headerRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 8 },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 38, borderRadius: 19, backgroundColor: RC.bg, borderWidth: 1, borderColor: RC.line },
  pillText: { fontSize: 13, fontWeight: '700', color: RC.ink, maxWidth: 110 },

  // Winding path
  nodeWrap: { position: 'absolute', width: LBL_W, alignItems: 'center' },
  stone: { width: NODE_W, height: NODE_H, borderRadius: NODE_H / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  stoneSheen: { position: 'absolute', top: 6, left: 16, right: 16, height: 13, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.25)' },
  stoneLabel: { marginTop: 12, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },

  // CTA card
  ctaCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 22, paddingVertical: 16, paddingLeft: 20, paddingRight: 14 },
  ctaTitle: { fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  ctaSub: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.92)', marginTop: 2 },
  ctaBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FCEBCF', alignItems: 'center', justifyContent: 'center' },

  // Raised button
  raised: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 16 },
  raisedText: { fontSize: 15, fontWeight: '800', letterSpacing: -0.1 },

  // SegTabs
  segWrap: { flexDirection: 'row', backgroundColor: RC.surface2, borderRadius: 12, padding: 4, gap: 4, marginHorizontal: 16, marginBottom: 12 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 9 },
  segItemOn: { backgroundColor: RC.bg, ...hardShadow('rgba(17,24,39,0.12)', 1) },
  segText: { fontSize: 12.5, fontWeight: '700' },

  // IssueCard
  issueCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: RC.bg, borderWidth: 1, borderColor: RC.line, borderRadius: 16, padding: 14, marginBottom: 10 },
  issueIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: RC.surface2, borderWidth: 1, borderColor: RC.line, alignItems: 'center', justifyContent: 'center' },
  issueTitle: { fontSize: 15, fontWeight: '700', color: RC.ink, letterSpacing: -0.2, marginBottom: 2 },
  issueSub: { fontSize: 12, fontWeight: '500', color: RC.muted, lineHeight: 16 },

  // InventoryRow
  invRow: { flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14, alignItems: 'flex-start' },
  invRowSelected: { backgroundColor: RC.bg, borderWidth: 1, borderColor: RC.line, ...hardShadow('rgba(17,24,39,0.1)', 2) },
  invThumb: { width: 60, height: 60, borderRadius: 12, backgroundColor: RC.surface2 },
  invTitle: { fontSize: 14.5, fontWeight: '700', color: RC.ink, letterSpacing: -0.2 },
  invPrice: { fontSize: 13, fontWeight: '600', color: RC.ink, marginTop: 2 },
  invMeta: { fontSize: 11, fontWeight: '500', color: RC.faint, marginTop: 2 },
  platRow: { flexDirection: 'row', gap: 5, marginTop: 7 },
  platBadge: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: RC.line, backgroundColor: RC.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  platLetter: { fontSize: 9.5, fontWeight: '800', color: RC.muted },

  invPillCol: { alignItems: 'flex-end', justifyContent: 'flex-start', paddingTop: 2 },
  unitPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100, borderWidth: 1, borderColor: RC.line, backgroundColor: RC.bg },
  unitPillLow: { backgroundColor: RC.dangerSoft, borderColor: RC.dangerLine },
  unitText: { fontSize: 11, fontWeight: '700', color: RC.muted },
  statusPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100, borderWidth: 1, borderColor: RC.line, backgroundColor: RC.surface },
  statusText: { fontSize: 11, fontWeight: '700', color: RC.muted },
});
