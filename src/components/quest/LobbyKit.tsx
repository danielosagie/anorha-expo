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

import PlatformLogo from '../PlatformLogo';
import { getPlatform } from '../../config/platforms';

export { swatchFor };

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
export type LobbyState = 'done' | 'active' | 'locked';

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

// Merged icon pill — e.g. [ package | trash ] in one rounded group (figma).
export function HeaderIconGroup({
  items,
}: {
  items: { icon: IconName; onPress?: () => void; tint?: string }[];
}) {
  return (
    <View style={lk.iconGroup}>
      {items.map((it, i) => (
        <React.Fragment key={`${it.icon}-${i}`}>
          {i > 0 && <View style={lk.iconGroupDivider} />}
          <TouchableOpacity onPress={it.onPress} style={lk.iconGroupBtn} hitSlop={HIT} activeOpacity={0.7}>
            <MaterialCommunityIcons name={it.icon} size={18} color={it.tint || RC.ink} />
          </TouchableOpacity>
        </React.Fragment>
      ))}
    </View>
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

// ─── ThumbStrip — overlapping item swatches with a "+N" overflow tile ──────
// Used in the hero card to preview the items a stage will act on. Only items
// with real product art get a tile; everything else folds into the "+N" count
// so the strip still reads as the stage's workload. No art at all → no strip.
export function ThumbStrip({
  items,
  max = 5,
  size = 36,
}: {
  items: { id?: string; imageUrl?: string | null }[];
  max?: number;
  size?: number;
}) {
  const withArt = items.filter((it) => !!it.imageUrl);
  if (!withArt.length) return null;
  const shown = withArt.slice(0, max);
  const extra = items.length - shown.length;
  return (
    <View style={lk.strip}>
      {shown.map((it, i) => (
        <View key={it.id || i} style={[lk.stripTile, { width: size, height: size }]}>
          <Image source={{ uri: it.imageUrl! }} style={lk.stripImg} />
        </View>
      ))}
      {extra > 0 && (
        <View style={[lk.stripTile, lk.stripMore, { width: size, height: size }]}>
          <Text style={lk.stripMoreText}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

// ─── HeroCard — the big "active stage" card at the top of the import lobby ──
export function HeroCard({
  title,
  sub,
  items,
  ctaLabel,
  icon = 'puzzle',
  color = RC.orange,
  glyph = 'puzzle-outline',
  disabled,
  onPress,
}: {
  title: string;
  sub: string;
  items?: { id?: string; imageUrl?: string | null }[];
  ctaLabel: string;
  icon?: IconName;
  color?: string;
  glyph?: IconName;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <View style={[lk.hero, { backgroundColor: color }]}>
      <MaterialCommunityIcons name={glyph} size={150} color="rgba(255,255,255,0.18)" style={lk.heroGlyph} />
      <Text style={lk.heroTitle} numberOfLines={1}>{title}</Text>
      <Text style={lk.heroSub} numberOfLines={1}>{sub}</Text>
      {!!items && items.length > 0 && <ThumbStrip items={items} />}
      <TouchableOpacity
        activeOpacity={disabled ? 1 : 0.9}
        disabled={disabled}
        onPress={onPress}
        style={[lk.heroBtn, { opacity: disabled ? 0.7 : 1 }]}
      >
        <Text style={lk.heroBtnText}>{ctaLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── UpNextRow — an upcoming (locked) or completed (done) stage row ─────────
export function UpNextRow({
  icon,
  title,
  sub,
  count,
  state = 'locked',
  onPress,
  night = false,
  whiteActive = false,
}: {
  icon: IconName;
  title: string;
  sub?: string;
  count?: number | null;
  state?: LobbyState;
  onPress?: () => void;
  night?: boolean;
  /** Home setup feed: the active row becomes a WHITE card that pops in both themes
   *  (dark content, green accent). Lobbies leave this off and keep the green tint. */
  whiteActive?: boolean;
}) {
  const done = state === 'done';
  const active = state === 'active';
  const whiteCard = active && whiteActive;
  // On a white active card, content is always dark; otherwise it follows the theme.
  const contentDark = whiteCard || !night;

  const rowBg = whiteCard
    ? '#FFFFFF'
    : active
      ? (night ? 'rgba(147,200,34,0.14)' : RC.greenSoft)
      : done
        ? (night ? 'rgba(255,255,255,0.03)' : RC.surface)
        : (night ? 'rgba(255,255,255,0.045)' : RC.bg);
  const rowBorder = whiteCard
    ? 'rgba(0,0,0,0.08)'
    : active
      ? (night ? 'rgba(147,200,34,0.42)' : RC.greenLine)
      : (night ? 'rgba(255,255,255,0.09)' : RC.line);
  const iconBg = (active || done)
    ? (whiteCard || !night ? RC.greenSoft : 'rgba(147,200,34,0.16)')
    : (night ? 'rgba(255,255,255,0.06)' : RC.surface2);
  const iconColor = (active || done)
    ? (contentDark ? RC.greenDark : '#B7E34F')
    : (night ? 'rgba(244,244,238,0.45)' : RC.muted);
  const titleColor = done
    ? (contentDark ? RC.muted : 'rgba(244,244,238,0.5)')
    : (contentDark ? RC.ink : '#F4F4EE');
  const subColor = contentDark ? RC.muted : 'rgba(244,244,238,0.55)';
  const arrowColor = contentDark ? RC.greenDark : '#B7E34F';

  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.85 : 1}
      disabled={!onPress}
      onPress={onPress}
      style={[lk.upRow, { backgroundColor: rowBg, borderColor: rowBorder }, whiteCard && lk.upRowActiveShadow]}
    >
      <View style={[lk.upIcon, { backgroundColor: iconBg }]}>
        <MaterialCommunityIcons name={done ? 'check-bold' : icon} size={22} color={iconColor} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[lk.upTitle, { color: titleColor }]} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={[lk.upSub, { color: subColor }]} numberOfLines={1}>{sub}</Text>}
      </View>
      {typeof count === 'number' && count > 0 && (
        <View style={[lk.upPill, active && lk.upPillGreen]}>
          <Text style={[lk.upPillText, active && lk.upPillGreenText]}>{count}</Text>
        </View>
      )}
      {active && <MaterialCommunityIcons name="arrow-right" size={20} color={arrowColor} />}
    </TouchableOpacity>
  );
}

// ─── IssueLane — pressable issue rows (the match & optimize lobbies) ────────
// Each issue is a full-width pressable card in the same style as UpNextRow
// (the "button press" look): icon square · title · sub · count pill · chevron.
// The first open issue gets a soft orange "start here" tint; everything stays
// tappable in any order — nothing looks locked. Drives off the v2 cases so
// every backend signal — consolidate, variants, collision, compare, bundle,
// kit, stale, orphan, find — surfaces as its own row.
export interface LaneIssue {
  id: string;
  icon: IconName;
  title: string;
  sub: string;
  count: number;
  state: LobbyState;
  ctaLabel?: string;
  onFix?: () => void;
  /** Up to 3 product images — rendered as an overlapping stack in place of
   *  the icon square so the row shows WHAT it's about, not just a word. */
  thumbs?: (string | null)[];
  /** How many more items hide behind the stack ("+N" tile). */
  extra?: number;
}

// ─── ThumbStack — overlapping product squares + "+N" tile ──────────────────
export function ThumbStack({
  thumbs,
  extra,
  size = 30,
}: {
  thumbs: (string | null)[];
  extra?: number;
  size?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {thumbs.map((uri, i) => (
        <View
          key={i}
          style={[
            lk.stackTile,
            { width: size, height: size, borderRadius: size * 0.3, marginLeft: i ? -size * 0.32 : 0 },
          ]}
        >
          {uri ? (
            <Image source={{ uri }} style={{ width: '100%', height: '100%' }} />
          ) : (
            <View style={{ flex: 1, backgroundColor: swatchFor(String(i)) }} />
          )}
        </View>
      ))}
      {extra != null && extra > 0 && (
        <View
          style={[
            lk.stackTile,
            lk.stackMore,
            { width: size, height: size, borderRadius: size * 0.3, marginLeft: -size * 0.32 },
          ]}
        >
          <Text style={[lk.stackMoreText, { fontSize: Math.max(8, size * 0.28) }]} numberOfLines={1}>
            {extra > 99 ? '99+' : `+${extra}`}
          </Text>
        </View>
      )}
    </View>
  );
}

export function IssueLane({ issues }: { issues: LaneIssue[] }) {
  return (
    <View style={lk.lane}>
      {issues.map((it) => {
        const active = it.state === 'active';
        const done = it.state === 'done';
        return (
          <TouchableOpacity
            key={it.id}
            activeOpacity={it.onFix && !done ? 0.85 : 1}
            disabled={done || !it.onFix}
            onPress={it.onFix}
            style={[lk.upRow, active && lk.upRowActive, done && lk.upRowDone]}
          >
            {!done && it.thumbs && it.thumbs.length > 0 ? (
              <ThumbStack thumbs={it.thumbs} extra={it.extra} size={32} />
            ) : (
              <View style={[lk.upIcon, active && lk.upIconActive, done && lk.upIconDone]}>
                <MaterialCommunityIcons
                  name={done ? 'check-bold' : it.icon}
                  size={26}
                  color={done ? RC.greenDark : active ? RC.orangeDark : RC.muted}
                />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[lk.upTitle, done && { color: RC.muted }]} numberOfLines={1}>{it.title}</Text>
              <Text style={lk.upSub} numberOfLines={2}>{it.sub}</Text>
            </View>
            {!done && it.count > 0 && (
              <View style={[lk.upPill, active && lk.upPillActive]}>
                <Text style={[lk.upPillText, active && { color: RC.orangeDark }]}>{it.count}</Text>
              </View>
            )}
            {!done && !!it.onFix && (
              <MaterialCommunityIcons name="chevron-right" size={20} color={active ? RC.orangeDark : RC.faint} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
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

export function InventoryRow({
  item,
  onPress,
  onLongPress,
  selectionMode,
}: {
  item: InventoryItemData;
  onPress?: () => void;
  onLongPress?: () => void;
  selectionMode?: boolean;
}) {
  const swatch = item.color || swatchFor(item.id || item.title);
  const hasUnits = typeof item.units === 'number';

  return (
    <TouchableOpacity
      activeOpacity={onPress || onLongPress ? 0.8 : 1}
      disabled={!onPress && !onLongPress}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={[lk.invRow, item.selected && lk.invRowSelected]}
    >
      {selectionMode && (
        <View style={{ justifyContent: 'center', alignSelf: 'center' }}>
          <MaterialCommunityIcons
            name={item.selected ? 'check-circle' : 'circle-outline'}
            size={24}
            color={item.selected ? '#84CC16' : '#C7C7CC'}
          />
        </View>
      )}
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
            {item.platforms.slice(0, 4).map((p, i) => (
              <View key={`${p}-${i}`} style={lk.platBadge}>
                {getPlatform(p) ? <PlatformLogo type={p} size={12} /> : <Text style={lk.platLetter}>{p.charAt(0).toUpperCase()}</Text>}
              </View>
            ))}
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

  iconGroup: { flexDirection: 'row', alignItems: 'center', height: 38, borderRadius: 19, backgroundColor: RC.bg, borderWidth: 1, borderColor: RC.line, overflow: 'hidden' },
  iconGroupBtn: { width: 42, height: 38, alignItems: 'center', justifyContent: 'center' },
  iconGroupDivider: { width: 1, height: 22, backgroundColor: RC.line },

  // Winding path
  nodeWrap: { position: 'absolute', width: LBL_W, alignItems: 'center' },
  stone: { width: NODE_W, height: NODE_H, borderRadius: NODE_H / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  stoneSheen: { position: 'absolute', top: 6, left: 16, right: 16, height: 13, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.25)' },
  stoneLabel: { marginTop: 12, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },

  // CTA card — the big bottom "next step" bar (figma: r24, 3px scrim, p24)
  ctaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: 'rgba(0,0,0,0.18)',
    paddingVertical: 18,
    paddingLeft: 22,
    paddingRight: 16,
  },
  ctaTitle: { fontSize: 18, fontWeight: '700', color: '#fff', letterSpacing: -0.2 },
  ctaSub: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.92)', marginTop: 3 },
  ctaBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FCEBCF', borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' },

  // Raised button — the centered status / confirm pill (figma: r24, 3px scrim)
  raised: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 24, borderWidth: 3, borderColor: 'rgba(0,0,0,0.18)', paddingVertical: 20 },
  raisedText: { fontSize: 16, fontWeight: '700', letterSpacing: -0.1 },

  // Hero card — active stage
  hero: { width: '100%', borderRadius: 18, borderWidth: 3, borderColor: 'rgba(0,0,0,0.10)', paddingHorizontal: 18, paddingVertical: 22, overflow: 'hidden' },
  heroGlyph: { position: 'absolute', top: -34, right: -20 },
  heroTitle: { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  heroSub: { fontSize: 15, fontWeight: '600', color: '#FFE0B3', marginTop: 4 },
  heroBtn: { marginTop: 16, backgroundColor: '#fff', borderWidth: 2, borderColor: 'rgba(0,0,0,0.18)', borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  heroBtnText: { fontSize: 16, fontWeight: '700', color: RC.muted },

  // Thumb strip
  strip: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingLeft: 1 },
  stripTile: { borderRadius: 8, borderWidth: 1, borderColor: '#fff', marginRight: -10, overflow: 'hidden', backgroundColor: '#C5C5C5' },
  stripImg: { width: '100%', height: '100%' },
  stripMore: { backgroundColor: '#C5C5C5', alignItems: 'center', justifyContent: 'center', marginRight: 0 },
  stripMoreText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  // Up-next stage row (shared by UpNextRow + IssueLane). Clean settings-style
  // card: hairline border, soft icon tile, subtle pill — not the old chunky look.
  upRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: RC.bg, borderWidth: 1, borderColor: RC.line, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 10 },
  upRowActive: { backgroundColor: '#FFF7EC', borderColor: 'rgba(245,166,35,0.45)' },
  upRowActiveGreen: { backgroundColor: RC.greenSoft, borderColor: RC.greenLine },
  upRowDone: { backgroundColor: RC.surface, borderColor: RC.line },
  upIcon: { width: 42, height: 42, borderRadius: 11, backgroundColor: RC.surface2, alignItems: 'center', justifyContent: 'center' },
  upIconActive: { backgroundColor: '#FDEBD2' },
  upIconActiveGreen: { backgroundColor: '#fff' },
  upIconDone: { backgroundColor: RC.greenSoft },
  upTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: RC.ink, letterSpacing: -0.2 },
  upSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: RC.muted, marginTop: 2, letterSpacing: -0.1 },
  // White active card pop (home setup feed). Colors are computed inline in UpNextRow;
  // this only carries the elevation so the "up next" step stands off its siblings.
  upRowActiveShadow: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  upPill: { minWidth: 28, alignItems: 'center', backgroundColor: RC.surface2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  upPillActive: { backgroundColor: '#FDEBD2' },
  upPillGreen: { backgroundColor: '#fff' },
  upPillText: { fontSize: 14, fontWeight: '700', color: RC.muted },
  upPillGreenText: { color: RC.greenDark },

  // Issue lane container
  lane: { width: '100%' },

  // Thumb stack (overlapping product squares)
  stackTile: { borderWidth: 2, borderColor: '#fff', overflow: 'hidden', backgroundColor: RC.surface2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.18, shadowRadius: 3, elevation: 2 },
  stackMore: { alignItems: 'center', justifyContent: 'center' },
  stackMoreText: { fontWeight: '800', color: RC.muted },

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
