import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
import { api } from '../../lib/apiClient';
import type { PricingGuidanceData } from '../pricing/PricingGuidanceCard';
import {
  addCalendarDays,
  calendarDaysBetween,
  describeCampaignDuration,
  formatSellByDate,
  startOfLocalDay,
} from '../../features/liquidationConversation/campaignTiming';

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
  /** ProductVariant ids the seller chose for this clearout. */
  productIds: string[];
  inventoryScope: 'all' | 'specific';
  /** Real researched launch prices keyed by ProductVariant id. */
  launchPrices: Record<string, number>;
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

type PricingResearchResult = PricingGuidanceData & { error?: string };
type PricingResearchState =
  | { status: 'loading' }
  | { status: 'ready'; result: PricingResearchResult }
  | { status: 'empty' }
  | { status: 'error' };

const SELECT_COLS = 'Id, Title, Sku, Price, PrimaryImageUrl, VariantType, IsArchived';

// How much of the listed value a clearout is expected to recover. The goal we
// pre-fill is grounded in the items the seller actually picked, not a guess,
// and it updates as real sold-comps research arrives.
const RECOVERY_RATE = 0.75;
const PRICING_CONCURRENCY = 3;
const PRICING_TIMEOUT_MS = 20_000;

const money = (n: number) => `$${n.toLocaleString(undefined, {
  minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
  maximumFractionDigits: 2,
})}`;

const pricingChoices = (result: PricingResearchResult) => {
  const candidates = [
    { key: 'fast', label: 'Fast sale', price: result.low },
    { key: 'suggested', label: 'Suggested', price: result.recommended ?? result.median },
    { key: 'max', label: 'Max return', price: result.high },
  ];
  const seen = new Set<number>();
  return candidates.filter((choice): choice is { key: string; label: string; price: number } => {
    if (typeof choice.price !== 'number' || !Number.isFinite(choice.price) || choice.price <= 0) return false;
    const rounded = Math.round(choice.price * 100) / 100;
    if (seen.has(rounded)) return false;
    seen.add(rounded);
    return true;
  });
};

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

const STEPS = ['name', 'inventory', 'goal', 'deadline', 'pricing'] as const;

/**
 * One-question-at-a-time create flow, all inside a single bottom sheet.
 * Name -> Inventory -> Goal -> Deadline -> Pricing review.
 *
 * The goal is no longer a blank number: the seller picks what's going into the
 * clearout first, and the goal step opens pre-filled with a target derived from
 * those items' listed value, which they can still adjust.
 */
