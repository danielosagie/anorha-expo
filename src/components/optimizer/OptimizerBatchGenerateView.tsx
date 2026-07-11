import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    FlatList,
    Image,
    ActivityIndicator,
    Dimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ensureSupabaseJwt, supabase } from '../../lib/supabase';
import { createLogger } from '../../utils/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RC } from '../resolve/ResolveKit';
import ErrorModal from '../ErrorModal';
import { useBatchGenerate, BatchItemStatus, BatchGenerateInput } from '../../hooks/useBatchGenerate';
const log = createLogger('OptimizerBatchGenerateView');


const { width } = Dimensions.get('window');

interface OptimizerBatchGenerateViewProps {
    onBack: () => void;
    onComplete: (ids: string[]) => void;
    /** When provided, use this list instead of fetching (real data-needed queue from useOptimizerQueues) */
    queueProducts?: any[];
}

export function OptimizerBatchGenerateView({ onBack, onComplete, queueProducts }: OptimizerBatchGenerateViewProps) {
    const insets = useSafeAreaInsets();
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [modal, setModal] = useState<{ visible: boolean; type: 'error' | 'warning'; title: string; message: string }>(
        { visible: false, type: 'warning', title: '', message: '' },
    );

    // Real bulk generation: submit → poll job → persist to ProductVariants.
    const batch = useBatchGenerate();
    const isGenerating = batch.phase === 'running';
    const isSettled = batch.phase === 'settled';

    useEffect(() => {
        if (queueProducts && queueProducts.length > 0) {
            setProducts(queueProducts);
            const initialSelection = new Set<string>();
            queueProducts.slice(0, 5).forEach((p: any) => initialSelection.add(p.Id));
            setSelectedIds(initialSelection);
            setLoading(false);
        } else {
            loadBatchCandidates();
        }
    }, []);

    const loadBatchCandidates = async () => {
        try {
            await ensureSupabaseJwt();
            const { data, error } = await supabase
                .from('ProductVariants')
                .select(`
                    Id, Title, Sku, Price,
                    ProductImages:ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl)
                `)
                .limit(100);

            if (error) throw error;
            const list = data || [];
            setProducts(list);
            const initialSelection = new Set<string>();
            list.slice(0, 5).forEach((p: any) => initialSelection.add(p.Id));
            setSelectedIds(initialSelection);
        } catch (err) {
            log.error('[BatchMode] Error loading', err);
            setModal({ visible: true, type: 'error', title: 'Couldn’t load items', message: 'Failed to load products for batch generation.' });
        } finally {
            setLoading(false);
        }
    };

    // Selection is locked once generation starts (and while a partial-failure
    // result is on screen) — the user acts via Retry / Continue instead.
    const selectionLocked = isGenerating || isSettled;

    const toggleSelection = (id: string) => {
        if (selectionLocked) return;
        // Haptic feedback for selection
        Haptics.selectionAsync();

        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const toggleSelectAll = () => {
        if (selectionLocked) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        if (selectedIds.size === products.length) {
            setSelectedIds(new Set());
        } else {
            const allIds = new Set(products.map(p => p.Id));
            setSelectedIds(allIds);
        }
    };

    const buildInputs = (ids: string[]): BatchGenerateInput[] =>
        ids
            .map((id) => products.find((p) => p.Id === id))
            .filter(Boolean)
            .map((p: any) => ({
                variantId: p.Id,
                imageUrls: ((p.ProductImages as any[]) || [])
                    .map((img) => img?.ImageUrl)
                    .filter((u: any) => typeof u === 'string'),
                existingTitle: p.Title || '',
                existingDescription: p.Description || '',
            }));

    const handleGenerate = () => {
        if (selectedIds.size === 0 || isGenerating) return;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setModal((m) => ({ ...m, visible: false }));
        void batch.run(buildInputs(Array.from(selectedIds)));
    };

    const handleRetryFailed = () => {
        if (isGenerating || batch.failedIds.length === 0) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setModal((m) => ({ ...m, visible: false }));
        void batch.run(buildInputs(batch.failedIds));
    };

    // When the batch settles: all-success → hand the done ids up (advances to the
    // review step). Any failures → surface ONE summary and keep the failed items
    // here (unmarked) so the user can retry or continue with what worked.
    useEffect(() => {
        if (batch.phase !== 'settled') return;
        if (batch.failedIds.length === 0 && batch.doneIds.length > 0) {
            onComplete(batch.doneIds);
        } else if (batch.failedIds.length > 0) {
            setModal({
                visible: true,
                type: 'warning',
                title: 'Some items need another try',
                message: batch.errorSummary || 'A few items couldn’t be generated.',
            });
        }
        // onComplete intentionally omitted: it navigates away, so re-firing on its
        // identity change would double-advance.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [batch.phase, batch.failedIds.length, batch.doneIds.length, batch.errorSummary]);

    const renderItem = ({ item }: { item: any }) => {
        const isSelected = selectedIds.has(item.Id);
        const image = item.ProductImages?.[0]?.ImageUrl;
        const status: BatchItemStatus | undefined = batch.statuses[item.Id];
        const locked = selectionLocked;

        return (
            <TouchableOpacity
                style={[
                    styles.itemCard,
                    isSelected && !status && styles.itemCardSelected,
                    status === 'done' && styles.itemCardDone,
                    status === 'failed' && styles.itemCardFailed,
                ]}
                onPress={() => toggleSelection(item.Id)}
                activeOpacity={locked ? 1 : 0.7}
                disabled={locked}
            >
                <View style={styles.checkboxContainer}>
                    {status === 'done' ? (
                        <View style={styles.statusDoneDot}>
                            <MaterialCommunityIcons name="check" size={16} color="#fff" />
                        </View>
                    ) : status === 'failed' ? (
                        <View style={styles.statusFailedDot}>
                            <MaterialCommunityIcons name="alert" size={14} color="#fff" />
                        </View>
                    ) : status === 'generating' || status === 'queued' ? (
                        <ActivityIndicator size="small" color={RC.green} />
                    ) : (
                        <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                            {isSelected && <MaterialCommunityIcons name="check" size={16} color="#fff" />}
                        </View>
                    )}
                </View>

                {image ? (
                    <Image source={{ uri: image }} style={styles.itemImage} />
                ) : (
                    <View style={styles.itemImagePlaceholder}>
                        <MaterialCommunityIcons name="image-off" size={20} color="#ccc" />
                    </View>
                )}

                <View style={styles.itemInfo}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{item.Title || 'Untitled item'}</Text>
                    <Text style={styles.itemSku}>{item.Sku || 'No SKU'}</Text>

                    {status === 'failed' ? (
                        <Text style={styles.statusFailedText}>Couldn’t generate — retry</Text>
                    ) : status === 'done' ? (
                        <Text style={styles.statusDoneText}>Details generated</Text>
                    ) : status === 'generating' || status === 'queued' ? (
                        <Text style={styles.statusGenText}>Generating…</Text>
                    ) : (
                        /* Tags showing what will be generated */
                        <View style={styles.tagsRow}>
                            <View style={styles.tag}>
                                <MaterialCommunityIcons name="format-title" size={12} color={RC.green} />
                                <Text style={styles.tagText}>Title</Text>
                            </View>
                            <View style={styles.tag}>
                                <MaterialCommunityIcons name="text-short" size={12} color={RC.green} />
                                <Text style={styles.tagText}>Desc</Text>
                            </View>
                        </View>
                    )}
                </View>
            </TouchableOpacity>
        );
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={RC.green} />
                <Text style={{ marginTop: 10, color: RC.muted }}>Loading candidates...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <TouchableOpacity onPress={onBack} style={styles.backButton} disabled={isGenerating}>
                    <MaterialCommunityIcons name="close" size={24} color={isGenerating ? RC.faint : RC.ink} />
                </TouchableOpacity>
                <View>
                    <Text style={styles.headerTitle}>Batch Magic</Text>
                    <Text style={styles.headerSubtitle}>Select items to optimize</Text>
                </View>
                <View style={{ width: 40 }} />
            </View>

            {/* Selection Toolbar */}
            <View style={styles.toolbar}>
                <TouchableOpacity style={styles.selectAllBtn} onPress={toggleSelectAll}>
                    <View style={[styles.checkbox, selectedIds.size === products.length && styles.checkboxChecked]}>
                        {selectedIds.size === products.length && <MaterialCommunityIcons name="check" size={16} color="#fff" />}
                    </View>
                    <Text style={styles.selectText}>
                        {selectedIds.size === products.length ? 'Deselect All' : 'Select All'}
                    </Text>
                </TouchableOpacity>
                <Text style={styles.countText}>{selectedIds.size} selected</Text>
            </View>

            {/* Product List */}
            <FlatList
                data={products}
                renderItem={renderItem}
                keyExtractor={(item) => item.Id}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
            />

            {/* Bottom Action Footer */}
            <View style={styles.footer}>
                {isSettled && batch.failedIds.length > 0 ? (
                    <>
                        <TouchableOpacity
                            style={styles.generateButton}
                            onPress={handleRetryFailed}
                            disabled={isGenerating}
                        >
                            <LinearGradient
                                colors={[RC.green, RC.greenDark]}
                                style={styles.gradientBtn}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                            >
                                <MaterialCommunityIcons name="refresh" size={22} color="#fff" />
                                <Text style={styles.generateBtnText}>Retry {batch.failedIds.length} failed</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                        {batch.doneIds.length > 0 && (
                            <TouchableOpacity style={styles.continueBtn} onPress={() => onComplete(batch.doneIds)}>
                                <Text style={styles.continueBtnText}>Continue with {batch.doneIds.length} done</Text>
                            </TouchableOpacity>
                        )}
                    </>
                ) : (
                    <TouchableOpacity
                        style={[
                            styles.generateButton,
                            (selectedIds.size === 0 || isGenerating) && styles.generateButtonDisabled
                        ]}
                        onPress={handleGenerate}
                        disabled={selectedIds.size === 0 || isGenerating}
                    >
                        <LinearGradient
                            colors={selectedIds.size > 0 || isGenerating ? [RC.green, RC.greenDark] : ['#e9ecef', '#ced4da']}
                            style={styles.gradientBtn}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                        >
                            {isGenerating ? (
                                <>
                                    <ActivityIndicator color="#fff" />
                                    <Text style={styles.generateBtnText}>
                                        Generating{batch.totalCount > 0 ? ` ${Math.min(batch.progressCount, batch.totalCount)}/${batch.totalCount}` : ''}…
                                    </Text>
                                </>
                            ) : (
                                <>
                                    <MaterialCommunityIcons
                                        name="auto-fix"
                                        size={24}
                                        color={selectedIds.size > 0 ? "#fff" : "#adb5bd"}
                                    />
                                    <Text style={[
                                        styles.generateBtnText,
                                        selectedIds.size === 0 && styles.textDisabled
                                    ]}>
                                        Generate for {selectedIds.size} Items
                                    </Text>
                                </>
                            )}
                        </LinearGradient>
                    </TouchableOpacity>
                )}
            </View>

            <ErrorModal
                visible={modal.visible}
                type={modal.type}
                title={modal.title}
                message={modal.message}
                buttonText="OK"
                onClose={() => setModal((m) => ({ ...m, visible: false }))}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: RC.surface,
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
        paddingHorizontal: 20,
        paddingBottom: 20,
        backgroundColor: RC.bg,
        borderBottomWidth: 1,
        borderBottomColor: RC.line,
    },
    backButton: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f1f3f5',
        borderRadius: 20,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: RC.ink,
        textAlign: 'center',
    },
    headerSubtitle: {
        fontSize: 12,
        color: RC.muted,
        textAlign: 'center',
    },
    toolbar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 12,
        backgroundColor: RC.bg,
        borderBottomWidth: 1,
        borderBottomColor: RC.line,
    },
    selectAllBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    selectText: {
        fontSize: 14,
        fontWeight: '600',
        color: RC.ink,
    },
    countText: {
        fontSize: 14,
        color: RC.muted,
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: '#adb5bd',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
    },
    checkboxChecked: {
        backgroundColor: RC.green,
        borderColor: RC.green,
    },
    checkboxContainer: {
        marginRight: 12,
    },
    listContent: {
        padding: 16,
        paddingBottom: 100,
    },
    itemCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: RC.bg,
        padding: 12,
        borderRadius: 12,
        marginBottom: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    itemCardSelected: {
        borderColor: RC.green,
        backgroundColor: '#fbfdf8',
    },
    itemCardDone: {
        borderColor: RC.greenLine,
        backgroundColor: RC.greenSoft,
    },
    itemCardFailed: {
        borderColor: RC.dangerLine,
        backgroundColor: RC.dangerSoft,
    },
    statusDoneDot: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: RC.green,
        justifyContent: 'center',
        alignItems: 'center',
    },
    statusFailedDot: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: RC.danger,
        justifyContent: 'center',
        alignItems: 'center',
    },
    statusDoneText: {
        fontSize: 12,
        fontWeight: '700',
        color: RC.greenDark,
    },
    statusFailedText: {
        fontSize: 12,
        fontWeight: '700',
        color: RC.dangerInk,
    },
    statusGenText: {
        fontSize: 12,
        fontWeight: '600',
        color: RC.muted,
    },
    itemImage: {
        width: 50,
        height: 50,
        borderRadius: 8,
        marginRight: 12,
        backgroundColor: '#f1f3f5',
    },
    itemImagePlaceholder: {
        width: 50,
        height: 50,
        borderRadius: 8,
        marginRight: 12,
        backgroundColor: '#f1f3f5',
        justifyContent: 'center',
        alignItems: 'center',
    },
    itemInfo: {
        flex: 1,
    },
    itemTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: RC.ink,
        marginBottom: 2,
    },
    itemSku: {
        fontSize: 12,
        color: RC.muted,
        marginBottom: 6,
    },
    tagsRow: {
        flexDirection: 'row',
        gap: 6,
    },
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ecfccb', // light green
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        gap: 4,
    },
    tagText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#4d7c0f',
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 20,
        backgroundColor: RC.bg,
        borderTopWidth: 1,
        borderTopColor: RC.line,
        paddingBottom: 40,
    },
    generateButton: {
        borderRadius: 16,
        overflow: 'hidden',
        height: 56,
        shadowColor: RC.green,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
    },
    generateButtonDisabled: {
        shadowOpacity: 0,
        elevation: 0,
    },
    gradientBtn: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 10,
    },
    generateBtnText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#fff',
    },
    textDisabled: {
        color: '#868e96',
    },
    continueBtn: {
        height: 48,
        marginTop: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    continueBtnText: {
        fontSize: 15,
        fontWeight: '600',
        color: RC.muted,
    },
});
