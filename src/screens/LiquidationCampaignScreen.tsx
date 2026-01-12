import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, FlatList } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ensureSupabaseJwt } from '../lib/supabase';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const LiquidationCampaignScreen = () => {
    const theme = useTheme();
    const colors = theme.colors;
    const navigation = useNavigation();
    const route = useRoute();
    const { campaignId } = route.params as { campaignId: string };
    const [campaign, setCampaign] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchCampaign = async () => {
            try {
                const token = await ensureSupabaseJwt();
                const response = await fetch(`${process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app'}/api/liquidation/strategies/${campaignId}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const data = await response.json();
                if (data.success) {
                    setCampaign(data.strategy);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchCampaign();
    }, [campaignId]);

    if (loading) {
        return (
            <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (!campaign) {
        return (
            <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
                <Text style={{ color: colors.text }}>Campaign not found</Text>
            </View>
        );
    }

    return (
        <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={styles.header}>
                <Text style={[styles.title, { color: colors.text }]}>{campaign.DisplayName || 'Campaign'}</Text>
                <View style={[styles.badge, { backgroundColor: '#93C82220' }]}>
                    <Text style={{ color: '#93C822', fontWeight: 'bold' }}>{campaign.Status.toUpperCase()}</Text>
                </View>
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Progress</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                    <View>
                        <Text style={{ color: colors.textSecondary }}>Revenue</Text>
                        <Text style={{ fontSize: 24, fontWeight: 'bold', color: colors.primary }}>${campaign.RevenueGenerated || 0}</Text>
                    </View>
                    <View>
                        <Text style={{ color: colors.textSecondary }}>Sold</Text>
                        <Text style={{ fontSize: 24, fontWeight: 'bold', color: colors.text }}>{campaign.ItemsSold || 0}/{campaign.TotalItems || 0}</Text>
                    </View>
                </View>
            </View>

            {/* Placeholder for item list */}
            <View style={{ padding: 16 }}>
                <Text style={{ color: colors.textSecondary }}>Item details coming soon in next update.</Text>
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    centered: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        padding: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
    },
    badge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
    },
    card: {
        margin: 16,
        padding: 16,
        borderRadius: 12,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
    },
});

export default LiquidationCampaignScreen;
