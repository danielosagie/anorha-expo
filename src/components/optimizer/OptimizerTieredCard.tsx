import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export type OptimizerTier = 'urgent' | 'warning' | 'standard' | 'completed';

interface OptimizerTieredCardProps {
    item: any;
    tier: OptimizerTier;
    onPress: () => void;
    onAction?: () => void; // kept for interface compatibility
    selectable?: boolean;
    selected?: boolean;
    onLongPress?: () => void;
    onSelect?: () => void;
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
    selectable = false,
    selected = false,
    onLongPress,
    onSelect,
}) => {
    const isUrgent = tier === 'urgent';
    const isCompleted = tier === 'completed';

    return (
        <TouchableOpacity
            onPress={selectable ? onSelect : onPress}
            onLongPress={onLongPress}
            activeOpacity={0.7}
            style={[
                styles.card,
                isCompleted && styles.cardCompleted,
            ]}
        >
            <View style={styles.contentRow}>
                {selectable && (
                    <TouchableOpacity style={styles.checkboxContainer} onPress={onSelect}>
                        <MaterialCommunityIcons
                            name={selected ? 'check-circle' : 'checkbox-blank-circle-outline'}
                            size={24}
                            color={selected ? '#8cc63f' : '#adb5bd'}
                        />
                    </TouchableOpacity>
                )}

                {/* Unread/Priority Indicator */}
                {!selectable && (
                    <View style={styles.indicatorContainer}>
                        {!isCompleted && (
                            <View style={[styles.priorityDot, { backgroundColor: TIER_COLORS[tier] }]} />
                        )}
                    </View>
                )}

                <View style={styles.imageContainer}>
                    {item.ProductImages?.[0]?.ImageUrl ? (
                        <Image source={{ uri: item.ProductImages[0].ImageUrl }} style={styles.thumb} />
                    ) : (
                        <View style={[styles.thumb, styles.placeholderThumb]}>
                            <MaterialCommunityIcons name="image-outline" size={20} color="#adb5bd" />
                        </View>
                    )}
                </View>

                <View style={styles.textContainer}>
                    <View style={styles.headerRow}>
                        <Text style={[styles.title, isCompleted && styles.titleCompleted]} numberOfLines={1}>
                            {item.Title || 'Untitled Product'}
                        </Text>
                        <Text style={styles.timeText}>{item.Sku ? `SKU: ${item.Sku}` : 'No SKU'}</Text>
                    </View>

                    <Text style={[styles.subtitle, isCompleted && styles.subtitleCompleted]} numberOfLines={1}>
                        {isCompleted ? 'Optimized' : (isUrgent ? 'Missing photos' : 'Description needs details')}
                    </Text>
                </View>
            </View>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#ffffff',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(0,0,0,0.06)',
    },
    cardCompleted: {
        backgroundColor: '#fcfcfc',
    },
    contentRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    checkboxContainer: {
        width: 36,
        justifyContent: 'center',
        alignItems: 'flex-start',
    },
    indicatorContainer: {
        width: 14,
        justifyContent: 'center',
        alignItems: 'flex-start',
    },
    priorityDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    imageContainer: {
        marginRight: 12,
    },
    thumb: {
        width: 44,
        height: 44,
        borderRadius: 6,
        backgroundColor: '#f1f3f5',
    },
    placeholderThumb: {
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(0,0,0,0.04)',
    },
    textContainer: {
        flex: 1,
        justifyContent: 'center',
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 2,
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1a1a1a',
        flex: 1,
        marginRight: 8,
        letterSpacing: -0.2,
    },
    titleCompleted: {
        fontWeight: '400',
        color: '#6c757d',
    },
    timeText: {
        fontSize: 12,
        color: '#adb5bd',
        fontWeight: '400',
    },
    subtitle: {
        fontSize: 14,
        color: '#6c757d',
    },
    subtitleCompleted: {
        color: '#adb5bd',
    },
});
