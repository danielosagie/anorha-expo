import React, { useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Dimensions,
    TouchableOpacity,
    Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width } = Dimensions.get('window');

export interface SystemToastOptions {
    title: string;
    message?: string;
    type?: 'success' | 'error' | 'warning' | 'info';
    duration?: number;
    icon?: string;
}

interface SystemToastProps {
    visible: boolean;
    options: SystemToastOptions;
    onClose: () => void;
}

const SystemToast: React.FC<SystemToastProps> = ({ visible, options, onClose }) => {
    const insets = useSafeAreaInsets();
    const translateY = useSharedValue(-100);
    const opacity = useSharedValue(0);

    const hide = useCallback(() => {
        translateY.value = withTiming(-100, { duration: 300 }, () => {
            runOnJS(onClose)();
        });
        opacity.value = withTiming(0, { duration: 300 });
    }, [onClose]);

    useEffect(() => {
        if (visible) {
            translateY.value = withSpring(insets.top + 10, { damping: 12, stiffness: 100 });
            opacity.value = withTiming(1, { duration: 200 });

            Haptics.selectionAsync();

            const timer = setTimeout(() => {
                hide();
            }, options.duration || 3000);

            return () => clearTimeout(timer);
        }
    }, [visible, insets.top, options.duration, hide]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
        opacity: opacity.value,
    }));

    const panGesture = Gesture.Pan()
        .onUpdate((event) => {
            if (event.translationY < 0) {
                translateY.value = insets.top + 10 + event.translationY;
            }
        })
        .onEnd((event) => {
            if (event.translationY < -20) {
                runOnJS(hide)();
            } else {
                translateY.value = withSpring(insets.top + 10);
            }
        });

    if (!visible) return null;

    const getIconInfo = () => {
        if (options.icon) return { name: options.icon, color: '#FFFFFF' };
        switch (options.type) {
            case 'success': return { name: 'check-circle', color: '#34C759' };
            case 'error': return { name: 'alert-circle', color: '#FF3B30' };
            case 'warning': return { name: 'alert', color: '#FF9500' };
            case 'info': return { name: 'information', color: '#007AFF' };
            default: return { name: 'bell', color: '#FFFFFF' };
        }
    };

    const iconInfo = getIconInfo();

    return (
        <GestureDetector gesture={panGesture}>
            <Animated.View style={[styles.container, animatedStyle, { top: 0 }]}>
                <BlurView intensity={80} tint="dark" style={styles.blurContainer}>
                    <View style={styles.content}>
                        <View style={styles.iconWrapper}>
                            <Icon name={iconInfo.name} size={24} color={iconInfo.color} />
                        </View>
                        <View style={styles.textContainer}>
                            <Text style={styles.title} numberOfLines={1}>{options.title}</Text>
                            {options.message && (
                                <Text style={styles.message} numberOfLines={1}>{options.message}</Text>
                            )}
                        </View>
                    </View>
                </BlurView>
            </Animated.View>
        </GestureDetector>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        width: width - 32,
        alignSelf: 'center',
        zIndex: 9999,
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.2,
                shadowRadius: 10,
            },
            android: {
                elevation: 10,
            },
        }),
    },
    blurContainer: {
        borderRadius: 20,
        overflow: 'hidden',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: Platform.OS === 'ios' ? 'transparent' : 'rgba(40, 40, 40, 0.95)',
    },
    iconWrapper: {
        marginRight: 12,
    },
    textContainer: {
        flex: 1,
    },
    title: {
        fontSize: 15,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    message: {
        fontSize: 13,
        color: 'rgba(255, 255, 255, 0.8)',
        marginTop: 1,
    },
});

export default SystemToast;
