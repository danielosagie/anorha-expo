import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Picker } from '@react-native-picker/picker';

// Canonical Anorha fields that we need to map to
const CANONICAL_FIELDS = [
    { key: 'title', label: 'Title', required: true, example: 'Nike Air Max 90' },
    { key: 'description', label: 'Description', required: false, example: 'Classic sneaker with Air cushioning...' },
    { key: 'sku', label: 'SKU', required: true, example: 'NIKEAM90-001' },
    { key: 'barcode', label: 'Barcode/UPC', required: false, example: '012345678901' },
    { key: 'price', label: 'Price', required: true, example: '149.99' },
    { key: 'quantity', label: 'Quantity', required: false, example: '25' },
    { key: 'brand', label: 'Brand', required: false, example: 'Nike' },
    { key: 'category', label: 'Category', required: false, example: 'Footwear > Sneakers' },
    { key: 'condition', label: 'Condition', required: false, example: 'New' },
    { key: 'size', label: 'Size', required: false, example: '10' },
    { key: 'color', label: 'Color', required: false, example: 'White/Black' },
    { key: 'weight', label: 'Weight', required: false, example: '1.5' },
    { key: 'cost', label: 'Cost', required: false, example: '75.00' },
    { key: 'imageUrl', label: 'Image URL', required: false, example: 'https://...' },
];

interface RouteParams {
    csvHeaders: string[];
    csvData: any[];
    sampleRow: Record<string, string>;
}

type CSVColumnMappingScreenRouteProp = RouteProp<{ CSVColumnMapping: RouteParams }, 'CSVColumnMapping'>;

