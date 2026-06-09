import React, { useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    TouchableWithoutFeedback,
    Animated,
    Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width } = Dimensions.get('window');

type ModalType = 'error' | 'warning' | 'info' | 'success';

interface ErrorModalProps {
    visible: boolean;
    type?: ModalType;
    title: string;
    message: string;
    buttonText?: string;
    onClose: () => void;
    secondaryButtonText?: string;
    onSecondaryPress?: () => void;
}

const getTypeConfig = (type: ModalType) => {
    switch (type) {
        case 'error':
            return {
                icon: 'alert-circle',
                color: '#EF4444',
                backgroundColor: '#FEF2F2',
            };
        case 'warning':
            return {
                icon: 'alert',
                color: '#F59E0B',
                backgroundColor: '#FFFBEB',
            };
        case 'info':
            return {
                icon: 'information',
                color: '#3B82F6',
                backgroundColor: '#EFF6FF',
            };
        case 'success':
            return {
                icon: 'check-circle',
                color: '#10B981',
                backgroundColor: '#ECFDF5',
            };
        default:
            return {
                icon: 'alert-circle',
                color: '#EF4444',
                backgroundColor: '#FEF2F2',
            };
    }
};

const ErrorModal: React.FC<ErrorModalProps> = ({
    visible,
    type = 'error',
    title,
    message,
    buttonText = 'Got It',
    onClose,
    secondaryButtonText,
    onSecondaryPress,
}) => {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(0.9)).current;

    const config = getTypeConfig(type);

    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                }),
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    friction: 8,
                    tension: 100,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 0,
                    duration: 150,
                    useNativeDriver: true,
                }),
                Animated.timing(scaleAnim, {
                    toValue: 0.9,
                    duration: 150,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [visible, fadeAnim, scaleAnim]);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={onClose}
        >
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <Animated.View
                            style={[
                                styles.modalContainer,
                                {
                                    opacity: fadeAnim,
                                    transform: [{ scale: scaleAnim }],
                                },
                            ]}
                        >
                            {/* Icon */}
                            <View
                                style={[
                                    styles.iconContainer,
                                    { backgroundColor: config.backgroundColor },
                                ]}
                            >
                                <Icon name={config.icon} size={32} color={config.color} />
                            </View>

                            {/* Title */}
                            <Text style={styles.title}>{title}</Text>

                            {/* Message */}
                            <Text style={styles.message}>{message}</Text>

                            {/* Buttons */}
                            <View style={styles.buttonContainer}>
                                {secondaryButtonText && onSecondaryPress && (
                                    <TouchableOpacity
                                        style={styles.secondaryButton}
                                        onPress={onSecondaryPress}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={styles.secondaryButtonText}>
                                            {secondaryButtonText}
                                        </Text>
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                    style={[
                                        styles.primaryButton,
                                        { backgroundColor: config.color },
                                        secondaryButtonText ? styles.buttonWithSecondary : styles.buttonFull,
                                    ]}
                                    onPress={onClose}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.primaryButtonText}>{buttonText}</Text>
                                </TouchableOpacity>
                            </View>
                        </Animated.View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContainer: {
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 24,
        width: width - 48,
        maxWidth: 360,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 10,
    },
    iconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontFamily: 'Inter_700Bold',
        color: '#1a1a1a',
        textAlign: 'center',
        marginBottom: 8,
    },
    message: {
        fontSize: 15,
        fontFamily: 'Inter_400Regular',
        color: '#666',
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 24,
    },
    buttonContainer: {
        flexDirection: 'row',
        gap: 12,
        width: '100%',
    },
    primaryButton: {
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonFull: {
        flex: 1,
    },
    buttonWithSecondary: {
        flex: 1,
    },
    primaryButtonText: {
        color: '#fff',
        fontSize: 16,
        fontFamily: 'Inter_600SemiBold',
    },
    secondaryButton: {
        flex: 1,
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 24,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F3F4F6',
    },
    secondaryButtonText: {
        color: '#666',
        fontSize: 16,
        fontFamily: 'Inter_600SemiBold',
    },
});

export default ErrorModal;
