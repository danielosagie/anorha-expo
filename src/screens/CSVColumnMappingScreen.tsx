import React, { useState, useEffect, useMemo } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    Dimensions,
    Platform,
    Modal,
    SafeAreaView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import Animated, { FadeInUp, FadeIn } from 'react-native-reanimated';
import PillTabs from '../components/ui/PillTabs';
import { supabase } from '../../lib/supabase';
import { useOrg } from '../context/OrgContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Canonical Anorha fields that we map to
const CANONICAL_FIELDS = [
    { key: 'title', label: 'Title', required: true, example: 'Nike Air Max 90', icon: 'format-title' },
    { key: 'description', label: 'Description', required: false, example: 'Classic sneaker...', icon: 'text' },
    { key: 'sku', label: 'SKU', required: true, example: 'NIKEAM90-001', icon: 'barcode' },
    { key: 'barcode', label: 'Barcode/UPC', required: false, example: '012345678901', icon: 'barcode-scan' },
    { key: 'price', label: 'Price', required: true, example: '149.99', icon: 'cash' },
    { key: 'compareAtPrice', label: 'Compare Price', required: false, example: '199.99', icon: 'tag-heart' },
    { key: 'quantity', label: 'Quantity', required: false, example: '25', icon: 'package-variant' },
    { key: 'brand', label: 'Brand', required: false, example: 'Nike', icon: 'tag-outline' },
    { key: 'category', label: 'Category', required: false, example: 'Sneakers', icon: 'shape-outline' },
    { key: 'condition', label: 'Condition', required: false, example: 'New', icon: 'star-outline' },
    { key: 'size', label: 'Size', required: false, example: '10', icon: 'ruler' },
    { key: 'color', label: 'Color', required: false, example: 'White', icon: 'palette-outline' },
    { key: 'weight', label: 'Weight', required: false, example: '1.5', icon: 'weight' },
    { key: 'cost', label: 'Cost', required: false, example: '75.00', icon: 'currency-usd' },
    { key: 'imageUrl', label: 'Image URL', required: false, example: 'https://...', icon: 'image-outline' },
];

interface RouteParams {
    csvHeaders: string[];
    csvData: any[];
    sampleRow: Record<string, string>;
    connectionName?: string;
}

type CSVColumnMappingScreenRouteProp = RouteProp<{ CSVColumnMapping: RouteParams }, 'CSVColumnMapping'>;

