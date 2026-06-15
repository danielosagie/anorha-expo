import React from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, TouchableWithoutFeedback, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Progress from 'react-native-progress';
import { useTheme } from '../context/ThemeContext';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { API_BASE_URL } from '../config/env';
import PlatformLogo from './PlatformLogo';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { ensureSupabaseJwt } from '../lib/supabase';
import BaseModal from './BaseModal';
import { useOrg } from '../context/OrgContext';
import { createLogger } from '../utils/logger';
const log = createLogger('ConnectedPlatformItem');

// --- Types ---
export type PlatformId = 'shopify' | 'amazon' | 'clover' | 'square' | 'ebay' | 'facebook' | 'depop' | 'whatnot' | 'etsy';

export interface PlatformConnection {
    Id: string;
    PlatformType: string;
    DisplayName: string;
    Status: string;
    IsEnabled: boolean;
    LastSyncSuccessAt: string | null;
    NeedsReauth?: boolean;
    RecommendedAction?: string;
    CreatedAt: string;
    UpdatedAt: string;
}

export interface PlatformConfig {
    key: string;
    name: string;
    icon: any;
}

export interface ConnectedPlatformItemProps {
    connection: PlatformConnection;
    platformConfig: PlatformConfig;
    isEditMode: boolean;
    onStartScan: (id: string, name: string, force?: boolean) => void;
    onReview: (id: string, name: string) => void;
    onReconnect: (id: string, platformKey: string, platformName: string) => void;
    onDisconnect: (id: string, name: string) => void;
    onFix: (id: string, name: string) => void;
    navigation: any;
}

// --- Constants ---
const CONNECTION_STATUS = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    PENDING: 'pending',
    REVIEW: 'review',
    READY_TO_SYNC: 'ready_to_sync',
    SCANNING: 'scanning',
    ERROR: 'error',
    SYNCING: 'syncing',
    RECONCILING: 'reconciling',
};

// --- Helpers ---
const getStatusDisplay = (status: string): { label: string, color: string, icon: string } => {
    switch (status?.toLowerCase()) {
        case CONNECTION_STATUS.ACTIVE:
            return { label: 'Connected', color: BRAND_PRIMARY, icon: 'check-circle' };
        case CONNECTION_STATUS.INACTIVE:
            return { label: 'Inactive', color: '#8E8E93', icon: 'pause-circle' };
        case CONNECTION_STATUS.PENDING:
            return { label: 'Ready to Scan', color: '#FF9500', icon: 'progress-clock' };
        case CONNECTION_STATUS.REVIEW:
            return { label: 'Review Products', color: '#FF9500', icon: 'sync-alert' };
        case CONNECTION_STATUS.READY_TO_SYNC:
            return { label: 'Ready to Sync', color: BRAND_PRIMARY, icon: 'check-circle' };
        case CONNECTION_STATUS.SCANNING:
            return { label: 'Scanning...', color: '#5856D6', icon: 'loading' };
        case CONNECTION_STATUS.SYNCING:
            return { label: 'Syncing...', color: BRAND_PRIMARY, icon: 'loading' };
        case CONNECTION_STATUS.RECONCILING:
            return { label: 'Reconciling...', color: '#5856D6', icon: 'loading' };
        case CONNECTION_STATUS.ERROR:
            return { label: 'Error', color: '#FF3B30', icon: 'alert-circle' };
        default:
            return { label: status || 'Unknown', color: '#8E8E93', icon: 'help-circle' };
    }
};