export function CSVColumnMappingScreen() {
    const navigation = useNavigation<NativeStackNavigationProp<any>>();
    const route = useRoute<CSVColumnMappingScreenRouteProp>();

    const { csvHeaders = [], csvData = [], sampleRow = {} } = route.params || {};

    // Mapping state: canonical field key -> csv column name
    const [mappings, setMappings] = useState<Record<string, string>>({});
    const [isProcessing, setIsProcessing] = useState(false);

    // Auto-detect mappings based on similar column names
    useEffect(() => {
        const autoMappings: Record<string, string> = {};

        CANONICAL_FIELDS.forEach(field => {
            const fieldLower = field.key.toLowerCase();
            const labelLower = field.label.toLowerCase();

            // Try to find a matching CSV column
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
    }, [csvHeaders]);

    const handleMappingChange = (canonicalField: string, csvColumn: string) => {
        setMappings(prev => ({
            ...prev,
            [canonicalField]: csvColumn === '' ? '' : csvColumn,
        }));
    };

    const handleConfirm = async () => {
        // Validate required fields are mapped
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
            // Transform CSV data using the mappings
            const transformedData = csvData.map(row => {
                const transformed: Record<string, any> = {};
                Object.entries(mappings).forEach(([canonicalKey, csvColumn]) => {
                    if (csvColumn) {
                        transformed[canonicalKey] = row[csvColumn];
                    }
                });
                return transformed;
            });

            // Navigate to MappingReviewScreen with the transformed data
            navigation.navigate('MappingReview', {
                connectionId: 'csv-import',
                platformName: 'CSV Import',
                importedProducts: transformedData,
                isCSVImport: true,
            });
        } catch (error) {
            console.error('[CSVColumnMapping] Error processing data:', error);
            Alert.alert('Error', 'Failed to process CSV data. Please try again.');
        } finally {
            setIsProcessing(false);
        }
    };

    const mappedCount = Object.values(mappings).filter(Boolean).length;
    const requiredCount = CANONICAL_FIELDS.filter(f => f.required).length;
    const mappedRequiredCount = CANONICAL_FIELDS.filter(f => f.required && mappings[f.key]).length;

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                    <MaterialCommunityIcons name="arrow-left" size={24} color="#111827" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Map CSV Columns</Text>
                <View style={{ width: 24 }} />
            </View>

            <View style={styles.progressBar}>
                <View style={styles.progressFill}
                    // @ts-ignore
                    width={`${(mappedCount / CANONICAL_FIELDS.length) * 100}%`}
                />
            </View>
            <Text style={styles.progressText}>
                {mappedCount}/{CANONICAL_FIELDS.length} fields mapped • {mappedRequiredCount}/{requiredCount} required
            </Text>

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
                <Text style={styles.sectionTitle}>Match your CSV columns to Anorha fields</Text>
                <Text style={styles.sectionSubtitle}>
                    We've auto-detected some matches. Review and adjust as needed.
                </Text>

                {CANONICAL_FIELDS.map(field => (
                    <View key={field.key} style={styles.fieldRow}>
                        <View style={styles.fieldInfo}>
                            <View style={styles.fieldLabelRow}>
                                <Text style={styles.fieldLabel}>{field.label}</Text>
                                {field.required && (
                                    <View style={styles.requiredBadge}>
                                        <Text style={styles.requiredText}>Required</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={styles.fieldExample}>e.g., "{field.example}"</Text>
                        </View>

                        <View style={styles.pickerContainer}>
                            <Picker
                                selectedValue={mappings[field.key] || ''}
                                onValueChange={(value) => handleMappingChange(field.key, value)}
                                style={styles.picker}
                            >
                                <Picker.Item label="— Select column —" value="" />
                                {csvHeaders.map(header => (
                                    <Picker.Item
                                        key={header}
                                        label={header}
                                        value={header}
                                    />
                                ))}
                            </Picker>
                        </View>

                        {mappings[field.key] && sampleRow[mappings[field.key]] && (
                            <View style={styles.previewContainer}>
                                <Text style={styles.previewLabel}>Preview:</Text>
                                <Text style={styles.previewValue} numberOfLines={1}>
                                    {sampleRow[mappings[field.key]]}
                                </Text>
                            </View>
                        )}
                    </View>
                ))}
            </ScrollView>

            <View style={styles.footer}>
                <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => navigation.goBack()}
                >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.confirmButton, isProcessing && styles.confirmButtonDisabled]}
                    onPress={handleConfirm}
                    disabled={isProcessing}
                >
                    {isProcessing ? (
                        <ActivityIndicator color="#fff" size="small" />
                    ) : (
                        <>
                            <Text style={styles.confirmButtonText}>Continue</Text>
                            <MaterialCommunityIcons name="arrow-right" size={20} color="#fff" />
                        </>
                    )}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#111827',
    },
    progressBar: {
        height: 4,
        backgroundColor: '#e5e7eb',
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#6366f1',
    },
    progressText: {
        fontSize: 12,
        color: '#6b7280',
        textAlign: 'center',
        paddingVertical: 8,
        backgroundColor: '#fff',
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 100,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111827',
        marginBottom: 4,
    },
    sectionSubtitle: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 20,
    },
    fieldRow: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    fieldInfo: {
        marginBottom: 12,
    },
    fieldLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    fieldLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: '#111827',
    },
    requiredBadge: {
        backgroundColor: '#fef2f2',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    requiredText: {
        fontSize: 11,
        color: '#dc2626',
        fontWeight: '500',
    },
    fieldExample: {
        fontSize: 12,
        color: '#9ca3af',
        marginTop: 4,
    },
    pickerContainer: {
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
        overflow: 'hidden',
    },
    picker: {
        height: 50,
    },
    previewContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
    },
    previewLabel: {
        fontSize: 12,
        color: '#6b7280',
        marginRight: 8,
    },
    previewValue: {
        flex: 1,
        fontSize: 12,
        color: '#22c55e',
        fontWeight: '500',
    },
    footer: {
        flexDirection: 'row',
        padding: 16,
        gap: 12,
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },
    cancelButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 10,
        backgroundColor: '#f3f4f6',
        alignItems: 'center',
    },
    cancelButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#6b7280',
    },
    confirmButton: {
        flex: 2,
        flexDirection: 'row',
        paddingVertical: 14,
        borderRadius: 10,
        backgroundColor: '#6366f1',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    confirmButtonDisabled: {
        opacity: 0.7,
    },
    confirmButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#fff',
    },
});

export default CSVColumnMappingScreen;