export const NewClearoutSheet: React.FC<Props> = ({ visible, creating, onClose, onSubmit }) => {
  const insets = useSafeAreaInsets();
  const legendState: any = useLegendState();
  const today = startOfLocalDay(new Date());

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [goalEdited, setGoalEdited] = useState(false);
  const [deadline, setDeadline] = useState<Date>(() => addCalendarDays(new Date(), 14));

  // Inventory picker state
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  // Pricing requests are queued as soon as an item is selected. The refs make
  // repeated selection effects idempotent and let close/unmount abort every job.
  const [pricingById, setPricingById] = useState<Record<string, PricingResearchState>>({});
  const [launchPrices, setLaunchPrices] = useState<Record<string, number>>({});
  const pricingQueueRef = useRef<InventoryRow[]>([]);
  const pricingAttemptedRef = useRef<Set<string>>(new Set());
  const pricingActiveRef = useRef(0);
  const pricingAbortRef = useRef<Map<string, AbortController>>(new Map());
  const pricingSessionRef = useRef(0);
  const pumpPricingRef = useRef<() => void>(() => undefined);

  // Fresh form each time the sheet opens.
  useEffect(() => {
    const abortControllers = pricingAbortRef.current;
    if (visible) {
      setStep(0);
      setName('');
      setTarget('');
      setGoalEdited(false);
      setDeadline(addCalendarDays(new Date(), 14));
      setSelected(new Set());
      setQuery('');
      setPricingById({});
      setLaunchPrices({});
      pricingQueueRef.current = [];
      pricingAttemptedRef.current = new Set();
      pricingActiveRef.current = 0;
    }

    pricingSessionRef.current += 1;
    for (const controller of abortControllers.values()) controller.abort();
    abortControllers.clear();
    return () => {
      pricingSessionRef.current += 1;
      pricingQueueRef.current = [];
      for (const controller of abortControllers.values()) controller.abort();
      abortControllers.clear();
    };
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

  const runPricingResearch = useCallback(async (row: InventoryRow, session: number) => {
    const controller = new AbortController();
    pricingAbortRef.current.set(row.Id, controller);

    try {
      const result = await api.post<PricingResearchResult>('/api/ebay/pricing-research', {
        title: String(row.Title || '').trim(),
        condition: 'mixed',
        limit: 20,
      }, {
        signal: controller.signal,
        timeoutMs: PRICING_TIMEOUT_MS,
      });
      if (pricingSessionRef.current !== session || controller.signal.aborted) return;

      const choices = pricingChoices(result);
      if (result.error) {
        setPricingById(previous => ({ ...previous, [row.Id]: { status: 'error' } }));
        return;
      }
      if (choices.length === 0) {
        setPricingById(previous => ({ ...previous, [row.Id]: { status: 'empty' } }));
        return;
      }

      setPricingById(previous => ({ ...previous, [row.Id]: { status: 'ready', result } }));
      const suggested = choices.find(choice => choice.key === 'suggested') ?? choices[0];
      setLaunchPrices(previous => (
        typeof previous[row.Id] === 'number'
          ? previous
          : { ...previous, [row.Id]: suggested.price }
      ));
    } catch {
      if (pricingSessionRef.current !== session) return;
      setPricingById(previous => ({ ...previous, [row.Id]: { status: 'error' } }));
    } finally {
      if (pricingAbortRef.current.get(row.Id) === controller) pricingAbortRef.current.delete(row.Id);
    }
  }, []);

  const pumpPricingQueue = useCallback(() => {
    while (pricingActiveRef.current < PRICING_CONCURRENCY && pricingQueueRef.current.length > 0) {
      const row = pricingQueueRef.current.shift();
      if (!row) break;
      const session = pricingSessionRef.current;
      pricingActiveRef.current += 1;
      void runPricingResearch(row, session).finally(() => {
        if (pricingSessionRef.current !== session) return;
        pricingActiveRef.current = Math.max(0, pricingActiveRef.current - 1);
        pumpPricingRef.current();
      });
    }
  }, [runPricingResearch]);

  useEffect(() => {
    pumpPricingRef.current = pumpPricingQueue;
  }, [pumpPricingQueue]);

  const enqueuePricingResearch = useCallback((row: InventoryRow, retry = false) => {
    if (!row.Title?.trim()) {
      setPricingById(previous => ({ ...previous, [row.Id]: { status: 'empty' } }));
      return;
    }
    if (pricingAbortRef.current.has(row.Id) || pricingQueueRef.current.some(queued => queued.Id === row.Id)) return;
    if (!retry && pricingAttemptedRef.current.has(row.Id)) return;

    pricingAttemptedRef.current.add(row.Id);
    pricingQueueRef.current = pricingQueueRef.current.filter(queued => queued.Id !== row.Id);
    setPricingById(previous => ({ ...previous, [row.Id]: { status: 'loading' } }));
    pricingQueueRef.current.push(row);
    pumpPricingRef.current();
  }, []);

  useEffect(() => {
    if (!visible || selected.size === 0) return;
    for (const row of rows) {
      if (selected.has(row.Id)) enqueuePricingResearch(row);
    }
  }, [enqueuePricingResearch, rows, selected, visible]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => `${r.Title || ''} ${r.Sku || ''}`.toLowerCase().includes(q));
  }, [rows, query]);

  const selectedRows = useMemo(() => rows.filter(row => selected.has(row.Id)), [rows, selected]);

  const selectedValue = useMemo(() => {
    let sum = 0;
    for (const row of selectedRows) sum += Number(launchPrices[row.Id] ?? row.Price ?? 0);
    return sum;
  }, [launchPrices, selectedRows]);

  // Grounded suggestion: what the picked items are likely to recover in a clearout.
  const suggestedGoal = useMemo(
    () => (selectedValue > 0 ? Math.max(10, Math.round((selectedValue * RECOVERY_RATE) / 10) * 10) : 0),
    [selectedValue],
  );

  const targetNum = useMemo(() => Number(target.replace(/[^0-9.]/g, '')) || 0, [target]);
  const durationDays = calendarDaysBetween(today, deadline);
  const timeframeDays = Math.max(1, durationDays);
  const durationLabel = describeCampaignDuration(durationDays);
  const pricingReadyCount = selectedRows.filter(row => pricingById[row.Id]?.status === 'ready').length;
  const pricingLoadingCount = selectedRows.filter(row => pricingById[row.Id]?.status === 'loading').length;

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
    STEPS[step] === 'deadline' ? startOfLocalDay(deadline) >= today :
    true;

  const isLast = step === STEPS.length - 1;

  const toggleRow = (id: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
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
        productIds: Array.from(selected),
        inventoryScope: 'specific',
        launchPrices: Object.fromEntries(
          Object.entries(launchPrices).filter(([id, price]) => selected.has(id) && Number.isFinite(price) && price > 0),
        ),
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
                      ? `${selected.size} selected · ${money(selectedValue)} estimated`
                      : 'Nothing selected yet'}
                  </Text>
                </>
              )}

              {STEPS[step] === 'goal' && (
                <>
                  <Text style={styles.question}>Set revenue goal</Text>
                  <Text style={styles.hint}>
                    {suggestedGoal > 0
                      ? `Based on ${selected.size} item${selected.size === 1 ? '' : 's'} at about ${money(selectedValue)}. It updates as research lands.`
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
                  <Text style={styles.question}>Sell everything by</Text>
                  <Text style={styles.hint}>{formatSellByDate(deadline)}</Text>
                  <View style={styles.durationPill}>
                    <Icon name="calendar-clock" size={17} color="#5D7E16" />
                    <Text style={styles.durationText}>{durationLabel}</Text>
                  </View>
                  <ClearoutCalendar selectedDate={deadline} onSelect={setDeadline} minDate={today} />
                </>
              )}

              {STEPS[step] === 'pricing' && (
                <>
                  <Text style={styles.question}>Choose launch prices</Text>
                  <Text style={styles.hint}>
                    {pricingLoadingCount > 0
                      ? `${pricingReadyCount} of ${selectedRows.length} ready. Results appear as research finishes.`
                      : pricingReadyCount > 0
                      ? `${pricingReadyCount} of ${selectedRows.length} priced from recent sales.`
                      : 'No recent pricing results were found. Current prices stay unchanged.'}
                  </Text>
                  <FlatList
                    data={selectedRows}
                    keyExtractor={item => item.Id}
                    style={styles.pricingList}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => {
                      const research = pricingById[item.Id] ?? { status: 'loading' as const };
                      const choices = research.status === 'ready' ? pricingChoices(research.result) : [];
                      const chosenPrice = launchPrices[item.Id];
                      return (
                        <View style={styles.pricingCard}>
                          <View style={styles.pricingItemRow}>
                            <View style={styles.pricingThumb}>
                              {item.PrimaryImageUrl ? (
                                <Image source={{ uri: item.PrimaryImageUrl }} style={styles.pickThumbImg} resizeMode="cover" />
                              ) : (
                                <Icon name="package-variant-closed" size={17} color="#A1A1AA" />
                              )}
                            </View>
                            <View style={styles.pricingItemCopy}>
                              <Text style={styles.pricingTitle} numberOfLines={1}>{item.Title || 'Untitled'}</Text>
                              <Text style={styles.pricingCurrent}>Current {money(Number(item.Price || 0))}</Text>
                            </View>
                          </View>

                          {research.status === 'loading' ? (
                            <View style={styles.pricingState}>
                              <ActivityIndicator size="small" color={BRAND} />
                              <Text style={styles.pricingStateText}>Finding comps</Text>
                            </View>
                          ) : research.status === 'error' ? (
                            <View style={styles.pricingState}>
                              <Text style={styles.pricingStateText}>Research unavailable</Text>
                              <Pressable onPress={() => enqueuePricingResearch(item, true)} hitSlop={8}>
                                <Text style={styles.retryText}>Retry</Text>
                              </Pressable>
                            </View>
                          ) : research.status === 'empty' ? (
                            <View style={styles.pricingState}>
                              <Icon name="tag-search-outline" size={18} color="#A1A1AA" />
                              <Text style={styles.pricingStateText}>No recent comps</Text>
                            </View>
                          ) : (
                            <>
                              {typeof research.result.low === 'number' && typeof research.result.high === 'number' ? (
                                <Text style={styles.marketRange}>
                                  Market {money(research.result.low)} to {money(research.result.high)}
                                </Text>
                              ) : null}
                              <View style={styles.priceChoices}>
                                {choices.map(choice => {
                                  const active = chosenPrice === choice.price;
                                  return (
                                    <Pressable
                                      key={choice.key}
                                      style={[styles.priceChoice, active && styles.priceChoiceActive]}
                                      onPress={() => {
                                        tap();
                                        setLaunchPrices(previous => ({ ...previous, [item.Id]: choice.price }));
                                      }}
                                    >
                                      <Text style={[styles.priceChoiceLabel, active && styles.priceChoiceLabelActive]}>{choice.label}</Text>
                                      <Text style={[styles.priceChoiceValue, active && styles.priceChoiceValueActive]}>{money(choice.price)}</Text>
                                    </Pressable>
                                  );
                                })}
                              </View>
                            </>
                          )}
                        </View>
                      );
                    }}
                  />
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

  durationPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(147,200,34,0.14)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  durationText: { color: '#5D7E16', fontFamily: FONT.semibold, fontSize: 13 },

  pricingList: { maxHeight: 310 },
  pricingCard: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.07)',
    borderRadius: 12,
    borderCurve: 'continuous',
    padding: 12,
    gap: 12,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  pricingItemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pricingThumb: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pricingItemCopy: { flex: 1 },
  pricingTitle: { color: '#111827', fontFamily: FONT.semibold, fontSize: 14 },
  pricingCurrent: { color: '#6B7280', fontFamily: FONT.regular, fontSize: 12, marginTop: 2 },
  pricingState: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: '#F1F5F9',
  },
  pricingStateText: { color: '#6B7280', fontFamily: FONT.medium, fontSize: 13 },
  retryText: { color: '#5D7E16', fontFamily: FONT.bold, fontSize: 13 },
  marketRange: { color: '#4B5563', fontFamily: FONT.medium, fontSize: 12 },
  priceChoices: { flexDirection: 'row', gap: 8 },
  priceChoice: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.07)',
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 9,
  },
  priceChoiceActive: { borderColor: BRAND, backgroundColor: 'rgba(147,200,34,0.12)' },
  priceChoiceLabel: { color: '#6B7280', fontFamily: FONT.medium, fontSize: 10.5 },
  priceChoiceLabelActive: { color: '#5D7E16', fontFamily: FONT.semibold },
  priceChoiceValue: { color: '#111827', fontFamily: FONT.semibold, fontSize: 13 },
  priceChoiceValueActive: { color: '#43631A', fontFamily: FONT.bold },

  cta: { marginTop: 14, alignItems: 'center', borderRadius: 14, paddingVertical: 16, backgroundColor: BRAND },
  ctaDisabled: { opacity: 0.45 },
  ctaText: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 16 },
});

export default NewClearoutSheet;
