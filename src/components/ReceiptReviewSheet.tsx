import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    Dimensions,
    TextInput,
    Alert,
    Modal,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, SlideInDown } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { ensureSupabaseJwt } from '../lib/supabase';
import { useJobStatus } from '../hooks/useJobStatus';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Types matching backend ReceiptItem
export interface ReceiptItem {
    id: string;
    rawText: string;
    parsedName: string;
    quantity: number;
    unitCost: number | null;
    sku: string | null;
    upc: string | null;
    matchedProduct: {
        id: string;
        variantId: string;
        title: string;
        sku: string | null;
        upc: string | null;
        currentQuantity: number;
        price: number | null;
    } | null;
    matchConfidence: 'high' | 'medium' | 'low' | 'none';
    matchType: 'UPC' | 'SKU' | 'TITLE' | 'AI' | 'NONE';
    action: 'UPDATE_EXISTING' | 'LINK_AND_UPDATE' | 'CREATE_NEW' | 'SKIP';
    isSelected: boolean;
    needsReview: boolean;
}

export interface ReceiptJobStatus {
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress: number;
    stage: 'parsing' | 'matching' | 'reranking' | 'done';
    items?: ReceiptItem[];
    error?: string;
}

interface ReceiptReviewSheetProps {
    jobId: string;
    onClose: () => void;
    onApplyUpdates?: (updates: Array<{ itemId: string; variantId: string; quantityToAdd: number }>) => void;
    onCreateNew?: (itemName: string) => void;
}

const API_URL = process.env.EXPO_PUBLIC_SSSYNC_BACKEND_URL || 'https://sssync-bknd.onrender.com';