const getRecommendedAction = (
    connection: { Status: string; LastSyncSuccessAt: string | null; IsEnabled: boolean; NeedsReauth?: boolean; RecommendedAction?: string },
    platformType: string
): { action: 'reconnect' | 'rescan' | 'fix_resume' | 'manage'; label: string; icon: string; color: string; description: string } => {
    if (connection.RecommendedAction) {
        switch (connection.RecommendedAction) {
            case 'reconnect':
                return { action: 'reconnect', label: 'Reconnect', icon: 'link-variant', color: '#FF3B30', description: 'Re-authorize.' };
            case 'rescan':
                return { action: 'rescan', label: 'Rescan', icon: 'refresh', color: '#FF9500', description: 'Rescan products.' };
            case 'fix_resume':
                return { action: 'fix_resume', label: 'Re-enable', icon: 'play-circle', color: '#FF9500', description: 'Re-enable syncing.' };
            case 'manage':
            default:
                return { action: 'manage', label: 'Manage', icon: 'cog', color: '#007AFF', description: 'Manage settings.' };
        }
    }

    const status = connection.Status?.toLowerCase();
    const hasEverSynced = !!connection.LastSyncSuccessAt;
    const isEnabled = connection.IsEnabled;
    const needsReauth = connection.NeedsReauth === true;

    if (!isEnabled && status !== CONNECTION_STATUS.INACTIVE) {
        return { action: 'fix_resume', label: 'Re-enable', icon: 'play-circle', color: '#FF9500', description: 'Re-enable syncing.' };
    }

    if (needsReauth) {
        return { action: 'reconnect', label: 'Reconnect', icon: 'link-variant', color: '#FF3B30', description: 'Re-authorize.' };
    }

    if (status === CONNECTION_STATUS.ERROR) {
        if (!hasEverSynced) {
            if (['shopify', 'square', 'facebook', 'ebay', 'clover'].includes(platformType.toLowerCase())) {
                return { action: 'reconnect', label: 'Reconnect', icon: 'link-variant', color: '#FF3B30', description: 'Re-authorize.' };
            }
            return { action: 'rescan', label: 'Retry Scan', icon: 'refresh', color: '#FF9500', description: 'Retry scan.' };
        }
        return { action: 'rescan', label: 'Rescan', icon: 'refresh', color: '#FF9500', description: 'Rescan products.' };
    }

    return { action: 'manage', label: 'Manage', icon: 'cog', color: '#007AFF', description: 'Manage settings.' };
};

