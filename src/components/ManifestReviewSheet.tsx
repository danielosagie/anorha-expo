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
} from 'react-native';
import Animated, { FadeIn, FadeInDown, SlideInDown } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { ensureSupabaseJwt } from '../lib/supabase';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Types matching backend ManifestItem
export interface ManifestItem {
    id: string;
    rawText: string;
    parsedName: string;
    quantity: number;
    msrp: number | null;
    estimatedValue: number | null;
    sku: string | null;
    upc: string | null;
    confidence: 'high' | 'medium' | 'low';
    needsReview: boolean;
    estimationSources?: Array<{
        type: 'database' | 'web' | 'inference';
        source: string;
        price?: number;
    }>;
}

export interface ManifestJobStatus {
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress: number;
    items?: ManifestItem[];
    error?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
}

interface ManifestReviewSheetProps {
    jobId: string;
    onClose: () => void;
    onAddToInventory?: (items: ManifestItem[]) => void;
    onLiquidate?: (items: ManifestItem[]) => void;
}

const API_URL = process.env.EXPO_PUBLIC_SSSYNC_BACKEND_URL || 'https://sssync-bknd.onrender.com';

const ManifestReviewSheet: React.FC<ManifestReviewSheetProps> = ({
    jobId,
    onClose,
    onAddToInventory,
    onLiquidate,
}) => {
    const theme = useTheme();
    const colors = theme.colors;
    const border = '#E5E7EB';

    const [jobStatus, setJobStatus] = useState<ManifestJobStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editedItems, setEditedItems] = useState<ManifestItem[]>([]);
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

    // Poll for job status
    const fetchJobStatus = useCallback(async () => {
        try {
            const jwt = await ensureSupabaseJwt();
            const response = await fetch(`${API_URL}/products/manifests/${jobId}/status`, {
                headers: { Authorization: `Bearer ${jwt}` },
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            setJobStatus(data);

            if (data.items) {
                setEditedItems(data.items);
                // Select all high-confidence items by default
                const highConfIds = data.items
                    .filter((item: ManifestItem) => item.confidence === 'high')
                    .map((item: ManifestItem) => item.id);
                setSelectedItems(new Set(highConfIds));
            }

            setLoading(false);

            return data.status;
        } catch (err: any) {
            setError(err.message);
            setLoading(false);
            return 'failed';
        }
    }, [jobId]);

    // Poll every 2 seconds while processing
    useEffect(() => {
        let intervalId: ReturnType<typeof setInterval> | null = null;

        const poll = async () => {
            const status = await fetchJobStatus();
            if (status === 'completed' || status === 'failed') {
                if (intervalId) clearInterval(intervalId);
            }
        };

        poll();
        intervalId = setInterval(poll, 2000);

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [fetchJobStatus]);

    // Toggle item selection
    const toggleItemSelection = (itemId: string) => {
        setSelectedItems(prev => {
            const next = new Set(prev);
            if (next.has(itemId)) {
                next.delete(itemId);
            } else {
                next.add(itemId);
            }
            return next;
        });
    };

    // Update item field
    const updateItem = (itemId: string, field: keyof ManifestItem, value: any) => {
        setEditedItems(prev =>
            prev.map(item =>
                item.id === itemId ? { ...item, [field]: value } : item
            )
        );
    };

    // Get confidence badge color
    const getConfidenceColor = (confidence: 'high' | 'medium' | 'low') => {
        switch (confidence) {
            case 'high': return '#4CAF50';
            case 'medium': return '#FF9800';
            case 'low': return '#f44336';
        }
    };

    // Handle add to inventory
    const handleAddToInventory = () => {
        const itemsToAdd = editedItems.filter(item => selectedItems.has(item.id));
        if (itemsToAdd.length === 0) {
            Alert.alert('No Items Selected', 'Please select at least one item to add.');
            return;
        }

        if (onAddToInventory) {
            onAddToInventory(itemsToAdd);
        } else {
            Alert.alert('Coming Soon', 'Adding items to inventory will be available in a future update.');
        }
    };

    // Handle liquidate
    const handleLiquidate = () => {
        const itemsToLiquidate = editedItems.filter(item => selectedItems.has(item.id));
        if (itemsToLiquidate.length === 0) {
            Alert.alert('No Items Selected', 'Please select at least one item to liquidate.');
            return;
        }

        if (onLiquidate) {
            onLiquidate(itemsToLiquidate);
        } else {
            Alert.alert('Coming Soon', 'Liquidation flow will be available in the next update.');
        }
    };

    // Calculate totals
    const totalItems = editedItems.length;
    const selectedCount = selectedItems.size;
    const totalValue = editedItems
        .filter(item => selectedItems.has(item.id))
        .reduce((sum, item) => sum + (item.estimatedValue || 0) * item.quantity, 0);

    return (
        <Animated.View
            entering={SlideInDown.duration(300)}
            style={[styles.container, { backgroundColor: colors.background }]}
        >
            {/* Header */}
            <View style={styles.header}>
                <View style={styles.sheetHeaderSpacer} />
                <Text style={[styles.title, { flex: 1, color: colors.text }]}>Manifest Review</Text>
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
                    <Text style={[styles.progressText, { color: colors.textSecondary }]}>
                        {jobStatus.status === 'pending' ? 'Waiting...' :
                            jobStatus.status === 'processing' ? `Processing... ${jobStatus.progress}%` :
                                jobStatus.status === 'failed' ? '❌ Failed' : 'Complete'}
                    </Text>
                </View>
            )}

            {/* Loading State */}
            {loading && (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                        Loading manifest...
                    </Text>
                </View>
            )}

            {/* Error State */}
            {error && (
                <View style={styles.errorContainer}>
                    <Icon name="alert-circle" size={48} color="#f44336" />
                    <Text style={[styles.errorText, { color: colors.text }]}>{error}</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={fetchJobStatus}>
                        <Text style={styles.retryButtonText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Items List */}
            {!loading && !error && editedItems.length > 0 && (
                <ScrollView style={styles.itemsList} showsVerticalScrollIndicator={false}>
                    {editedItems.map((item, index) => (
                        <Animated.View
                            key={item.id}
                            entering={FadeInDown.delay(index * 50)}
                            style={[
                                styles.itemCard,
                                { backgroundColor: colors.surface },
                                selectedItems.has(item.id) && styles.itemCardSelected,
                            ]}
                        >
                            {/* Selection Checkbox */}
                            <TouchableOpacity
                                style={styles.checkbox}
                                onPress={() => toggleItemSelection(item.id)}
                            >
                                <Icon
                                    name={selectedItems.has(item.id) ? 'checkbox-marked' : 'checkbox-blank-outline'}
                                    size={24}
                                    color={selectedItems.has(item.id) ? '#93C822' : colors.textSecondary}
                                />
                            </TouchableOpacity>

                            {/* Item Content */}
                            <View style={styles.itemContent}>
                                {/* Name */}
                                <TextInput
                                    style={[styles.itemName, { color: colors.text }]}
                                    value={item.parsedName}
                                    onChangeText={(text) => updateItem(item.id, 'parsedName', text)}
                                    placeholder="Item name"
                                    placeholderTextColor={colors.textSecondary}
                                />

                                {/* Row: Qty, MSRP, Est Value */}
                                <View style={styles.itemRow}>
                                    <View style={styles.itemField}>
                                        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Qty</Text>
                                        <TextInput
                                            style={[styles.fieldInput, { color: colors.text, borderColor: border }]}
                                            value={String(item.quantity)}
                                            onChangeText={(text) => updateItem(item.id, 'quantity', parseInt(text) || 1)}
                                            keyboardType="number-pad"
                                        />
                                    </View>

                                    <View style={styles.itemField}>
                                        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>MSRP</Text>
                                        <TextInput
                                            style={[styles.fieldInput, { color: colors.text, borderColor: border }]}
                                            value={item.msrp ? `$${item.msrp}` : '-'}
                                            onChangeText={(text) => updateItem(item.id, 'msrp', parseFloat(text.replace('$', '')) || null)}
                                            keyboardType="decimal-pad"
                                        />
                                    </View>

                                    <View style={styles.itemField}>
                                        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Est.</Text>
                                        <Text style={[styles.estimatedValue, { color: colors.primary }]}>
                                            {item.estimatedValue ? `$${item.estimatedValue.toFixed(2)}` : '???'}
                                        </Text>
                                    </View>
                                </View>

                                {/* Confidence Badge */}
                                <View style={styles.badgeRow}>
                                    <View style={[styles.badge, { backgroundColor: getConfidenceColor(item.confidence) + '20' }]}>
                                        <Text style={[styles.badgeText, { color: getConfidenceColor(item.confidence) }]}>
                                            {item.confidence.toUpperCase()}
                                        </Text>
                                    </View>
                                    {item.needsReview && (
                                        <View style={[styles.badge, { backgroundColor: '#FF980020' }]}>
                                            <Icon name="eye" size={12} color="#FF9800" />
                                            <Text style={[styles.badgeText, { color: '#FF9800', marginLeft: 4 }]}>
                                                Review
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            </View>
                        </Animated.View>
                    ))}

                    {/* Bottom padding for scroll */}
                    <View style={{ height: 120 }} />
                </ScrollView>
            )}

            {/* Empty State */}
            {!loading && !error && editedItems.length === 0 && jobStatus?.status === 'completed' && (
                <View style={styles.emptyContainer}>
                    <Icon name="file-document-outline" size={64} color={colors.textSecondary} />
                    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                        No items found in manifest
                    </Text>
                </View>
            )}

            {/* Bottom Action Bar */}
            {editedItems.length > 0 && (
                <View style={[styles.actionBar, { backgroundColor: colors.surface, borderTopColor: border }]}>
                    <View style={styles.summaryRow}>
                        <Text style={[styles.summaryText, { color: colors.textSecondary }]}>
                            {selectedCount} of {totalItems} items
                        </Text>
                        <Text style={[styles.totalValue, { color: colors.primary }]}>
                            Est. Total: ${totalValue.toFixed(2)}
                        </Text>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12 }}>
                        <TouchableOpacity
                            style={[
                                styles.addButton,
                                { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#FF9900', flex: 1 }
                            ]}
                            onPress={handleLiquidate}
                            disabled={selectedCount === 0}
                        >
                            <Icon name="flash" size={20} color="#FF9900" />
                            <Text style={[styles.addButtonText, { color: '#FF9900' }]}>Liquidate</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.addButton, selectedCount === 0 && styles.addButtonDisabled, { flex: 1 }]}
                            onPress={handleAddToInventory}
                            disabled={selectedCount === 0}
                        >
                            <Icon name="plus" size={20} color="#fff" />
                            <Text style={styles.addButtonText}>Add Inventory</Text>
                        </TouchableOpacity>
                    </View>
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
    sheetHeaderSpacer: {
        minWidth: 72,
        minHeight: 34,
    },
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
    exitButtonText: {
        color: '#64748B',
        fontWeight: '600',
        marginLeft: 6,
        fontSize: 15,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
    },
    progressContainer: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    progressBar: {
        height: 4,
        backgroundColor: 'rgba(0,0,0,0.1)',
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#93C822',
    },
    progressText: {
        fontSize: 12,
        marginTop: 4,
        textAlign: 'center',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 14,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    errorText: {
        marginTop: 12,
        fontSize: 14,
        textAlign: 'center',
    },
    retryButton: {
        marginTop: 16,
        paddingHorizontal: 20,
        paddingVertical: 10,
        backgroundColor: '#93C822',
        borderRadius: 8,
    },
    retryButtonText: {
        color: '#fff',
        fontWeight: '600',
    },
    itemsList: {
        flex: 1,
        paddingHorizontal: 16,
        paddingTop: 12,
    },
    itemCard: {
        flexDirection: 'row',
        padding: 12,
        borderRadius: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    itemCardSelected: {
        borderColor: '#93C822',
    },
    checkbox: {
        marginRight: 12,
        justifyContent: 'flex-start',
        paddingTop: 2,
    },
    itemContent: {
        flex: 1,
    },
    itemName: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 8,
    },
    itemRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 8,
    },
    itemField: {
        flex: 1,
    },
    fieldLabel: {
        fontSize: 10,
        marginBottom: 2,
        textTransform: 'uppercase',
    },
    fieldInput: {
        fontSize: 14,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderWidth: 1,
        borderRadius: 6,
    },
    estimatedValue: {
        fontSize: 16,
        fontWeight: '700',
        paddingVertical: 4,
    },
    badgeRow: {
        flexDirection: 'row',
        gap: 8,
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    badgeText: {
        fontSize: 10,
        fontWeight: '600',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyText: {
        marginTop: 12,
        fontSize: 14,
    },
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
    summaryText: {
        fontSize: 14,
    },
    totalValue: {
        fontSize: 16,
        fontWeight: '700',
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#93C822',
        paddingVertical: 14,
        borderRadius: 12,
        gap: 8,
    },
    addButtonDisabled: {
        backgroundColor: '#ccc',
    },
    addButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});

export default ManifestReviewSheet;
