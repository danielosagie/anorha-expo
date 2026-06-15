// PricingResearchModal — bottom-sheet wrapper around the shared PricingGuidanceCard.
//
// This used to carry its own ~350-line pricing UI (sources toggle, three price
// buttons, bar/line charts). The app now has ONE pricing overview — the same
// card the add-product preview shows — so this modal just hosts it. The legacy
// sources/history props are kept (and ignored) so existing call sites compile.

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Pressable } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { PricingGuidanceCard } from './pricing/PricingGuidanceCard';

export interface PricingResearchModalProps {
    visible: boolean;
    onClose: () => void;
    pricingResearchResult: any;
    /** Legacy props from the old inline UI — accepted but unused. */
    pricingSourcesSheetVisible?: boolean;
    setPricingSourcesSheetVisible?: React.Dispatch<React.SetStateAction<boolean>>;
    pricingHistoryRange?: '1W' | '1M' | '3M';
    setPricingHistoryRange?: React.Dispatch<React.SetStateAction<'1W' | '1M' | '3M'>>;
    selectedPricingPointIdx?: number | null;
    onApplyPrice?: (price: string, metrics: { low: number; recommended: number; high: number }) => void;
}

export const PricingResearchModal: React.FC<PricingResearchModalProps> = ({
    visible,
    onClose,
    pricingResearchResult,
    onApplyPrice,
}) => {
    return (
        <Modal visible={visible} transparent animationType="slide">
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={onClose}>
                <Pressable
                    style={{ maxHeight: '90%', backgroundColor: '#F2F2F7', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
                    onPress={e => e.stopPropagation()}
                >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 }}>
                        <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2937' }}>Pricing research</Text>
                        <TouchableOpacity onPress={onClose}>
                            <Icon name="close" size={24} color="#6B7280" />
                        </TouchableOpacity>
                    </View>
                    {pricingResearchResult?.error ? (
                        <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                            <Text style={{ fontSize: 14, color: '#ef4444' }}>{pricingResearchResult.error}</Text>
                        </View>
                    ) : pricingResearchResult && typeof pricingResearchResult.low === 'number' ? (
                        <ScrollView style={{ maxHeight: 620 }} contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 28 }}>
                            <PricingGuidanceCard
                                headers="none"
                                pricing={pricingResearchResult}
                                onApplyPrice={onApplyPrice
                                    ? (price) => {
                                        const low = pricingResearchResult.low ?? 0;
                                        const recommended = pricingResearchResult.recommended ?? pricingResearchResult.median ?? 0;
                                        const high = pricingResearchResult.high ?? 0;
                                        onApplyPrice(price.toFixed(2), { low, recommended, high });
                                    }
                                    : undefined}
                            />
                        </ScrollView>
                    ) : (
                        <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                            <Text style={{ fontSize: 14, color: '#6B7280' }}>Loading...</Text>
                        </View>
                    )}
                </Pressable>
            </Pressable>
        </Modal>
    );
};
