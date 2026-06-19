import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ClearoutCalendar } from './ClearoutCalendar';
import { supabase } from '../../../lib/supabase';
import { useLegendState } from '../../context/LegendStateContext';

const BRAND = '#93C822';
const FONT = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

export type NewClearoutInput = {
  title?: string;
  targetRevenue: number;
  timeframeDays: number;
  aggressiveness: 'conservative' | 'balanced' | 'aggressive';
  /** ProductVariant ids the seller chose for this clearout. */
  productIds: string[];
  inventoryScope: 'all' | 'specific';
};

type Props = {
  visible: boolean;
  creating: boolean;
  onClose: () => void;
  onSubmit: (input: NewClearoutInput) => void;
};

type InventoryRow = {
  Id: string;
  Title?: string;
  Sku?: string;
  Price?: number;
  PrimaryImageUrl?: string;
  VariantType?: string;
  IsArchived?: boolean;
};

const SELECT_COLS = 'Id, Title, Sku, Price, PrimaryImageUrl, VariantType, IsArchived';

const AGGRESSIVENESS = [
  { key: 'conservative', label: 'Conservative', hint: 'Protect margin, drop prices slowly' },
  { key: 'balanced', label: 'Balanced', hint: 'Steady pace toward the deadline' },
  { key: 'aggressive', label: 'Aggressive', hint: 'Clear fast, accept lower offers' },
] as const;

// How much of the listed value a clearout is expected to recover. The goal we
// pre-fill is grounded in the items the seller actually picked — not a guess —
// and Sprout refines it with live comps once the campaign starts.
const RECOVERY_RATE = 0.75;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a: Date, b: Date) =>
  Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000);
