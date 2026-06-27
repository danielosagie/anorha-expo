// RoutineCard — the Buoy-style "this keeps running" card. Visually DISTINCT from
// the white activity card (brand-tinted) so a standing routine / reminder reads
// as an ongoing fact, not a one-off receipt. No inline Pause/Edit/Delete (one
// decision per surface) — those live in the routine tray. Tap opens the tray.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { CHAT_COLORS, CHAT_FONT } from '../../../../design/chatGlass';
import type { ActivityPayload } from '../../types';
import { humanizeCadence } from './humanizers';

type RoutinePayload = Extract<ActivityPayload, { kind: 'routine' }>;
type ReminderPayload = Extract<ActivityPayload, { kind: 'reminder' }>;

export default function RoutineCard({
  payload,
  onOpenTray,
}: {
  payload: RoutinePayload | ReminderPayload;
  onOpenTray?: (payload: ActivityPayload) => void;
}) {
  const isReminder = payload.kind === 'reminder';
  const paused = payload.kind === 'routine' ? !!payload.routine.paused : false;

  const title = isReminder ? payload.what : payload.routine.title;
  const cadenceLine = isReminder ? payload.whenAtLabel : humanizeCadence(payload.routine.cadence);
  const glyph = isReminder ? 'bell-outline' : 'autorenew';

  const press = () => {
    Haptics.selectionAsync().catch(() => undefined);
    onOpenTray?.(payload);
  };

  return (
    <TouchableOpacity
      style={[styles.card, paused && styles.cardPaused]}
      activeOpacity={0.85}
      onPress={press}
    >
      <View style={[styles.iconChip, paused && styles.iconChipPaused]}>
        <Icon name={glyph} size={17} color={paused ? CHAT_COLORS.dim : CHAT_COLORS.brandDeep} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.title, paused && styles.textMuted]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.cadenceRow}>
          <Icon
            name={isReminder ? 'clock-outline' : 'calendar-clock'}
            size={12}
            color={paused ? CHAT_COLORS.faint : MUTED_BRAND}
          />
          <Text style={[styles.cadence, paused && styles.textMuted]} numberOfLines={1}>
            {cadenceLine}
          </Text>
        </View>
      </View>

      {!isReminder ? (
        <View style={[styles.statePill, paused && styles.statePillPaused]}>
          <Text style={[styles.statePillText, paused && styles.statePillTextPaused]}>{paused ? 'Paused' : 'On'}</Text>
        </View>
      ) : null}
      <Icon name="chevron-right" size={20} color={paused ? CHAT_COLORS.faint : 'rgba(93,126,22,0.6)'} />
    </TouchableOpacity>
  );
}

const MUTED_BRAND = '#6E8A2E';

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginBottom: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: CHAT_COLORS.brandSoft,
    borderWidth: 1,
    borderColor: CHAT_COLORS.brandBorder,
  },
  cardPaused: {
    backgroundColor: CHAT_COLORS.surface,
    borderColor: CHAT_COLORS.border,
  },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CHAT_COLORS.white,
  },
  iconChipPaused: { backgroundColor: CHAT_COLORS.white },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: {
    fontSize: 13.5,
    fontFamily: CHAT_FONT.semibold,
    color: CHAT_COLORS.brandDeep,
  },
  textMuted: { color: CHAT_COLORS.dim },
  cadenceRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cadence: {
    fontSize: 12,
    fontFamily: CHAT_FONT.medium,
    color: MUTED_BRAND,
    flexShrink: 1,
  },
  statePill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: CHAT_COLORS.white,
  },
  statePillPaused: { backgroundColor: CHAT_COLORS.bubble },
  statePillText: { fontSize: 11, fontFamily: CHAT_FONT.semibold, color: CHAT_COLORS.brandDeep },
  statePillTextPaused: { color: CHAT_COLORS.dim },
});
