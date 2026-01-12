import React, { useState } from 'react';
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
} from 'react-native';
import { X, CheckCircle2, Users } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { ensureSupabaseJwt } from '../lib/supabase';

const API_BASE_URL = 'https://api.sssync.app/api';
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

const ANORHA_GREEN = '#647653';
const ANORHA_CREAM = '#FEF4DD';

const TierSelectorModal: React.FC<TierSelectorModalProps> = ({
    visible,
    onClose,
    onSuccess,
    usageInfo,
    hasSubscription = false,
}) => {
    const theme = useTheme();
    const [selectedTierId, setSelectedTierId] = useState<'growth' | 'teams' | null>(null);
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

            // Use proper redirect URLs that show success/cancel message
            const successUrl = 'https://app.anorha.app/billing?success=true';
            const cancelUrl = 'https://app.anorha.app/billing?canceled=true';

            // Call backend to create checkout session
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
                // Close modal first
                onClose();
                // Open in system browser (non-blocking)
                const supported = await Linking.canOpenURL(url);
                if (supported) {
                    await Linking.openURL(url);
                    onSuccess?.();
                } else {
                    Alert.alert('Error', 'Cannot open checkout URL');
                }
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

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={styles.container}>
                    {/* Header */}
                    <View style={styles.header}>
                        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                            <X size={24} color="#666" />
                        </TouchableOpacity>
                        <Text style={styles.title}>Choose Your Plan</Text>
                        <Text style={styles.subtitle}>Scale as you grow</Text>

                        {/* Usage indicator */}
                        {usageInfo && usageInfo.remaining === 0 && (
                            <View style={styles.usageBadge}>
                                <Text style={styles.usageBadgeText}>
                                    Free tier exhausted ({usageInfo.usageCount}/{usageInfo.freeLimit} scans used)
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Tier Cards */}
                    <ScrollView
                        style={styles.tiersContainer}
                        contentContainerStyle={styles.tiersContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {TIERS.map((tier) => (
                            <TouchableOpacity
                                key={tier.id}
                                style={[
                                    styles.tierCard,
                                    selectedTierId === tier.id && styles.tierCardSelected,
                                ]}
                                onPress={() => setSelectedTierId(tier.id)}
                                activeOpacity={0.8}
                            >
                                {/* Popular badge */}
                                {tier.highlighted && (
                                    <View style={styles.popularBadge}>
                                        <Text style={styles.popularBadgeText}>Most Popular</Text>
                                    </View>
                                )}

                                <Text style={styles.tierName}>{tier.name}</Text>
                                <Text style={styles.tierDescription}>{tier.description}</Text>

                                {/* Price */}
                                <View style={styles.priceRow}>
                                    <Text style={styles.priceAmount}>${tier.price}</Text>
                                    <Text style={styles.pricePeriod}>/ {tier.billingPeriod}</Text>
                                </View>

                                {/* Team size */}
                                <View style={styles.teamRow}>
                                    <Users size={16} color="#666" />
                                    <Text style={styles.teamText}>
                                        {tier.users} included users (+${tier.additionalUserPrice} per additional)
                                    </Text>
                                </View>

                                {/* Features */}
                                <View style={styles.featuresContainer}>
                                    {tier.features.map((feature, idx) => (
                                        <View key={idx} style={styles.featureRow}>
                                            <CheckCircle2 size={18} color={ANORHA_GREEN} />
                                            <Text style={styles.featureText}>{feature}</Text>
                                        </View>
                                    ))}
                                </View>

                                {/* Selection indicator */}
                                {selectedTierId === tier.id && (
                                    <View style={styles.selectedIndicator}>
                                        <Text style={styles.selectedText}>✓ Selected</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        ))}
                    </ScrollView>

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
                                <Text style={styles.checkoutButtonText}>Continue to checkout</Text>
                            )}
                        </TouchableOpacity>

                        {/* Manage subscription for existing subscribers */}
                        {hasSubscription && (
                            <TouchableOpacity
                                style={styles.manageButton}
                                onPress={handleManageAccount}
                                disabled={isLoading}
                            >
                                <Text style={styles.manageButtonText}>Manage current subscription</Text>
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                            <Text style={styles.cancelButtonText}>Maybe later</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    container: {
        backgroundColor: ANORHA_CREAM,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 34,
        maxHeight: SCREEN_HEIGHT * 0.9,
    },
    header: {
        alignItems: 'center',
        marginBottom: 16,
    },
    closeButton: {
        position: 'absolute',
        top: 0,
        right: 0,
        padding: 8,
        zIndex: 1,
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: '#333',
        marginTop: 8,
    },
    subtitle: {
        fontSize: 14,
        color: '#666',
        marginTop: 4,
    },
    usageBadge: {
        marginTop: 12,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: '#FEE2E2',
    },
    usageBadgeText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#DC2626',
    },
    tiersContainer: {
        flexGrow: 0,
        flexShrink: 1,
        maxHeight: SCREEN_HEIGHT * 0.55,
    },
    tiersContent: {
        paddingBottom: 16,
    },
    tierCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    tierCardSelected: {
        borderColor: ANORHA_GREEN,
        borderWidth: 2,
    },
    popularBadge: {
        position: 'absolute',
        top: -10,
        right: 16,
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 12,
        backgroundColor: ANORHA_GREEN,
    },
    popularBadgeText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
    },
    tierName: {
        fontSize: 22,
        fontWeight: '700',
        color: '#333',
    },
    tierDescription: {
        fontSize: 14,
        color: '#666',
        marginTop: 2,
    },
    priceRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginTop: 12,
    },
    priceAmount: {
        fontSize: 36,
        fontWeight: '700',
        color: '#333',
    },
    pricePeriod: {
        fontSize: 14,
        color: '#666',
        marginLeft: 4,
    },
    teamRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        gap: 8,
    },
    teamText: {
        fontSize: 13,
        color: '#666',
    },
    featuresContainer: {
        marginTop: 16,
        gap: 10,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    featureText: {
        fontSize: 14,
        color: '#333',
    },
    selectedIndicator: {
        marginTop: 16,
        paddingVertical: 8,
        borderRadius: 8,
        alignItems: 'center',
        backgroundColor: '#64765315',
    },
    selectedText: {
        fontSize: 14,
        fontWeight: '600',
        color: ANORHA_GREEN,
    },
    actionsContainer: {
        gap: 12,
        marginTop: 8,
    },
    checkoutButton: {
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
        backgroundColor: ANORHA_GREEN,
    },
    checkoutButtonDisabled: {
        backgroundColor: '#ccc',
    },
    checkoutButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    cancelButton: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    cancelButtonText: {
        color: '#666',
        fontSize: 14,
    },
    manageButton: {
        alignItems: 'center',
        paddingVertical: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: ANORHA_GREEN,
        backgroundColor: 'transparent',
    },
    manageButtonText: {
        color: ANORHA_GREEN,
        fontSize: 15,
        fontWeight: '600',
    },
});

export default TierSelectorModal;
