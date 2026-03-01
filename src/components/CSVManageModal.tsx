import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { CloudDownload, Settings } from 'lucide-react-native';
import { documentDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import BaseModal from './BaseModal';

interface CSVManageModalProps {
    visible: boolean;
    onClose: () => void;
    onSettings?: () => void;
}

export default function CSVManageModal({ visible, onClose, onSettings }: CSVManageModalProps) {
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = async () => {
        try {
            setIsExporting(true);

            // 1. Get current user
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            // 2. Fetch products
            const { data: products, error } = await supabase
                .from('ProductVariants')
                .select(`
          Sku,
          Title,
          Description,
          Price,
          Quantity,
          Brand,
          Category,
          Condition,
          Weight,
          Images
        `)
                .eq('UserId', user.id)
                .order('CreatedAt', { ascending: false })
                .limit(2000);

            if (error) throw error;
            if (!products || products.length === 0) {
                Alert.alert('No Products', 'You have no products to export.');
                setIsExporting(false);
                return;
            }

            // 3. Convert to CSV
            const headers = ['Sku', 'Title', 'Description', 'Price', 'Quantity', 'Brand', 'Category', 'Condition', 'Weight', 'Images'];
            const csvRows = [headers.join(',')];

            products.forEach(p => {
                const row = [
                    `"${(p.Sku || '').replace(/"/g, '""')}"`,
                    `"${(p.Title || '').replace(/"/g, '""')}"`,
                    `"${(p.Description || '').replace(/"/g, '""')}"`,
                    p.Price || 0,
                    p.Quantity || 0,
                    `"${(p.Brand || '').replace(/"/g, '""')}"`,
                    `"${(p.Category || '').replace(/"/g, '""')}"`,
                    `"${(p.Condition || '').replace(/"/g, '""')}"`,
                    p.Weight || 0,
                    `"${(Array.isArray(p.Images) ? p.Images.join(';') : (p.Images || '')).replace(/"/g, '""')}"`,
                ];
                csvRows.push(row.join(','));
            });

            const csvString = csvRows.join('\n');

            // 4. Save to file
            const fileName = `inventory_export_${new Date().toISOString().split('T')[0]}.csv`;
            const fileUri = documentDirectory + fileName;
            await writeAsStringAsync(fileUri, csvString, { encoding: EncodingType.UTF8 });

            // 5. Share
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Export Inventory CSV' });
            } else {
                Alert.alert('Sharing not available', 'Sharing is not available on this device');
            }

            onClose();

        } catch (err: any) {
            console.error('Export Error:', err);
            Alert.alert('Export Failed', err.message || 'Unknown error occurred');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <BaseModal
            visible={visible}
            onClose={onClose}
            containerStyle={{ padding: 24, borderRadius: 24, width: '90%', maxWidth: 400 }}
        >
            <View style={styles.container}>
                {/* Export Button (Primary Green) */}
                <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleExport}
                    disabled={isExporting}
                >
                    {isExporting ? <ActivityIndicator color="#fff" size="small" /> : <CloudDownload size={20} color="#fff" />}
                    <Text style={styles.primaryText}>{isExporting ? 'Exporting...' : 'Export Inventory to CSV'}</Text>
                </TouchableOpacity>

                {/* Spacer */}
                <View style={{ height: 12 }} />

                {/* Settings Button (Secondary Gray) */}
                <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => {
                        onClose();
                        onSettings && onSettings();
                    }}
                >
                    <Settings size={20} color="#71717A" />
                    <Text style={styles.secondaryText}>Connection Settings</Text>
                </TouchableOpacity>
            </View>
        </BaseModal>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
    },
    primaryBtn: {
        flexDirection: 'row',
        gap: 8,
        backgroundColor: '#93C822',
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        // Subtle shadow for primary button
        shadowColor: '#93C822',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    primaryText: { color: '#fff', fontWeight: '600', fontSize: 16 },
    secondaryBtn: {
        flexDirection: 'row',
        gap: 8,
        backgroundColor: '#E5E5E5',
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
    },
    secondaryText: { color: '#71717A', fontWeight: '600', fontSize: 16 },
});
