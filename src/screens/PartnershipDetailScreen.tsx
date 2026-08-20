import React, { useState, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../config/env';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    TouchableOpacity,
    Alert,
    FlatList,
    RefreshControl,
    Switch
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ensureSupabaseJwt } from '../lib/supabase';
import { Partnership } from './PartnersScreen';
import { createLogger } from '../utils/logger';
const log = createLogger('PartnershipDetailScreen');


const SSSYNC_API_BASE_URL = API_BASE_URL;

interface LinkedProduct {
    // NOT the link id: the API groups links by product, so `id` is the PRODUCT
    // id. The link routes key on CrossOrgProductLinks.Id — use `linkId`.
    id: string;
    linkId?: string;
    productId: string;
    title: string;
    sourceVariantSku: string;
    status: 'active' | 'paused' | 'revoked';
    visibilityStatus: 'available' | 'hidden';
    sharedQuantity: number;
    primaryImageUrl: string | null;
}

export default function PartnershipDetailScreen() {
    const theme = useTheme();
    const navigation = useNavigation();
    const route = useRoute();
    const { partnership } = route.params as { partnership: Partnership };

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [products, setProducts] = useState<LinkedProduct[]>([]);

    // After the first cycle, refetches run quietly — refocus and pull-to-refresh
    // must not blank the list that's already on screen.
    const hasLoadedRef = useRef(false);

    const loadProducts = useCallback(async () => {
        try {
            if (!hasLoadedRef.current) setLoading(true);
            const token = await ensureSupabaseJwt();

            const res = await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/partnerships/${partnership.id}/products`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) throw new Error(await res.text() || `Request failed (${res.status})`);
            const data = await res.json();

                // The API returns grouped products. Flattening for mobile list view simplicity or using as is.
                // API returns: Record<productId, LinkedProduct[]>
                // Wait, the PoolsAndPartnersClient uses `fetchLinkedProducts` which returns `LinkedProduct[]`.
                // Let's assume it returns an array of LinkedProduct objects directly or grouped.
                // Based on `PoolsAndPartnersClient.tsx`: `setLinkedProducts(prev => ({ ...prev, [partnershipId]: data }));`
                // And the interface `LinkedProduct` there has `variants` array.

                // Mobile MVP: Let's flatten to variant links if possible, or just list products.
                // Actually, let's treat `data` as an array of products with potential variants.
                // For simplicity, we will just display the list.

                // If data is array:
            if (Array.isArray(data)) {
                setProducts(data);
            } else {
                const list = Object.values(data).flat() as LinkedProduct[];
                setProducts(list);
            }
        } catch (error) {
            log.error(error);
            Alert.alert('Error', 'Failed to load shared products');
        } finally {
            hasLoadedRef.current = true;
            setLoading(false);
            setRefreshing(false);
        }
    }, [partnership.id]);

    // Refetch on every focus — pause/share changes happen on screens pushed over
    // this one and on the partner's side; a stale list here reads as sync truth.
    useFocusEffect(
        useCallback(() => {
            void loadProducts();
        }, [loadProducts]),
    );

    const onRefresh = () => {
        setRefreshing(true);
        loadProducts();
    };

    const handleToggleSync = async (link: LinkedProduct) => {
        const action = link.status === 'paused' ? 'resume' : 'pause';

        // These routes take a CrossOrgProductLinks.Id. `link.id` is the grouped
        // product id, which 404s ("Product link not found").
        const linkId = link.linkId;
        if (!linkId) {
            Alert.alert('Couldn’t update sync', 'This shared product is missing its link reference. Pull to refresh and try again.');
            return;
        }

        try {
            const token = await ensureSupabaseJwt();
            const response = await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/links/${linkId}/${action}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
            setProducts(prev => prev.map(p => p.id === link.id ? { ...p, status: link.status === 'paused' ? 'active' : 'paused' } : p));
        } catch (e: any) {
            log.error(e);
            Alert.alert('Couldn’t update sync', e?.message || 'Please try again.');
        }
    };



    const renderProduct = ({ item }: { item: LinkedProduct }) => (
        <View style={styles.productCard}>
            <View style={styles.productHeader}>
                <View style={styles.iconBox}>
                    <Icon name="tshirt-crew" size={24} color="#6B7280" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.productTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.productSku}>{item.sourceVariantSku}</Text>
                </View>
                <View style={[styles.statusBadge, item.status === 'active' ? styles.statusActive : styles.statusPaused]}>
                    <Text style={[styles.statusText, item.status === 'active' ? styles.statusTextActive : styles.statusTextPaused]}>
                        {item.status === 'active' ? 'Sync on' : 'Paused'}
                    </Text>
                </View>
            </View>

            <View style={styles.actionsContainer}>
                <Switch
                    value={item.status === 'active'}
                    onValueChange={() => handleToggleSync(item)}
                    trackColor={{ false: '#D1D5DB', true: '#93C822' }}
                    thumbColor="#FFF"
                    ios_backgroundColor="#D1D5DB"
                />
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Icon name="arrow-left" size={24} color="#111827" />
                </TouchableOpacity>
                <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={styles.headerTitle}>{partnership.partnerOrgName || 'Partner'}</Text>
                    <Text style={styles.headerSubtitle}>{partnership.poolName}</Text>
                </View>
                <View style={{ width: 40 }} />
            </View>

            {/* Content */}
            <FlatList
                data={products}
                renderItem={renderProduct}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.listContent}
                // A real pull-to-refresh — the old `<ActivityIndicator>` here was
                // not a RefreshControl, so pulling never refetched anything.
                refreshControl={(
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor="#93C822"
                        colors={['#93C822']}
                    />
                )}
                ListEmptyComponent={loading ? (
                    <ActivityIndicator style={styles.emptyState} color="#93C822" />
                ) : (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyText}>No linked products found.</Text>
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8F9FB',
    },
    header: {
        paddingTop: 60,
        paddingHorizontal: 16,
        paddingBottom: 16,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    backBtn: {
        padding: 8,
        marginLeft: -8,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111827',
    },
    headerSubtitle: {
        fontSize: 12,
        color: '#6B7280',
    },
    listContent: {
        padding: 16,
    },
    productCard: {
        backgroundColor: '#FFF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#F3F4F6',
    },
    productHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    iconBox: {
        width: 40,
        height: 40,
        borderRadius: 8,
        backgroundColor: '#F3F4F6',
        alignItems: 'center',
        justifyContent: 'center',
    },
    productTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#1F2937',
    },
    productSku: {
        fontSize: 13,
        color: '#6B7280',
        marginTop: 2,
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    statusActive: { backgroundColor: '#DCFCE7' },
    statusPaused: { backgroundColor: '#FEF3C7' },
    statusText: { fontSize: 11, fontWeight: '600' },
    statusTextActive: { color: '#93C822' },
    statusTextPaused: { color: '#D97706' },
    actionsContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        gap: 16,
    },
    emptyState: {
        padding: 32,
        alignItems: 'center',
    },
    emptyText: {
        color: '#6B7280',
        fontSize: 15,
    }
});
