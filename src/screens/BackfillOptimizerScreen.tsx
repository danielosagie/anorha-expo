// ... imports remain the same, ensuring MaterialCommunityIcons is used
import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    Animated,
    Dimensions,
    Image,
    Platform,
    ScrollView,
    LayoutAnimation,
    UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { ensureSupabaseJwt, supabase } from '../lib/supabase';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

import { OptimizerProgressRing } from '../components/optimizer/OptimizerProgressRing';
import { OptimizerTieredCard, OptimizerTier } from '../components/optimizer/OptimizerTieredCard';
import { OptimizerProductDetailSheet } from '../components/optimizer/OptimizerProductDetailSheet';
import { OptimizerBatchGenerateView } from '../components/optimizer/OptimizerBatchGenerateView';
import { OptimizerPhotoModeView } from '../components/optimizer/OptimizerPhotoModeView';
import { OptimizerReviewModeView } from '../components/optimizer/OptimizerReviewModeView';
import { OptimizerCelebration } from '../components/optimizer/OptimizerCelebration';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width } = Dimensions.get('window');

const COLORS = {
    primary: '#8cc63f',
    primaryDark: '#70a826',
    secondary: '#58cc02',
    accent: '#ffc800',
    background: '#f8f9fa',
    surface: '#ffffff',
    text: '#1a1a1a',
    textLight: '#6c757d',
    border: '#e9ecef',
    purple: '#845ef7',
    orange: '#fa5252',
    blue: '#228be6',
    success: '#28a745',
    warning: '#ffc107',
};

type OptimizerMode = 'dashboard' | 'batch' | 'photo' | 'review';
type FilterType = 'all' | 'urgent' | 'quick_wins';

