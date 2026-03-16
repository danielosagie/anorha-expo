import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ShadowSurface from './ui/ShadowSurface';

interface CampaignSession {
    id: string;
    status: string;
    goal: {
        type: string;
        targetRevenue?: number;
    };
    state: {
        progress?: number;
        revenueGenerated?: number;
    };
    createdAt: string;
}

interface CampaignSelectorProps {
    campaigns: CampaignSession[];
    selectedId: string;
    onSelect: (id: string) => void;
    loading?: boolean;
}

export const CampaignSelector: React.FC<CampaignSelectorProps> = ({ campaigns, selectedId, onSelect, loading }) => {
    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <View style={[styles.skeletonCard, { width: 140 }]} />
                <View style={[styles.skeletonCard, { width: 140, marginLeft: 12 }]} />
            </View>
        );
    }

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.container}
        >
            {campaigns.map((campaign) => {
                const isSelected = campaign.id === selectedId;
                const progress = campaign.state?.progress || 0;
                const revenue = campaign.state?.revenueGenerated || 0;

                return (
                    <ShadowSurface
                        key={campaign.id}
                        shadow="xs"
                        radius={12}
                        style={styles.cardShadow}
                        innerStyle={styles.cardInner}
                    >
                        <TouchableOpacity
                            style={[
                                styles.card,
                                isSelected && styles.selectedCard
                            ]}
                            onPress={() => onSelect(campaign.id)}
                        >
                        <View style={styles.header}>
                            <Icon
                                name="rocket-launch-outline"
                                size={16}
                                color={isSelected ? '#15803d' : '#6b7280'}
                            />
                            <View style={[
                                styles.statusDot,
                                { backgroundColor: campaign.status === 'active' ? '#22c55e' : '#9ca3af' }
                            ]} />
                        </View>

                        <Text style={[styles.title, isSelected && styles.selectedText]} numberOfLines={1}>
                            Campaign #{campaign.id.slice(0, 5)}
                        </Text>

                        <Text style={[styles.amount, isSelected && styles.selectedText]}>
                            ${revenue.toLocaleString()}
                        </Text>

                        {/* Mini Progress Bar */}
                        <View style={styles.progressTrack}>
                            <View
                                style={[
                                    styles.progressFill,
                                    { width: `${Math.min(100, progress)}%`, backgroundColor: isSelected ? '#16a34a' : '#9ca3af' }
                                ]}
                            />
                        </View>
                        </TouchableOpacity>
                    </ShadowSurface>
                );
            })}

            {/* Add New Placeholer */}
            <ShadowSurface shadow="none" radius={12} style={styles.cardShadow} innerStyle={styles.cardInner}>
                <TouchableOpacity style={[styles.card, styles.addCard]}>
                    <Icon name="plus" size={24} color="#9ca3af" />
                    <Text style={styles.addText}>New</Text>
                </TouchableOpacity>
            </ShadowSurface>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
    },
    loadingContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    skeletonCard: {
        height: 80,
        backgroundColor: '#f3f4f6',
        borderRadius: 12,
    },
    cardShadow: {
        width: 130,
    },
    cardInner: {
        borderRadius: 12,
    },
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    selectedCard: {
        borderColor: '#86efac', // green-300
        backgroundColor: '#f0fdf4', // green-50
    },
    addCard: {
        justifyContent: 'center',
        alignItems: 'center',
        borderStyle: 'dashed',
        borderColor: '#d1d5db',
        backgroundColor: 'transparent',
        shadowOpacity: 0,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    title: {
        fontSize: 12,
        color: '#6b7280',
        marginBottom: 2,
    },
    amount: {
        fontSize: 16,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 8,
    },
    selectedText: {
        color: '#14532d',
    },
    addText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#6b7280',
        marginTop: 4,
    },
    progressTrack: {
        height: 3,
        backgroundColor: '#e5e7eb',
        borderRadius: 1.5,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 1.5,
    },
});