export function CSVColumnMappingScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<CSVColumnMappingScreenRouteProp>();
    const { currentOrg } = useOrg();
    const { getToken } = useAuth();

    // Default empty params if undefined to prevent crashes
    const { csvHeaders = [], csvData = [], sampleRow = {}, connectionName = 'CSV Import' } = route.params || {};

    const [mappings, setMappings] = useState<Record<string, string>>({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [isLoadingAI, setIsLoadingAI] = useState(false);
    const [activeTab, setActiveTab] = useState<'all' | 'required' | 'optional'>('all');

    // Modal state for column selection
    const [selectionModalVisible, setSelectionModalVisible] = useState(false);
    const [currentFieldKey, setCurrentFieldKey] = useState<string | null>(null);

    // Auto-detect mappings using backend AI on mount
    useEffect(() => {
        if (!csvHeaders.length) return;

        const fetchAIMappings = async () => {
            setIsLoadingAI(true);
            try {
                const token = await getToken();
                if (!token) {
                    console.warn('[CSVColumnMapping] No auth token, falling back to basic matching');
                    fallbackToBasicMatching();
                    return;
                }

                const response = await fetch(`${process.env.EXPO_PUBLIC_API_BASE_URL}/api/products/csv-column-mapping`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        headers: csvHeaders,
                        sampleRow: sampleRow,
                    }),
                });

                if (!response.ok) {
                    throw new Error(`API returned ${response.status}`);
                }

                const result = await response.json();
                setMappings(result.mappings || {});
                console.log('[CSVColumnMapping] AI mapped', Object.keys(result.mappings || {}).length, 'fields');
            } catch (error) {
                console.error('[CSVColumnMapping] AI mapping failed:', error);
                fallbackToBasicMatching();
            } finally {
                setIsLoadingAI(false);
            }
        };

        fetchAIMappings();
    }, [csvHeaders]);

    const fallbackToBasicMatching = () => {
        const autoMappings: Record<string, string> = {};
        CANONICAL_FIELDS.forEach(field => {
            const fieldLower = field.key.toLowerCase();
            const labelLower = field.label.toLowerCase();
            const match = csvHeaders.find(header => {
                const headerLower = header.toLowerCase().replace(/[_\-\s]/g, '');
                return (
                    headerLower === fieldLower ||
                    headerLower === labelLower.replace(/[_\-\s]/g, '') ||
                    headerLower.includes(fieldLower) ||
                    fieldLower.includes(headerLower)
                );
            });
            if (match) {
                autoMappings[field.key] = match;
            }
        });
        setMappings(autoMappings);
    };

    const handleConfirm = async () => {
        // Validate required fields
        const missingRequired = CANONICAL_FIELDS
            .filter(f => f.required && !mappings[f.key])
            .map(f => f.label);

        if (missingRequired.length > 0) {
            Alert.alert(
                'Missing Required Fields',
                `Please map the following required fields:\n\n• ${missingRequired.join('\n• ')}`,
                [{ text: 'OK' }]
            );
            return;
        }

        setIsProcessing(true);
        try {
            const transformedData = csvData.map(row => {
                const transformed: Record<string, any> = {};
                Object.entries(mappings).forEach(([canonicalKey, csvColumn]) => {
                    if (csvColumn) {
                        transformed[canonicalKey] = row[csvColumn];
                    }
                });
                return transformed;
            });

            // Create persistent CSV connection record in UserPlatforms
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            const { data: newConnection, error: insertError } = await supabase
                .from('UserPlatforms')
                .insert({
                    UserId: user.id,
                    OrgId: currentOrg?.id, // Add OrgId from context
                    PlatformType: 'csv',
                    DisplayName: connectionName,
                    Status: 'active',
                    IsEnabled: true,
                })
                .select()
                .single();

            if (insertError) {
                console.error('[CSVColumnMapping] Failed to create CSV connection:', insertError);
                // Fallback to passing just the 'csv-import' flag so we can still proceed
                // The connection won't be saved for later, but the import will work.
                navigation.navigate('MappingReview', {
                    connectionId: 'csv-import', // Magic string for CSV Import mode
                    platformName: 'CSV Import',
                    importedProducts: transformedData, // Pass the data!
                    isCSVImport: true, // Fix: Ensure this is passed
                });
                return;
            }

            console.log('[CSVColumnMapping] Created CSV connection:', newConnection.Id);

            navigation.navigate('MappingReview', {
                connectionId: newConnection.Id,
                platformName: connectionName,
                importedProducts: transformedData,
                isCSVImport: true,
            } as any);
        } catch (error) {
            console.error('[CSVColumnMapping] Error processing data:', error);
            Alert.alert('Error', 'Failed to process CSV data.');
        } finally {
            setIsProcessing(false);
        }
    };

    const mappedCount = Object.values(mappings).filter(Boolean).length;
    const requiredCount = CANONICAL_FIELDS.filter(f => f.required).length;
    const mappedRequiredCount = CANONICAL_FIELDS.filter(f => f.required && mappings[f.key]).length;
    const progressPercentage = (mappedCount / CANONICAL_FIELDS.length) * 100;

    const filteredFields = useMemo(() => {
        if (activeTab === 'required') return CANONICAL_FIELDS.filter(f => f.required);
        if (activeTab === 'optional') return CANONICAL_FIELDS.filter(f => !f.required);
        return CANONICAL_FIELDS;
    }, [activeTab]);

    const tabs = [
        { key: 'all' as const, id: 'all' as const, label: `All` },
        { key: 'required' as const, id: 'required' as const, label: `Required` },
        { key: 'optional' as const, id: 'optional' as const, label: `Optional` },
    ];

    const openSelectionModal = (fieldKey: string) => {
        setCurrentFieldKey(fieldKey);
        setSelectionModalVisible(true);
    };

    const selectColumn = (column: string) => {
        if (currentFieldKey) {
            setMappings(prev => ({
                ...prev,
                [currentFieldKey]: column,
            }));
        }
        setSelectionModalVisible(false);
        setCurrentFieldKey(null);
    };

    return (
        <View style={styles.container}>
            <SafeAreaView style={styles.safeArea}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
                        <Icon name="arrow-left" size={24} color="#1f2937" />
                    </TouchableOpacity>
                    <View style={styles.headerContent}>
                        <Text style={styles.headerTitle}>Map Columns</Text>
                        <Text style={styles.headerSubtitle}>{csvHeaders.length} columns from CSV</Text>
                    </View>
                    <View style={styles.progressBadge}>
                        <Text style={[styles.progressBadgeText, mappedRequiredCount === requiredCount && styles.textSuccess]}>
                            {mappedRequiredCount}/{requiredCount} Req.
                        </Text>
                    </View>
                </View>

                {/* AI Loading Indicator */}
                {isLoadingAI && (
                    <View style={styles.aiLoadingBar}>
                        <ActivityIndicator size="small" color={BRAND_PRIMARY} />
                        <Text style={styles.aiLoadingText}>AI is auto-mapping columns...</Text>
                    </View>
                )}

                {/* Tabs */}
                <View style={styles.tabsWrapper}>
                    <PillTabs
                        tabs={tabs}
                        value={activeTab}
                        onChange={(k) => setActiveTab(k as any)}
                    />
                </View>

                {/* List */}
                <ScrollView
                    style={styles.content}
                    contentContainerStyle={styles.contentContainer}
                    showsVerticalScrollIndicator={false}
                >
                    {filteredFields.map((field, index) => {
                        const mappedCol = mappings[field.key];
                        const isMapped = !!mappedCol;

                        return (
                            <Animated.View
                                key={field.key}
                                entering={FadeInUp.delay(index * 30).springify()}
                                style={[styles.card, isMapped && styles.cardMapped]}
                            >
                                <View style={styles.cardHeader}>
                                    <View style={styles.cardIconBox}>
                                        <Icon name={field.icon} size={20} color={isMapped ? BRAND_PRIMARY : '#6b7280'} />
                                    </View>
                                    <View style={styles.cardTitleBox}>
                                        <Text style={styles.cardTitle}>{field.label}</Text>
                                        {field.required && <Text style={styles.reqTag}>Required</Text>}
                                    </View>
                                </View>

                                <TouchableOpacity
                                    style={[styles.selectorBtn, isMapped ? styles.selectorBtnActive : styles.selectorBtnEmpty]}
                                    onPress={() => openSelectionModal(field.key)}
                                >
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.selectorLabel, isMapped ? styles.selectorLabelActive : styles.selectorLabelEmpty]}>
                                            {isMapped ? mappedCol : 'Select CSV Column...'}
                                        </Text>
                                        {isMapped && sampleRow[mappedCol] && (
                                            <Text style={styles.sampleValue} numberOfLines={1}>
                                                Sample: {sampleRow[mappedCol]}
                                            </Text>
                                        )}
                                    </View>
                                    <Icon name="chevron-down" size={20} color={isMapped ? BRAND_PRIMARY : '#9ca3af'} />
                                </TouchableOpacity>
                            </Animated.View>
                        );
                    })}
                    <View style={{ height: 100 }} />
                </ScrollView>

                {/* Footer */}
                <View style={styles.footer}>
                    <TouchableOpacity
                        style={[styles.primaryBtn, isProcessing && styles.btnDisabled]}
                        onPress={handleConfirm}
                        disabled={isProcessing}
                    >
                        {isProcessing ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.primaryBtnText}>
                                Import {csvData.length} Products
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>
            </SafeAreaView>

            {/* Column Selection Modal */}
            <Modal
                visible={selectionModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setSelectionModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContainer}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Select Column</Text>
                            <TouchableOpacity onPress={() => setSelectionModalVisible(false)}>
                                <Icon name="close" size={24} color="#1f2937" />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalList}>
                            <TouchableOpacity
                                style={styles.modalItem}
                                onPress={() => selectColumn('')}
                            >
                                <Text style={[styles.modalItemText, { color: '#ef4444' }]}>Clear Mapping</Text>
                            </TouchableOpacity>
                            {csvHeaders.map((header) => (
                                <TouchableOpacity
                                    key={header}
                                    style={styles.modalItem}
                                    onPress={() => selectColumn(header)}
                                >
                                    <Text style={styles.modalItemText}>{header}</Text>
                                    <Text style={styles.modalItemSample} numberOfLines={1}>
                                        {sampleRow[header]}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
    },
    safeArea: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    iconBtn: {
        padding: 8,
        marginRight: 8,
    },
    headerContent: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    headerSubtitle: {
        fontSize: 13,
        color: '#6b7280',
    },
    progressBadge: {
        backgroundColor: '#f3f4f6',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    progressBadgeText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#6b7280',
    },
    textSuccess: {
        color: BRAND_PRIMARY,
    },
    aiLoadingBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        backgroundColor: '#f0fdf4',
        gap: 8,
    },
    aiLoadingText: {
        fontSize: 13,
        color: BRAND_PRIMARY,
        fontWeight: '500',
    },
    tabsWrapper: {
        paddingVertical: 12,
        paddingHorizontal: 16,
    },
    content: {
        flex: 1,
    },
    contentContainer: {
        paddingHorizontal: 16,
        paddingBottom: 20,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    cardMapped: {
        borderColor: BRAND_PRIMARY,
        backgroundColor: '#f7fee7',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    cardIconBox: {
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: '#f3f4f6',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    cardTitleBox: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    cardTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#374151',
    },
    reqTag: {
        fontSize: 11,
        fontWeight: '700',
        color: '#ef4444',
        backgroundColor: '#fef2f2',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        overflow: 'hidden',
    },
    selectorBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        borderWidth: 1,
        borderRadius: 10,
        backgroundColor: '#fff',
    },
    selectorBtnEmpty: {
        borderColor: '#e5e7eb',
        borderStyle: 'dashed',
    },
    selectorBtnActive: {
        borderColor: BRAND_PRIMARY,
        backgroundColor: '#fff',
    },
    selectorLabel: {
        fontSize: 14,
        fontWeight: '500',
    },
    selectorLabelEmpty: {
        color: '#9ca3af',
    },
    selectorLabelActive: {
        color: '#1f2937',
    },
    sampleValue: {
        fontSize: 12,
        color: '#6b7280',
        marginTop: 2,
    },
    footer: {
        padding: 16,
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
    },
    primaryBtn: {
        backgroundColor: BRAND_PRIMARY,
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
        shadowColor: BRAND_PRIMARY,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    btnDisabled: {
        backgroundColor: '#9ca3af',
        shadowOpacity: 0,
    },
    primaryBtnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    // Modal
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContainer: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '80%',
        paddingBottom: 30,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    modalList: {

    },
    modalItem: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    modalItemText: {
        fontSize: 15,
        fontWeight: '500',
        color: '#374151',
    },
    modalItemSample: {
        fontSize: 13,
        color: '#9ca3af',
        marginTop: 4,
    },
});
