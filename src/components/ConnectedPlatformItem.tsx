import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal, TouchableWithoutFeedback, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Progress from 'react-native-progress';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { useSyncProgress } from '../hooks/useSyncProgress';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
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
const getPlatformIcon = (platformId: string): React.ComponentType<any> | null => {
    const iconMap: { [key: string]: React.ComponentType<any> } = {
        shopify: ShopifySvg,
        amazon: AmazonSvg,
        facebook: FacebookSvg,
        ebay: EbaySvg,
        clover: CloverSvg,
        square: SquareSvg,
    };
    return iconMap[platformId] || null;
};

const getStatusDisplay = (status: string): { label: string, color: string, icon: string } => {
    switch (status?.toLowerCase()) {
        case CONNECTION_STATUS.ACTIVE:
            return { label: 'Connected', color: '#93C822', icon: 'check-circle' };
        case CONNECTION_STATUS.INACTIVE:
            return { label: 'Inactive', color: '#8E8E93', icon: 'pause-circle' };
        case CONNECTION_STATUS.PENDING:
            return { label: 'Ready to Scan', color: '#FF9500', icon: 'progress-clock' };
        case CONNECTION_STATUS.REVIEW:
            return { label: 'Review Products', color: '#FF9500', icon: 'sync-alert' };
        case CONNECTION_STATUS.READY_TO_SYNC:
            return { label: 'Ready to Sync', color: '#93C822', icon: 'check-circle' };
        case CONNECTION_STATUS.SCANNING:
            return { label: 'Scanning...', color: '#5856D6', icon: 'loading' };
        case CONNECTION_STATUS.SYNCING:
            return { label: 'Syncing...', color: '#93C822', icon: 'loading' };
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
    const { progress } = useSyncProgress(connection.Id);

    let displayShopName = connection.DisplayName || platformConfig.name;
    if (connection.PlatformType === 'shopify' && connection.DisplayName.includes('.myshopify.com')) {
        displayShopName = connection.DisplayName.replace('.myshopify.com', '');
    }

    const PlatformIconComponent = getPlatformIcon(platformConfig.key);
    const statusInfo = getStatusDisplay(connection.Status);

    const status = (progress?.status as any);
    const isProgressActive = status === 'scanning' ||
        status === 'syncing' ||
        status === 'reconciling' ||
        status === 'queued';

    const progressValue = (progress?.progress || 0) / 100;


    // --- CSV Manage Logic ---
    const [manageMenuVisible, setManageMenuVisible] = React.useState(false);
    const [manageMenuPosition, setManageMenuPosition] = React.useState({ top: 0, left: 0 });
    const [isExporting, setIsExporting] = React.useState(false);
    const manageButtonRef = React.useRef<View>(null);

    const openManageMenu = () => {
        manageButtonRef.current?.measure((x, y, width, height, pageX, pageY) => {
            // Position above the button, aligned right
            setManageMenuPosition({ top: pageY - 100, left: pageX + width - 180 }); // rough estimate
            setManageMenuVisible(true);
        });
    };

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
            const fileUri = FileSystem.documentDirectory + fileName;
            await FileSystem.writeAsStringAsync(fileUri, csvString, { encoding: FileSystem.EncodingType.UTF8 });

            // 5. Share
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Export Inventory CSV' });
            } else {
                Alert.alert('Sharing not available', 'Sharing is not available on this device');
            }

            setManageMenuVisible(false);

        } catch (err: any) {
            console.error('Export Error:', err);
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
                    {PlatformIconComponent ? (
                        <PlatformIconComponent width={32} height={32} />
                    ) : (
                        <Icon name="store" size={32} color="#555" />
                    )}
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

                    {!connection.NeedsReauth && connection.Status === CONNECTION_STATUS.PENDING && (
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: theme.colors.primary + '20' }]}
                            onPress={() => onStartScan(connection.Id, platformConfig.name)}
                        >
                            <Icon name="play-circle" size={18} color={theme.colors.primary} />
                            <Text style={[styles.actionButtonText, { color: theme.colors.primary }]}>Start Scan</Text>
                        </TouchableOpacity>
                    )}

                    {!connection.NeedsReauth && connection.Status === CONNECTION_STATUS.REVIEW && (
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: '#FF9500' + '20' }]}
                            onPress={() => onReview(connection.Id, platformConfig.name)}
                        >
                            <Icon name="eye" size={18} color="#FF9500" />
                            <Text style={[styles.actionButtonText, { color: '#FF9500' }]}>Review</Text>
                        </TouchableOpacity>
                    )}

                    {!connection.NeedsReauth && connection.Status === CONNECTION_STATUS.READY_TO_SYNC && (
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: theme.colors.success + '15' }]}
                            onPress={() => navigation.navigate('MappingReview', { connectionId: connection.Id, platformName: platformConfig.name })}
                        >
                            <Icon name="check-circle" size={18} color={theme.colors.success} />
                            <Text style={[styles.actionButtonText, { color: theme.colors.success }]}>Ready</Text>
                        </TouchableOpacity>
                    )}

                    {!connection.NeedsReauth && (connection.Status === CONNECTION_STATUS.INACTIVE) && (
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: theme.colors.success + '15' }]}
                            onPress={() => onStartScan(connection.Id, platformConfig.name)}
                        >
                            <Icon name="play-circle" size={18} color={theme.colors.success} />
                            <Text style={[styles.actionButtonText, { color: theme.colors.success }]}>Activate</Text>
                        </TouchableOpacity>
                    )}

                    {!connection.NeedsReauth && connection.Status === CONNECTION_STATUS.ERROR && (() => {
                        const recommended = getRecommendedAction(connection, platformConfig.key);
                        const handleAction = () => {
                            switch (recommended.action) {
                                case 'reconnect': onReconnect(connection.Id, platformConfig.key, platformConfig.name); break;
                                case 'rescan': onStartScan(connection.Id, platformConfig.name, true); break;
                                case 'fix_resume': onFix(connection.Id, platformConfig.name); break;
                                case 'manage':
                                    navigation.navigate('MappingReview', { connectionId: connection.Id, platformName: platformConfig.name });
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

                    {!connection.NeedsReauth && connection.Status === CONNECTION_STATUS.ACTIVE && (
                        <>
                            <TouchableOpacity
                                ref={manageButtonRef as any}
                                style={[styles.actionButton, { backgroundColor: theme.colors.primary + '15' }]}
                                onPress={() => {
                                    if (connection.PlatformType === 'csv') {
                                        openManageMenu();
                                    } else {
                                        navigation.navigate('MappingReview', { connectionId: connection.Id, platformName: platformConfig.name });
                                    }
                                }}
                            >
                                <Icon name="cog" size={18} color={theme.colors.primary} />
                                <Text style={[styles.actionButtonText, { color: theme.colors.primary }]}>Manage</Text>
                            </TouchableOpacity>

                            {/* CSV Manage Popover */}
                            <Modal
                                visible={manageMenuVisible}
                                transparent={true}
                                animationType="fade"
                                onRequestClose={() => setManageMenuVisible(false)}
                            >
                                <TouchableWithoutFeedback onPress={() => setManageMenuVisible(false)}>
                                    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.1)' }}>
                                        <View style={[
                                            styles.managePopover,
                                            {
                                                top: manageMenuPosition.top,
                                                left: manageMenuPosition.left,
                                            }
                                        ]}>
                                            <TouchableOpacity
                                                style={styles.popoverItem}
                                                onPress={handleExport}
                                                disabled={isExporting}
                                            >
                                                {isExporting ? <ActivityIndicator size="small" color="#93C822" /> : <Icon name="cloud-download" size={20} color="#93C822" />}
                                                <Text style={[styles.popoverText, { fontWeight: '600' }]}>{isExporting ? 'Exporting...' : 'Export CSV'}</Text>
                                            </TouchableOpacity>
                                            <View style={styles.popoverDivider} />
                                            <TouchableOpacity
                                                style={styles.popoverItem}
                                                onPress={() => {
                                                    setManageMenuVisible(false);
                                                    navigation.navigate('MappingReview' as any, {
                                                        connectionId: connection.Id,
                                                        platformName: connection.DisplayName || 'CSV Connection',
                                                    });
                                                }}
                                            >
                                                <Icon name="cog" size={20} color="#666" />
                                                <Text style={styles.popoverText}>Settings</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                </TouchableWithoutFeedback>
                            </Modal>
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
