import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, StyleSheet, Platform, Dimensions, Modal, Pressable } from 'react-native';
import Animated from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PricingResearchModal } from '../../components/PricingResearchModal';
import { cleanMatchText } from './utils';
import { MatchResponse, MatchCandidate } from './types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export const MatchResultsSheet: React.FC<{
  matchData: MatchResponse;
  onClose: () => void;
  sheetStyle: any;
  onUseForSelection?: () => void;
  onStartBroadSearch?: () => void;
  onConfirmMatch?: (serpApiData: any[], preSelectedIndices: number[]) => void;
  currentMatchItemId?: string | null;
  initialSelectedIndices?: number[];
  fetchPricingResearch?: (title: string) => Promise<{ low?: number; median?: number; high?: number; recommended?: number; error?: string } | null>;
  navigation?: any;
}> = ({ matchData, onClose, sheetStyle, onUseForSelection, onStartBroadSearch, onConfirmMatch, currentMatchItemId, initialSelectedIndices, fetchPricingResearch, navigation }) => {
  const insets = useSafeAreaInsets();
  const bottomMargin = Math.max(insets.bottom, 20);
  // Use index-based selection to avoid duplicate id issues
  const effectiveInitialSelection = (Array.isArray(initialSelectedIndices) && initialSelectedIndices.length > 0)
    ? initialSelectedIndices
    : (matchData.totalMatches === 1 ? [0] : []);
  const initialSelectionKey = `${currentMatchItemId ?? 'none'}:${effectiveInitialSelection.join(',')}`;
  const [selectedMatchIndices, setSelectedMatchIndices] = React.useState<Set<number>>(() => new Set(effectiveInitialSelection));
  const [pricingResearch, setPricingResearch] = React.useState<{ low?: number; median?: number; high?: number; recommended?: number } | null>(null);
  const [pricingResearchLoading, setPricingResearchLoading] = React.useState(false);
  const [pricingResearchModalVisible, setPricingResearchModalVisible] = React.useState(false);
  const [pricingSourcesSheetVisible, setPricingSourcesSheetVisible] = React.useState(false);
  const [pricingHistoryRange, setPricingHistoryRange] = React.useState<'1W' | '1M' | '3M'>('1M');

  const [shippingModalVisible, setShippingModalVisible] = React.useState(false);
  const [shippingModalData, setShippingModalData] = React.useState<{ min: number; max: number } | null>(null);

  const firstCandidate = matchData.rankedCandidates[0];
  const firstTitle = firstCandidate?.title;
  // Check if candidate already has pre-fetched pricing research from quick scan enrichment
  const preFetchedPricing = (firstCandidate as any)?.pricingResearch;

  React.useEffect(() => {
    setSelectedMatchIndices((prev) => {
      if (prev.size === effectiveInitialSelection.length) {
        const hasChanged = effectiveInitialSelection.some((index) => !prev.has(index));
        if (!hasChanged) {
          return prev;
        }
      }
      return new Set(effectiveInitialSelection);
    });
  }, [initialSelectionKey]);

  React.useEffect(() => {
    // If pre-fetched pricing research data exists from quick scan, use it directly
    if (preFetchedPricing && typeof preFetchedPricing.low === 'number') {
      setPricingResearch(preFetchedPricing);
      setPricingResearchLoading(false);
      return;
    }
    if (!firstTitle || !fetchPricingResearch) return;
    setPricingResearchLoading(true);
    setPricingResearch(null);
    fetchPricingResearch(firstTitle)
      .then((res) => {
        if (res && typeof (res as any).low === 'number') setPricingResearch(res as any);
      })
      .catch(() => { })
      .finally(() => setPricingResearchLoading(false));
  }, [firstTitle, fetchPricingResearch, preFetchedPricing]);

  const toggleMatchSelection = (index: number) => {
    setSelectedMatchIndices(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const handleGenerateWithSelected = () => {
    if (selectedMatchIndices.size > 0) {
      // Convert matchData.rankedCandidates to serpApiData format for MatchSelectionScreen
      const serpApiData = matchData.rankedCandidates.map((c, idx) => ({
        position: idx + 1,
        title: c.title || 'Unknown Product',
        link: c.sourceUrl || '',
        source: 'quickscan',
        source_icon: '',
        thumbnail: c.imageUrl || '',
        image: c.imageUrl || '',
        price: typeof c.price === 'number' ? { value: `$${c.price}`, extracted_value: c.price, currency: 'USD' } : undefined,
      }));
      const preSelected = Array.from(selectedMatchIndices);
      if (currentMatchItemId && onConfirmMatch) {
        onConfirmMatch(serpApiData, preSelected);
      }
      onClose();
    } else if (selectedMatchIndices.size > 0) {
      onUseForSelection?.();
    }
  };

  return (
    <Animated.View style={[styles.matchSheet, sheetStyle, { paddingBottom: 230 }]}>
      <ScrollView
        style={[
          styles.itemsScrollContainer,
        ]}
        showsVerticalScrollIndicator={true}
        contentContainerStyle={[
          styles.scrollContent,
          {
            flexGrow: 1,
            paddingBottom: 0
          }
        ]}
      >
        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderSpacer} />
          <Text style={[styles.sheetTitle, { flex: 1 }]}>
            {matchData.totalMatches} Match{matchData.totalMatches > 1 ? 'es' : ''} Found
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.exitButton} activeOpacity={0.8} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="close" size={18} color="#64748B" />
            <Text style={styles.exitButtonText}>Exit</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.selectionHint}>
          {selectedMatchIndices.size > 0
            ? 'Selected match is ready. Tap another result if you need to change it.'
            : 'Tap the right match before continuing.'}
        </Text>

        <View style={styles.matchResults}>
          {matchData.rankedCandidates.map((candidate, index) => {
            const isSelected = selectedMatchIndices.has(index);
            const hasPrice = typeof candidate.price === 'number' && candidate.price > 0;
            // Use pricing research for price display: prefer candidate's pre-fetched data, then component-level data
            const candidatePricing = (candidate as any)?.pricingResearch;
            const effectivePricing = (index === 0) ? (pricingResearch || candidatePricing) : candidatePricing;
            const usePricingResearch = !hasPrice && effectivePricing && typeof effectivePricing.low === 'number';
            const priceText = hasPrice
              ? `$${candidate.price}`
              : usePricingResearch
                ? `$${effectivePricing.low} – $${effectivePricing.high ?? effectivePricing.median ?? effectivePricing.low}${effectivePricing.median != null ? ` (avg $${effectivePricing.median})` : ''}`
                : pricingResearchLoading && index === 0
                  ? '…'
                  : '—';

            return (
              <TouchableOpacity
                key={`match-${index}`}
                style={[
                  styles.matchCard,
                  isSelected && styles.matchCardSelected
                ]}
                onPress={() => toggleMatchSelection(index)}
                activeOpacity={0.7}
              >
                <Image source={{ uri: candidate.imageUrl }} style={styles.matchImage} />
                <View style={styles.matchInfo}>
                  <Text style={styles.matchTitle} numberOfLines={2}>{cleanMatchText(candidate.title) || 'Unknown Product'}</Text>

                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, marginBottom: 4 }}>
                    <TouchableOpacity
                      disabled={(index !== 0) || (!pricingResearch && !candidatePricing) || pricingResearchLoading}
                      onPress={(index === 0 && (pricingResearch || candidatePricing) && !pricingResearchLoading) ? () => setPricingResearchModalVisible(true) : undefined}
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: '#E5E7EB' }}
                    >
                      <Icon name="tag-outline" size={12} color="#4B5563" style={{ marginRight: 4 }} />
                      <Text style={{ fontSize: 12, fontWeight: '600', color: '#374151' }}>
                        {priceText}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {candidate.sourceUrl && (() => {
                    try {
                      return (
                        <Text style={styles.matchSource} numberOfLines={1}>
                          {new URL(candidate.sourceUrl).hostname.replace('www.', '')}
                        </Text>
                      );
                    } catch {
                      return null;
                    }
                  })()}
                </View>

                {/* Selection indicator overlay */}
                {isSelected && (
                  <View style={styles.matchSelectionOverlay}>
                    <View style={styles.matchCheckmark}>
                      <Icon name="check" size={20} color="#FFFFFF" />
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.sheetActions}>
          <View style={[styles.matchActionsRow, { justifyContent: 'center' }]}>
            <TouchableOpacity
              style={[
                styles.listProductButton,
                { flex: 1, minHeight: 52 },
                selectedMatchIndices.size === 0 && styles.listProductButtonDisabled
              ]}
              onPress={handleGenerateWithSelected}
              disabled={selectedMatchIndices.size === 0}
            >
              <Icon name="package-variant" size={20} color={selectedMatchIndices.size > 0 ? "#FFF" : "#999"} />
              <Text style={[
                styles.listProductButtonText,
                selectedMatchIndices.size === 0 && { color: '#999' }
              ]}>Use Selected</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Pricing Research Modal */}
      <PricingResearchModal
        visible={pricingResearchModalVisible}
        onClose={() => setPricingResearchModalVisible(false)}
        pricingResearchResult={pricingResearch}
        pricingSourcesSheetVisible={pricingSourcesSheetVisible}
        setPricingSourcesSheetVisible={setPricingSourcesSheetVisible}
        pricingHistoryRange={pricingHistoryRange}
        setPricingHistoryRange={setPricingHistoryRange}
        selectedPricingPointIdx={null}
      />

      {/* Shipping Estimate Modal */}
      <Modal visible={shippingModalVisible} transparent animationType="fade">
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setShippingModalVisible(false)}>
          <Pressable style={{ backgroundColor: '#fff', borderRadius: 16, width: '85%', maxWidth: 320, padding: 24 }} onPress={e => e.stopPropagation()}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0FDF4', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="truck-outline" size={24} color="#16a34a" />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2937' }}>Shipping Estimate</Text>
            </View>
            <Text style={{ fontSize: 15, color: '#4B5563', lineHeight: 22, marginBottom: 8 }}>
              Based on similar items, the estimated shipping cost is:
            </Text>
            <Text style={{ fontSize: 24, fontWeight: '700', color: '#166534', marginBottom: 20 }}>
              ${shippingModalData?.min?.toFixed(2)} – ${shippingModalData?.max?.toFixed(2)}
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: '#1F2937', paddingVertical: 12, borderRadius: 8, alignItems: 'center' }}
              onPress={() => setShippingModalVisible(false)}
            >
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

    </Animated.View>
  );
};

