// HomeDateTray — the Sprout home date tray (ported interaction from the
// habit-tracker reference app). Opens as a dropdown under the floating top bar:
// a WEEK strip first; dragging the built-in knob (or tapping it) expands it into
// a MONTH grid (react-native-calendars ExpandableCalendar handles the drag —
// no custom gesture code). Day selection is a YYYY-MM-DD string, never a parsed
// Date (avoids UTC off-by-one).

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { CalendarProvider, ExpandableCalendar } from 'react-native-calendars';

const SCREEN_HEIGHT = Dimensions.get('window').height;
// CalendarProvider is flex:1 — inside a content-sized absolute panel that collapses
// to 0, so the tray must give it an explicit height per week/month state.
const WEEK_TRAY_HEIGHT = 140;
const MONTH_CAL_HEIGHT = Math.round(SCREEN_HEIGHT / 2.4);
// Month grid + knob ≈ 330-380px depending on 5- vs 6-week months; 400 avoids
// clipping the tall months without leaving a dead band under the knob.
const MONTH_TRAY_HEIGHT = 400;

// ── timezone-safe date-string helpers ──────────────────────────────────────
export const getDateString = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
export const getTodayString = (): string => getDateString(new Date());
const parseDateString = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
};
/** 'Mon, Jun 9' — for the header day pill. */
export const formatDayLabel = (s: string): string => {
  const { year, month, day } = parseDateString(s);
  const d = new Date(year, month, day);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
/** 'June 2026' — month caption while the grid is open. */
const formatMonthLabel = (s: string): string => {
  const { year, month, day } = parseDateString(s);
  const d = new Date(year, month, day);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

export interface HomeDateTrayProps {
  /** The tray renders IN-FLOW: height animates 0 ↔ week ↔ month, pushing
      whatever sits below it down (public.com-style top tray, no overlay). */
  visible: boolean;
  /** Selected day as YYYY-MM-DD. */
  selectedDate: string;
  onSelectDate: (date: string) => void;
  /** Week↔month expansion state (drives the header chevron). */
  onToggled?: (isOpen: boolean) => void;
  isNight: boolean;
  /** Sprout's short update / next-step note for the selected day — the reason
      this tray earns its space (week bar on top, note underneath). */
  note?: string;
}

export const HomeDateTray: React.FC<HomeDateTrayProps> = ({
  visible,
  selectedDate,
  onSelectDate,
  onToggled,
  isNight,
  note,
}) => {
  const today = getTodayString();
  const [expanded, setExpanded] = useState(false);

  // Collapse back to the week row whenever the tray closes.
  useEffect(() => {
    if (!visible && expanded) setExpanded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // panel must stay OPAQUE and match the page gradient's top color: the lib
  // stacks the closed week row OVER the month grid, and a transparent bg lets
  // the month bleed through as ghost numbers.
  const colors = isNight
    ? {
        panel: '#272B20',
        text: '#F4F6EE',
        faint: 'rgba(244,246,238,0.55)',
        selectedBg: '#F4F6EE',
        selectedText: '#20241A',
        knobLine: 'rgba(244,246,238,0.35)',
      }
    : {
        panel: '#9AC53C',
        text: '#FFFFFF',
        faint: 'rgba(255,255,255,0.65)',
        selectedBg: '#FFFFFF',
        selectedText: '#3D5713',
        knobLine: 'rgba(255,255,255,0.5)',
      };

  // The library does not re-render on theme prop changes — remount via key.
  // `today` in the key also fixes a stale "today" highlight after midnight.
  const calendarKey = `${isNight ? 'night' : 'day'}-${today}`;

  const calendarTheme = useMemo(
    () => ({
      calendarBackground: colors.panel,
      dayTextColor: colors.text,
      textDisabledColor: colors.faint,
      monthTextColor: colors.text,
      textSectionTitleColor: colors.faint,
      selectedDayBackgroundColor: colors.selectedBg,
      selectedDayTextColor: colors.selectedText,
      todayTextColor: colors.text,
      textDayFontWeight: '600' as const,
      textDayFontSize: 15,
      // Hide the library's own month title — the caption row above carries it.
      'stylesheet.calendar.header': {
        monthText: { fontSize: 1, height: 0, opacity: 0 },
        header: { height: 0, opacity: 0 },
      },
    }),
    [colors],
  );

  const markedDates = useMemo(
    () => ({
      [selectedDate]: {
        selected: true,
        selectedColor: colors.selectedBg,
        selectedTextColor: colors.selectedText,
      },
    }),
    [selectedDate, colors],
  );

  const NOTE_HEIGHT = note ? 64 : 0;
  const trayHeight = !visible ? 0 : (expanded ? MONTH_TRAY_HEIGHT : WEEK_TRAY_HEIGHT) + 38 + NOTE_HEIGHT;

  return (
    // In-flow: animating the height pushes the content below down (no overlay,
    // no overlap). Transparent background — it lives on the page gradient.
    <Animated.View
      layout={LinearTransition.duration(220)}
      style={{ height: trayHeight, overflow: 'hidden' }}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <View style={styles.captionRow}>
        <Text style={[styles.caption, { color: colors.text }]}>{formatMonthLabel(selectedDate)}</Text>
        {selectedDate !== today && (
          <TouchableOpacity
            onPress={() => onSelectDate(today)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.todayBtn, { color: colors.text, borderColor: colors.knobLine }]}>Today</Text>
          </TouchableOpacity>
        )}
      </View>
      <Animated.View
        layout={LinearTransition.duration(220)}
        style={{ height: expanded ? MONTH_TRAY_HEIGHT : WEEK_TRAY_HEIGHT }}
      >
        <CalendarProvider date={selectedDate} onDateChanged={onSelectDate} style={{ flex: 1 }}>
          <ExpandableCalendar
            key={calendarKey}
            initialPosition={ExpandableCalendar.positions.CLOSED}
            hideKnob={false}
            hideArrows
            allowShadow={false}
            firstDay={1}
            calendarHeight={MONTH_CAL_HEIGHT}
            theme={calendarTheme as any}
            markedDates={markedDates}
            onDayPress={(d) => onSelectDate(d.dateString)}
            onCalendarToggled={(isOpen: boolean) => {
              setExpanded(isOpen);
              onToggled?.(isOpen);
            }}
            closeOnDayPress={false}
          />
        </CalendarProvider>
      </Animated.View>
      {/* Sprout's note for the selected day — sits BELOW the week bar. */}
      {note ? (
        <View style={styles.noteRow}>
          <Text style={[styles.noteText, { color: colors.text }]} numberOfLines={3}>
            {note}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: 'hidden',
    paddingBottom: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 2,
  },
  caption: {
    fontSize: 14,
    fontWeight: '700',
  },
  todayBtn: {
    fontSize: 12,
    fontWeight: '700',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  noteRow: {
    paddingHorizontal: 18,
    paddingTop: 6,
    height: 64,
    justifyContent: 'flex-start',
  },
  noteText: {
    fontSize: 14,
    lineHeight: 19,
    fontFamily: 'Inter_500Medium',
    opacity: 0.92,
  },
});

export default HomeDateTray;
