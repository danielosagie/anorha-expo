import React, { useState } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    Dimensions,
    Linking,
    Alert,
    Image,
    SafeAreaView,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { X } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL as ENV_API_BASE_URL } from '../config/env';

const API_BASE_URL = `${ENV_API_BASE_URL}/api`;
const SCREEN_HEIGHT = Dimensions.get('window').height;

interface Tier {
    id: 'growth' | 'teams';
    name: string;
    description: string;
    price: number;
    billingPeriod: string;
    users: number;
    additionalUserPrice: number;
    features: string[];
    highlighted?: boolean;
}

const TIERS: Tier[] = [
    {
        id: 'growth',
        name: 'Growth',
        description: 'Best for small teams',
        price: 20,
        billingPeriod: 'month',
        users: 2,
        additionalUserPrice: 10,
        highlighted: true,
        features: [
            'Unlimited syncs',
            'Unlimited integrations',
            '40 AI scans included',
            'Email support',
        ],
    },
    {
        id: 'teams',
        name: 'Teams',
        description: 'Best for growing teams',
        price: 60,
        billingPeriod: 'month',
        users: 5,
        additionalUserPrice: 8,
        features: [
            'Everything in Growth',
            '120 AI scans included',
            'Priority support',
        ],
    },
];

interface TierSelectorModalProps {
    visible: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    usageInfo?: {
        usageCount: number;
        freeLimit: number;
        remaining: number;
    };
    hasSubscription?: boolean;
}

const ANORHA_GREEN = BRAND_PRIMARY;
const ANORHA_GREEN_TINT = 'rgba(147,200,34,0.12)';
const WHITE_BG = '#FFFFFF';

// Mapping features for the tabular view
const TABULAR_FEATURES = [
    { label: 'Platform integrations', free: '1 Platform', growth: 'Unlimited', teams: 'Unlimited' },
    { label: 'Real-time syncings', free: 'Limited', growth: 'Unlimited', teams: 'Unlimited' },
    { label: 'Included AI scans', free: '10 / mo', growth: '40 / mo', teams: '120 / mo' },
    { label: 'Team members', free: '1 User', growth: '2 Users', teams: '5 Users' },
    { label: 'Priority Support', free: '-', growth: '-', teams: '✓' },
];

