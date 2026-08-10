// LobbyKit — the setup-feed row (UpNextRow), the one survivor of the old
// import-lobby kit. Lives on the Sprout home screen's setup feed.

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { RC } from '../resolve/ResolveKit';

export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
export type LobbyState = 'done' | 'active' | 'locked';

// ─── UpNextRow — one step in the setup feed ─────────────────────────────────
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

const lk = StyleSheet.create({
  upRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: RC.bg, borderWidth: 1, borderColor: RC.line, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 10 },
  upIcon: { width: 42, height: 42, borderRadius: 11, backgroundColor: RC.surface2, alignItems: 'center', justifyContent: 'center' },
  upTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: RC.ink, letterSpacing: -0.2 },
  upSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: RC.muted, marginTop: 2, letterSpacing: -0.1 },
  upRowActiveShadow: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  upPill: { minWidth: 28, alignItems: 'center', backgroundColor: RC.surface2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  upPillGreen: { backgroundColor: '#fff' },
  upPillText: { fontSize: 14, fontWeight: '700', color: RC.muted },
  upPillGreenText: { color: RC.greenDark },
});
