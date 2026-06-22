import React, { useEffect, useState } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator
} from 'react-native';
import { BlurView } from 'expo-blur';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { PLATFORM_META } from '../utils/platformConstants';
import { createLogger } from '../utils/logger';
const log = createLogger('PublishConfirmationModal');


interface PublishConfirmationModalProps {
    visible: boolean;
    onClose: () => void;
    onConfirm: () => void;
    readyPlatforms: string[];
    allConnections: any[];
    selectedConnectionIds: Record<string, string>;
    setSelectedConnectionIds: (ids: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
    productSummary: {
        title?: string;
        sku?: string;
        price?: number | string;
    };
    isPublishing?: boolean;
    /** When provided, shows a "Save to inventory only" option (no platform publish). */
    onSaveToInventory?: () => void;
}

export default function PublishConfirmationModal({
    visible,
    onClose,
    onConfirm,
    readyPlatforms,
    allConnections,
    selectedConnectionIds,
    setSelectedConnectionIds,
    productSummary,
    isPublishing = false,
    onSaveToInventory
}: PublishConfirmationModalProps) {

    // Track which platforms are selected for publishing
    const [selectedPlatforms, setSelectedPlatforms] = React.useState<Set<string>>(new Set());

    // Auto-select "ALL" for platforms that haven't been selected yet - use allConnections, not readyPlatforms
    useEffect(() => {
        if (visible && allConnections.length > 0) {
            log.debug('[PublishModal] Modal opened');
            log.debug('[PublishModal] allConnections:', allConnections);
            log.debug('[PublishModal] allConnections.length:', allConnections?.length);

            // Group connections by platform
            const platformGroups: Record<string, any[]> = {};
            allConnections.forEach((conn: any) => {
                if (!conn.IsEnabled) return;
                const platform = conn.PlatformType?.toLowerCase();
                if (!platform) return;
                if (!platformGroups[platform]) platformGroups[platform] = [];
                platformGroups[platform].push(conn);
            });

            // Auto-select all platforms
            setSelectedPlatforms(new Set(Object.keys(platformGroups)));

            const newSelections: Record<string, string> = { ...selectedConnectionIds };
            let hasChanges = false;

            // Auto-select ALL for each platform with connections
            Object.keys(platformGroups).forEach(platform => {
                if (newSelections[platform] === undefined) {
                    newSelections[platform] = 'ALL';
                    hasChanges = true;
                }
            });

            if (hasChanges) {
                setSelectedConnectionIds(newSelections);
            }
        }
    }, [visible, allConnections]);

    const calculateTotalAccounts = () => {
        let total = 0;

        // Group connections by platform
        const platformGroups: Record<string, any[]> = {};
        allConnections.forEach((conn: any) => {
            if (!conn.IsEnabled) return;
            const platform = conn.PlatformType?.toLowerCase();
            if (!platform) return;
            if (!platformGroups[platform]) platformGroups[platform] = [];
            platformGroups[platform].push(conn);
        });

        for (const [platform, selection] of Object.entries(selectedConnectionIds)) {
            // Only count if platform is selected
            if (!selectedPlatforms.has(platform)) continue;

            const connections = platformGroups[platform] || [];
            if (connections.length === 0) continue;

            if (selection === 'ALL') {
                total += connections.length;
            } else {
                total += 1;
            }
        }
        return total;
    };

    const totalAccounts = calculateTotalAccounts();
    const hasSelection = totalAccounts > 0;

    // Calculate how many platforms actually have connections
    const enabledConnections = allConnections.filter((c: any) => c.IsEnabled);
    const uniquePlatforms = new Set(enabledConnections.map((c: any) => c.PlatformType?.toLowerCase()).filter(Boolean));
    const platformsWithConnections = selectedPlatforms.size;

    const togglePlatform = (platform: string) => {
        const newSet = new Set(selectedPlatforms);
        if (newSet.has(platform)) {
            newSet.delete(platform);
        } else {
            newSet.add(platform);
        }
        setSelectedPlatforms(newSet);
    };

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="slide"
            onRequestClose={onClose}
        >
            <View style={styles.backdrop}>
                <View style={styles.container}>
                    <View style={styles.grabber} />
                    <View style={styles.header}>
                        <View>
                            <Text style={styles.title}>Review & Publish</Text>
                            <Text style={styles.subtitle}>
                                Publishing to {platformsWithConnections} platform{platformsWithConnections !== 1 ? 's' : ''}
                            </Text>
                        </View>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Icon name="close" size={20} color="#666" />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.summaryCard}>
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>Product:</Text>
                            <Text style={styles.summaryValue} numberOfLines={1}>{productSummary?.title || 'Untitled'}</Text>
                        </View>
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>SKU:</Text>
                            <Text style={styles.summaryValue}>{productSummary?.sku || 'N/A'}</Text>
                        </View>
                        <View style={styles.summaryRow}>
                            <Text style={styles.summaryLabel}>Price:</Text>
                            <Text style={styles.summaryValue}>${productSummary?.price || 0}</Text>
                        </View>
                    </View>