const formatLong = (d: Date) => `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

const STEPS = ['name', 'inventory', 'goal', 'deadline', 'pace'] as const;

/**
 * One-question-at-a-time create flow, all inside a single bottom sheet.
 * Name -> Inventory -> Goal (suggested from the picked items) -> Deadline -> Pace.
 *
 * The goal is no longer a blank number: the seller picks what's going into the
 * clearout first, and the goal step opens pre-filled with a target derived from
 * those items' listed value, which they can still adjust.
 */
export const NewClearoutSheet: React.FC<Props> = ({ visible, creating, onClose, onSubmit }) => {
  const insets = useSafeAreaInsets();
  const legendState: any = useLegendState();
  const today = useMemo(() => startOfDay(new Date()), []);

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [goalEdited, setGoalEdited] = useState(false);
  const [deadline, setDeadline] = useState<Date>(() => addDays(new Date(), 14));
  const [aggressiveness, setAggressiveness] = useState<NewClearoutInput['aggressiveness']>('balanced');

  // Inventory picker state
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  // Fresh form each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setStep(0);
      setName('');
      setTarget('');
      setGoalEdited(false);
      setDeadline(addDays(new Date(), 14));
      setAggressiveness('balanced');
      setSelected(new Set());
      setQuery('');
    }
  }, [visible]);

  // Load the seller's inventory once the sheet is open (so the picker step is instant).
  useEffect(() => {
    if (!visible) return;
    const userId = legendState?.userId;
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoadingRows(true);
      try {
        const all: InventoryRow[] = [];
        let from = 0;
        const size = 200;
        // Hard cap so a very large inventory can't fan out into unbounded
        // sequential requests (the picker only needs a workable list to choose from).
        const MAX_ITEMS = 2000;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const to = from + size - 1;
          const { data, error } = await supabase
            .from('ProductVariants')
            .select(SELECT_COLS)
            .eq('UserId', userId)
            .not('Sku', 'like', 'DRAFT-%')
            .range(from, to);
          if (error) throw error;
          const r = (data as InventoryRow[]) || [];
          all.push(...r);
          if (r.length < size || all.length >= MAX_ITEMS) break;
          from += size;
        }
        if (!cancelled) setRows(all.filter(r => r.VariantType !== 'option' && !r.IsArchived));
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoadingRows(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, legendState?.userId]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => `${r.Title || ''} ${r.Sku || ''}`.toLowerCase().includes(q));
  }, [rows, query]);

  const selectedValue = useMemo(() => {
    let sum = 0;
    for (const r of rows) if (selected.has(r.Id)) sum += Number(r.Price || 0);
    return sum;
  }, [rows, selected]);

  // Grounded suggestion: what the picked items are likely to recover in a clearout.
  const suggestedGoal = useMemo(
    () => (selectedValue > 0 ? Math.max(10, Math.round((selectedValue * RECOVERY_RATE) / 10) * 10) : 0),
    [selectedValue],
  );

  const targetNum = useMemo(() => Number(target.replace(/[^0-9.]/g, '')) || 0, [target]);
  const timeframeDays = Math.max(1, daysBetween(today, deadline));

  // Pre-fill the goal field from the selection the moment the seller lands on the
  // goal step — unless they've already typed their own number.
  useEffect(() => {
    if (STEPS[step] === 'goal' && !goalEdited && suggestedGoal > 0) {
      setTarget(String(suggestedGoal));
    }
  }, [step, goalEdited, suggestedGoal]);

  const canAdvance =
    STEPS[step] === 'name' ? true :
    STEPS[step] === 'inventory' ? selected.size > 0 :
    STEPS[step] === 'goal' ? targetNum > 0 :
    STEPS[step] === 'deadline' ? startOfDay(deadline) > today :
    true;

  const isLast = step === STEPS.length - 1;

  const toggleRow = (id: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    // A change in selection re-opens the door to a fresh suggestion.
    if (!goalEdited) setTarget('');
  };

  const toggleAllVisible = () => {
    tap();
    setSelected(prev => {
      const n = new Set(prev);
      const everyShown = visibleRows.length > 0 && visibleRows.every(r => n.has(r.Id));
      if (everyShown) visibleRows.forEach(r => n.delete(r.Id));
      else visibleRows.forEach(r => n.add(r.Id));
      return n;
    });
    if (!goalEdited) setTarget('');
  };

  const next = () => {
    if (!canAdvance || creating) return;
    tap();
    if (isLast) {
      onSubmit({
        title: name.trim() || undefined,
        targetRevenue: targetNum,
        timeframeDays,
        aggressiveness,
        productIds: Array.from(selected),
        inventoryScope: 'specific',
      });
      return;
    }
    setStep(s => s + 1);
  };

  const back = () => {
    tap();
    if (step === 0) {
      onClose();
      return;
    }
    setStep(s => s - 1);
  };

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every(r => selected.has(r.Id));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />

            {/* Back + progress dots */}
            <View style={styles.topRow}>
              <TouchableOpacity onPress={back} style={styles.backBtn} activeOpacity={0.7}>
                <Icon name={step === 0 ? 'close' : 'chevron-left'} size={22} color="#3F3F46" />
              </TouchableOpacity>
              <View style={styles.dots}>
                {STEPS.map((_, i) => (
                  <View key={i} style={[styles.dot, i === step && styles.dotActive, i < step && styles.dotDone]} />
                ))}
              </View>
              <View style={styles.backBtn} />
            </View>

            {/* Step content */}
            <Animated.View key={step} entering={FadeIn.duration(160)} style={styles.stepBody}>
              {STEPS[step] === 'name' && (
                <>
                  <Text style={styles.question}>Name this clearout</Text>
                  <Text style={styles.hint}>So you can spot it on your home screen. Optional.</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      style={styles.input}
                      value={name}
                      onChangeText={setName}
                      placeholder="e.g. Tech liquidation"
                      placeholderTextColor="#9CA3AF"
                      autoFocus
                      returnKeyType="next"
                      onSubmitEditing={next}
                      maxLength={48}
                    />
                  </View>
                </>
              )}

              {STEPS[step] === 'inventory' && (
                <>
                  <Text style={styles.question}>What are we clearing out?</Text>
                  <Text style={styles.hint}>
                    Pick the items for this clearout. Your goal is built from what you choose.
                  </Text>
                  <View style={styles.searchRow}>
                    <Icon name="magnify" size={18} color="#9CA3AF" />
                    <TextInput
                      style={styles.searchInput}
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Search inventory"
                      placeholderTextColor="#9CA3AF"
                    />
                    <TouchableOpacity onPress={toggleAllVisible} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.selectAll}>{allVisibleSelected ? 'Clear' : 'All'}</Text>
                    </TouchableOpacity>
                  </View>

                  {loadingRows ? (
                    <View style={styles.pickerLoading}>
                      <ActivityIndicator color={BRAND} />
                      <Text style={styles.pickerLoadingText}>Loading your inventory…</Text>
                    </View>
                  ) : (
                    <FlatList
                      data={visibleRows}
                      keyExtractor={item => item.Id}
                      style={styles.pickerList}
                      keyboardShouldPersistTaps="handled"
                      ListEmptyComponent={
                        <Text style={styles.pickerEmpty}>
                          {rows.length === 0 ? 'No inventory yet. Add products first.' : 'No items match.'}
                        </Text>
                      }
                      renderItem={({ item }) => {
                        const sel = selected.has(item.Id);
                        return (
                          <TouchableOpacity style={styles.pickRow} onPress={() => toggleRow(item.Id)} activeOpacity={0.7}>
                            <View style={[styles.cb, sel && styles.cbOn]}>
                              {sel ? <Icon name="check" size={13} color="#FFFFFF" /> : null}
                            </View>
                            <View style={styles.pickThumb}>
                              {item.PrimaryImageUrl ? (
                                <Image source={{ uri: item.PrimaryImageUrl }} style={styles.pickThumbImg} resizeMode="cover" />
                              ) : (
                                <Icon name="package-variant-closed" size={18} color="#A1A1AA" />
                              )}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.pickTitle} numberOfLines={1}>{item.Title || 'Untitled'}</Text>
                              <Text style={styles.pickSub} numberOfLines={1}>
                                {money(Number(item.Price || 0))}{item.Sku ? `  ·  ${item.Sku}` : ''}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      }}
                    />
                  )}

                  <Text style={styles.selSummary}>
                    {selected.size > 0
                      ? `${selected.size} selected · ${money(selectedValue)} at list price`
                      : 'Nothing selected yet'}
                  </Text>
                </>
              )}

              {STEPS[step] === 'goal' && (
                <>
                  <Text style={styles.question}>What's your revenue goal?</Text>
                  <Text style={styles.hint}>
                    {suggestedGoal > 0
                      ? `Suggested from your ${selected.size} item${selected.size === 1 ? '' : 's'} (~${money(selectedValue)} at list price). Sprout refines this with live comps.`
                      : 'The total you want Sprout to bring in.'}
                  </Text>
                  <View style={styles.inputRow}>
                    <Text style={styles.prefix}>$</Text>
                    <TextInput
                      style={styles.input}
                      value={target}
                      onChangeText={t => { setGoalEdited(true); setTarget(t); }}
                      keyboardType="number-pad"
                      placeholder={suggestedGoal > 0 ? String(suggestedGoal) : '750'}
                      placeholderTextColor="#9CA3AF"
                      autoFocus
                    />
                    {suggestedGoal > 0 && targetNum !== suggestedGoal ? (
                      <TouchableOpacity
                        onPress={() => { tap(); setGoalEdited(false); setTarget(String(suggestedGoal)); }}
                        style={styles.resetChip}
                      >
                        <Text style={styles.resetChipText}>Use {money(suggestedGoal)}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </>
              )}

              {STEPS[step] === 'deadline' && (
                <>
                  <Text style={styles.question}>When should Sprout finish?</Text>
                  <Text style={styles.hint}>
                    {formatLong(deadline)} · {timeframeDays} day{timeframeDays === 1 ? '' : 's'} from today
                  </Text>
                  <ClearoutCalendar selectedDate={deadline} onSelect={setDeadline} minDate={addDays(today, 1)} />
                </>
              )}

              {STEPS[step] === 'pace' && (
                <>
                  <Text style={styles.question}>How hard should Sprout push?</Text>
                  <Text style={styles.hint}>You can change this anytime in campaign settings.</Text>
                  <View style={styles.paceList}>
                    {AGGRESSIVENESS.map(a => {
                      const active = a.key === aggressiveness;
                      return (
                        <TouchableOpacity
                          key={a.key}
                          style={[styles.paceRow, active && styles.paceRowActive]}
                          onPress={() => {
                            tap();
                            setAggressiveness(a.key);
                          }}
                          activeOpacity={0.85}
                        >
                          <View style={[styles.radio, active && styles.radioActive]}>
                            {active ? <View style={styles.radioDot} /> : null}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.paceLabel, active && styles.paceLabelActive]}>{a.label}</Text>
                            <Text style={styles.paceHint}>{a.hint}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </Animated.View>

            {/* CTA */}
            <TouchableOpacity
              style={[styles.cta, !canAdvance && styles.ctaDisabled]}
              onPress={next}
              disabled={!canAdvance || creating}
              activeOpacity={0.9}
            >
              {creating && isLast ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.ctaText}>{isLast ? 'Start clearout' : 'Next'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E7', marginBottom: 8 },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#E4E4E7' },
  dotActive: { width: 22, backgroundColor: BRAND },
  dotDone: { backgroundColor: '#C2DE8C' },

  stepBody: { minHeight: 184, paddingTop: 6 },
  question: { color: '#18181B', fontFamily: FONT.bold, fontSize: 22, marginBottom: 6 },
  hint: { color: '#71717A', fontFamily: FONT.regular, fontSize: 14, lineHeight: 19, marginBottom: 16 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E4E4E7',
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  prefix: { color: '#71717A', fontFamily: FONT.semibold, fontSize: 18, marginRight: 4 },
  input: { flex: 1, color: '#18181B', fontFamily: FONT.semibold, fontSize: 18, paddingVertical: 15 },
  resetChip: { backgroundColor: 'rgba(147,200,34,0.14)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  resetChipText: { color: '#5D7E16', fontFamily: FONT.semibold, fontSize: 12.5 },

  // Inventory picker
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F4F4F1',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#18181B', fontFamily: FONT.medium, paddingVertical: 0 },
  selectAll: { color: '#5D7E16', fontFamily: FONT.semibold, fontSize: 13 },
  pickerList: { maxHeight: 260 },
  pickerLoading: { height: 200, alignItems: 'center', justifyContent: 'center', gap: 10 },
  pickerLoadingText: { color: '#71717A', fontFamily: FONT.medium, fontSize: 13 },
  pickerEmpty: { textAlign: 'center', color: '#9CA3AF', fontFamily: FONT.medium, fontSize: 13, marginTop: 28 },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  cb: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  cbOn: { backgroundColor: BRAND, borderColor: BRAND },
  pickThumb: { width: 44, height: 44, borderRadius: 11, backgroundColor: '#F4F4F1', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)', overflow: 'hidden' },
  pickThumbImg: { width: '100%', height: '100%' },
  pickTitle: { fontSize: 15, color: '#18181B', fontFamily: FONT.semibold, marginLeft: 12, marginBottom: 2 },
  pickSub: { fontSize: 12.5, color: '#71717A', fontFamily: FONT.regular, marginLeft: 12 },
  selSummary: { marginTop: 10, color: '#5D7E16', fontFamily: FONT.semibold, fontSize: 13 },

  paceList: { gap: 10 },
  paceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    borderRadius: 14,
    padding: 14,
  },
  paceRowActive: { borderColor: BRAND, backgroundColor: 'rgba(147,200,34,0.08)' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#D4D4D8', alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: BRAND },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: BRAND },
  paceLabel: { color: '#27272A', fontFamily: FONT.semibold, fontSize: 15 },
  paceLabelActive: { color: '#18181B', fontFamily: FONT.bold },
  paceHint: { color: '#9CA3AF', fontFamily: FONT.regular, fontSize: 12, marginTop: 2 },

  cta: { marginTop: 14, alignItems: 'center', borderRadius: 14, paddingVertical: 16, backgroundColor: BRAND },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 16 },
});

export default NewClearoutSheet;
