import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Camera, ChevronUp } from 'lucide-react-native';
import { capture } from '../lib/analytics';

interface UsageCounterProps {
    usageCount: number;
    freeLimit: number;
    onUpgradePress: () => void;
    isSubscriber?: boolean;
}
const ANORHA_GREEN = '#93C822';
const ANORHA_CREAM = '#ffffffe4';

const UsageCounter: React.FC<UsageCounterProps> = ({
    usageCount,
    freeLimit,
    onUpgradePress,
    isSubscriber = false,
}) => {
    // Don't show for subscribers
    if (isSubscriber) return null;

    const remaining = Math.max(0, freeLimit - usageCount);
    const isExhausted = remaining === 0;

    return (
        <View style={[
            styles.container,
            { backgroundColor: isExhausted ? '#FEE2E2' : ANORHA_CREAM }
        ]}>
            <View style={styles.leftSection}>
                <Camera size={20} color={isExhausted ? '#DC2626' : ANORHA_GREEN} />
                <Text style={[
                    styles.countText,
                    { color: isExhausted ? '#DC2626' : '#333' }
                ]}>
                    {isExhausted
                        ? `Free scans used (${usageCount}/${freeLimit})`
                        : `${remaining}/${freeLimit} daily free scans`
                    }
                </Text>
            </View>

            <TouchableOpacity
                style={[
                    styles.upgradeButton,
                    { backgroundColor: isExhausted ? '#DC2626' : ANORHA_GREEN }
                ]}
                onPress={() => {
                    capture('billing_metering_upgrade_cta_tapped', {
                        usageCount,
                        freeLimit,
                        remaining,
                        exhausted: isExhausted,
                    });
                    onUpgradePress();
                }}
            >
                <Text style={styles.upgradeText}>Upgrade</Text>
                <ChevronUp size={14} color="#fff" />
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        marginHorizontal: 16,
        marginBottom: 8,
        borderColor: "rgba(0, 0, 0, 0.18)",
        borderWidth: 2,
    },
    leftSection: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    countText: {
        fontSize: 13,
        fontWeight: '500',
    },
    upgradeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
        gap: 4,
    },
    upgradeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
});

export default UsageCounter;