const formatSyncDate = (dateString: string): string => {
    const syncDate = new Date(dateString);
    const now = new Date();
    const isToday = syncDate.toDateString() === now.toDateString();
    const isThisYear = syncDate.getFullYear() === now.getFullYear();

    if (isToday) return syncDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (isThisYear) return syncDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return syncDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

// --- Component ---
const ConnectedPlatformItem: React.FC<ConnectedPlatformItemProps> = React.memo(({
    connection,
    platformConfig,
    isEditMode,
    onStartScan,
    onReview,
    onReconnect,
    onDisconnect,
    onFix,
    navigation
}) => {
    const theme = useTheme();
    const { progressByConnectionId } = usePlatformConnections();
    const { currentOrg } = useOrg();
    const progress = progressByConnectionId[connection.Id];

    let displayShopName = connection.DisplayName || platformConfig.name;
    if (connection.PlatformType === 'shopify' && connection.DisplayName.includes('.myshopify.com')) {
        displayShopName = connection.DisplayName.replace('.myshopify.com', '');
    }

    const progressStatus = (progress?.status || '').toLowerCase();
    const effectiveStatus = progressStatus && CONNECTION_STATUS[progressStatus.toUpperCase() as keyof typeof CONNECTION_STATUS]
        ? progressStatus
        : connection.Status;
    const statusInfo = getStatusDisplay(effectiveStatus);
    const actionConnection = { ...connection, Status: effectiveStatus };

    const isProgressActive = progressStatus === 'scanning' ||
        progressStatus === 'syncing' ||
        progressStatus === 'reconciling' ||
        progressStatus === 'queued';

    const rawProgress = typeof progress?.progress === 'number' ? progress.progress : 0;
    const progressValue = rawProgress > 1 ? rawProgress / 100 : rawProgress;


    // --- CSV Manage Logic ---
    const [manageMenuVisible, setManageMenuVisible] = React.useState(false);
    const [isExporting, setIsExporting] = React.useState(false);

    const openManageMenu = () => {
        setManageMenuVisible(true);
    };

    const handleExport = async () => {
        try {
            setIsExporting(true);
            const orgId = currentOrg?.id;
            if (!orgId) throw new Error('No active organization selected');

            const token = await ensureSupabaseJwt();
            if (!token) throw new Error('Not authenticated');

            const rawApiBase = API_BASE_URL;
            const apiBase = rawApiBase.endsWith('/api') ? rawApiBase : `${rawApiBase}/api`;
            const platformFilter = encodeURIComponent((connection.PlatformType || '').toLowerCase());
            const response = await fetch(
                `${apiBase}/organizations/${encodeURIComponent(orgId)}/export/current?platforms=${platformFilter}`,
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
            const fileUri = FileSystem.documentDirectory + fileName;
            await FileSystem.writeAsStringAsync(fileUri, csvString, { encoding: FileSystem.EncodingType.UTF8 });

            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Export Inventory CSV' });
            } else {
                Alert.alert('Sharing not available', 'Sharing is not available on this device');
            }

            setManageMenuVisible(false);

        } catch (err: any) {
            log.error('Export Error:', err);
            Alert.alert('Export Failed', err.message || 'Unknown error occurred');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <View style={styles.integrationItem}>
            {/* Left column: icon + name + status/timestamp */}
            <View style={styles.integrationLeft}>
                <View style={styles.platformIconContainer}>
                    <PlatformLogo type={platformConfig.key} size={32} fallbackIcon="store" />
                </View>

                <View style={styles.integrationMain}>
                    <Text style={styles.integrationName} numberOfLines={1} ellipsizeMode="tail">
                        {displayShopName}
                    </Text>

                    {!isEditMode && (
                        <View style={styles.statusContainer}>
                            {isProgressActive ? (
                                <View style={{ width: '100%', marginTop: 4 }}>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                                        <Text style={{ fontSize: 10, color: theme.colors.primary }}>
                                            {progress?.description || statusInfo.label || 'Processing...'}
                                        </Text>
                                        <Text style={{ fontSize: 10, color: theme.colors.textSecondary }}>
                                            {Math.round((progress?.progress || 0))}%
                                        </Text>
                                    </View>
                                    <Progress.Bar
                                        progress={progressValue}
                                        width={null}
                                        height={4}
                                        color={theme.colors.primary}
                                        unfilledColor={'#E5E7EB'}
                                        borderWidth={0}
                                    />
                                </View>
                            ) : (
                                <>
                                    <View style={styles.statusRow}>
                                        {statusInfo.icon === 'loading' ? (
                                            <ActivityIndicator size="small" color={statusInfo.color} style={styles.statusIcon} />
                                        ) : (
                                            <Icon name={statusInfo.icon} size={16} color={statusInfo.color} style={styles.statusIcon} />
                                        )}
                                        <Text style={[styles.statusText, { color: statusInfo.color }]}>
                                            {statusInfo.label}
                                        </Text>
                                    </View>
                                    {connection.LastSyncSuccessAt && (
                                        <Text style={styles.lastSyncText}>
                                            Last synced: {formatSyncDate(connection.LastSyncSuccessAt)}
                                        </Text>
                                    )}
                                </>
                            )}
                        </View>
                    )}
                </View>
            </View>

            {/* Right column: action buttons (non-edit mode only) */}
            {!isEditMode && connection && !isProgressActive && (
                <View style={styles.connectionActions}>
                    {connection.NeedsReauth && (
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: '#FF3B30' + '20' }]}
                            onPress={() => onReconnect(connection.Id, platformConfig.key, platformConfig.name)}
                        >
                            <Icon name="alert-circle" size={18} color="#FF3B30" />
                            <Text style={[styles.actionButtonText, { color: '#FF3B30' }]}>Re-auth</Text>
                        </TouchableOpacity>
                    )}

                    {!connection.NeedsReauth && effectiveStatus === CONNECTION_STATUS.PENDING && (
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: theme.colors.primary + '20' }]}
                            onPress={() => onStartScan(connection.Id, platformConfig.name)}
                        >
                            <Icon name="play-circle" size={18} color={theme.colors.primary} />
                            <Text style={[styles.actionButtonText, { color: theme.colors.primary }]}>Start Scan</Text>
                        </TouchableOpacity>
                    )}

                    {!connection.NeedsReauth && effectiveStatus === CONNECTION_STATUS.REVIEW && (
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: '#FF9500' + '20' }]}
                            onPress={() => onReview(connection.Id, platformConfig.name)}
                        >
                            <Icon name="eye" size={18} color="#FF9500" />
                            <Text style={[styles.actionButtonText, { color: '#FF9500' }]}>Review</Text>
                        </TouchableOpacity>
                    )}

                    {!connection.NeedsReauth && effectiveStatus === CONNECTION_STATUS.READY_TO_SYNC && (
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: theme.colors.success + '15' }]}
                            onPress={() => navigation.navigate('ImportOverview', { connectionId: connection.Id, platformName: platformConfig.name })}
                        >
                            <Icon name="check-circle" size={18} color={theme.colors.success} />
                            <Text style={[styles.actionButtonText, { color: theme.colors.success }]}>Ready</Text>
                        </TouchableOpacity>
                    )}

                    {!connection.NeedsReauth && (effectiveStatus === CONNECTION_STATUS.INACTIVE) && (
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: theme.colors.success + '15' }]}
                            onPress={() => onStartScan(connection.Id, platformConfig.name)}
                        >
                            <Icon name="play-circle" size={18} color={theme.colors.success} />
                            <Text style={[styles.actionButtonText, { color: theme.colors.success }]}>Activate</Text>
                        </TouchableOpacity>
                    )}

                    {!connection.NeedsReauth && effectiveStatus === CONNECTION_STATUS.ERROR && (() => {
                        const recommended = getRecommendedAction(actionConnection, platformConfig.key);
                        const handleAction = () => {
                            switch (recommended.action) {
                                case 'reconnect': onReconnect(connection.Id, platformConfig.key, platformConfig.name); break;
                                case 'rescan': onStartScan(connection.Id, platformConfig.name, true); break;
                                case 'fix_resume': onFix(connection.Id, platformConfig.name); break;
                                case 'manage':
                                    navigation.navigate('ImportOverview', { connectionId: connection.Id, platformName: platformConfig.name });
                                    break;
                            }
                        };
                        return (
                            <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: recommended.color + '15' }]}
                                onPress={handleAction}
                            >
                                <Icon name={recommended.icon} size={18} color={recommended.color} />
                                <Text style={[styles.actionButtonText, { color: recommended.color }]}>{recommended.label}</Text>
                            </TouchableOpacity>
                        );
                    })()}

                    {!connection.NeedsReauth && effectiveStatus === CONNECTION_STATUS.ACTIVE && (
                        <>
                            <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: theme.colors.primary + '15' }]}
                                onPress={() => {
                                    if (connection.PlatformType === 'csv') {
                                        openManageMenu();
                                    } else {
                                        navigation.navigate('ImportOverview', { connectionId: connection.Id, platformName: platformConfig.name });
                                    }
                                }}
                            >
                                <Icon name="cog" size={18} color={theme.colors.primary} />
                                <Text style={[styles.actionButtonText, { color: theme.colors.primary }]}>Manage</Text>
                            </TouchableOpacity>

                            {/* CSV Manage Modal */}
                            <BaseModal
                                visible={manageMenuVisible}
                                onClose={() => setManageMenuVisible(false)}
                                showCloseButton={true}
                                containerStyle={{ padding: 20, borderRadius: 16, width: '85%', maxWidth: 360 }}
                            >
                                <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 20, color: theme.colors.text }}>Manage Connection</Text>

                                <TouchableOpacity
                                    style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        padding: 16,
                                        backgroundColor: theme.colors.surface,
                                        borderRadius: 12,
                                        borderWidth: 1,
                                        borderColor: '#E5E7EB',
                                        marginBottom: 12,
                                        gap: 12
                                    }}
                                    onPress={handleExport}
                                    disabled={isExporting}
                                >
                                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0FDF4', alignItems: 'center', justifyContent: 'center' }}>
                                        {isExporting ? <ActivityIndicator size="small" color={BRAND_PRIMARY} /> : <Icon name="cloud-download" size={24} color={BRAND_PRIMARY} />}
                                    </View>
                                    <View>
                                        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.text }}>{isExporting ? 'Exporting...' : 'Export Inventory'}</Text>
                                        <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>Download CSV of current products</Text>
                                    </View>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        padding: 16,
                                        backgroundColor: theme.colors.surface,
                                        borderRadius: 12,
                                        borderWidth: 1,
                                        borderColor: '#E5E7EB',
                                        gap: 12
                                    }}
                                    onPress={() => {
                                        setManageMenuVisible(false);
                                        navigation.navigate('ImportOverview' as any, {
                                            connectionId: connection.Id,
                                            platformName: connection.DisplayName || 'CSV Connection',
                                        });
                                    }}
                                >
                                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' }}>
                                        <Icon name="cog" size={24} color="#4B5563" />
                                    </View>
                                    <View>
                                        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.text }}>Settings</Text>
                                        <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>Configure sync rules & mapping</Text>
                                    </View>
                                </TouchableOpacity>
                            </BaseModal>
                        </>
                    )}
                </View>
            )}

            {/* Edit Mode Actions */}
            {isEditMode && (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    {['square', 'shopify', 'facebook', 'clover', 'ebay'].includes(platformConfig.key) && (
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: '#FF9500' + '15' }]}
                            onPress={() => onStartScan(connection.Id, platformConfig.name, true)}
                        >
                            <Icon name="refresh" size={18} color="#FF9500" />
                            <Text style={[styles.actionButtonText, { color: '#FF9500' }]}>Rescan</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={() => onDisconnect(connection.Id, platformConfig.name)}
                    >
                        <Icon name="minus-circle-outline" size={24} color={theme.colors.error} />
                        <Text style={{ color: "red", fontSize: 14 }}>Disconnect</Text>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
});

