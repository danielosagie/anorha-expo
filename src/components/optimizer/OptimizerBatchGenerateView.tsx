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
    Dimensions,
    Animated,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/clerk-expo';
import { ensureSupabaseJwt, supabase } from '../../lib/supabase';
import { createLogger } from '../../utils/logger';
const log = createLogger('OptimizerBatchGenerateView');


const { width } = Dimensions.get('window');

const COLORS = {
    primary: '#8cc63f',
    primaryDark: '#70a826',
    surface: '#ffffff',
    background: '#f8f9fa',
    text: '#1a1a1a',
    textLight: '#6c757d',
    border: '#e5e5e5',
};

interface OptimizerBatchGenerateViewProps {
    onBack: () => void;
    onComplete: (ids: string[]) => void;
    /** When provided, use this list instead of fetching (real data-needed queue from useOptimizerQueues) */
    queueProducts?: any[];
}

export function OptimizerBatchGenerateView({ onBack, onComplete, queueProducts }: OptimizerBatchGenerateViewProps) {
    const { getToken } = useAuth();
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isGenerating, setIsGenerating] = useState(false);

    // Animation for success state
    const successAnim = useRef(new Animated.Value(0)).current;

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
            Alert.alert('Error', 'Failed to load products for batch generation.');
        } finally {
            setLoading(false);
        }
    };

    const toggleSelection = (id: string) => {
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
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        if (selectedIds.size === products.length) {
            setSelectedIds(new Set());
        } else {
            const allIds = new Set(products.map(p => p.Id));
            setSelectedIds(allIds);
        }
    };

    const handleGenerate = async () => {
        if (selectedIds.size === 0) return;

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setIsGenerating(true);

        const idsToMark = Array.from(selectedIds);

        // Simulate async generation process start
        setTimeout(() => {
            setIsGenerating(false);

            Alert.alert(
                '🔮 Magic Started!',
                `AI is now generating optimized details for ${selectedIds.size} products. You'll be notified when they are ready for review.`,
                [{ text: 'Awesome', onPress: () => onComplete(idsToMark) }]
            );
        }, 1500);
    };

    const renderItem = ({ item }: { item: any }) => {
        const isSelected = selectedIds.has(item.Id);
        const image = item.ProductImages?.[0]?.ImageUrl;

        return (
            <TouchableOpacity
                style={[
                    styles.itemCard,
                    isSelected && styles.itemCardSelected
                ]}
                onPress={() => toggleSelection(item.Id)}
                activeOpacity={0.7}
            >
                <View style={styles.checkboxContainer}>
                    <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                        {isSelected && <MaterialCommunityIcons name="check" size={16} color="#fff" />}
                    </View>
                </View>

                {image ? (
                    <Image source={{ uri: image }} style={styles.itemImage} />
                ) : (
                    <View style={styles.itemImagePlaceholder}>
                        <MaterialCommunityIcons name="image-off" size={20} color="#ccc" />
                    </View>
                )}

                <View style={styles.itemInfo}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{item.Title}</Text>
                    <Text style={styles.itemSku}>{item.Sku || 'No SKU'}</Text>

                    {/* Tags showing what will be generated */}
                    <View style={styles.tagsRow}>
                        <View style={styles.tag}>
                            <MaterialCommunityIcons name="format-title" size={12} color={COLORS.primary} />
                            <Text style={styles.tagText}>Title</Text>
                        </View>
                        <View style={styles.tag}>
                            <MaterialCommunityIcons name="text-short" size={12} color={COLORS.primary} />
                            <Text style={styles.tagText}>Desc</Text>
                        </View>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={{ marginTop: 10, color: COLORS.textLight }}>Loading candidates...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack} style={styles.backButton}>
                    <MaterialCommunityIcons name="close" size={24} color={COLORS.text} />
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
                <TouchableOpacity
                    style={[
                        styles.generateButton,
                        selectedIds.size === 0 && styles.generateButtonDisabled
                    ]}
                    onPress={handleGenerate}
                    disabled={selectedIds.size === 0 || isGenerating}
                >
                    <LinearGradient
                        colors={selectedIds.size > 0 ? [COLORS.primary, COLORS.primaryDark] : ['#e9ecef', '#ced4da']}
                        style={styles.gradientBtn}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                    >
                        {isGenerating ? (
                            <ActivityIndicator color="#fff" />
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
            </View>
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
        color: COLORS.text,
        textAlign: 'center',
    },
    headerSubtitle: {
        fontSize: 12,
        color: COLORS.textLight,
        textAlign: 'center',
    },
    toolbar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 12,
        backgroundColor: COLORS.surface,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
    },
    selectAllBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    selectText: {
        fontSize: 14,
        fontWeight: '600',
        color: COLORS.text,
    },
    countText: {
        fontSize: 14,
        color: COLORS.textLight,
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
        backgroundColor: COLORS.primary,
        borderColor: COLORS.primary,
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
        backgroundColor: COLORS.surface,
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
        borderColor: COLORS.primary,
        backgroundColor: '#fbfdf8',
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
        color: COLORS.text,
        marginBottom: 2,
    },
    itemSku: {
        fontSize: 12,
        color: COLORS.textLight,
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
        backgroundColor: COLORS.surface,
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
        paddingBottom: 40,
    },
    generateButton: {
        borderRadius: 16,
        overflow: 'hidden',
        height: 56,
        shadowColor: COLORS.primary,
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
});
