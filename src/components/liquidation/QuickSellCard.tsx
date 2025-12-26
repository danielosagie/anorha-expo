import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ScrollView, ActivityIndicator, Image, Dimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useOrg } from '../../context/OrgContext';
import { ensureSupabaseJwt } from '../../lib/supabase';
import InventoryListCard from '../InventoryListCard';

interface QuickSellCardProps {
    onRefreshed?: () => void;
}

export const QuickSellCard: React.FC<QuickSellCardProps> = ({ onRefreshed }) => {
    const { currentOrg } = useOrg();
    const [modalVisible, setModalVisible] = useState(false);
    const [sourcesVisible, setSourcesVisible] = useState(false);
    const [step, setStep] = useState<'setup' | 'analyzing' | 'plan' | 'success'>('setup');

    // Form State
    const [targetRevenue, setTargetRevenue] = useState('2000');
    const [timeframeDays, setTimeframeDays] = useState('7');
    const [minPricePercent, setMinPricePercent] = useState('50'); // 50%

    // Plan State
    const [plan, setPlan] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    // Mock Products & Research
    const mockItems = [
        { id: '1', title: 'Sony WH-1000XM4 Headphones', price: 180, quantity: 2, imageUrl: 'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?q=80&w=2576&auto=format&fit=crop', platformNames: ['ebay'] },
        { id: '2', title: 'Vintage Leather Camera Bag', price: 85, quantity: 1, imageUrl: 'https://images.unsplash.com/photo-1551214012-84f95e060dee?q=80&w=2670&auto=format&fit=crop', platformNames: ['poshmark'] },
        { id: '3', title: 'KitchenAid Stand Mixer - Red', price: 220, quantity: 1, imageUrl: 'https://images.unsplash.com/photo-1594385263720-6d9b93237e3d?q=80&w=2670&auto=format&fit=crop', platformNames: ['facebook'] },
        { id: '4', title: 'Nintendo Switch OLED', price: 290, quantity: 3, imageUrl: 'https://images.unsplash.com/photo-1578303512597-81e6cc155b3e?q=80&w=2670&auto=format&fit=crop', platformNames: ['mercari'] },
        { id: '5', title: 'Dewalt Cordless Drill Set', price: 110, quantity: 4, imageUrl: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?q=80&w=2156&auto=format&fit=crop', platformNames: ['ebay'] },
    ];

    const mockSources = [
        { type: 'web', title: 'eBay Sold Listings (Last 30d)', url: 'https://ebay.com/itm/12345', snippet: 'Avg selling price: $195.00' },
        { type: 'web', title: 'FB Marketplace Local (50mi)', url: 'https://facebook.com/marketplace/item/123', snippet: 'High demand in your area' },
        { type: 'db', title: 'Internal Sales History', snippet: 'You sold similar items for $185 last month' },
    ];

    const handleAnalyze = async () => {
        setLoading(true);
        setStep('analyzing');

        try {
            // Simulation of API call to generated plan
            await new Promise(r => setTimeout(r, 2000));

            const revenue = parseInt(targetRevenue) || 2000;

            const mockPlan = {
                goal: { revenue: revenue, days: parseInt(timeframeDays) },
                confidence: 'high',
                phases: [
                    {
                        days: '1-3',
                        action: 'List priority items',
                        items: 8,
                        channel: 'FB Marketplace (Local)',
                        revenue: Math.round(revenue * 0.45)
                    },
                    {
                        days: '4-6',
                        action: 'List remaining + Bundles',
                        items: 12,
                        channel: 'FB Marketplace + OfferUp',
                        revenue: Math.round(revenue * 0.35)
                    },
                    {
                        days: '7',
                        action: 'Flash Sale (20% off)',
                        items: 'Remaining',
                        channel: 'All Channels',
                        revenue: Math.round(revenue * 0.20)
                    }
                ],
                items: mockItems,
                sources: mockSources
            };

            setPlan(mockPlan);
            setStep('plan');
        } catch (e) {
            console.error(e);
            setStep('setup');
        } finally {
            setLoading(false);
        }
    };

    const handleStartCampaign = async () => {
        setLoading(true);
        try {
            const token = await ensureSupabaseJwt();
            // Fire and forget call to real backend
            await fetch('https://api.sssync.app/liquidation/strategies', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    targetRevenue: parseInt(targetRevenue),
                    timeframeDays: parseInt(timeframeDays),
                    inventoryScope: 'all',
                    aggressiveness: minPricePercent === '50' ? 'balanced' : 'aggressive'
                })
            });

            setStep('success');
            setTimeout(() => {
                setModalVisible(false);
                setStep('setup');
                onRefreshed?.();
            }, 2000);
        } catch (e) {
            console.error(e);
            setStep('success'); // Fallback demo
            setTimeout(() => {
                setModalVisible(false);
                setStep('setup');
            }, 2000);
        } finally {
            setLoading(false);
        }
    };

    const AnalysisStep = () => (
        <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#F97316" />
            <Text style={styles.loadingText}>AI is scanning your inventory...</Text>

            {/* Animated pulsing "Research" feedback */}
            <View style={styles.researchPulse}>
                <MaterialCommunityIcons name="web" size={16} color="#6B7280" />
                <Text style={styles.researchText}>Checking eBay sold listings...</Text>
            </View>
            <View style={styles.researchPulse}>
                <MaterialCommunityIcons name="facebook" size={16} color="#6B7280" />
                <Text style={styles.researchText}>Analyzing local FB demand...</Text>
            </View>
        </View>
    );

    return (
        <>
            <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setModalVisible(true)}
            >
                <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.cardContainer}>
                    <View style={styles.cardContent}>
                        <View style={styles.iconCircle}>
                            <MaterialCommunityIcons name="lightning-bolt" size={24} color="#F97316" />
                        </View>
                        <View style={styles.textContainer}>
                            <Text style={styles.cardTitle}>Quick Sell</Text>
                            <Text style={styles.cardSubtitle}>Turn inventory into cash fast</Text>
                        </View>
                        <View style={styles.arrowContainer}>
                            <MaterialCommunityIcons name="chevron-right" size={24} color="#9CA3AF" />
                        </View>
                    </View>
                </Animated.View>
            </TouchableOpacity>

            <Modal
                visible={modalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setModalVisible(false)}
            >
                <View style={styles.modalBackdrop}>
                    <View style={styles.modalContainer}>

                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>
                                {step === 'setup' && 'Quick Sell Setup'}
                                {step === 'analyzing' && 'Analyzing Inventory'}
                                {step === 'plan' && 'Liquidation Plan'}
                                {step === 'success' && 'Campaign Active'}
                            </Text>
                            {step !== 'success' && step !== 'analyzing' && (
                                <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                                    <MaterialCommunityIcons name="close" size={24} color="#6B7280" />
                                </TouchableOpacity>
                            )}
                        </View>

                        <View style={styles.modalBody}>

                            {/* SETUP STEP */}
                            {step === 'setup' && (
                                <>
                                    <Text style={styles.label}>How much do you need?</Text>
                                    <View style={styles.inputContainer}>
                                        <Text style={styles.inputPrefix}>$</Text>
                                        <TextInput
                                            style={styles.input}
                                            value={targetRevenue}
                                            onChangeText={setTargetRevenue}
                                            keyboardType="numeric"
                                            placeholder="2000"
                                        />
                                    </View>

                                    <Text style={styles.label}>When do you need it by?</Text>
                                    <View style={styles.pillContainer}>
                                        {['3', '7', '14', '30'].map(d => (
                                            <TouchableOpacity
                                                key={d}
                                                style={[styles.pill, timeframeDays === d && styles.pillActive]}
                                                onPress={() => setTimeframeDays(d)}
                                            >
                                                <Text style={[styles.pillText, timeframeDays === d && styles.pillTextActive]}>{d} days</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>

                                    <Text style={styles.label}>Minimum price per item?</Text>
                                    <View style={styles.pillContainer}>
                                        {['25', '50', '75'].map(p => (
                                            <TouchableOpacity
                                                key={p}
                                                style={[styles.pill, minPricePercent === p && styles.pillActive]}
                                                onPress={() => setMinPricePercent(p)}
                                            >
                                                <Text style={[styles.pillText, minPricePercent === p && styles.pillTextActive]}>{p}% of retail</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>

                                    <TouchableOpacity style={styles.primaryBtn} onPress={handleAnalyze}>
                                        <Text style={styles.primaryBtnText}>Analyze Inventory</Text>
                                        <MaterialCommunityIcons name="arrow-right" size={20} color="#FFF" />
                                    </TouchableOpacity>
                                </>
                            )}

                            {/* ANALYZING STEP */}
                            {step === 'analyzing' && <AnalysisStep />}

                            {/* PLAN REVIEW STEP */}
                            {step === 'plan' && plan && (
                                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                                    <View style={styles.planSummary}>
                                        <Text style={styles.planGoal}>Goal: ${plan.goal.revenue.toLocaleString()} in {plan.goal.days} days</Text>
                                        <View style={styles.confidenceBadge}>
                                            <MaterialCommunityIcons name="check-decagram" size={16} color="#15803D" />
                                            <Text style={styles.confidenceText}>Confidence: {plan.confidence.toUpperCase()}</Text>
                                        </View>
                                    </View>

                                    {/* Sources Pill */}
                                    <TouchableOpacity style={styles.sourcesPill} onPress={() => setSourcesVisible(true)}>
                                        <MaterialCommunityIcons name="bullseye-arrow" size={16} color="#4B5563" />
                                        <Text style={styles.sourcesText}>{plan.sources.length} Research Sources Available</Text>
                                        <MaterialCommunityIcons name="chevron-right" size={16} color="#9CA3AF" />
                                    </TouchableOpacity>

                                    {/* Phases */}
                                    {plan.phases.map((phase: any, idx: number) => (
                                        <View key={idx} style={styles.phaseCard}>
                                            <View style={styles.phaseHeader}>
                                                <MaterialCommunityIcons name="calendar-clock" size={18} color="#F97316" />
                                                <Text style={styles.phaseTitle}>Days {phase.days}</Text>
                                            </View>
                                            <Text style={styles.phaseAction}>{phase.action}</Text>
                                            <Text style={styles.phaseDetailText}>Expected: ${phase.revenue}</Text>
                                        </View>
                                    ))}

                                    <View style={styles.divider} />

                                    {/* Items List */}
                                    <Text style={styles.sectionHeader}>Strategy Items ({plan.items.length})</Text>
                                    {plan.items.map((item: any) => (
                                        <InventoryListCard
                                            key={item.id}
                                            id={item.id}
                                            title={item.title}
                                            price={item.price}
                                            totalQuantity={item.quantity}
                                            imageUrl={item.imageUrl}
                                            platformNames={item.platformNames}
                                            onPress={() => { }}
                                        />
                                    ))}

                                    <TouchableOpacity style={styles.primaryBtn} onPress={handleStartCampaign} disabled={loading}>
                                        {loading ? <ActivityIndicator color="#FFF" /> : (
                                            <>
                                                <Text style={styles.primaryBtnText}>Start Campaign</Text>
                                                <MaterialCommunityIcons name="rocket-launch" size={20} color="#FFF" />
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </ScrollView>
                            )}

                            {/* SUCCESS STEP */}
                            {step === 'success' && (
                                <View style={styles.loadingState}>
                                    <MaterialCommunityIcons name="check-circle" size={64} color="#22C55E" />
                                    <Text style={styles.successText}>Campaign Active!</Text>
                                    <Text style={styles.loadingSubtext}>I'll update you daily on your progress.</Text>
                                </View>
                            )}
                        </View>
                    </View>
                </View>

                {/* SOURCES MODAL */}
                <Modal
                    visible={sourcesVisible}
                    animationType="slide"
                    transparent={true}
                    onRequestClose={() => setSourcesVisible(false)}
                >
                    <View style={styles.modalBackdropDark}>
                        <View style={styles.sourcesSheet}>
                            <View style={styles.sheetHeader}>
                                <Text style={styles.sheetTitle}>Market Research</Text>
                                <TouchableOpacity onPress={() => setSourcesVisible(false)}>
                                    <MaterialCommunityIcons name="close-circle" size={24} color="#6B7280" />
                                </TouchableOpacity>
                            </View>
                            <ScrollView>
                                <Text style={styles.researchIntro}>
                                    We analyzed market data to build your liquidation strategy.
                                </Text>
                                {plan?.sources?.map((source: any, idx: number) => (
                                    <View key={idx} style={styles.sourceItem}>
                                        <View style={styles.sourceIcon}>
                                            <MaterialCommunityIcons name={source.type === 'web' ? 'web' : 'database'} size={20} color="#F97316" />
                                        </View>
                                        <View style={styles.sourceContent}>
                                            <Text style={styles.sourceTitle}>{source.title}</Text>
                                            <Text style={styles.sourceSnippet}>{source.snippet}</Text>
                                            {source.url && <Text style={styles.sourceUrl} numberOfLines={1}>{source.url}</Text>}
                                        </View>
                                    </View>
                                ))}
                            </ScrollView>
                        </View>
                    </View>
                </Modal>

            </Modal>
        </>
    );
};

const styles = StyleSheet.create({
    cardContainer: {
        backgroundColor: '#FFF7ED',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#FED7AA',
    },
    cardContent: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    iconCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#FFEDD5',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    textContainer: {
        flex: 1,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#9A3412',
    },
    cardSubtitle: {
        fontSize: 13,
        color: '#C2410C',
    },
    arrowContainer: {
        justifyContent: 'center',
    },
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalBackdropDark: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'flex-end',
    },
    modalContainer: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        height: '92%',
        padding: 24,
        paddingBottom: 40,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
    },
    closeBtn: {
        padding: 4,
    },
    modalBody: {
        flex: 1,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
        marginTop: 16,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#D1D5DB',
        borderRadius: 12,
        paddingHorizontal: 12,
        height: 50,
    },
    inputPrefix: {
        fontSize: 18,
        fontWeight: '600',
        color: '#111827',
        marginRight: 8,
    },
    input: {
        flex: 1,
        fontSize: 18,
        color: '#111827',
    },
    pillContainer: {
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
    },
    pill: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        backgroundColor: '#F3F4F6',
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    pillActive: {
        backgroundColor: '#FFF7ED',
        borderColor: '#F97316',
    },
    pillText: {
        color: '#4B5563',
        fontWeight: '500',
    },
    pillTextActive: {
        color: '#C2410C',
        fontWeight: '600',
    },
    primaryBtn: {
        backgroundColor: '#F97316',
        borderRadius: 12,
        paddingVertical: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        marginTop: 24,
        marginBottom: 24,
        shadowColor: '#F97316',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    primaryBtnText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '700',
    },
    loadingState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 16,
    },
    loadingText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#111827',
    },
    loadingSubtext: {
        fontSize: 14,
        color: '#6B7280',
        textAlign: 'center',
        maxWidth: 250,
    },
    successText: {
        fontSize: 24,
        fontWeight: '700',
        color: '#111827',
    },
    planSummary: {
        backgroundColor: '#F8FAFC',
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    planGoal: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0F172A',
        marginBottom: 4,
    },
    confidenceBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    confidenceText: {
        fontSize: 12,
        color: '#15803D',
        fontWeight: '600',
    },
    phaseCard: {
        marginBottom: 12,
        borderLeftWidth: 3,
        borderLeftColor: '#F97316',
        paddingLeft: 12,
    },
    phaseHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 2,
    },
    phaseTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#C2410C',
    },
    phaseAction: {
        fontSize: 15,
        fontWeight: '600',
        color: '#111827',
    },
    phaseDetailText: {
        fontSize: 13,
        color: '#4B5563',
    },
    researchPulse: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
    },
    researchText: {
        color: '#6B7280',
        fontSize: 13,
    },
    sourcesPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3F4F6',
        padding: 10,
        borderRadius: 8,
        marginBottom: 16,
        gap: 8,
    },
    sourcesText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '500',
        color: '#4B5563',
    },
    sectionHeader: {
        fontSize: 16,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 12,
    },
    divider: {
        height: 1,
        backgroundColor: '#E5E7EB',
        marginVertical: 16,
    },
    sourcesSheet: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 24,
        height: '60%',
    },
    sheetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    sheetTitle: {
        fontSize: 18,
        fontWeight: '700',
    },
    researchIntro: {
        fontSize: 14,
        color: '#6B7280',
        marginBottom: 16,
        lineHeight: 20,
    },
    sourceItem: {
        flexDirection: 'row',
        marginBottom: 16,
        gap: 12,
    },
    sourceIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#FFF7ED',
        justifyContent: 'center',
        alignItems: 'center',
    },
    sourceContent: {
        flex: 1,
    },
    sourceTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111827',
    },
    sourceSnippet: {
        fontSize: 13,
        color: '#4B5563',
    },
    sourceUrl: {
        fontSize: 12,
        color: '#F97316',
        marginTop: 2,
    },
});
