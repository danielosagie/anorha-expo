// QuestionCard — renders a Sprout ask_seller_question pending action as tappable
// options (single or multi select) with a recommended badge and per-option
// "what this means" descriptions. Single-select with one question auto-submits on
// tap; otherwise a Send button submits once every question has a selection.

import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Check } from 'lucide-react-native';
import type { QuestionItem, QuestionPrompt } from '../types';

interface QuestionCardProps {
  prompt: QuestionPrompt;
  submitting?: boolean;
  onSubmit: (answers: Record<string, string[]>, other?: string) => void;
}

const keyFor = (q: QuestionItem, i: number) => q.header?.trim() || `q${i + 1}`;

const QuestionCard: React.FC<QuestionCardProps> = ({ prompt, submitting, onSubmit }) => {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState('');

  const autoSubmit = prompt.questions.length === 1 && !prompt.questions[0].multiSelect;

  const toggle = (q: QuestionItem, i: number, label: string) => {
    const k = keyFor(q, i);
    if (!q.multiSelect) {
      if (autoSubmit) {
        onSubmit({ [k]: [label] }, other.trim() || undefined);
        return;
      }
      setSelected((prev) => ({ ...prev, [k]: [label] }));
      return;
    }
    setSelected((prev) => {
      const cur = prev[k] || [];
      const next = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
      return { ...prev, [k]: next };
    });
  };

  const ready = useMemo(
    () =>
      prompt.questions.every((q, i) => (selected[keyFor(q, i)] || []).length > 0) ||
      other.trim().length > 0,
    [prompt.questions, selected, other],
  );

  const submit = () => {
    if (submitting) return;
    onSubmit(selected, other.trim() || undefined);
  };

  return (
    <View style={s.card}>
      {prompt.questions.map((q, qi) => {
        const k = keyFor(q, qi);
        const picks = selected[k] || [];
        return (
          <View key={k} style={qi > 0 ? s.qSpacer : undefined}>
            {!!q.header && (
              <Text style={s.chip}>
                {q.header}
                {q.multiSelect ? ' · pick any' : ''}
              </Text>
            )}
            <Text style={s.question}>{q.question}</Text>
            {q.options.map((opt, oi) => {
              const on = picks.includes(opt.label);
              return (
                <TouchableOpacity
                  key={`${opt.label}-${oi}`}
                  style={[s.option, (on || opt.recommended) && s.optionAccent, on && s.optionOn]}
                  activeOpacity={0.75}
                  disabled={submitting}
                  onPress={() => toggle(q, qi, opt.label)}
                >
                  <View style={[s.mark, q.multiSelect ? s.markBox : s.markRadio, on && s.markOn]}>
                    {on && <Check size={13} color="#FFFFFF" />}
                  </View>
                  <View style={s.optBody}>
                    <View style={s.optLabelRow}>
                      <Text style={[s.optLabel, (on || opt.recommended) && s.optLabelAccent]}>{opt.label}</Text>
                      {opt.recommended && <Text style={s.recPill}>Recommended</Text>}
                    </View>
                    {!!opt.description && (
                      <Text style={[s.optDesc, (on || opt.recommended) && s.optDescAccent]}>{opt.description}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })}

      <TextInput
        style={s.other}
        value={other}
        onChangeText={setOther}
        placeholder="Or type your own answer…"
        placeholderTextColor="#9CA3AF"
        editable={!submitting}
      />

      {!autoSubmit && (
        <TouchableOpacity
          style={[s.send, (!ready || submitting) && { opacity: 0.5 }]}
          disabled={!ready || submitting}
          onPress={submit}
          activeOpacity={0.85}
        >
          <Text style={s.sendText}>{submitting ? 'Sending…' : 'Send'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 0.5, borderColor: '#ECEBE6', borderRadius: 18, padding: 14 },
  qSpacer: { marginTop: 16 },
  chip: {
    alignSelf: 'flex-start', fontSize: 12, color: '#71717A', backgroundColor: '#F1F1EE',
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, overflow: 'hidden', marginBottom: 10,
    fontFamily: 'Inter_500Medium',
  },
  question: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold', lineHeight: 21, marginBottom: 12 },
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
  optLabel: { fontSize: 14, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  optLabelAccent: { color: '#3B6D11' },
  recPill: {
    fontSize: 11, color: '#3B6D11', borderWidth: 0.5, borderColor: '#93C822',
    paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, overflow: 'hidden', fontFamily: 'Inter_500Medium',
  },
  optDesc: { marginTop: 3, fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular', lineHeight: 18 },
  optDescAccent: { color: '#3B6D11' },
  other: {
    borderWidth: 0.5, borderColor: '#ECEBE6', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: '#18181B', fontFamily: 'Inter_400Regular', backgroundColor: '#FAFAF8', marginTop: 2,
  },
  send: {
    marginTop: 10, backgroundColor: '#93C822', borderRadius: 12, paddingVertical: 12, alignItems: 'center',
  },
  sendText: { fontSize: 14, color: '#FFFFFF', fontFamily: 'Inter_700Bold' },
});

export default QuestionCard;