// Bulk Items Sheet Component

const styles = StyleSheet.create({
  matchSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 4,
    paddingBottom: 0,
    marginBottom: 0,
    maxHeight: SCREEN_HEIGHT * 0.9,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  matchActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  listProductButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 25,
    backgroundColor: '#93C822',
    gap: 8,
  },
  listProductButtonDisabled: {
    backgroundColor: '#e0e0e0',
  },
  listProductButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  matchResults: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  matchCard: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
    minHeight: 120,
  },
  matchCardSelected: {
    borderColor: '#93C822',
    backgroundColor: 'rgba(147, 200, 34, 0.08)',
  },
  matchImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  matchInfo: {
    flex: 1,
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  matchSource: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
  },
  matchSelectionOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
  },
  matchCheckmark: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#93C822',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3 },
      android: { elevation: 4 },
    }),
  },
  selectionHint: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  sheetActions: {
    paddingHorizontal: 20,
  },
  itemsScrollContainer: {
    flex: 1,
    marginBottom: 0,
  },
  scrollContent: {
    paddingBottom: 24,
    paddingHorizontal: 10,
  },
  exitButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    minHeight: 34,
    maxHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F2F2F7',
    flexDirection: 'row',
    alignItems: 'center',
  },
  exitButtonText: {
    color: '#64748B',
    fontWeight: '600',
    marginLeft: 6,
    fontSize: 15,
  },
  sheetHeaderSpacer: {
    minWidth: 72,
    minHeight: 34,
  },
});