const styles = StyleSheet.create({
    integrationItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#f0f0f0e6',
        borderRadius: 12,
        marginBottom: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    integrationLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    platformIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#F3F4F6',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    integrationMain: {
        flex: 1,
        justifyContent: 'center',
    },
    integrationName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111827',
        marginBottom: 2,
    },
    statusContainer: {
        flexDirection: 'column',
        alignItems: 'flex-start',
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    statusIcon: {
        marginRight: 2,
    },
    statusText: {
        fontSize: 13,
        fontWeight: '500',
    },
    lastSyncText: {
        fontSize: 11,
        color: '#9CA3AF',
        marginTop: 1,
    },
    connectionActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
        gap: 4,
    },
    actionButtonText: {
        fontSize: 13,
        fontWeight: '600',
    },
    deleteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 8,
        borderRadius: 8,
        backgroundColor: '#FEF2F2',
        gap: 4,
    },
    managePopover: {
        position: 'absolute',
        width: 180,
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 8,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 10,
    },
    popoverItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        gap: 12,
    },
    popoverText: {
        fontSize: 15,
        color: '#333',
    },
    popoverDivider: {
        height: 1,
        backgroundColor: '#F3F4F6',
        marginHorizontal: 8,
    },
});

export default ConnectedPlatformItem;
