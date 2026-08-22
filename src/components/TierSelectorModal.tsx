import React, { useCallback, useEffect, useState } from 'react';
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
    Alert,
    Image,
    SafeAreaView,
    Platform,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { ApiError, apiJson } from '../lib/apiClient';
import { openBillingUrl, withMobileReturn } from '../lib/billingReturn';
import {
    deriveBillingState,
    deriveBillingStateFromCheckoutConflict,
    formatBillingTimestamp,
    isCheckoutBlocked,
    type BillingStateViewModel,
    type RawCheckoutConflict,
} from '../utils/billingState';
import {
    parseBillingSummaryPayload,
    type BillingSummaryPayload,
} from '../utils/billingPayload';
import { createLogger } from '../utils/logger';
const log = createLogger('TierSelectorModal');


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
            'Monthly AI usage included',
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
            '3x monthly AI usage',
            'Priority support',
        ],
    },
];

interface TierSelectorModalProps {
    visible: boolean;
    onClose: () => void;
    onDismiss?: () => void;
    onSuccess?: () => void;
    usageInfo?: {
        usageCount: number;
        freeLimit: number;
        remaining: number;
    };
    usagePercent?: number;
    initialSummary?: BillingSummaryPayload | null;
}

const ANORHA_GREEN = BRAND_PRIMARY;
const ANORHA_GREEN_TINT = 'rgba(147,200,34,0.12)';
const WHITE_BG = '#FFFFFF';

// Mapping features for the tabular view
const TABULAR_FEATURES = [
    { label: 'Platform integrations', free: '1 Platform', growth: 'Unlimited', teams: 'Unlimited' },
    { label: 'Real-time syncings', free: 'Limited', growth: 'Unlimited', teams: 'Unlimited' },
    { label: 'AI usage', free: 'Limited', growth: 'Included', teams: '3× included' },
    { label: 'Team members', free: '1 User', growth: '2 Users', teams: '5 Users' },
    { label: 'Priority Support', free: '-', growth: '-', teams: '✓' },
];

