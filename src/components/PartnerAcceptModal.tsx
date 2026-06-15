import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BaseModal } from './BaseModal';
import { Handshake, Folder, Package, Tag, Check } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';

const ANORHA_GREEN = '#93C822';
const ANORHA_GREEN_TINT = 'rgba(147,200,34,0.12)';

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
            containerStyle={{ paddingBottom: bottomPadding, paddingTop: 12 }}
        >
            <View style={styles.dragHandle} />

            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.iconContainer}>
                    <Handshake size={32} color={ANORHA_GREEN} />
                </View>

                <Text style={styles.title}>Accept Partnership?</Text>

                <Text style={styles.description}>
                    You are about to accept an invitation from <Text style={styles.bold}>{invite.sourceOrgName}</Text>.
                </Text>

                <View style={styles.detailsContainer}>
                    <View style={styles.detailRow}>
                        <Folder size={20} color="#71717A" />
                        <Text style={styles.detailText}>Pool: <Text style={styles.bold}>{invite.sourcePoolName}</Text></Text>
                    </View>
                    <View style={styles.detailRow}>
                        <Package size={20} color="#71717A" />
                        <Text style={styles.detailText}>Products: <Text style={styles.bold}>{invite.productCount}</Text></Text>
                    </View>
                    <View style={styles.detailRow}>
                        <Tag size={20} color="#71717A" />
                        <Text style={styles.detailText}>Type: <Text style={styles.bold}>{invite.shareType}</Text></Text>
                    </View>
                </View>

                {/*

                <Text style={styles.locationSectionTitle}>Which location(s) should sync with this partner?</Text>
                {locationsLoading ? (
                    <View style={styles.locationLoadingRow}>
                        <ActivityIndicator size="small" color={ANORHA_GREEN} />
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
                                        <View style={[styles.checkbox, selectedLocationIds.includes(loc.platformLocationId) && styles.checkboxOn]}>
                                            {selectedLocationIds.includes(loc.platformLocationId) && (
                                                <Check size={16} color="#FFFFFF" strokeWidth={3} />
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
                    style={[styles.button, styles.confirmButton]}
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
    dragHandle: {
        width: 60,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#D4D4D8',
        alignSelf: 'center',
        marginBottom: 16,
    },
    scroll: {
        maxHeight: '75%',
    },
    scrollContent: {
        alignItems: 'center',
        paddingBottom: 24,
    },
    locationSectionTitle: {
        fontSize: 14,
        fontFamily: 'Inter_600SemiBold',
        color: '#18181B',
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
        fontFamily: 'Inter_400Regular',
        color: '#71717A',
    },
    locationEmptyText: {
        fontSize: 13,
        fontFamily: 'Inter_400Regular',
        color: '#71717A',
        backgroundColor: '#FAFAF8',
        borderWidth: 1,
        borderColor: '#ECEBE6',
        borderRadius: 14,
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
        fontFamily: 'Inter_600SemiBold',
        color: '#71717A',
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
        width: 24,
        height: 24,
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: '#D4D4D8',
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    checkboxOn: {
        backgroundColor: ANORHA_GREEN,
        borderColor: ANORHA_GREEN,
    },
    locationName: {
        fontSize: 15,
        fontFamily: 'Inter_400Regular',
        color: '#18181B',
    },
    iconContainer: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: ANORHA_GREEN_TINT,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontFamily: 'Inter_700Bold',
        color: '#18181B',
        marginBottom: 8,
        textAlign: 'center',
    },
    description: {
        fontSize: 14,
        fontFamily: 'Inter_400Regular',
        color: '#71717A',
        textAlign: 'center',
        marginBottom: 16,
        lineHeight: 21,
    },
    bold: {
        fontFamily: 'Inter_700Bold',
        color: '#18181B',
    },
    detailsContainer: {
        width: '100%',
        maxWidth: 320,
        alignSelf: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 14,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#ECEBE6',
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    detailText: {
        marginLeft: 12,
        fontSize: 14,
        fontFamily: 'Inter_400Regular',
        color: '#71717A',
        lineHeight: 21,
    },
    subtext: {
        fontSize: 13,
        fontFamily: 'Inter_400Regular',
        color: '#71717A',
        lineHeight: 20,
        textAlign: 'center',
        marginBottom: 8,
    },
    buttonContainer: {
        flexDirection: 'row',
        width: '100%',
        gap: 12,
        marginTop: 16,
    },
    button: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButton: {
        backgroundColor: '#F1F1EE',
    },
    confirmButton: {
        backgroundColor: ANORHA_GREEN,
    },
    cancelButtonText: {
        color: '#18181B',
        fontFamily: 'Inter_600SemiBold',
        fontSize: 15,
    },
    confirmButtonText: {
        color: '#FFFFFF',
        fontFamily: 'Inter_700Bold',
        fontSize: 15,
    },
});
