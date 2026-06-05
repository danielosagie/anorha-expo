import React, { useState } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { CloudDownload, Settings } from 'lucide-react-native';
import { documentDirectory, writeAsStringAsync, EncodingType } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ensureSupabaseJwt } from '../lib/supabase';
import BaseModal from './BaseModal';
import { useOrg } from '../context/OrgContext';

interface CSVManageModalProps {
    visible: boolean;
    onClose: () => void;
    onSettings?: () => void;
}

export default function CSVManageModal({ visible, onClose, onSettings }: CSVManageModalProps) {
    const [isExporting, setIsExporting] = useState(false);
    const { currentOrg } = useOrg();
    const rawApiBase = (process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app').replace(/\/+$/, '');
    const API_BASE = rawApiBase.endsWith('/api') ? rawApiBase : `${rawApiBase}/api`;

    const handleExport = async () => {
        try {
            setIsExporting(true);
            const orgId = currentOrg?.id;
            if (!orgId) throw new Error('No active organization selected');

            const token = await ensureSupabaseJwt();
            if (!token) throw new Error('Not authenticated');

            const response = await fetch(
                `${API_BASE}/organizations/${encodeURIComponent(orgId)}/export/current`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );

            if (!response.ok) throw new Error('Export failed');

            const csvString = await response.text();
            if (!csvString.trim()) {
                Alert.alert('No Products', 'You have no products to export.');
                return;
            }

            const fileName = `inventory_export_${new Date().toISOString().split('T')[0]}.csv`;
            const fileUri = documentDirectory + fileName;
            await writeAsStringAsync(fileUri, csvString, { encoding: EncodingType.UTF8 });

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
        backgroundColor: BRAND_PRIMARY,
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        // Subtle shadow for primary button
        shadowColor: BRAND_PRIMARY,
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
