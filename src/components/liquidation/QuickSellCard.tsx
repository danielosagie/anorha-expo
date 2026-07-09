import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { API_BASE_URL } from '../../config/env';
import { createLogger } from '../../utils/logger';
const log = createLogger('QuickSellCard');


interface QuickSellCardProps {
    onRefreshed?: () => void;
}

export const QuickSellCard: React.FC<QuickSellCardProps> = ({ onRefreshed }) => {
    const navigation = useNavigation<any>();
    const [modalVisible, setModalVisible] = useState(false);
    const [step, setStep] = useState<'setup' | 'analyzing' | 'success'>('setup');

    // Form State
    const [targetRevenue, setTargetRevenue] = useState('2000');
    const [timeframeDays, setTimeframeDays] = useState('7');
    const [minPricePercent, setMinPricePercent] = useState('50'); // 50%

    const [loading, setLoading] = useState(false);

    const handleAnalyze = async () => {
        setLoading(true);
        setStep('analyzing');

        try {
            const token = await ensureSupabaseJwt();
            if (!token) {
                throw new Error('Not authenticated');
            }

            const revenue = parseInt(targetRevenue) || 2000;
            const days = parseInt(timeframeDays) || 7;
            const response = await fetch(`${API_BASE_URL}/api/agent/quick/liquidation`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    targetRevenue: revenue,
                    timeframeDays: days,
                    inventoryScope: 'all',
                    aggressiveness: minPricePercent === '50' ? 'balanced' : 'aggressive'
                })
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result?.sessionId) {
                throw new Error(result?.message || `Failed to start campaign: ${response.status}`);
            }

            setStep('success');
            setTimeout(() => {
                setModalVisible(false);
                setStep('setup');
                onRefreshed?.();
                navigation.navigate('LiquidationCampaignScreen', {
                    campaignId: result.sessionId,
                    entryPoint: 'detail',
                });
            }, 900);
        } catch (e: any) {
            log.error(e);
            setStep('setup');
            Alert.alert('Error', e?.message || 'Failed to start liquidation campaign');
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
});
