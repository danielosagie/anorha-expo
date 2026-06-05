import React from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, { FadeInLeft } from 'react-native-reanimated';
import ShadowSurface from './ui/ShadowSurface';

interface CampaignCardProps {
    id: string;
    name: string;
    itemsSold: number;
    totalItems: number;
    revenue: number;
    daysRemaining: number;
    status: 'executing' | 'completed' | 'paused' | 'failed' | 'pending';
    onPress: () => void;
}

const CampaignCard: React.FC<CampaignCardProps> = ({
    id,
    name,
    itemsSold,
    totalItems,
    revenue,
    daysRemaining,
    status,
    onPress,
}) => {
    const theme = useTheme();
    const colors = theme.colors;
    const border = '#E5E7EB';

    const progress = totalItems > 0 ? (itemsSold / totalItems) * 100 : 0;

    const getStatusColor = () => {
        switch (status) {
            case 'executing': return BRAND_PRIMARY;
            case 'completed': return '#4CAF50';
            case 'paused': return '#FF9800';
            case 'failed': return '#F44336';
            default: return colors.textSecondary;
        }
    };

    return (
        <Animated.View entering={FadeInLeft.duration(300)}>
            <ShadowSurface shadow="sm" radius={16} style={styles.cardOuter} innerStyle={styles.cardSurface}>
                <TouchableOpacity
                    style={[styles.cardContent, { backgroundColor: colors.surface, borderColor: border }]}
                    onPress={onPress}
                    activeOpacity={0.7}
                >
                <View style={styles.header}>
                    <View style={styles.titleRow}>
                        <Icon name="flash" size={16} color="#FF9900" style={{ marginRight: 6 }} />
                        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{name || 'Liquidation Campaign'}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: getStatusColor() + '20' }]}>
                        <Text style={[styles.badgeText, { color: getStatusColor() }]}>
                            {status === 'executing' ? 'ACTIVE' : status.toUpperCase()}
                        </Text>
                    </View>
                </View>

                <View style={styles.statsRow}>
                    <View style={styles.stat}>
                        <Text style={[styles.statValue, { color: colors.primary }]}>${revenue.toLocaleString()}</Text>
                        <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Revenue</Text>
                    </View>
                    <View style={[styles.divider, { backgroundColor: border }]} />
                    <View style={styles.stat}>
                        <Text style={[styles.statValue, { color: colors.text }]}>{itemsSold}/{totalItems}</Text>
                        <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Sold</Text>
                    </View>
                    <View style={[styles.divider, { backgroundColor: border }]} />
                    <View style={styles.stat}>
                        <Text style={[styles.statValue, { color: colors.text }]}>{daysRemaining}d</Text>
                        <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Left</Text>
                    </View>
                </View>

                <View style={styles.progressContainer}>
                    <View style={[styles.progressBar, { backgroundColor: border }]}>
                        <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: getStatusColor() }]} />
                    </View>
                </View>
                </TouchableOpacity>
            </ShadowSurface>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    cardOuter: {
        width: 280,
        marginRight: 12,
    },
    cardSurface: {
        borderRadius: 16,
    },
    cardContent: {
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    title: {
        fontSize: 14,
        fontWeight: '600',
        flex: 1,
    },
    badge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        marginLeft: 8,
    },
    badgeText: {
        fontSize: 10,
        fontWeight: '700',
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    stat: {
        alignItems: 'center',
        flex: 1,
    },
    divider: {
        width: 1,
        height: 24,
    },
    statValue: {
        fontSize: 16,
        fontWeight: '700',
        marginBottom: 2,
    },
    statLabel: {
        fontSize: 10,
        textTransform: 'uppercase',
    },
    progressContainer: {
        width: '100%',
    },
    progressBar: {
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 3,
    },
});

export default CampaignCard;
