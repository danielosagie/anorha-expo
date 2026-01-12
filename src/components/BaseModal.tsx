import React, { ReactNode } from 'react';
import { Modal, View, StyleSheet, TouchableOpacity, ModalProps, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface BaseModalProps extends Omit<ModalProps, 'children'> {
    visible: boolean;
    onClose?: () => void;
    showCloseButton?: boolean;
    children: ReactNode;
    containerStyle?: ViewStyle;
}

/**
 * BaseModal - Reusable modal wrapper with overlay and centered container.
 * Use this as the foundation for all modals in the app.
 */
export const BaseModal: React.FC<BaseModalProps> = ({
    visible,
    onClose,
    showCloseButton = false,
    children,
    containerStyle,
    ...modalProps
}) => {
    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            {...modalProps}
        >
            <View style={styles.overlay}>
                <View style={[styles.container, containerStyle]}>
                    {showCloseButton && onClose && (
                        <TouchableOpacity
                            style={styles.closeButton}
                            onPress={onClose}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                            <Icon name="close" size={24} color="#666" />
                        </TouchableOpacity>
                    )}
                    {children}
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'center',
        padding: 20,
    },
    container: {
        backgroundColor: '#fff',
        borderRadius: 24,
        padding: 32,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 10,
    },
    closeButton: {
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 10,
    },
});

export default BaseModal;
