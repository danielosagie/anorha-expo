import React from 'react';
import { BRAND_PRIMARY } from '../../../design/tokens';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { CampaignOverview, CampaignSummary } from '../types';

type Props = {
  campaign: CampaignSummary | null;
  overview: CampaignOverview | null;
  onReviewMessage: (threadId: string) => void;
  onAccept: () => void;
  onCounter: () => void;
  onLetAgent: () => void;
  onFindSlowMovers: () => void;
  onRunFlashCampaign: () => void;
};

export const OverviewActionHeader = ({
  campaign,
  overview,
  onReviewMessage,
  onAccept,
  onCounter,
  onLetAgent,
  onFindSlowMovers,
  onRunFlashCampaign,
}: Props) => {
  const firstNeed = overview?.needsInput?.[0];
  const showNeedsInput = !!firstNeed;
  const showNegotiationActions = (overview?.summary24h.negotiating || 0) > 0;

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Current</Text>
        <Text style={styles.title}>{campaign?.title || 'No campaign selected'}</Text>
        <Text style={styles.subtle}>{campaign?.stateSummary || 'Your Agent is working...'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Last 24 hours</Text>
        <Text style={styles.bullet}>• Listed {overview?.summary24h.listed || 0} new items</Text>
        <Text style={styles.bullet}>• Lowered {overview?.summary24h.repriced || 0} prices</Text>
        <Text style={styles.bullet}>• Negotiating {overview?.summary24h.negotiating || 0} offers</Text>
        <Text style={styles.bullet}>• Sold {overview?.summary24h.sold || 0} items (${Math.round(overview?.summary24h.revenue || 0)})</Text>
      </View>

      {showNeedsInput ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Needs your input</Text>
          <Text style={styles.body}>{firstNeed.title}</Text>
          <Text style={styles.subtle}>{firstNeed.description}</Text>
          {firstNeed.threadId ? (
            <TouchableOpacity style={styles.primaryInlineButton} onPress={() => onReviewMessage(firstNeed.threadId!)}>
              <Text style={styles.primaryInlineButtonText}>Review message</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {showNegotiationActions ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>High-value negotiation</Text>
          <Text style={styles.subtle}>Offer decisions can run in guardrailed auto mode.</Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.inlineButton} onPress={onAccept}>
              <Text style={styles.inlineButtonText}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.inlineButton} onPress={onCounter}>
              <Text style={styles.inlineButtonText}>Counter</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.inlineButton} onPress={onLetAgent}>
              <Text style={styles.inlineButtonText}>Let Agent</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Run now</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.inlineButton} onPress={onFindSlowMovers}>
            <Text style={styles.inlineButtonText}>Find slow movers</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.inlineButton} onPress={onRunFlashCampaign}>
            <Text style={styles.inlineButtonText}>Run flash campaign</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  stack: {
    gap: 10,
    paddingBottom: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  eyebrow: {
    color: '#6B8A11',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    marginTop: 6,
    color: '#111827',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 16,
  },
  sectionTitle: {
    color: '#111827',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 15,
    marginBottom: 8,
  },
  bullet: {
    color: '#374151',
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 13,
    lineHeight: 21,
  },
  body: {
    color: '#111827',
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 13,
    lineHeight: 20,
  },
  subtle: {
    marginTop: 2,
    color: '#6B7280',
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
  },
  buttonRow: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  inlineButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineButtonText: {
    color: '#111827',
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 13,
  },
  primaryInlineButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BRAND_PRIMARY,
    backgroundColor: 'rgba(147,200,34,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  primaryInlineButtonText: {
    color: '#5D7E16',
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 13,
  },
});
