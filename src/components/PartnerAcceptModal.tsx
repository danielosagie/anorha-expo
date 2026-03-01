import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BaseModal } from './BaseModal';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';

interface ReceivedInvite {
    id: string;
    sourceOrgName: string;
    sourcePoolName: string;
    shareType: string;
    productCount: number;
    variantCount: number;
}

export type AvailableLocationsGroup = Record<string, {
    connectionName: string;
    platformType: string;
    locations: { platformLocationId: string; locationName: string }[];
}>;

interface PartnerAcceptModalProps {
    visible: boolean;
    invite: ReceivedInvite | null;
    onClose: () => void;
    onConfirm: (selectedLocationIds: string[]) => void;
    loading?: boolean;
    availableLocations?: AvailableLocationsGroup;
    locationsLoading?: boolean;
    selectedLocationIds: string[];
    onSelectionChange: (ids: string[]) => void;
}

export const PartnerAcceptModal: React.FC<PartnerAcceptModalProps> = ({
    visible,
    invite,
    onClose,
    onConfirm,
    loading = false,
    availableLocations = {},
    locationsLoading = false,
    selectedLocationIds,
    onSelectionChange,
}) => {
    const theme = useTheme();
    const insets = useSafeAreaInsets();

    if (!invite) return null;

    const locationEntries = Object.entries(availableLocations);
    const hasAnyLocations = locationEntries.some(([, g]) => (g.locations?.length ?? 0) > 0);
    const toggleLocation = (id: string) => {
        const next = selectedLocationIds.includes(id)
            ? selectedLocationIds.filter((x) => x !== id)
            : [...selectedLocationIds, id];
        onSelectionChange(next);
    };

    const bottomPadding = Math.max(insets.bottom, 16);

    return (
        <BaseModal
            visible={visible}
            onClose={onClose}
            position="bottom"
            containerStyle={{ paddingBottom: 0 }}
        >
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.iconContainer}>
                    <Icon name="handshake" size={32} color={theme.colors.primary} />
                </View>

                <Text style={styles.title}>Accept Partnership?</Text>

                <Text style={styles.description}>
                    You are about to accept an invitation from <Text style={styles.bold}>{invite.sourceOrgName}</Text>.
                </Text>

                <View style={styles.detailsContainer}>
                    <View style={styles.detailRow}>
                        <Icon name="folder-outline" size={20} color="#666" />
                        <Text style={styles.detailText}>Pool: <Text style={styles.bold}>{invite.sourcePoolName}</Text></Text>
                    </View>
                    <View style={styles.detailRow}>
                        <Icon name="cube-outline" size={20} color="#666" />
                        <Text style={styles.detailText}>Products: <Text style={styles.bold}>{invite.productCount}</Text></Text>
                    </View>
                    <View style={styles.detailRow}>
                        <Icon name="tag-outline" size={20} color="#666" />
                        <Text style={styles.detailText}>Type: <Text style={styles.bold}>{invite.shareType}</Text></Text>
                    </View>
                </View>

                {/*

                <Text style={styles.locationSectionTitle}>Which location(s) should sync with this partner?</Text>
                {locationsLoading ? (
                    <View style={styles.locationLoadingRow}>
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                        <Text style={styles.locationLoadingText}>Loading locations...</Text>
                    </View>
                ) : !hasAnyLocations ? (
                    <Text style={styles.locationEmptyText}>
                        You can add locations to this pool later in Locations.
                    </Text>
                ) : (
                    <View style={styles.locationList}>
                        {locationEntries.map(([connId, group]) => (
                            <View key={connId} style={styles.locationGroup}>
                                <Text style={styles.locationGroupLabel}>
                                    {group.connectionName || group.platformType}
                                </Text>
                                {(group.locations || []).map((loc) => (
                                    <TouchableOpacity
                                        key={loc.platformLocationId}
                                        style={styles.locationRow}
                                        onPress={() => toggleLocation(loc.platformLocationId)}
                                        activeOpacity={0.7}
                                    >
                                        <View style={[styles.checkbox, selectedLocationIds.includes(loc.platformLocationId) && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }]}>
                                            {selectedLocationIds.includes(loc.platformLocationId) && (
                                                <Icon name="check" size={14} color="#FFF" />
                                            )}
                                        </View>
                                        <Text style={styles.locationName}>{loc.locationName}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        ))}
                    </View>
                )}

                */}

                <Text style={styles.subtext}>
                    Accepting this invite will start syncing products to your catalog. This may take a few moments.
                </Text>
            </ScrollView>

            <View style={styles.buttonContainer}>
                <TouchableOpacity
                    style={[styles.button, styles.cancelButton]}
                    onPress={onClose}
                    disabled={loading}
                >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.button, styles.confirmButton, { backgroundColor: theme.colors.primary }]}
                    onPress={() => onConfirm(selectedLocationIds)}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                        <Text style={styles.confirmButtonText}>Confirm & Accept</Text>
                    )}
                </TouchableOpacity>
            </View>
        </BaseModal>
    );
};

const styles = StyleSheet.create({
    scroll: {
        maxHeight: '75%',
    },
    scrollContent: {
        alignItems: 'center',
        paddingBottom: 48,
    },
    locationSectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
        textAlign: 'center',
    },
    locationLoadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 12,
    },
    locationLoadingText: {
        fontSize: 14,
        color: '#6B7280',
    },
    locationEmptyText: {
        fontSize: 13,
        color: '#6B7280',
        backgroundColor: '#FFFBEB',
        borderWidth: 1,
        borderColor: '#FDE68A',
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        textAlign: 'center',
    },
    locationList: {
        width: '100%',
        marginBottom: 12,
        maxHeight: 160,
    },
    locationGroup: {
        marginBottom: 12,
    },
    locationGroupLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: '#6B7280',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 6,
    },
    locationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingLeft: 4,
    },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: '#D1D5DB',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    locationName: {
        fontSize: 15,
        color: '#111827',
    },
    iconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#F0FDF4', // Light green
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111',
        marginBottom: 8,
        textAlign: 'center',
    },
    description: {
        fontSize: 15,
        color: '#4B5563',
        textAlign: 'center',
        marginBottom: 16,
        lineHeight: 22,
    },
    bold: {
        fontWeight: '700',
        color: '#111',
    },
    detailsContainer: {
        width: '100%',
        maxWidth: 320,
        alignSelf: 'center',
        backgroundColor: '#F9FAFB',
        borderRadius: 12,
        padding: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#F3F4F6',
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    detailText: {
        marginLeft: 12,
        fontSize: 15,
        color: '#374151',
    },
    subtext: {
        fontSize: 13,
        color: '#6B7280',
        textAlign: 'center',
        marginBottom: 32,
        fontStyle: 'italic',
    },
    buttonContainer: {
        flexDirection: 'row',
        width: '100%',
        gap: 12,
        marginTop: 8,
    },
    button: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButton: {
        backgroundColor: '#F3F4F6',
    },
    confirmButton: {
        // Background color set via props/style
    },
    cancelButtonText: {
        color: '#4B5563',
        fontWeight: '600',
        fontSize: 16,
    },
    confirmButtonText: {
        color: '#FFF',
        fontWeight: 'bold',
        fontSize: 16,
    },
});