                    <Text style={styles.sectionTitle}>Select Accounts</Text>

                    <ScrollView style={styles.scrollArea}>
                        {(() => {
                            // Group connections by platform type
                            const platformGroups: Record<string, any[]> = {};
                            allConnections.forEach((conn: any) => {
                                if (!conn.IsEnabled) return;
                                const platform = conn.PlatformType?.toLowerCase();
                                if (!platform) return;
                                if (!platformGroups[platform]) platformGroups[platform] = [];
                                platformGroups[platform].push(conn);
                            });

                            log.debug('[PublishModal] platformGroups:', Object.keys(platformGroups));
                            log.debug('[PublishModal] allConnections count:', allConnections.length);

                            if (Object.keys(platformGroups).length === 0) {
                                return (
                                    <View style={{ padding: 20, alignItems: 'center' }}>
                                        <Text style={{ color: '#666', fontSize: 14 }}>No connected accounts found</Text>
                                        <Text style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                                            Connect a platform in Settings to start publishing
                                        </Text>
                                    </View>
                                );
                            }

                            return Object.entries(platformGroups).map(([platform, connections]) => {
                                const selectedConnId = selectedConnectionIds[platform];
                                const allSelected = selectedConnId === 'ALL';
                                const meta = PLATFORM_META[platform] || { label: platform.charAt(0).toUpperCase() + platform.slice(1), icon: 'application' };
                                const isPlatformSelected = selectedPlatforms.has(platform);

                                return (
                                    <View key={platform} style={styles.platformSection}>
                                        <TouchableOpacity
                                            style={styles.platformHeader}
                                            onPress={() => togglePlatform(platform)}
                                        >
                                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                                <Icon
                                                    name={isPlatformSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                                                    size={22}
                                                    color={isPlatformSelected ? BRAND_PRIMARY : '#9CA3AF'}
                                                    style={{ marginRight: 8 }}
                                                />
                                                <Icon name={meta.icon} size={18} color="#374151" style={{ marginRight: 8 }} />
                                                <Text style={styles.platformTitle}>{meta.label}</Text>
                                            </View>
                                        </TouchableOpacity>

                                        {isPlatformSelected && (
                                            <View style={styles.connectionsList}>
                                                {connections.length > 1 && (
                                                    <TouchableOpacity
                                                        onPress={() => setSelectedConnectionIds(prev => ({ ...prev, [platform]: 'ALL' }))}
                                                        style={[styles.optionRow, allSelected && styles.optionRowSelected]}
                                                    >
                                                        <Text style={[styles.optionText, allSelected && styles.optionTextSelected]}>
                                                            All Accounts ({connections.length})
                                                        </Text>
                                                        {allSelected && <Icon name="check-circle" size={20} color={BRAND_PRIMARY} />}
                                                    </TouchableOpacity>
                                                )}

                                                {connections.map((conn: any) => {
                                                    const isSelected = selectedConnId === conn.Id || (connections.length === 1 && selectedConnId === 'ALL');
                                                    return (
                                                        <TouchableOpacity
                                                            key={conn.Id}
                                                            onPress={() => setSelectedConnectionIds(prev => ({ ...prev, [platform]: conn.Id }))}
                                                            style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                                                        >
                                                            <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                                                                {conn.DisplayName || conn.PlatformType}
                                                            </Text>
                                                            {isSelected && <Icon name="check-circle" size={20} color={BRAND_PRIMARY} />}
                                                        </TouchableOpacity>
                                                    );
                                                })}
                                            </View>
                                        )}
                                    </View>
                                );
                            });
                        })()}
                    </ScrollView>

                    <View style={styles.footer}>
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.cancelButton}
                            disabled={isPublishing}
                        >
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={onConfirm}
                            style={[styles.publishButton, (!hasSelection || isPublishing) && styles.publishButtonDisabled]}
                            disabled={!hasSelection || isPublishing}
                        >
                            {isPublishing ? (
                                <ActivityIndicator color="#FFF" size="small" />
                            ) : (
                                <Text style={styles.publishButtonText}>
                                    Publish to {totalAccounts} Account{totalAccounts !== 1 ? 's' : ''}
                                </Text>
                            )}
                        </TouchableOpacity>
                    </View>

