import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const BRAND = '#93C822';
const FONT = {
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

type Props = {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  /** Earliest selectable day (inclusive). Defaults to today. */
  minDate?: Date;
};

/**
 * Compact month calendar adapted from the habit-tracker MonthCalendar:
 * brand-green selected day, prev/next month nav, past days disabled, Inter type.
 */
export const ClearoutCalendar: React.FC<Props> = ({ selectedDate, onSelect, minDate }) => {
  const today = useMemo(() => startOfDay(new Date()), []);
  const min = minDate ? startOfDay(minDate) : today;
  const [viewMonth, setViewMonth] = useState(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
  );

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = useMemo(() => {
    const arr: (Date | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(new Date(year, month, d));
    return arr;
  }, [year, month, firstWeekday, daysInMonth]);

  const canPrev = new Date(year, month, 1) > new Date(min.getFullYear(), min.getMonth(), 1);

  const go = (delta: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setViewMonth(new Date(year, month + delta, 1));
  };

  const pick = (d: Date) => {
    if (startOfDay(d) < min) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    onSelect(d);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => canPrev && go(-1)}
          disabled={!canPrev}
          style={[styles.navBtn, !canPrev && styles.navBtnDisabled]}
          activeOpacity={0.7}
        >
          <Icon name="chevron-left" size={22} color={canPrev ? '#3F3F46' : '#D4D4D8'} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{MONTHS[month]} {year}</Text>
        <TouchableOpacity onPress={() => go(1)} style={styles.navBtn} activeOpacity={0.7}>
          <Icon name="chevron-right" size={22} color="#3F3F46" />
        </TouchableOpacity>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <View key={i} style={styles.weekCell}>
            <Text style={styles.weekText}>{w}</Text>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((d, i) => {
          if (!d) return <View key={`empty-${i}`} style={styles.cell} />;
          const disabled = startOfDay(d) < min;
          const selected = sameDay(d, selectedDate);
          const isToday = sameDay(d, today);
          return (
            <TouchableOpacity
              key={d.toISOString()}
              style={styles.cell}
              activeOpacity={0.7}
              onPress={() => pick(d)}
              disabled={disabled}
            >
              <View style={[styles.dayContent, selected && styles.daySelected]}>
                <Text
                  style={[
                    styles.dayNum,
                    disabled && styles.dayDisabled,
                    !selected && isToday && styles.dayToday,
                    selected && styles.daySelectedText,
                  ]}
                >
                  {d.getDate()}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {},
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  navBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F2EE' },
  navBtnDisabled: { backgroundColor: '#F8F8F6' },
  monthLabel: { fontFamily: FONT.bold, fontSize: 16, color: '#18181B' },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekCell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  weekText: { fontFamily: FONT.semibold, fontSize: 12, color: '#A1A1AA' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.2857%', aspectRatio: 1, padding: 3 },
  dayContent: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  daySelected: { backgroundColor: BRAND },
  dayNum: { fontFamily: FONT.semibold, fontSize: 15, color: '#27272A' },
  daySelectedText: { color: '#FFFFFF', fontFamily: FONT.bold },
  dayToday: { color: BRAND, fontFamily: FONT.bold },
  dayDisabled: { color: '#D4D4D8' },
});

export default ClearoutCalendar;
