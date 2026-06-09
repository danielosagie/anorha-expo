import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
};

type Props = {
  visible: boolean;
  creating: boolean;
  onClose: () => void;
  onSubmit: (input: NewClearoutInput) => void;
};

const AGGRESSIVENESS = [
  { key: 'conservative', label: 'Conservative', hint: 'Protect margin, drop prices slowly' },
  { key: 'balanced', label: 'Balanced', hint: 'Steady pace toward the deadline' },
  { key: 'aggressive', label: 'Aggressive', hint: 'Clear fast, accept lower offers' },
] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a: Date, b: Date) =>
  Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000);
const formatLong = (d: Date) => `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

const STEPS = ['name', 'goal', 'deadline', 'pace'] as const;

/**
 * One-question-at-a-time create flow, all inside a single bottom sheet.
 * Name -> Goal -> Deadline (calendar) -> Pace.
 */
export const NewClearoutSheet: React.FC<Props> = ({ visible, creating, onClose, onSubmit }) => {
  const insets = useSafeAreaInsets();
  const today = useMemo(() => startOfDay(new Date()), []);

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState<Date>(() => addDays(new Date(), 14));
  const [aggressiveness, setAggressiveness] = useState<NewClearoutInput['aggressiveness']>('balanced');

  // Fresh form each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setStep(0);
      setName('');
      setTarget('');
      setDeadline(addDays(new Date(), 14));
      setAggressiveness('balanced');
    }
  }, [visible]);

  const targetNum = useMemo(() => Number(target.replace(/[^0-9.]/g, '')) || 0, [target]);
  const timeframeDays = Math.max(1, daysBetween(today, deadline));

  const canAdvance =
    step === 0 ? true :
    step === 1 ? targetNum > 0 :
    step === 2 ? startOfDay(deadline) > today :
    true;

  const isLast = step === STEPS.length - 1;

  const next = () => {
    if (!canAdvance || creating) return;
    tap();
    if (isLast) {
      onSubmit({
        title: name.trim() || undefined,
        targetRevenue: targetNum,
        timeframeDays,
        aggressiveness,
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
              {step === 0 && (
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

              {step === 1 && (
                <>
                  <Text style={styles.question}>What's your revenue goal?</Text>
                  <Text style={styles.hint}>The total you want Sprout to bring in.</Text>
                  <View style={styles.inputRow}>
                    <Text style={styles.prefix}>$</Text>
                    <TextInput
                      style={styles.input}
                      value={target}
                      onChangeText={setTarget}
                      keyboardType="number-pad"
                      placeholder="750"
                      placeholderTextColor="#9CA3AF"
                      autoFocus
                    />
                  </View>
                </>
              )}

              {step === 2 && (
                <>
                  <Text style={styles.question}>When should Sprout finish?</Text>
                  <Text style={styles.hint}>
                    {formatLong(deadline)} · {timeframeDays} day{timeframeDays === 1 ? '' : 's'} from today
                  </Text>
                  <ClearoutCalendar selectedDate={deadline} onSelect={setDeadline} minDate={addDays(today, 1)} />
                </>
              )}

              {step === 3 && (
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