                    {onSaveToInventory ? (
                        <TouchableOpacity
                            onPress={onSaveToInventory}
                            disabled={isPublishing}
                            style={styles.saveOnlyButton}
                        >
                            <Icon name="content-save-outline" size={16} color="#6B7280" />
                            <Text style={styles.saveOnlyText}>Just save to inventory</Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'flex-end',
        alignItems: 'stretch',
        padding: 0
    },
    grabber: {
        alignSelf: 'center',
        width: 40,
        height: 5,
        borderRadius: 999,
        backgroundColor: '#E5E7EB',
        marginTop: 8,
        marginBottom: 2,
    },
    container: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        width: '100%',
        maxHeight: '90%',
        paddingBottom: 28,
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: -4,
        },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: 24,
        paddingBottom: 16
    },
    title: {
        fontSize: 24,
        fontWeight: '800',
        color: '#111827',
        marginBottom: 4
    },
    subtitle: {
        fontSize: 14,
        color: '#6B7280',
        fontWeight: '500'
    },
    closeButton: {
        padding: 8,
        backgroundColor: '#F3F4F6',
        borderRadius: 20,
    },
    summaryCard: {
        backgroundColor: '#F9FAFB',
        marginHorizontal: 24,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        marginBottom: 24
    },
    summaryRow: {
        flexDirection: 'row',
        marginBottom: 8,
        alignItems: 'flex-start'
    },
    summaryLabel: {
        width: 60,
        fontSize: 13,
        color: '#6B7280',
        fontWeight: '500'
    },
    summaryValue: {
        flex: 1,
        fontSize: 13,
        color: '#111827',
        fontWeight: '600'
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#111827',
        marginHorizontal: 24,
        marginBottom: 12
    },
    scrollArea: {
        paddingHorizontal: 24,
        maxHeight: 180, // Limit height to ensure footer stays visible
        flexGrow: 0,
        flexShrink: 1
    },
    platformSection: {
        marginBottom: 20
    },
    platformHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8
    },
    platformTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: '#4B5563',
        textTransform: 'uppercase',
        letterSpacing: 0.5
    },
    connectionsList: {
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: '#fff'
    },
    emptyStateText: {
        color: '#EF4444',
        fontSize: 13,
        fontStyle: 'italic',
        marginTop: 4
    },
    optionRow: {
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        backgroundColor: '#fff'
    },
    optionRowSelected: {
        backgroundColor: '#ECFCCB' // Light lime background
    },
    optionText: {
        fontSize: 14,
        color: '#374151',
        fontWeight: '500'
    },
    optionTextSelected: {
        color: '#365314', // Dark green text
        fontWeight: '700'
    },
    footer: {
        padding: 24,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        flexDirection: 'row',
        gap: 12
    },
    cancelButton: {
        flex: 1,
        paddingVertical: 14,
        backgroundColor: '#F3F4F6',
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center'
    },
    cancelButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#4B5563'
    },
    saveOnlyButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingBottom: 20,
        paddingTop: 2,
    },
    saveOnlyText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6B7280',
    },
    publishButton: {
        flex: 1,
        paddingVertical: 14,
        backgroundColor: BRAND_PRIMARY,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: BRAND_PRIMARY,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4
    },
    publishButtonDisabled: {
        backgroundColor: '#E5E7EB',
        shadowOpacity: 0,
        elevation: 0
    },
    publishButtonText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#FFF'
    }
});
