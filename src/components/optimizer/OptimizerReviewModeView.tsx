import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    FlatList,
    Image,
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/clerk-expo';
import { ensureSupabaseJwt, supabase } from '../../lib/supabase';
import { createLogger } from '../../utils/logger';
const log = createLogger('OptimizerReviewModeView');


const { width } = Dimensions.get('window');

const COLORS = {
    primary: '#8cc63f',
    approve: '#4cd964',
    reject: '#ff3b30',
    surface: '#ffffff',
    background: '#f8f9fa',
    text: '#1a1a1a',
    textLight: '#6c757d',
    border: '#e5e5e5',
    diffAdd: '#eaffea',
    diffText: '#2e7d32',
};

interface OptimizerReviewModeViewProps {
    onBack: () => void;
    /** When provided, use this list instead of fetching (real manual-queue from useOptimizerQueues) */
    queueProducts?: any[];
}

export function OptimizerReviewModeView({ onBack, queueProducts }: OptimizerReviewModeViewProps) {
    const { getToken } = useAuth();
    const [pendingItems, setPendingItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [approvedCount, setApprovedCount] = useState(0);

    // Filter Type: 'all' | 'content' | 'images'
    const [filterType, setFilterType] = useState('all');

    useEffect(() => {
        if (queueProducts && queueProducts.length > 0) {
            setPendingItems(queueProducts.map((p: any) => ({ ...p, changeType: p.reason || 'Needs review', proposedTitle: null, proposedDescription: null })));
            setLoading(false);
        } else {
            loadPendingReviews();
        }
    }, []);

    const loadPendingReviews = async () => {
        try {
            const token = await getToken();
            await ensureSupabaseJwt();

            // Fetch products. In a real app, we'd specifically fetch from a 'ProductDrafts' table
            // or products with a 'review_pending' status. 
            // Mocking this by fetching random products and simulating proposed changes.
            const { data, error } = await supabase
                .from('ProductVariants')
                .select(`
                    Id, Title, Sku, Description,
                    ProductImages:ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl)
                `)
                .limit(10);

            if (error) throw error;

            // Simulate "Proposed Changes" for demo purposes
            const mockedDrafts = (data || []).map((p, index) => ({
                ...p,
                proposedTitle: index % 2 === 0 ? `✨ ${p.Title} (Optimized)` : p.Title,
                proposedDescription: !p.Description ? "This is an AI-generated description highlighting the key features of this product. It is SEO-optimized and ready to convert sales." : null,
                changeType: !p.Description ? 'New Description' : 'Title Optimization',
            }));

            setPendingItems(mockedDrafts);
            setLoading(false);
        } catch (err) {
            log.error('[ReviewMode] Error loading reviews', err);
            setLoading(false);
        }
    };

    const handleApprove = (id: string) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        // Optimistic Remove
        setPendingItems(prev => prev.filter(item => item.Id !== id));
        setApprovedCount(c => c + 1);

        // In real app: await acceptDraft(id)
    };

    const handleReject = (id: string) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        // Optimistic Remove
        setPendingItems(prev => prev.filter(item => item.Id !== id));
        // In real app: discardDraft(id)
    };

    const renderReviewCard = ({ item }: { item: any }) => {
        const image = item.ProductImages?.[0]?.ImageUrl;

        return (
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <View style={styles.productBrief}>
                        {image ? (
                            <Image source={{ uri: image }} style={styles.thumb} />
                        ) : (
                            <View style={styles.thumbPlaceholder} />
                        )}
                        <View style={{ flex: 1 }}>
                            <Text style={styles.briefTitle} numberOfLines={1}>{item.Title}</Text>
                            <View style={styles.changeBadge}>
                                <MaterialCommunityIcons name="auto-fix" size={12} color="#fff" />
                                <Text style={styles.changeBadgeText}>{item.changeType}</Text>
                            </View>
                        </View>
                    </View>
                </View>

                <View style={styles.diffContainer}>
                    {/* Manual queue: show reason (e.g. Missing SKU) */}
                    {item.reason && !item.proposedDescription && !(item.proposedTitle && item.proposedTitle !== item.Title) && (
                        <View style={styles.diffBlock}>
                            <Text style={styles.diffLabel}>NEEDS MANUAL ATTENTION</Text>
                            <Text style={styles.newText}>{item.reason}. Tap to edit in Product Detail.</Text>
                        </View>
                    )}
                    {/* If Title Changed */}
                    {item.proposedTitle && item.Title !== item.proposedTitle && (
                        <View style={styles.diffBlock}>
                            <Text style={styles.diffLabel}>TITLE</Text>
                            <Text style={styles.oldText}>{item.Title}</Text>
                            <View style={styles.arrowContainer}>
                                <MaterialCommunityIcons name="arrow-down" size={20} color={COLORS.textLight} />
                            </View>
                            <View style={styles.newTextBlock}>
                                <Text style={styles.newText}>{item.proposedTitle}</Text>
                            </View>
                        </View>
                    )}

                    {/* If Description Proposed (from AI drafts) */}
                    {item.proposedDescription && (
                        <View style={styles.diffBlock}>
                            <Text style={styles.diffLabel}>DESCRIPTION</Text>
                            <View style={styles.newTextBlock}>
                                <Text style={styles.newText}>{item.proposedDescription}</Text>
                            </View>
                        </View>
                    )}
                </View>

                <View style={styles.cardActions}>
                    <TouchableOpacity
                        style={[styles.actionBtn, styles.rejectBtn]}
                        onPress={() => handleReject(item.Id)}
                    >
                        <MaterialCommunityIcons name="close" size={24} color={COLORS.reject} />
                        <Text style={[styles.actionText, { color: COLORS.reject }]}>Discard</Text>
                    </TouchableOpacity>

                    <View style={styles.divider} />

                    <TouchableOpacity
                        style={[styles.actionBtn, styles.approveBtn]}
                        onPress={() => handleApprove(item.Id)}
                    >
                        <MaterialCommunityIcons name="check" size={24} color={COLORS.approve} />
                        <Text style={[styles.actionText, { color: COLORS.approve }]}>Approve</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={{ marginTop: 10, color: COLORS.textLight }}>Loading reviews...</Text>
            </View>
        );
    }

    if (pendingItems.length === 0 && !loading) {
        return (
            <View style={styles.emptyContainer}>
                <MaterialCommunityIcons name="check-all" size={80} color={COLORS.primary} />
                <Text style={styles.emptyTitle}>All Caught Up!</Text>
                <Text style={styles.emptyText}>You've reviewed all pending changes.</Text>
                <View style={styles.statsRow}>
                    <View style={styles.stat}>
                        <Text style={styles.statNum}>{approvedCount}</Text>
                        <Text style={styles.statLabel}>Approved</Text>
                    </View>
                </View>
                <TouchableOpacity onPress={onBack} style={styles.goBackBtn}>
                    <Text style={styles.goBackText}>Return to Dashboard</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.text} />
                </TouchableOpacity>
                <View>
                    <Text style={styles.headerTitle}>Review</Text>
                    <Text style={styles.headerSubtitle}>{pendingItems.length} Pending Approval</Text>
                </View>
                <TouchableOpacity style={styles.filterBtn}>
                    <MaterialCommunityIcons name="filter-variant" size={24} color={COLORS.text} />
                </TouchableOpacity>
            </View>

            <FlatList
                data={pendingItems}
                renderItem={renderReviewCard}
                keyExtractor={(item) => item.Id}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
            />

            {/* Bottom Floating Action Bar if multiple items */}
            {pendingItems.length > 3 && (
                <LinearGradient
                    colors={['rgba(255,255,255,0)', '#f8f9fa']}
                    style={styles.floatingBar}
                    pointerEvents="box-none"
                >
                    <TouchableOpacity
                        style={styles.approveAllBtn}
                        onPress={() => {
                            Alert.alert('Approve All?', `Are you sure you want to approve all ${pendingItems.length} changes?`, [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                    text: 'Yes, Approve All',
                                    onPress: () => {
                                        setApprovedCount(c => c + pendingItems.length);
                                        setPendingItems([]);
                                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                                    }
                                }
                            ])
                        }}
                    >
                        <Text style={styles.approveAllText}>Approve All ({pendingItems.length})</Text>
                        <MaterialCommunityIcons name="check-all" size={20} color="#fff" />
                    </TouchableOpacity>
                </LinearGradient>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 60,
        paddingHorizontal: 20,
        paddingBottom: 20,
        backgroundColor: COLORS.surface,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
        zIndex: 10,
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: COLORS.text,
        textAlign: 'center',
    },
    headerSubtitle: {
        fontSize: 12,
        color: COLORS.textLight,
        textAlign: 'center',
    },
    filterBtn: {
        padding: 4,
    },
    listContent: {
        padding: 16,
        paddingBottom: 100,
    },
    card: {
        backgroundColor: COLORS.surface,
        borderRadius: 16,
        marginBottom: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
        overflow: 'hidden',
    },
    cardHeader: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f1f3f5',
    },
    productBrief: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    thumb: {
        width: 48,
        height: 48,
        borderRadius: 8,
        marginRight: 12,
        backgroundColor: '#f1f3f5',
    },
    thumbPlaceholder: {
        width: 48,
        height: 48,
        borderRadius: 8,
        marginRight: 12,
        backgroundColor: '#f1f3f5',
    },
    briefTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: COLORS.text,
        marginBottom: 4,
    },
    changeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: COLORS.primary,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 12,
        gap: 4,
    },
    changeBadgeText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: 'bold',
    },
    diffContainer: {
        padding: 16,
        backgroundColor: '#fafafa',
    },
    diffBlock: {
        marginBottom: 16,
    },
    diffLabel: {
        fontSize: 10,
        fontWeight: '900',
        color: COLORS.textLight,
        marginBottom: 6,
        letterSpacing: 1,
    },
    oldText: {
        fontSize: 14,
        color: COLORS.textLight,
        textDecorationLine: 'line-through',
        marginBottom: 4,
    },
    newTextBlock: {
        backgroundColor: COLORS.diffAdd,
        padding: 10,
        borderRadius: 8,
        borderLeftWidth: 3,
        borderLeftColor: COLORS.diffText,
    },
    newText: {
        fontSize: 14,
        color: COLORS.diffText,
        lineHeight: 20,
    },
    arrowContainer: {
        alignItems: 'center',
        marginVertical: 4,
    },
    cardActions: {
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: '#f1f3f5',
    },
    actionBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        gap: 8,
    },
    rejectBtn: {
        backgroundColor: '#fff',
    },
    approveBtn: {
        backgroundColor: '#fff',
    },
    actionText: {
        fontWeight: 'bold',
        fontSize: 14,
    },
    divider: {
        width: 1,
        backgroundColor: '#f1f3f5',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    emptyTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: COLORS.text,
        marginTop: 20,
        marginBottom: 8,
    },
    emptyText: {
        fontSize: 16,
        color: COLORS.textLight,
        textAlign: 'center',
        marginBottom: 30,
    },
    statsRow: {
        marginBottom: 40,
    },
    stat: {
        alignItems: 'center',
    },
    statNum: {
        fontSize: 32,
        fontWeight: '900',
        color: COLORS.primary,
    },
    statLabel: {
        fontSize: 14,
        color: COLORS.textLight,
    },
    goBackBtn: {
        paddingVertical: 12,
        paddingHorizontal: 24,
        backgroundColor: '#f1f3f5',
        borderRadius: 20,
    },
    goBackText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: COLORS.text,
    },
    floatingBar: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 20,
        paddingBottom: 40,
        alignItems: 'center',
    },
    approveAllBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.primary,
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderRadius: 30,
        gap: 8,
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    approveAllText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
});