const TierSelectorModal: React.FC<TierSelectorModalProps> = ({
    visible,
    onClose,
    onDismiss,
    onSuccess,
    usageInfo,
    usagePercent,
    initialSummary,
}) => {
    const theme = useTheme();
    const navigation = useNavigation();
    // Default selected tier is growth
    const [selectedTierId, setSelectedTierId] = useState<'growth' | 'teams'>(TIERS[0].id);
    const [isLoading, setIsLoading] = useState(false);
    const [isBillingStateLoading, setIsBillingStateLoading] = useState(false);
    const [billingState, setBillingState] = useState<BillingStateViewModel>(() =>
        deriveBillingState(initialSummary, new Date()),
    );
    const pendingBrowserUrlRef = React.useRef<string | null>(null);

    const refreshBillingState = useCallback(async () => {
        setIsBillingStateLoading(true);
        try {
            const payload = await apiJson<unknown>('/api/billing/summary');
            const parsed = parseBillingSummaryPayload(payload);
            if (!parsed.ok) throw new Error(`Invalid billing summary at ${parsed.field}`);
            const nextBillingState = deriveBillingState(parsed.value, new Date());
            setBillingState(current => nextBillingState.knowledge === 'unknown'
                && isCheckoutBlocked(current.checkout.allowed)
                ? current
                : nextBillingState);
        } catch (error) {
            log.warn('[TierSelector] Billing summary unavailable:', error);
        } finally {
            setIsBillingStateLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!visible) return;
        setBillingState(deriveBillingState(initialSummary, new Date()));
        void refreshBillingState();
    }, [initialSummary, refreshBillingState, visible]);

    // iOS presents SFSafariViewController only after the Modal has fully
    // dismissed; onDismiss is the deterministic signal (a fixed delay loses
    // under CPU load and the browser silently never appears).
    const handleModalDismiss = async () => {
        onDismiss?.();
        const url = pendingBrowserUrlRef.current;
        pendingBrowserUrlRef.current = null;
        if (!url) return;
        try {
            await openBillingUrl(url);
            await refreshBillingState();
            onSuccess?.();
        } catch (error: any) {
            log.error('[TierSelector] Checkout browser error:', error);
            Alert.alert('Checkout Error', 'Failed to open checkout. Please try again.');
        }
    };

    const presentBillingUrl = async (url: string) => {
        if (Platform.OS === 'ios') {
            pendingBrowserUrlRef.current = url;
            onClose();
            return;
        }
        onClose();
        await openBillingUrl(url);
        await refreshBillingState();
        onSuccess?.();
    };

    const openBillingSupport = () => {
        onClose();
        (navigation as any).navigate('BillingSupport');
    };

    const handleCheckout = async () => {
        if (!selectedTierId
            || isBillingStateLoading
            || isCheckoutBlocked(billingState.checkout.allowed)) return;

        const tier = TIERS.find(t => t.id === selectedTierId);
        if (!tier) return;

        setIsLoading(true);
        try {
            // Both endings bounce back into the app; the web page renders normally for
            // anyone who reaches these URLs from a desktop browser.
            const successUrl = withMobileReturn('https://app.anorha.app/billing?success=true');
            const cancelUrl = withMobileReturn('https://app.anorha.app/billing?canceled=true');

            const response = await apiJson<{
                provider?: string;
                action?: string;
                url?: string;
            }>('/api/billing/checkout', {
                method: 'POST',
                body: {
                    tier: tier.name,
                    successUrl,
                    cancelUrl,
                },
            });

            if (response.action === 'redirect' && response.url) {
                await presentBillingUrl(response.url);
                return;
            }
            throw new Error('Checkout redirect unavailable');
        } catch (error: any) {
            if (error instanceof ApiError && error.status === 409) {
                const blocked = deriveBillingStateFromCheckoutConflict(
                    error.body as RawCheckoutConflict,
                    new Date(),
                );
                if (blocked.knowledge === 'known') {
                    setBillingState(blocked);
                    void refreshBillingState();
                    return;
                }
            }
            log.error('[TierSelector] Checkout error:', error);
            Alert.alert('Checkout Error', 'Failed to start checkout. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleManageAccount = async () => {
        setIsLoading(true);
        try {
            const response = await apiJson<{
                action?: string;
                url?: string | null;
            }>('/api/billing/portal', {
                method: 'POST',
            });

            if (response.action === 'contact_support') {
                openBillingSupport();
                return;
            }
            if (response.action === 'manage' && response.url) {
                await presentBillingUrl(response.url);
                return;
            }
            throw new Error('Billing management action unavailable');
        } catch (error: any) {
            if (error instanceof ApiError && error.status === 409
                && error.body?.action === 'contact_support') {
                openBillingSupport();
                return;
            }
            log.error('[TierSelector] Manage account error:', error);
            Alert.alert('Error', 'Failed to open billing portal. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const selectedTier = TIERS.find(t => t.id === selectedTierId) || TIERS[0];
    const checkoutTimestamp = formatBillingTimestamp(billingState.checkout.eligibleAt);
    const resubscribeTimestamp = formatBillingTimestamp(billingState.resubscribe.eligibleAt);
    const billingNotice = billingState.handoff?.state === 'scheduled'
        ? checkoutTimestamp
            ? `Switch scheduled. Checkout ${checkoutTimestamp}.`
            : 'Switch scheduled.'
        : billingState.resubscribe.offered === true && billingState.resubscribe.eligible === false
            ? resubscribeTimestamp
                ? `Re-subscribe ${resubscribeTimestamp}.`
                : 'Re-subscribe unavailable.'
            : billingState.checkout.state === 'blocked' && checkoutTimestamp
                ? `Checkout ${checkoutTimestamp}.`
                : billingState.handoff?.state === 'ready'
                    ? 'Switch ready.'
                    : null;
    const providerNote = billingState.entitlementProvider === 'manual'
        ? 'Support managed.'
        : billingState.entitlementProvider === 'polar'
            ? 'Managed through Polar.'
            : billingState.entitlementProvider === 'shopify'
                ? 'Managed through Shopify.'
                : billingState.checkout.provider === 'polar'
                    ? 'Checkout through Polar.'
                    : billingState.checkout.provider === 'shopify'
                        ? 'Checkout through Shopify.'
                        : null;
    const checkoutLabel = billingState.checkout.action === 'schedule_handoff'
        ? 'Schedule switch'
        : billingState.checkout.state === 'blocked'
            ? 'Checkout unavailable'
            : billingState.resubscribe.offered === true
                ? 'Re-subscribe'
                : 'Continue';
    const billingRequestLoading = isLoading || isBillingStateLoading;
    const checkoutDisabled = billingRequestLoading
        || isCheckoutBlocked(billingState.checkout.allowed);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
            onDismiss={handleModalDismiss}
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
                        {typeof usagePercent === 'number' ? (
                            <View style={styles.usageBadge}>
                                <Text style={styles.usageBadgeText}>
                                    {Math.max(0, Math.round(usagePercent))}% of this month&apos;s AI usage used
                                </Text>
                            </View>
                        ) : usageInfo && usageInfo.remaining === 0 ? (
                            <View style={styles.usageBadge}>
                                <Text style={styles.usageBadgeText}>
                                    Monthly AI usage reached
                                </Text>
                            </View>
                        ) : null}
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
                                checkoutDisabled && styles.checkoutButtonDisabled,
                            ]}
                            onPress={handleCheckout}
                            disabled={checkoutDisabled}
                        >
                            {billingRequestLoading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.checkoutButtonText}>{checkoutLabel}</Text>
                            )}
                        </TouchableOpacity>

                        {billingNotice ? <Text style={styles.footerNote}>{billingNotice}</Text> : null}

                        <TouchableOpacity
                            style={styles.manageButton}
                            onPress={handleManageAccount}
                            disabled={billingRequestLoading}
                        >
                            <Text style={styles.manageButtonText}>Manage subscription</Text>
                        </TouchableOpacity>
                        {providerNote ? <Text style={styles.footerNote}>{providerNote}</Text> : null}
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
