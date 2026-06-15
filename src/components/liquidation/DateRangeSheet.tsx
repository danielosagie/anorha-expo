// DateRangeSheet — Shopify-style date range picker (replaces the expandable
// calendar tray, which never earned its keep). Page 1: preset rows + "Custom
// Dates". Page 2: month calendar with period (start→end) selection + Apply.

import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Calendar as CalendarIcon, ChevronRight, X } from 'lucide-react-native';
import { Calendar } from 'react-native-calendars';

export interface DateRange {
  /** Preset key or 'custom'. */
  key: string;
  /** Pill label, e.g. "Today", "Last 7 days", "Jun 1 – Jun 10". */
  label: string;
  /** YYYY-MM-DD inclusive bounds. */
  start: string;
  end: string;
}

const ymd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
};
const shortDate = (s: string): string => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const todayRange = (): DateRange => ({ key: 'today', label: 'Today', start: ymd(new Date()), end: ymd(new Date()) });

const PRESETS: Array<{ key: string; label: string; range: () => DateRange }> = [
  { key: 'today', label: 'Today', range: todayRange },
  { key: 'yesterday', label: 'Yesterday', range: () => ({ key: 'yesterday', label: 'Yesterday', start: daysAgo(1), end: daysAgo(1) }) },
  { key: '7d', label: 'Last 7 days', range: () => ({ key: '7d', label: 'Last 7 days', start: daysAgo(6), end: ymd(new Date()) }) },
  { key: '30d', label: 'Last 30 days', range: () => ({ key: '30d', label: 'Last 30 days', start: daysAgo(29), end: ymd(new Date()) }) },
  { key: '90d', label: 'Last 90 days', range: () => ({ key: '90d', label: 'Last 90 days', start: daysAgo(89), end: ymd(new Date()) }) },
  { key: '365d', label: 'Last 365 days', range: () => ({ key: '365d', label: 'Last 365 days', start: daysAgo(364), end: ymd(new Date()) }) },
  {
    key: 'ytd',
    label: 'Year to date',
    range: () => ({ key: 'ytd', label: 'Year to date', start: `${new Date().getFullYear()}-01-01`, end: ymd(new Date()) }),
  },
];

export interface DateRangeSheetProps {
  visible: boolean;
  current: DateRange;
  onApply: (range: DateRange) => void;
  onClose: () => void;
}

export const DateRangeSheet: React.FC<DateRangeSheetProps> = ({ visible, current, onApply, onClose }) => {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<'presets' | 'custom'>('presets');
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);

  const close = () => {
    setPage('presets');
    setStart(null);
    setEnd(null);
    onClose();
  };

  const onDayPress = (d: { dateString: string }) => {
    if (!start || (start && end)) {
      setStart(d.dateString);
      setEnd(null);
    } else if (d.dateString < start) {
      setStart(d.dateString);
    } else {
      setEnd(d.dateString);
    }
  };

  // Period marking start → end (capped — a range past a year marks the bounds only).
  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};
    if (start) marks[start] = { startingDay: true, color: '#93C822', textColor: '#FFFFFF' };
    if (start && end) {
      const cursor = new Date(start);
      const stop = new Date(end);
      let guard = 0;
      cursor.setDate(cursor.getDate() + 1);
      while (cursor < stop && guard < 370) {
        marks[ymd(cursor)] = { color: 'rgba(147,200,34,0.22)', textColor: '#18181B' };
        cursor.setDate(cursor.getDate() + 1);
        guard += 1;
      }
      marks[end] = { endingDay: true, color: '#93C822', textColor: '#FFFFFF' };
    }
    return marks;
  }, [start, end]);

  const applyCustom = () => {
    if (!start) return;
    const e = end || start;
    onApply({ key: 'custom', label: `${shortDate(start)} – ${shortDate(e)}`, start, end: e });
    close();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdropWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
          <View style={styles.handle} />

          {page === 'presets' ? (
            <>
              <View style={styles.titleRow}>
                <CalendarIcon size={18} color="#18181B" />
                <Text style={styles.title}>Date range</Text>
              </View>

              <TouchableOpacity style={styles.customRow} activeOpacity={0.7} onPress={() => setPage('custom')}>
                <View style={styles.customIcon}>
                  <CalendarIcon size={18} color="#43631A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.customTitle}>Custom Dates</Text>
                  <Text style={styles.customSub}>Define a fixed date range</Text>
                </View>
                <ChevronRight size={20} color="#D4D4D8" />
              </TouchableOpacity>

              <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                {PRESETS.map((p, i) => {
                  const active = current.key === p.key;
                  return (
                    <TouchableOpacity
                      key={p.key}
                      style={[styles.presetRow, i > 0 && styles.rowBorder]}
                      activeOpacity={0.7}
                      onPress={() => {
                        onApply(p.range());
                        close();
                      }}
                    >
                      <Text style={[styles.presetText, active && { color: '#5A8F12', fontFamily: 'Inter_700Bold' }]}>
                        {p.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          ) : (
            <>
              <View style={styles.customHeader}>
                <TouchableOpacity style={styles.closeCircle} onPress={() => setPage('presets')} activeOpacity={0.85}>
                  <X size={18} color="#18181B" />
                </TouchableOpacity>
                <Text style={styles.title}>Set Custom Dates</Text>
                <View style={{ width: 36 }} />
              </View>

              <View style={styles.fieldsRow}>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Start</Text>
                  <Text style={styles.fieldValue}>{start ? shortDate(start) : 'Pick a day'}</Text>
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>End</Text>
                  <Text style={styles.fieldValue}>{end ? shortDate(end) : start ? 'Pick a day' : '—'}</Text>
                </View>
              </View>

              <Calendar
                markingType="period"
                markedDates={markedDates}
                onDayPress={onDayPress}
                maxDate={ymd(new Date())}
                theme={{
                  calendarBackground: '#FFFFFF',
                  dayTextColor: '#18181B',
                  monthTextColor: '#18181B',
                  textSectionTitleColor: '#9CA3AF',
                  arrowColor: '#18181B',
                  todayTextColor: '#5A8F12',
                  textDayFontWeight: '600',
                }}
              />

              <TouchableOpacity
                style={[styles.applyBtn, !start && { opacity: 0.45 }]}
                disabled={!start}
                activeOpacity={0.85}
                onPress={applyCustom}
              >
                <Text style={styles.applyText}>Apply</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdropWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: '#D4D4D8', marginBottom: 12 },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  title: { fontSize: 18, color: '#18181B', fontFamily: 'Inter_700Bold' },

  customRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FAFAF8', borderWidth: 1, borderColor: '#ECEBE6', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  customIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(147,200,34,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  customTitle: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  customSub: { fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginTop: 1 },

  presetRow: { paddingVertical: 15 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F1F1EE' },
  presetText: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_500Medium' },

  customHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  closeCircle: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F1EE',
    alignItems: 'center', justifyContent: 'center',
  },
  fieldsRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  field: {
    flex: 1, backgroundColor: '#FAFAF8', borderWidth: 1, borderColor: '#ECEBE6',
    borderRadius: 14, paddingHorizontal: 13, paddingVertical: 9,
  },
  fieldLabel: { fontSize: 11, color: '#9CA3AF', fontFamily: 'Inter_500Medium' },
  fieldValue: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold', marginTop: 1 },

  applyBtn: {
    backgroundColor: '#93C822', borderRadius: 16, paddingVertical: 15,
    alignItems: 'center', marginTop: 8,
  },
  applyText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
});

export default DateRangeSheet;
