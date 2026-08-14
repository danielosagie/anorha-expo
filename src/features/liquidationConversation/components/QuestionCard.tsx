// QuestionCard — renders a Sprout ask_seller_question pending action as tappable
// options (single or multi select) with a recommended badge and a short "what this
// means" line per option. Questions are paged one at a time with a "N of M" stepper to
// the left of the title; a single single-select question answers instantly on tap.

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Check, ChevronLeft } from 'lucide-react-native';
import type { QuestionItem, QuestionPrompt } from '../types';
import { getSproutTheme } from '../../../design/sproutTheme';

interface QuestionCardProps {
  prompt: QuestionPrompt;
  submitting?: boolean;
  onSubmit: (answers: Record<string, string[]>, other?: string) => void;
  dark?: boolean;
}

// Always index-scoped so two questions sharing a header don't collide in `selected`.
const keyFor = (q: QuestionItem, i: number) => `${i}:${q.header?.trim() || 'q'}`;

const QuestionCard: React.FC<QuestionCardProps> = ({ prompt, submitting, onSubmit, dark = false }) => {
  const theme = getSproutTheme(dark);
  const total = prompt.questions.length;
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState('');

  const current = Math.min(idx, total - 1);
  const q = prompt.questions[current];
  const k = keyFor(q, current);
  const picks = selected[k] || [];
  const isLast = current >= total - 1;
  // One single-select question → tap an option to answer instantly (no Send button).
  const instant = total === 1 && !q.multiSelect;

  const choose = (label: string) => {
    if (submitting) return;
    if (!q.multiSelect) {
      if (instant) {
        onSubmit({ [k]: [label] }, other.trim() || undefined);
        return;
      }
      setSelected((prev) => ({ ...prev, [k]: [label] }));
      return;
    }
    setSelected((prev) => {
      const cur = prev[k] || [];
      const nextPicks = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
      return { ...prev, [k]: nextPicks };
    });
  };

  const currentAnswered = picks.length > 0 || other.trim().length > 0;
  const allAnswered = useMemo(
    () =>
      prompt.questions.every((qq, i) => (selected[keyFor(qq, i)] || []).length > 0) ||
      other.trim().length > 0,
    [prompt.questions, selected, other],
  );

  const goNext = () => setIdx((i) => Math.min(total - 1, i + 1));
  const goBack = () => setIdx((i) => Math.max(0, i - 1));
  const submit = () => {
    if (submitting) return;
    onSubmit(selected, other.trim() || undefined);
  };

  const primaryDisabled = (isLast ? !allAnswered : !currentAnswered) || !!submitting;

  return (
    <View style={[s.card, dark && { backgroundColor: theme.chat.surface, borderColor: theme.chat.border }]}>
      <View style={s.head}>
        {total > 1 ? (
          <View style={s.stepper}>
            <TouchableOpacity
              onPress={goBack}
              disabled={current === 0 || submitting}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <ChevronLeft size={16} color={current === 0 ? theme.chat.textMuted : theme.chat.textSecondary} />
            </TouchableOpacity>
            <Text style={[s.stepText, dark && { color: theme.chat.textSecondary }]}>{current + 1} of {total}</Text>
          </View>
        ) : null}
        <Text style={[s.question, s.questionFlex, dark && { color: theme.chat.text }]}>{q.question}</Text>
      </View>

      {q.options.map((opt, oi) => {
        const on = picks.includes(opt.label);
        return (
          <TouchableOpacity
            key={`${opt.label}-${oi}`}
            style={[
              s.option,
              dark && { borderColor: theme.chat.border },
              (on || opt.recommended) && s.optionAccent,
              dark && (on || opt.recommended) && { backgroundColor: theme.chat.surfaceMuted },
              on && s.optionOn,
            ]}
            activeOpacity={0.75}
            disabled={submitting}
            onPress={() => choose(opt.label)}
          >
            <View style={[
              s.mark,
              q.multiSelect ? s.markBox : s.markRadio,
              { borderColor: on ? theme.colors.primary : theme.chat.textMuted },
              on && s.markOn,
            ]}>
              {on && <Check size={13} color={theme.colors.onPrimary} />}
            </View>
            <View style={s.optBody}>
              <View style={s.optLabelRow}>
                <Text style={[
                  s.optLabel,
                  dark && { color: theme.chat.text },
                  (on || opt.recommended) && { color: dark ? theme.colors.primary : '#93C822', fontFamily: 'Inter_600SemiBold' },
                ]}>{opt.label}</Text>
                {opt.recommended && <Text style={[s.recPill, dark && { color: theme.colors.primary }]}>Recommended</Text>}
              </View>
              {!!opt.description && (
                <Text
                  style={[
                    s.optDesc,
                    dark && { color: theme.chat.textSecondary },
                    (on || opt.recommended) && { color: dark ? theme.colors.primary : '#93C822', fontFamily: 'Inter_600SemiBold' },
                  ]}
                  numberOfLines={2}
                >
                  {opt.description}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        );
      })}

      <TextInput
        style={[
          s.other,
          dark && { color: theme.chat.text, backgroundColor: theme.chat.surfaceElevated, borderColor: theme.chat.border },
        ]}
        value={other}
        onChangeText={setOther}
        placeholder="Or type your own answer…"
        placeholderTextColor={theme.chat.textMuted}
        editable={!submitting}
      />

      {!instant && (
        <TouchableOpacity
          style={[s.send, primaryDisabled && { opacity: 0.5 }]}
          disabled={primaryDisabled}
          onPress={isLast ? submit : goNext}
          activeOpacity={0.85}
        >
          <Text style={[s.sendText, { color: theme.colors.onPrimary }]}>{submitting ? 'Sending…' : isLast ? 'Send' : 'Next'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 0.5, borderColor: '#ECEBE6', borderRadius: 18, padding: 14 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: 1 },
  stepText: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_600SemiBold' },
  question: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold', lineHeight: 22 },
  questionFlex: { flex: 1 },
  option: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 11, marginBottom: 8,
    borderWidth: 0.5, borderColor: '#D4D4D8', borderRadius: 12,
  },
  optionAccent: { borderColor: '#93C822', backgroundColor: '#F4F9E8' },
  optionOn: { borderWidth: 1.5 },
  mark: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  markRadio: { borderRadius: 10, borderWidth: 1.5, borderColor: '#D4D4D8' },
  markBox: { borderRadius: 6, borderWidth: 1.5, borderColor: '#D4D4D8' },
  markOn: { backgroundColor: '#93C822', borderColor: '#93C822' },
  optBody: { flex: 1 },
  optLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  optLabel: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  recPill: {
    fontSize: 12, color: '#93C822', borderWidth: 0.5, borderColor: '#93C822',
    paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, overflow: 'hidden', fontFamily: 'Inter_600SemiBold',
  },
  optDesc: { marginTop: 3, fontSize: 14, color: '#71717A', fontFamily: 'Inter_400Regular', lineHeight: 19 },
  other: {
    borderWidth: 0.5, borderColor: '#ECEBE6', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#18181B', fontFamily: 'Inter_400Regular', backgroundColor: '#FAFAF8', marginTop: 2,
  },
  send: {
    marginTop: 10, backgroundColor: '#93C822', borderRadius: 12, paddingVertical: 12, alignItems: 'center',
  },
  sendText: { fontSize: 15, color: '#FFFFFF', fontFamily: 'Inter_700Bold' },
});

export default QuestionCard;