const ReceiptReviewSheet: React.FC<ReceiptReviewSheetProps> = ({
    jobId,
    onClose,
    onApplyUpdates,
    onCreateNew,
}) => {
    const theme = useTheme();
    const [jobStatus, setJobStatus] = useState<ReceiptJobStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [items, setItems] = useState<ReceiptItem[]>([]);
    const [applying, setApplying] = useState(false);

    // Poll for job status
    const fetchJobStatus = useCallback(async () => {
        try {
            const jwt = await ensureSupabaseJwt();
            const response = await fetch(`${API_URL}/products/receipts/${jobId}/status`, {
                headers: { Authorization: `Bearer ${jwt}` },
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            setJobStatus(data);

            if (data.items) {
                setItems(data.items);
            }

            setLoading(false);
            return data.status;
        } catch (err: any) {
            setError(err.message);
            setLoading(false);
            return 'failed';
        }
    }, [jobId]);

    // Poll job status via the shared hook: AppState-aware (pauses while
    // backgrounded, polls on resume), de-duplicated, and auto-stops on a terminal
    // status. fetchJobStatus already owns the state side-effects and never throws,
    // so this is a behaviour-preserving timing-only swap.
    useJobStatus(jobId, fetchJobStatus, {
        intervalMs: 2000,
        getStatus: (status) => status,
    });

    // Toggle item selection
    const toggleItemSelection = (itemId: string) => {
        setItems(prev =>
            prev.map(item =>
                item.id === itemId ? { ...item, isSelected: !item.isSelected } : item
            )
        );
    };

    // Update item quantity
    const updateQuantity = (itemId: string, quantity: number) => {
        setItems(prev =>
            prev.map(item =>
                item.id === itemId ? { ...item, quantity } : item
            )
        );
    };

    // Get confidence badge color
    const getConfidenceColor = (confidence: 'high' | 'medium' | 'low' | 'none') => {
        switch (confidence) {
            case 'high': return '#4CAF50';
            case 'medium': return '#FF9800';
            case 'low': return '#f44336';
            case 'none': return '#9E9E9E';
        }
    };

    // Handle apply updates
    const handleApplyUpdates = async () => {
        const selectedItems = items.filter(i => i.isSelected && i.matchedProduct);
        if (selectedItems.length === 0) {
            Alert.alert('No Items', 'Please select items to update.');
            return;
        }

        setApplying(true);

        try {
            const jwt = await ensureSupabaseJwt();
            const updates = selectedItems.map(item => ({
                itemId: item.id,
                variantId: item.matchedProduct!.variantId,
                quantityToAdd: item.quantity,
            }));

            const response = await fetch(`${API_URL}/products/receipts/${jobId}/apply`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${jwt}`,
                },
                body: JSON.stringify({ updates }),
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const result = await response.json();
            Alert.alert(
                'Success!',
                `Updated ${result.updatedCount} items.`,
                [{ text: 'OK', onPress: onClose }]
            );
        } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to apply updates');
        } finally {
            setApplying(false);
        }
    };

    // Calculate totals
    const matchedItems = items.filter(i => i.matchedProduct);
    const unmatchedItems = items.filter(i => !i.matchedProduct);
    const selectedCount = items.filter(i => i.isSelected).length;

    return (
        <Animated.View
            entering={SlideInDown.duration(300)}
            style={[styles.container, { backgroundColor: theme.colors.background }]}
        >
            {/* Header */}
            <View style={styles.header}>
                <View style={styles.sheetHeaderSpacer} />
                <Text style={[styles.title, { flex: 1, color: theme.colors.text }]}>Receipt Intake</Text>
                <TouchableOpacity onPress={onClose} style={styles.exitButton} activeOpacity={0.8} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Icon name="close" size={18} color="#64748B" />
                    <Text style={styles.exitButtonText}>Exit</Text>
                </TouchableOpacity>
            </View>

            {/* Progress/Status Bar */}
            {jobStatus && jobStatus.status !== 'completed' && (
                <View style={styles.progressContainer}>
                    <View style={styles.progressBar}>
                        <Animated.View
                            style={[styles.progressFill, { width: `${jobStatus.progress}%` }]}
                        />
                    </View>
                    <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
                        {jobStatus.stage === 'parsing' ? '📄 Parsing receipt...' :
                            jobStatus.stage === 'matching' ? '🔍 Matching items...' :
                                jobStatus.stage === 'reranking' ? '🎯 Verifying matches...' :
                                    jobStatus.status === 'failed' ? '❌ Failed' : '✅ Complete'}
                    </Text>
                </View>
            )}

            {/* Loading State */}
            {loading && (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={theme.colors.primary} />
                    <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                        Processing receipt...
                    </Text>
                </View>
            )}

            {/* Error State */}
            {error && (
                <View style={styles.errorContainer}>
                    <Icon name="alert-circle" size={48} color="#f44336" />
                    <Text style={[styles.errorText, { color: theme.colors.text }]}>{error}</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={fetchJobStatus}>
                        <Text style={styles.retryButtonText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Items List */}
            {!loading && !error && items.length > 0 && (
                <ScrollView style={styles.itemsList} showsVerticalScrollIndicator={false}>
                    {/* Matched Items Section */}
                    {matchedItems.length > 0 && (
                        <>
                            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                                ✅ Matched Items ({matchedItems.length})
                            </Text>
                            {matchedItems.map((item, index) => (
                                <Animated.View
                                    key={item.id}
                                    entering={FadeInDown.delay(index * 30)}
                                    style={[
                                        styles.itemCard,
                                        { backgroundColor: theme.colors.card },
                                        item.isSelected && styles.itemCardSelected,
                                    ]}
                                >
                                    <TouchableOpacity
                                        style={styles.checkbox}
                                        onPress={() => toggleItemSelection(item.id)}
                                    >
                                        <Icon
                                            name={item.isSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                                            size={24}
                                            color={item.isSelected ? '#4CAF50' : theme.colors.textSecondary}
                                        />
                                    </TouchableOpacity>

                                    <View style={styles.itemContent}>
                                        <Text style={[styles.itemName, { color: theme.colors.text }]} numberOfLines={2}>
                                            {item.matchedProduct?.title || item.parsedName}
                                        </Text>
                                        <Text style={[styles.itemSubtext, { color: theme.colors.textSecondary }]}>
                                            From receipt: {item.parsedName}
                                        </Text>

                                        <View style={styles.qtyRow}>
                                            <Text style={[styles.qtyLabel, { color: theme.colors.textSecondary }]}>
                                                Current: {item.matchedProduct?.currentQuantity || 0}
                                            </Text>
                                            <Text style={[styles.qtyPlus, { color: '#4CAF50' }]}>+</Text>
                                            <TextInput
                                                style={[styles.qtyInput, { color: theme.colors.text, borderColor: theme.colors.border }]}
                                                value={String(item.quantity)}
                                                onChangeText={(t) => updateQuantity(item.id, parseInt(t) || 0)}
                                                keyboardType="number-pad"
                                            />
                                            <Text style={[styles.qtyEquals, { color: theme.colors.text }]}>=</Text>
                                            <Text style={[styles.qtyTotal, { color: theme.colors.primary }]}>
                                                {(item.matchedProduct?.currentQuantity || 0) + item.quantity}
                                            </Text>
                                        </View>

                                        <View style={[styles.badge, { backgroundColor: getConfidenceColor(item.matchConfidence) + '20' }]}>
                                            <Text style={[styles.badgeText, { color: getConfidenceColor(item.matchConfidence) }]}>
                                                {item.matchType} • {item.matchConfidence.toUpperCase()}
                                            </Text>
                                        </View>
                                    </View>
                                </Animated.View>
                            ))}
                        </>
                    )}

                    {/* Unmatched Items Section */}
                    {unmatchedItems.length > 0 && (
                        <>
                            <Text style={[styles.sectionTitle, { color: theme.colors.text, marginTop: 20 }]}>
                                ❓ Unmatched Items ({unmatchedItems.length})
                            </Text>
                            {unmatchedItems.map((item, index) => (
                                <Animated.View
                                    key={item.id}
                                    entering={FadeInDown.delay((matchedItems.length + index) * 30)}
                                    style={[styles.itemCard, { backgroundColor: theme.colors.card }]}
                                >
                                    <View style={styles.itemContent}>
                                        <Text style={[styles.itemName, { color: theme.colors.text }]}>
                                            {item.parsedName}
                                        </Text>
                                        <Text style={[styles.itemSubtext, { color: theme.colors.textSecondary }]}>
                                            Qty: {item.quantity} • No match found
                                        </Text>

                                        <View style={styles.actionButtons}>
                                            <TouchableOpacity
                                                style={styles.searchButton}
                                                onPress={() => Alert.alert('Coming Soon', 'Search functionality will be added.')}
                                            >
                                                <Icon name="magnify" size={16} color="#fff" />
                                                <Text style={styles.searchButtonText}>Search & Link</Text>
                                            </TouchableOpacity>

                                            <TouchableOpacity
                                                style={styles.createButton}
                                                onPress={() => onCreateNew?.(item.parsedName)}
                                            >
                                                <Icon name="plus" size={16} color="#4CAF50" />
                                                <Text style={[styles.createButtonText, { color: '#4CAF50' }]}>Add New</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                </Animated.View>
                            ))}
                        </>
                    )}

                    <View style={{ height: 120 }} />
                </ScrollView>
            )}

            {/* Bottom Action Bar */}
            {items.length > 0 && (
                <View style={[styles.actionBar, { backgroundColor: theme.colors.card, borderTopColor: theme.colors.border }]}>
                    <View style={styles.summaryRow}>
                        <Text style={[styles.summaryText, { color: theme.colors.textSecondary }]}>
                            {selectedCount} items selected
                        </Text>
                        <Text style={[styles.summaryText, { color: theme.colors.textSecondary }]}>
                            {unmatchedItems.length} need attention
                        </Text>
                    </View>

                    <TouchableOpacity
                        style={[styles.applyButton, (selectedCount === 0 || applying) && styles.applyButtonDisabled]}
                        onPress={handleApplyUpdates}
                        disabled={selectedCount === 0 || applying}
                    >
                        {applying ? (
                            <ActivityIndicator size="small" color="#fff" />
                        ) : (
                            <>
                                <Icon name="check" size={20} color="#fff" />
                                <Text style={styles.applyButtonText}>Apply Updates</Text>
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            )}
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.1)',
    },
    sheetHeaderSpacer: { minWidth: 72, minHeight: 34 },
    exitButton: {
        paddingVertical: 6,
        paddingHorizontal: 10,
        minHeight: 34,
        maxHeight: 34,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        backgroundColor: '#F2F2F7',
        flexDirection: 'row',
        alignItems: 'center',
    },
    exitButtonText: { color: '#64748B', fontWeight: '600', marginLeft: 6, fontSize: 15 },
    title: { fontSize: 18, fontWeight: '600' },
    progressContainer: { paddingHorizontal: 16, paddingVertical: 8 },
    progressBar: {
        height: 4,
        backgroundColor: 'rgba(0,0,0,0.1)',
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressFill: { height: '100%', backgroundColor: '#4CAF50' },
    progressText: { fontSize: 12, marginTop: 4, textAlign: 'center' },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { marginTop: 12, fontSize: 14 },
    errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
    errorText: { marginTop: 12, fontSize: 14, textAlign: 'center' },
    retryButton: {
        marginTop: 16,
        paddingHorizontal: 20,
        paddingVertical: 10,
        backgroundColor: '#4CAF50',
        borderRadius: 8,
    },
    retryButtonText: { color: '#fff', fontWeight: '600' },
    itemsList: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
    sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
    itemCard: {
        flexDirection: 'row',
        padding: 12,
        borderRadius: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    itemCardSelected: { borderColor: '#4CAF50' },
    checkbox: { marginRight: 12, justifyContent: 'flex-start', paddingTop: 2 },
    itemContent: { flex: 1 },
    itemName: { fontSize: 15, fontWeight: '500', marginBottom: 4 },
    itemSubtext: { fontSize: 12, marginBottom: 8 },
    qtyRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
    qtyLabel: { fontSize: 13 },
    qtyPlus: { fontSize: 16, fontWeight: '600' },
    qtyInput: {
        width: 50,
        height: 32,
        borderWidth: 1,
        borderRadius: 6,
        textAlign: 'center',
        fontSize: 14,
        fontWeight: '600',
    },
    qtyEquals: { fontSize: 16 },
    qtyTotal: { fontSize: 16, fontWeight: '700' },
    badge: {
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    badgeText: { fontSize: 10, fontWeight: '600' },
    actionButtons: { flexDirection: 'row', gap: 10 },
    searchButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#2196F3',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        gap: 6,
    },
    searchButtonText: { color: '#fff', fontSize: 13, fontWeight: '500' },
    createButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'transparent',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#4CAF50',
        gap: 6,
    },
    createButtonText: { fontSize: 13, fontWeight: '500' },
    actionBar: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 16,
        paddingBottom: 32,
        borderTopWidth: 1,
    },
    summaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    summaryText: { fontSize: 13 },
    applyButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#4CAF50',
        paddingVertical: 14,
        borderRadius: 12,
        gap: 8,
    },
    applyButtonDisabled: { backgroundColor: '#ccc' },
    applyButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

export default ReceiptReviewSheet;
