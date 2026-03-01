import React, { ReactNode } from 'react';
import { Modal, View, StyleSheet, TouchableOpacity, ModalProps, ViewStyle, TouchableWithoutFeedback } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface BaseModalProps extends Omit<ModalProps, 'children'> {
    visible: boolean;
    onClose?: () => void;
    showCloseButton?: boolean;
    children: ReactNode;
    containerStyle?: ViewStyle;
    /** 'center' = centered modal (default), 'bottom' = bottom sheet */
    position?: 'center' | 'bottom';
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
    position = 'center',
    ...modalProps
}) => {
    const isBottomSheet = position === 'bottom';
    return (
        <Modal
            visible={visible}
            transparent
            animationType={isBottomSheet ? 'slide' : 'fade'}
            onRequestClose={onClose}
            {...modalProps}
        >
            <TouchableOpacity
                style={[styles.overlay, isBottomSheet && styles.overlayBottomSheet]}
                activeOpacity={1}
                onPress={onClose}
            >
                <TouchableWithoutFeedback onPress={() => { }}>
                    <View style={[
                        styles.container,
                        isBottomSheet && styles.containerBottomSheet,
                        containerStyle
                    ]}>
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
                </TouchableWithoutFeedback>
            </TouchableOpacity>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    overlayBottomSheet: {
        justifyContent: 'flex-end',
        alignItems: 'stretch',
        padding: 0,
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
    containerBottomSheet: {
        width: '100%',
        maxWidth: '100%',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        padding: 24,
    },
    closeButton: {
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 10,
    },
});

export default BaseModal;
