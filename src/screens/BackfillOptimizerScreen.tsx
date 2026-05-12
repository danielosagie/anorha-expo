import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    Dimensions,
    Platform,
    ScrollView,
    LayoutAnimation,
    UIManager,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { OptimizerTieredCard, OptimizerTier } from '../components/optimizer/OptimizerTieredCard';
import { OptimizerProductDetailSheet } from '../components/optimizer/OptimizerProductDetailSheet';
import { OptimizerBatchGenerateView } from '../components/optimizer/OptimizerBatchGenerateView';
import { OptimizerPhotoModeView } from '../components/optimizer/OptimizerPhotoModeView';
import { OptimizerReviewModeView } from '../components/optimizer/OptimizerReviewModeView';
import { OptimizerCelebration } from '../components/optimizer/OptimizerCelebration';
import PillTabs from '../components/ui/PillTabs';
import { useOptimizerQueues, OptimizerQueue } from '../hooks/useOptimizerQueues';

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
type QueueTab = 'all' | OptimizerQueue;

export function BackfillOptimizerScreen() {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const route = useRoute<any>();
    const newlyImportedIds: string[] = Array.isArray(route.params?.newlyImportedIds) ? route.params.newlyImportedIds : [];
    const newlyImportedSet = React.useMemo(() => new Set(newlyImportedIds), [newlyImportedIds]);

    const [mode, setMode] = useState<OptimizerMode>('dashboard');
    const [queueTab, setQueueTab] = useState<QueueTab>('all');
    const [showCelebration, setShowCelebration] = useState(false);
    const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const {
        loading,
        products,
        counts,
        photoNeededItems,
        dataNeededItems,
        manualQueueItems,
        refresh,
    } = useOptimizerQueues({ limit: 100 });

    // Detail Sheet State
    const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
    const [isDetailSheetVisible, setIsDetailSheetVisible] = useState(false);

    const completedCount = completedIds.size;
    useEffect(() => {
        if (completedCount > 0) refresh();
    }, [completedCount, refresh]);

    const switchMode = (newMode: OptimizerMode) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setMode(newMode);
    };

    const handleComplete = (ids: string[]) => {
        setCompletedIds(prev => new Set([...prev, ...ids]));
        setIsSelectMode(false);
        setSelectedIds(new Set());
        switchMode('dashboard');
        // Re-calc completeness or just toast
        setShowCelebration(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };

    const toggleSelect = (id: string) => {
        Haptics.selectionAsync();
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const openProductDetail = (product: any) => {
        setSelectedProduct(product);
        setIsDetailSheetVisible(true);
    };

    // --- SUB-VIEWS ---
    const getQueuedProducts = (fullList: any[]) => {
        if (!isSelectMode || selectedIds.size === 0) return fullList.filter(i => !completedIds.has(i.Id));
        return fullList.filter(i => selectedIds.has(i.Id) && !completedIds.has(i.Id));
    };

    if (mode === 'batch') {
        return (
            <OptimizerBatchGenerateView
                onBack={() => switchMode('dashboard')}
                onComplete={handleComplete}
                queueProducts={getQueuedProducts(dataNeededItems)}
            />
        );
    }
    if (mode === 'photo') {
        return (
            <OptimizerPhotoModeView
                onBack={() => switchMode('dashboard')}
                onComplete={handleComplete}
                queueProducts={getQueuedProducts(photoNeededItems)}
            />
        );
    }
    if (mode === 'review') {
        return (
            <OptimizerReviewModeView
                onBack={() => switchMode('dashboard')}
                queueProducts={getQueuedProducts(manualQueueItems)}
            />
        );
    }

    const queueToTier: Record<OptimizerQueue, OptimizerTier> = {
        'photo-needed': 'urgent',
        'data-needed': 'warning',
        'manual-queue': 'standard',
    };

    const queueItems = queueTab === 'all'
        ? products
        : queueTab === 'photo-needed'
            ? photoNeededItems
            : queueTab === 'data-needed'
                ? dataNeededItems
                : manualQueueItems;

    const filteredItems = [...queueItems].sort((a, b) => {
        if (newlyImportedSet.has(a.Id) && !newlyImportedSet.has(b.Id)) return -1;
        if (!newlyImportedSet.has(a.Id) && newlyImportedSet.has(b.Id)) return 1;
        const tierA = completedIds.has(a.Id) ? 'completed' : queueToTier[a.queue];
        const tierB = completedIds.has(b.Id) ? 'completed' : queueToTier[b.queue];
        const priority = { urgent: 0, warning: 1, standard: 2, completed: 3 };
        return priority[tierA] - priority[tierB];
    });

    const handleSelectAll = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const uncompletedFiltered = filteredItems.filter(item => !completedIds.has(item.Id));
        if (selectedIds.size === uncompletedFiltered.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(uncompletedFiltered.map(i => i.Id)));
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                {isSelectMode ? (
                    <>
                        <TouchableOpacity onPress={() => { setIsSelectMode(false); setSelectedIds(new Set()); }} style={styles.headerBtnText}>
                            <Text style={styles.headerActionText}>Cancel</Text>
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>{selectedIds.size} Selected</Text>
                        <TouchableOpacity onPress={handleSelectAll} style={styles.headerBtnText}>
                            <Text style={[styles.headerActionText, { fontWeight: '600', color: COLORS.primaryDark }]}>Select All</Text>
                        </TouchableOpacity>
                    </>
                ) : (
                    <>
                        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                            <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.text} />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Inbox</Text>
                        <TouchableOpacity onPress={() => setIsSelectMode(true)} style={styles.headerBtnText}>
                            <Text style={styles.headerActionText}>Select</Text>
                        </TouchableOpacity>
                    </>
                )}
            </View>

            {loading ? (
                <View style={styles.loadingWrapper}>
                    <ActivityIndicator size="small" color={COLORS.primary} />
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
                    {newlyImportedIds.length > 0 && (
                        <View style={styles.importBanner}>
                            <MaterialCommunityIcons name="star-four-points" size={18} color={COLORS.primaryDark} />
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

                    {/* Queue Tabs */}
                    <View style={styles.pillTabsWrapper}>
                        <PillTabs
                            tabs={[
                                { key: 'all', label: 'All', count: products.length },
                                { key: 'photo-needed' as const, label: 'Photos', count: counts.photoNeeded, tone: 'danger' },
                                { key: 'data-needed' as const, label: 'Data', count: counts.dataNeeded, tone: 'warning' },
                                //{ key: 'manual-queue' as const, label: 'Manual', count: counts.manualQueue, tone: 'default' },
                            ]}
                            value={queueTab}
                            onChange={(key) => {
                                Haptics.selectionAsync();
                                setQueueTab(key as QueueTab);
                            }}
                        />
                    </View>

                    {/* Tiered List */}
                    <View style={styles.listContainer}>
                        {filteredItems.map(item => (
                            <OptimizerTieredCard
                                key={item.Id}
                                item={item}
                                tier={completedIds.has(item.Id) ? 'completed' : queueToTier[item.queue]}
                                selectable={isSelectMode && !completedIds.has(item.Id)}
                                selected={selectedIds.has(item.Id)}
                                onSelect={() => toggleSelect(item.Id)}
                                onLongPress={() => {
                                    if (!completedIds.has(item.Id) && !isSelectMode) {
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                        setIsSelectMode(true);
                                        setSelectedIds(new Set([item.Id]));
                                    }
                                }}
                                onPress={() => {
                                    if (isSelectMode && !completedIds.has(item.Id)) {
                                        toggleSelect(item.Id);
                                        return;
                                    }
                                    openProductDetail(item);
                                }}
                            />
                        ))}

                        {filteredItems.length === 0 && (
                            <View style={styles.emptyState}>
                                <View style={styles.emptyIconCircle}>
                                    <MaterialCommunityIcons name="check-all" size={48} color={COLORS.primary} />
                                </View>
                                <Text style={styles.emptyTitle}>Inbox Zero</Text>
                                <Text style={styles.emptySub}>All products are optimized and ready to sell! 🎉</Text>
                                <View style={styles.emptyActions}>
                                    <TouchableOpacity style={styles.emptyActionBtn} onPress={() => navigation.navigate('Inventory')}>
                                        <Text style={styles.emptyActionText}>Add new products</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </View>
                    <View style={{ height: 120 }} />
                </ScrollView>
            )}

            {queueTab !== 'all' && filteredItems.length > 0 && mode === 'dashboard' && (
                <View style={styles.fabContainer}>
                    <TouchableOpacity
                        style={[styles.fabBtn, queueTab === 'photo-needed' && styles.fabBtnUrgent]}
                        onPress={() => {
                            if (isSelectMode && selectedIds.size === 0) {
                                Alert.alert("No items selected", "Please select items first.");
                                return;
                            }
                            if (queueTab === 'photo-needed') switchMode('photo');
                            else if (queueTab === 'data-needed') switchMode('batch');
                            else switchMode('review');
                        }}
                    >
                        <MaterialCommunityIcons
                            name={queueTab === 'photo-needed' ? 'camera' : queueTab === 'data-needed' ? 'auto-fix' : 'playlist-check'}
                            size={20}
                            color={queueTab === 'photo-needed' ? '#fff' : '#1a1a1a'}
                        />
                        <Text style={[styles.fabText, queueTab === 'photo-needed' && { color: '#fff' }]}>
                            {isSelectMode && selectedIds.size > 0
                                ? `Start Queue (${selectedIds.size})`
                                : (queueTab === 'photo-needed' ? `Start All Photos` : queueTab === 'data-needed' ? `Start All Data` : `Review All`)
                            }
                        </Text>
                    </TouchableOpacity>
                </View>
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
                    const q = (selectedProduct as any)?.queue;
                    if (q === 'photo-needed') switchMode('photo');
                    else if (q === 'data-needed') switchMode('batch');
                    else switchMode('review');
                }}
            />
            {showCelebration && <OptimizerCelebration onComplete={() => setShowCelebration(false)} />}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff', //f8f9fa
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
    headerBtnText: {
        minWidth: 60,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerActionText: {
        fontSize: 15,
        color: COLORS.text,
        fontWeight: '400',
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
    pillTabsWrapper: {
        marginBottom: 20,
    },
    bulkActionBar: {
        paddingHorizontal: 20,
        marginBottom: 16,
    },
    bulkActionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.06)',
        borderRadius: 8,
        paddingVertical: 12,
    },
    bulkActionBtnUrgent: {
        backgroundColor: '#fa5252',
        borderColor: '#fa5252',
    },
    bulkActionText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1a1a1a',
    },
    listContainer: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(0,0,0,0.06)',
    },
    emptyState: {
        alignItems: 'center',
        padding: 40,
        marginTop: 40,
    },
    emptyIconCircle: {
        width: 90,
        height: 90,
        borderRadius: 45,
        backgroundColor: '#f4fbe9',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    emptyTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: COLORS.text,
        marginBottom: 8,
    },
    emptySub: {
        fontSize: 15,
        color: COLORS.textLight,
        textAlign: 'center',
    },
    emptyActions: {
        marginTop: 30,
        width: '100%',
    },
    emptyActionBtn: {
        backgroundColor: COLORS.text,
        height: 50,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyActionText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
    },
    fabContainer: {
        position: 'absolute',
        bottom: 30,
        left: 0,
        right: 0,
        alignItems: 'center',
        pointerEvents: 'box-none',
    },
    fabBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.06)',
        borderRadius: 30,
        paddingVertical: 14,
        paddingHorizontal: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 6,
    },
    fabBtnUrgent: {
        backgroundColor: '#fa5252',
        borderColor: '#fa5252',
    },
    fabText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1a1a1a',
    },
});

