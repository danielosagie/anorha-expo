import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { DecisionPrompt } from '../types';

type Props = {
  prompt: DecisionPrompt;
  onDecision: (prompt: DecisionPrompt, action: 'approve' | 'revise' | 'follow_up') => void;
  submitting?: boolean;
};

const inventoryActionLabel = (action: NonNullable<DecisionPrompt['inventoryAction']>['action']) => {
  if (action === 'archive') return 'Archive';
  if (action === 'delete') return 'Delete';
  return 'Add tag';
};

// A plan Sprout proposed via propose_plan: title + summary + ordered steps, with
// Accept (runs it) / Revise (drops it, Sprout re-plans) / Follow-up. Sits above the
// composer like the question card.
const PlanCard = ({ prompt, onDecision, submitting }: Props) => (
  <View style={s.card}>
    <View style={s.header}>
      <Icon name="clipboard-check-outline" size={16} color="#5D7E16" />
      <Text style={s.kicker}>Plan{prompt.planType ? ` · ${prompt.planType.replace(/_/g, ' ')}` : ''}</Text>
    </View>
    <Text style={s.title}>{prompt.title}</Text>
    {prompt.inventoryAction ? (
      <View style={s.inventoryMeta}>
        <Text style={s.inventoryAction}>{inventoryActionLabel(prompt.inventoryAction.action)}</Text>
        <Text style={s.inventoryCount}>
          {prompt.inventoryAction.count} item{prompt.inventoryAction.count === 1 ? '' : 's'}
        </Text>
      </View>
    ) : null}
    {prompt.summary ? <Text style={s.summary}>{prompt.summary}</Text> : null}
    {prompt.steps?.length ? (
      <View style={s.steps}>
        {prompt.steps.map((step, i) => (
          <View key={i} style={s.stepRow}>
            <Text style={s.stepNum}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.stepTitle}>{step.title}</Text>
              {step.detail ? <Text style={s.stepDetail}>{step.detail}</Text> : null}
            </View>
          </View>
        ))}
      </View>
    ) : null}
    <View style={s.actions}>
      <TouchableOpacity
        style={[s.btn, s.primary, submitting && s.btnDisabled]}
        activeOpacity={0.85}
        disabled={submitting}
        onPress={() => onDecision(prompt, 'approve')}
      >
        <Text style={s.primaryText}>{prompt.approveLabel || 'Approve'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.btn, s.secondary, submitting && s.btnDisabled]}
        activeOpacity={0.85}
        disabled={submitting}
        onPress={() => onDecision(prompt, 'revise')}
      >
        <Text style={s.secondaryText}>{prompt.reviseLabel || 'Revise'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.btn, s.secondary, submitting && s.btnDisabled]}
        activeOpacity={0.85}
        disabled={submitting}
        onPress={() => onDecision(prompt, 'follow_up')}
      >
        <Text style={s.secondaryText}>{prompt.followUpLabel || 'Follow-up'}</Text>
      </TouchableOpacity>
    </View>
  </View>
);

export default PlanCard;

const s = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E4EFC9',
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  kicker: {
    fontSize: 12, color: '#5D7E16', fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  title: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 4 },
  inventoryMeta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#EFF7E0',
  },
  inventoryAction: { fontSize: 12, color: '#4E7012', fontFamily: 'Inter_700Bold' },
  inventoryCount: { fontSize: 12, color: '#5D6B48', fontFamily: 'Inter_600SemiBold' },
  summary: { fontSize: 14, color: '#52525B', fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 10 },
  steps: { gap: 8, marginBottom: 12 },
  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNum: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#EFF7E0', color: '#5C8A0E',
    fontSize: 12, fontFamily: 'Inter_700Bold', textAlign: 'center', lineHeight: 20, overflow: 'hidden',
  },
  stepTitle: { fontSize: 14, color: '#27272A', fontFamily: 'Inter_600SemiBold' },
  stepDetail: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular', lineHeight: 18, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.5 },
  primary: { backgroundColor: '#93C822' },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_700Bold' },
  secondary: { backgroundColor: '#F4F4F1' },
  secondaryText: { color: '#3F3F46', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