const TierSelectorModal: React.FC<TierSelectorModalProps> = ({
    visible,
    onClose,
    onSuccess,
    usageInfo,
    hasSubscription = false,
}) => {
    const theme = useTheme();
    // Default selected tier is growth
    const [selectedTierId, setSelectedTierId] = useState<'growth' | 'teams'>(TIERS[0].id);
    const [isLoading, setIsLoading] = useState(false);

    const handleCheckout = async () => {
        if (!selectedTierId) return;

        const tier = TIERS.find(t => t.id === selectedTierId);
        if (!tier) return;

        setIsLoading(true);
        try {
            const token = await ensureSupabaseJwt();
            if (!token) {
                console.error('[TierSelector] No auth token');
                Alert.alert('Error', 'Please sign in to continue');
                return;
            }

            const successUrl = 'https://app.anorha.app/billing?success=true';
            const cancelUrl = 'https://app.anorha.app/billing?canceled=true';

            const response = await fetch(`${API_BASE_URL}/billing/checkout`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    tier: tier.name,
                    paymentProvider: 'polar',
                    successUrl,
                    cancelUrl,
                }),
            });

            if (!response.ok) {
                throw new Error(`Checkout failed: ${response.status}`);
            }

            const { url } = await response.json();
            if (url) {
                onClose();
                await WebBrowser.openBrowserAsync(url);
                onSuccess?.();
            }
        } catch (error: any) {
            console.error('[TierSelector] Checkout error:', error);
            Alert.alert('Checkout Error', 'Failed to start checkout. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleManageAccount = async () => {
        setIsLoading(true);
        try {
            const token = await ensureSupabaseJwt();
            if (!token) {
                console.error('[TierSelector] No auth token');
                Alert.alert('Error', 'Please sign in to continue');
                return;
            }

            const response = await fetch(`${API_BASE_URL}/billing/portal`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Manage account failed: ${response.status}`);
            }

            const { url } = await response.json();
            if (url) {
                onClose();
                const supported = await Linking.canOpenURL(url);
                if (supported) {
                    await Linking.openURL(url);
                } else {
                    Alert.alert('Error', 'Cannot open billing portal');
                }
            }
        } catch (error: any) {
            console.error('[TierSelector] Manage account error:', error);
            Alert.alert('Error', 'Failed to open billing portal. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const selectedTier = TIERS.find(t => t.id === selectedTierId) || TIERS[0];

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={[styles.container, { paddingBottom: 34 + 20 }]}>
                    <View style={styles.dragHandle} />

                    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                        <View style={styles.closeButtonInner}>
                            <X size={18} color="#71717A" />
                        </View>
                    </TouchableOpacity>

                    {/* Header */}
                    <View style={styles.header}>
                        <Image source={require('../assets/anorha_logo.png')} style={{ width: 140, height: 40, resizeMode: 'contain', marginBottom: 16 }} />
                        <Text style={styles.title}>Upgrade Plan</Text>
                        <Text style={styles.subtitle}>Unlock full potential with premium</Text>

                        {/* Usage indicator */}
                        {usageInfo && usageInfo.remaining === 0 && (
                            <View style={styles.usageBadge}>
                                <Text style={styles.usageBadgeText}>
                                    Free tier exhausted ({usageInfo.usageCount}/{usageInfo.freeLimit} scans used)
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Plan Tabs */}
                    <View style={styles.tabContainer}>
                        {TIERS.map(tier => (
                            <TouchableOpacity
                                key={tier.id}
                                style={[styles.tabButton, selectedTierId === tier.id && styles.tabButtonActive]}
                                onPress={() => setSelectedTierId(tier.id)}
                            >
                                <Text style={[styles.tabButtonText, selectedTierId === tier.id && styles.tabButtonTextActive]}>
                                    {tier.name}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* Feature Matrix */}
                    <View style={styles.matrixContainer}>
                        <View style={styles.matrixHeaderRow}>
                            <Text style={styles.matrixHeaderLabel}>Features</Text>
                            <Text style={styles.matrixHeaderValueCol}>Free</Text>
                            <Text style={[styles.matrixHeaderValueCol, { color: ANORHA_GREEN }]}>{selectedTier.name}</Text>
                        </View>

                        {TABULAR_FEATURES.map((feat, idx) => (
                            <View key={idx} style={styles.matrixRow}>
                                <Text style={styles.matrixRowLabel}>{feat.label}</Text>
                                <Text style={styles.matrixRowFree}>{feat.free}</Text>
                                <Text style={[styles.matrixRowActive, { color: ANORHA_GREEN }]}>
                                    {selectedTierId === 'growth' ? feat.growth : feat.teams}
                                </Text>
                            </View>
                        ))}
                    </View>

                    {/* Action buttons */}
                    <View style={styles.actionsContainer}>
                        <TouchableOpacity
                            style={[
                                styles.checkoutButton,
                                !selectedTierId && styles.checkoutButtonDisabled,
                            ]}
                            onPress={handleCheckout}
                            disabled={!selectedTierId || isLoading}
                        >
                            {isLoading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.checkoutButtonText}>Upgrade for ${selectedTier.price}/{selectedTier.billingPeriod}</Text>
                            )}
                        </TouchableOpacity>

                        {hasSubscription ? (
                            <TouchableOpacity
                                style={styles.manageButton}
                                onPress={handleManageAccount}
                                disabled={isLoading}
                            >
                                <Text style={styles.manageButtonText}>Manage subscription</Text>
                            </TouchableOpacity>
                        ) : (
                            <View style={{ alignItems: 'center', marginTop: 12 }}>
                                <Text style={styles.footerNote}>Auto-renews monthly. Cancel anytime.</Text>
                            </View>
                        )}
                    </View>
                </View>
            </View>

        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'flex-end',
    },
    container: {
        backgroundColor: WHITE_BG,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 20,
        paddingTop: 12,
        maxHeight: SCREEN_HEIGHT * 0.95,
    },
    dragHandle: {
        width: 60,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#D4D4D8',
        alignSelf: 'center',
        marginBottom: 16,
    },
    header: {
        alignItems: 'center',
        marginBottom: 20,
    },
    iconContainer: {
        marginBottom: 8,
    },
    closeButton: {
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 10,
    },
    closeButtonInner: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#F1F1EE',
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: 20,
        fontFamily: 'Inter_700Bold',
        color: '#18181B',
        marginTop: 4,
    },
    subtitle: {
        fontSize: 14,
        fontFamily: 'Inter_400Regular',
        color: '#71717A',
        lineHeight: 21,
        marginTop: 6,
    },
    usageBadge: {
        marginTop: 12,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: '#F1F1EE',
    },
    usageBadgeText: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
        color: '#71717A',
    },
    tabContainer: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 20,
    },
    tabButton: {
        flex: 1,
        paddingVertical: 11,
        alignItems: 'center',
        backgroundColor: WHITE_BG,
        borderWidth: 1,
        borderColor: '#ECEBE6',
        borderRadius: 14,
    },
    tabButtonActive: {
        backgroundColor: ANORHA_GREEN_TINT,
        borderColor: ANORHA_GREEN,
    },
    tabButtonText: {
        fontSize: 15,
        fontFamily: 'Inter_600SemiBold',
        color: '#71717A',
    },
    tabButtonTextActive: {
        color: '#18181B',
    },
    matrixContainer: {
        borderWidth: 1,
        borderColor: '#ECEBE6',
        borderRadius: 16,
        padding: 16,
        marginBottom: 24,
        backgroundColor: WHITE_BG,
    },
    matrixHeaderRow: {
        flexDirection: 'row',
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#ECEBE6',
        marginBottom: 12,
    },
    matrixHeaderLabel: {
        flex: 2,
        fontSize: 14,
        fontFamily: 'Inter_600SemiBold',
        color: '#71717A',
    },
    matrixHeaderValueCol: {
        flex: 1,
        fontSize: 14,
        fontFamily: 'Inter_600SemiBold',
        color: '#71717A',
        textAlign: 'center',
    },
    matrixRow: {
        flexDirection: 'row',
        paddingVertical: 10,
        alignItems: 'center',
    },
    matrixRowLabel: {
        flex: 2,
        fontSize: 14,
        fontFamily: 'Inter_400Regular',
        color: '#18181B',
    },
    matrixRowFree: {
        flex: 1,
        fontSize: 14,
        fontFamily: 'Inter_400Regular',
        color: '#71717A',
        textAlign: 'center',
    },
    matrixRowActive: {
        flex: 1,
        fontSize: 14,
        fontFamily: 'Inter_600SemiBold',
        textAlign: 'center',
    },
    actionsContainer: {
        gap: 12,
        marginTop: 8,
    },
    checkoutButton: {
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: ANORHA_GREEN,
    },
    checkoutButtonDisabled: {
        opacity: 0.5,
    },
    checkoutButtonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontFamily: 'Inter_700Bold',
    },
    manageButton: {
        alignItems: 'center',
        paddingVertical: 14,
    },
    manageButtonText: {
        color: '#71717A',
        fontSize: 15,
        fontFamily: 'Inter_600SemiBold',
        textDecorationLine: 'underline',
    },
    footerNote: {
        fontSize: 13,
        fontFamily: 'Inter_400Regular',
        color: '#71717A',
    },
});

export default TierSelectorModal;
