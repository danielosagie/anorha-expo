import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
} from 'react-native';
import { BaseModal } from './BaseModal';
import * as Haptics from 'expo-haptics';

export interface SystemAlertAction {
    text: string;
    style?: 'default' | 'cancel' | 'destructive';
    onPress?: () => void;
}

export interface SystemAlertOptions {
    title: string;
    message?: string;
    actions?: SystemAlertAction[];
    type?: 'success' | 'error' | 'warning' | 'info';
}

interface SystemAlertProps {
    visible: boolean;
    options: SystemAlertOptions;
    onClose: () => void;
}

const SystemAlert: React.FC<SystemAlertProps> = ({ visible, options, onClose }) => {

    // Trigger haptics when shown
    React.useEffect(() => {
        if (visible) {
            if (options.type === 'success') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else if (options.type === 'error') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } else {
                Haptics.selectionAsync();
            }
        }
    }, [visible, options.type]);

    if (!visible) return null;

    const actions = options.actions || [{ text: 'OK', style: 'default' }];

    return (
        <BaseModal
            visible={visible}
            onClose={onClose}
            showCloseButton={false} // We usually use action buttons for alerts
        >
            <View style={styles.content}>
                <Text style={styles.title}>{options.title}</Text>
                {options.message && (
                    <Text style={styles.message}>{options.message}</Text>
                )}
            </View>

            <View style={styles.buttonContainer}>
                {actions.map((action, index) => (
                    <TouchableOpacity
                        key={index}
                        style={[
                            styles.button,
                            action.style === 'cancel' && styles.buttonCancel,
                            action.style === 'destructive' && styles.buttonDestructive,
                        ]}
                        onPress={() => {
                            onClose();
                            if (action.onPress) action.onPress();
                        }}
                    >
                        <Text style={[
                            styles.buttonText,
                            action.style === 'cancel' && styles.textCancel,
                            action.style === 'destructive' && styles.textDestructive,
                        ]}>
                            {action.text}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
        </BaseModal>
    );
};

const styles = StyleSheet.create({
    content: {
        alignItems: 'center',
        marginBottom: 24,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111',
        textAlign: 'center',
        marginBottom: 8,
    },
    message: {
        fontSize: 16,
        color: '#666',
        textAlign: 'center',
        lineHeight: 22,
    },
    buttonContainer: {
        width: '100%',
        gap: 12,
    },
    button: {
        backgroundColor: '#93C822', // Primary Green
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        width: '100%',
    },
    buttonCancel: {
        backgroundColor: '#f5f5f5',
    },
    buttonDestructive: {
        backgroundColor: '#ffebee',
    },
    buttonText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#fff',
    },
    textCancel: {
        color: '#666',
    },
    textDestructive: {
        color: '#d32f2f',
    },
});

export default SystemAlert;

