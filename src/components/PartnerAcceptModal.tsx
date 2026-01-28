import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
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

interface PartnerAcceptModalProps {
    visible: boolean;
    invite: ReceivedInvite | null;
    onClose: () => void;
    onConfirm: () => void;
    loading?: boolean;
}

export const PartnerAcceptModal: React.FC<PartnerAcceptModalProps> = ({
    visible,
    invite,
    onClose,
    onConfirm,
    loading = false
}) => {
    const theme = useTheme();

    if (!invite) return null;

    return (
        <BaseModal visible={visible} onClose={onClose}>
            <View style={styles.iconContainer}>
                <Icon name="handshake" size={40} color={theme.colors.primary} />
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

            <Text style={styles.subtext}>
                Accepting this invite will start syncing products to your catalog. This may take a few moments.
            </Text>

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
                    onPress={onConfirm}
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
        fontSize: 22,
        fontWeight: 'bold',
        color: '#111',
        marginBottom: 12,
        textAlign: 'center',
    },
    description: {
        fontSize: 16,
        color: '#4B5563',
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 22,
    },
    bold: {
        fontWeight: '700',
        color: '#111',
    },
    detailsContainer: {
        width: '100%',
        backgroundColor: '#F9FAFB',
        borderRadius: 12,
        padding: 16,
        marginBottom: 24,
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
        marginBottom: 24,
        fontStyle: 'italic',
    },
    buttonContainer: {
        flexDirection: 'row',
        width: '100%',
        gap: 12,
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
