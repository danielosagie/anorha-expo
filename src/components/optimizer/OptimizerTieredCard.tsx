import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export type OptimizerTier = 'urgent' | 'warning' | 'standard' | 'completed';

interface OptimizerTieredCardProps {
    item: any;
    tier: OptimizerTier;
    onPress: () => void;
    onAction?: () => void;
}

const TIER_COLORS = {
    urgent: '#fa5252',
    warning: '#fab005',
    standard: '#adb5bd',
    completed: '#8cc63f',
};

export const OptimizerTieredCard: React.FC<OptimizerTieredCardProps> = ({
    item,
    tier,
    onPress,
    onAction,
}) => {
    const isUrgent = tier === 'urgent';
    const isStandard = tier === 'standard';
    const isCompleted = tier === 'completed';

    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.8}
            style={[
                styles.card,
                { borderLeftColor: TIER_COLORS[tier] },
                isUrgent && styles.cardUrgent,
                isStandard && styles.cardStandard,
                isCompleted && styles.cardCompleted,
            ]}
        >
            <View style={styles.contentRow}>
                <View style={styles.imageContainer}>
                    {item.ProductImages?.[0]?.ImageUrl ? (
                        <Image source={{ uri: item.ProductImages[0].ImageUrl }} style={styles.thumb} />
                    ) : (
                        <View style={[styles.thumb, styles.placeholderThumb]}>
                            <MaterialCommunityIcons name="image-off" size={20} color="#ccc" />
                        </View>
                    )}
                    {isCompleted && (
                        <View style={styles.checkBadge}>
                            <MaterialCommunityIcons name="check-circle" size={14} color="#fff" />
                        </View>
                    )}
                </View>

                <View style={styles.textContainer}>
                    <View style={styles.headerRow}>
                        <Text style={styles.title} numberOfLines={1}>
                            {item.Title || 'Untitled Product'}
                        </Text>
                        {isUrgent && (
                            <View style={styles.urgentBadge}>
                                <Text style={styles.urgentBadgeText}>URGENT</Text>
                            </View>
                        )}
                    </View>

                    <Text style={styles.subtitle} numberOfLines={1}>
                        {isCompleted ? 'Fully optimized' : (isUrgent ? 'Missing critical photos' : 'Description could be better')}
                    </Text>

                    {isUrgent && (
                        <View style={styles.metaRow}>
                            <MaterialCommunityIcons name="clock-outline" size={12} color="#6c757d" />
                            <Text style={styles.metaText}>~2 min to fix</Text>
                        </View>
                    )}
                </View>

                {!isUrgent && !isCompleted && (
                    <MaterialCommunityIcons name="chevron-right" size={20} color="#adb5bd" />
                )}
            </View>

            {isUrgent && onAction && (
                <TouchableOpacity style={styles.actionButton} onPress={onAction}>
                    <MaterialCommunityIcons name="camera" size={16} color="#fff" />
                    <Text style={styles.actionText}>Start Photo Session</Text>
                </TouchableOpacity>
            )}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderLeftWidth: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    cardUrgent: {
        paddingBottom: 12,
    },
    cardStandard: {
        padding: 12,
        opacity: 0.8,
    },
    cardCompleted: {
        padding: 12,
        backgroundColor: '#f8f9fa',
        borderLeftWidth: 0,
        opacity: 0.7,
    },
    contentRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    imageContainer: {
        position: 'relative',
        marginRight: 12,
    },
    thumb: {
        width: 48,
        height: 48,
        borderRadius: 10,
        backgroundColor: '#f1f3f5',
    },
    placeholderThumb: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    checkBadge: {
        position: 'absolute',
        bottom: -4,
        right: -4,
        backgroundColor: '#8cc63f',
        borderRadius: 10,
        padding: 1,
    },
    textContainer: {
        flex: 1,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 2,
    },
    title: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1a1a1a',
        flexShrink: 1,
    },
    urgentBadge: {
        backgroundColor: '#fff5f5',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: '#ffa8a8',
    },
    urgentBadgeText: {
        fontSize: 9,
        fontWeight: '800',
        color: '#fa5252',
    },
    subtitle: {
        fontSize: 13,
        color: '#6c757d',
        marginBottom: 4,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    metaText: {
        fontSize: 11,
        color: '#6c757d',
        fontWeight: '500',
    },
    actionButton: {
        backgroundColor: '#fa5252',
        height: 38,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 12,
        gap: 8,
    },
    actionText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '700',
    },
});
