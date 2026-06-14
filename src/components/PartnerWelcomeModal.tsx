import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { BaseModal } from './BaseModal';
import PlatformLogo from './PlatformLogo';

interface PartnerWelcomeModalProps {
    visible: boolean;
    partnerName: string;
    onDismiss: () => void;
    onConnectPlatform: () => void;
}

/**
 * Partner FTUX Welcome Modal - Shows when a partner user has forked products 
 * but hasn't connected a platform yet.
 * 
 * Built on top of BaseModal for consistent styling.
 */
export const PartnerWelcomeModal: React.FC<PartnerWelcomeModalProps> = ({
    visible,
    partnerName,
    onDismiss,
    onConnectPlatform,
}) => {
    const handleConnectPress = () => {
        onDismiss();
        onConnectPlatform();
    };

    return (
        <BaseModal visible={visible} onClose={onDismiss}>
            <View style={styles.iconContainer}>
                <Icon name="handshake" size={40} color="#647653" />
            </View>

            <Text style={styles.title}>
                Welcome to {partnerName}'s Network!
            </Text>

            <Text style={styles.description}>
                To start selling these products, you need to connect your own POS or E-commerce platform.
            </Text>

            <TouchableOpacity
                onPress={handleConnectPress}
                style={styles.connectButton}
            >
                <Text style={styles.connectButtonText}>
                    Connect Platform
                </Text>
            </TouchableOpacity>

            <View style={styles.platformIcons}>
                <PlatformLogo type="shopify" size={24} />
                <PlatformLogo type="square" size={24} />
                <PlatformLogo type="clover" size={24} />
            </View>
        </BaseModal>
    );
};

const styles = StyleSheet.create({
    iconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#e6f4ea',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 12,
        color: '#111',
    },
    description: {
        fontSize: 16,
        color: '#666',
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: 32,
    },
    connectButton: {
        backgroundColor: '#93C822',
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 12,
        width: '100%',
        alignItems: 'center',
        shadowColor: '#93C822',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    connectButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    platformIcons: {
        marginTop: 24,
        flexDirection: 'row',
        gap: 12,
        opacity: 0.6,
    },
});

export default PartnerWelcomeModal;