export function BackfillOptimizerScreen() {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const route = useRoute<any>();
    const { getToken } = useAuth();
    const newlyImportedIds: string[] = Array.isArray(route.params?.newlyImportedIds) ? route.params.newlyImportedIds : [];
    const newlyImportedSet = React.useMemo(() => new Set(newlyImportedIds), [newlyImportedIds]);

    const [loading, setLoading] = useState(true);
    const [mode, setMode] = useState<OptimizerMode>('dashboard');
    const [filter, setFilter] = useState<FilterType>('all');
    const [showCelebration, setShowCelebration] = useState(false);

    // Data buckets
    const [allProducts, setAllProducts] = useState<any[]>([]);
    const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
    const [overallCompleteness, setOverallCompleteness] = useState(0);
    const [estimatedTime, setEstimatedTime] = useState(0);

    // Detail Sheet State
    const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
    const [isDetailSheetVisible, setIsDetailSheetVisible] = useState(false);

    const fetchData = async () => {
        try {
            await ensureSupabaseJwt();

            const { data, error } = await supabase
                .from('ProductVariants')
                .select(`
                    Id, Title, Description, Sku,
                    ProductImages:ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl)
                `)
                .limit(50);

            if (error) throw error;
            if (!data) return;

            // Tiering Logic
            const tieredData = data.map(p => {
                const needsPhotos = !p.ProductImages || p.ProductImages.length < 2;
                const needsContent = !p.Description || p.Description.length < 50;

                let tier: OptimizerTier = 'standard';
                if (needsPhotos) tier = 'urgent';
                else if (needsContent) tier = 'warning';

                return { ...p, tier };
            });

            setAllProducts(tieredData);

            // Health Calc
            const issues = tieredData.filter(p => !completedIds.has(p.Id) && p.tier !== 'standard').length;
            const score = Math.max(0, Math.round(((tieredData.length - issues) / tieredData.length) * 100));
            setOverallCompleteness(score);

            // Time Estimate (2m for urgent, 30s for warning)
            const urgentCount = tieredData.filter(p => !completedIds.has(p.Id) && p.tier === 'urgent').length;
            const warningCount = tieredData.filter(p => !completedIds.has(p.Id) && p.tier === 'warning').length;
            setEstimatedTime(Math.ceil((urgentCount * 2) + (warningCount * 0.5)));

        } catch (error) {
            console.error('[BackfillOptimizer] Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    // Use .size to avoid infinite loop (Set reference changes on every render)
    const completedCount = completedIds.size;
    useEffect(() => {
        fetchData();
    }, [completedCount]);

    const switchMode = (newMode: OptimizerMode) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setMode(newMode);
    };

    const handleComplete = (ids: string[]) => {
        setCompletedIds(prev => new Set([...prev, ...ids]));
        switchMode('dashboard');
        // Re-calc completeness or just toast
        setShowCelebration(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };

    const openProductDetail = (product: any) => {
        setSelectedProduct(product);
        setIsDetailSheetVisible(true);
    };

    // --- SUB-VIEWS ---
    if (mode === 'batch') {
        return <OptimizerBatchGenerateView onBack={() => switchMode('dashboard')} onComplete={handleComplete} />;
    }
    if (mode === 'photo') {
        return <OptimizerPhotoModeView onBack={() => switchMode('dashboard')} onComplete={handleComplete} />;
    }
    if (mode === 'review') {
        return <OptimizerReviewModeView onBack={() => switchMode('dashboard')} />;
    }

    const filteredItems = allProducts.filter(item => {
        if (filter === 'urgent') return item.tier === 'urgent';
        if (filter === 'quick_wins') return item.tier === 'warning';
        return true;
    }).sort((a, b) => {
        const priority = { urgent: 0, warning: 1, standard: 2, completed: 3 };
        if (newlyImportedSet.has(a.Id) && !newlyImportedSet.has(b.Id)) return -1;
        if (!newlyImportedSet.has(a.Id) && newlyImportedSet.has(b.Id)) return 1;
        const tierA = completedIds.has(a.Id) ? 'completed' : a.tier;
        const tierB = completedIds.has(b.Id) ? 'completed' : b.tier;
        return priority[tierA as keyof typeof priority] - priority[tierB as keyof typeof priority];
    });

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Optimizer</Text>
                <View style={styles.headerActionPlaceholder} />
            </View>

            {loading ? (
                <View style={styles.loadingWrapper}>
                    <ActivityIndicator size="small" color={COLORS.primary} />
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
                    {newlyImportedIds.length > 0 && (
                        <View style={styles.importBanner}>
                            <MaterialCommunityIcons name="sparkles" size={18} color={COLORS.primaryDark} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.importBannerTitle}>
                                    {newlyImportedIds.length} newly imported items are prioritized
                                </Text>
                                <Text style={styles.importBannerSub}>
                                    Tap any item, then open Product Detail to edit with the full listing editor.
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={styles.importBannerButton}
                                onPress={() => {
                                    const firstId = newlyImportedIds[0];
                                    if (firstId) {
                                        navigation.navigate('ProductDetail', { productId: firstId } as any);
                                    }
                                }}
                            >
                                <Text style={styles.importBannerButtonText}>Edit First</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Ring Overview */}
                    <View style={styles.overviewSection}>
                        <OptimizerProgressRing progress={overallCompleteness / 100} />
                        <View style={styles.taglineWrapper}>
                            <Text style={styles.tagline}>Let's get your products{'\n'}looking their best</Text>
                            <View style={styles.timeBadge}>
                                <MaterialCommunityIcons name="timer-outline" size={14} color={COLORS.textLight} />
                                <Text style={styles.timeText}>~{estimatedTime} min to complete</Text>
                            </View>
                        </View>
                    </View>

                    {/* Filter Chips */}
                    <View style={styles.filterRow}>
                        {[
                            { id: 'all', label: 'All Jobs' },
                            { id: 'urgent', label: 'Urgent' },
                            { id: 'quick_wins', label: 'Quick Wins' },
                        ].map(f => (
                            <TouchableOpacity
                                key={f.id}
                                style={[styles.filterChip, filter === f.id && styles.activeChip]}
                                onPress={() => {
                                    Haptics.selectionAsync();
                                    setFilter(f.id as FilterType);
                                }}
                            >
                                <Text style={[styles.chipText, filter === f.id && styles.activeChipText]}>{f.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* Tiered List */}
                    <View style={styles.listContainer}>
                        {filteredItems.map(item => (
                            <OptimizerTieredCard
                                key={item.Id}
                                item={item}
                                tier={completedIds.has(item.Id) ? 'completed' : item.tier}
                                onPress={() => openProductDetail(item)}
                                onAction={() => {
                                    if (newlyImportedSet.has(item.Id)) {
                                        navigation.navigate('ProductDetail', { productId: item.Id } as any);
                                        return;
                                    }
                                    switchMode(item.tier === 'urgent' ? 'photo' : 'batch');
                                }}
                            />
                        ))}

                        {filteredItems.length === 0 && (
                            <View style={styles.emptyState}>
                                <MaterialCommunityIcons name="party-popper" size={48} color={COLORS.primary} />
                                <Text style={styles.emptyTitle}>All products optimized! 🎉</Text>
                                <Text style={styles.emptySub}>Your listings are 50% more likely to convert</Text>
                                <View style={styles.emptyActions}>
                                    <TouchableOpacity style={styles.emptyActionBtn} onPress={() => switchMode('review')}>
                                        <Text style={styles.emptyActionText}>Review all photos</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={[styles.emptyActionBtn, styles.emptyActionBtnSecondary]} onPress={() => navigation.navigate('Inventory')}>
                                        <Text style={[styles.emptyActionText, { color: COLORS.textLight }]}>Add new products</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </View>
                    <View style={{ height: 80 }} />
                </ScrollView>
            )}

            <OptimizerProductDetailSheet
                isVisible={isDetailSheetVisible}
                onClose={() => setIsDetailSheetVisible(false)}
                product={selectedProduct}
                onStartSession={() => {
                    setIsDetailSheetVisible(false);
                    if (selectedProduct?.Id) {
                        navigation.navigate('ProductDetail', { productId: selectedProduct.Id } as any);
                        return;
                    }
                    switchMode(selectedProduct?.tier === 'urgent' ? 'photo' : 'batch');
                }}
            />
            {showCelebration && <OptimizerCelebration onComplete={() => setShowCelebration(false)} />}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        height: 60,
    },
    backButton: {
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 18,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: COLORS.text,
    },
    headerActionPlaceholder: {
        width: 36,
    },
    loadingWrapper: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    scrollContainer: {
        paddingTop: 10,
    },
    importBanner: {
        marginHorizontal: 20,
        marginBottom: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#dcefd0',
        backgroundColor: '#f4fbe9',
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    importBannerTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#355b12',
    },
    importBannerSub: {
        fontSize: 11,
        color: '#4b6f24',
        marginTop: 2,
    },
    importBannerButton: {
        backgroundColor: '#355b12',
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
    },
    importBannerButtonText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
    },
    overviewSection: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 24,
        marginBottom: 32,
        gap: 20,
    },
    taglineWrapper: {
        flex: 1,
    },
    tagline: {
        fontSize: 18,
        fontWeight: '800',
        color: COLORS.text,
        lineHeight: 24,
        marginBottom: 8,
    },
    timeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: '#eee',
        gap: 6,
    },
    timeText: {
        fontSize: 11,
        fontWeight: '600',
        color: COLORS.textLight,
    },
    filterRow: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        marginBottom: 20,
        gap: 10,
    },
    filterChip: {
        backgroundColor: '#fff',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#eee',
    },
    activeChip: {
        backgroundColor: COLORS.text,
        borderColor: COLORS.text,
    },
    chipText: {
        fontSize: 13,
        fontWeight: '700',
        color: COLORS.textLight,
    },
    activeChipText: {
        color: '#fff',
    },
    listContainer: {
        paddingHorizontal: 20,
    },
    emptyState: {
        alignItems: 'center',
        padding: 40,
        marginTop: 20,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: COLORS.text,
        marginTop: 16,
        marginBottom: 4,
    },
    emptySub: {
        fontSize: 14,
        color: COLORS.textLight,
        textAlign: 'center',
    },
    emptyActions: {
        marginTop: 24,
        gap: 12,
        width: '100%',
    },
    emptyActionBtn: {
        backgroundColor: COLORS.text,
        height: 50,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyActionBtnSecondary: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#eee',
    },
    emptyActionText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
    },
});

