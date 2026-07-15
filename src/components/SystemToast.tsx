import React, { useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Dimensions,
    Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    runOnJS,
    Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';

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
    const translateY = useSharedValue(-8);
    const opacity = useSharedValue(0);

    const hide = useCallback(() => {
        translateY.value = withTiming(-5, { duration: 140, easing: Easing.in(Easing.cubic) }, () => {
            runOnJS(onClose)();
        });
        opacity.value = withTiming(0, { duration: 140 });
    }, [onClose, opacity, translateY]);

    useEffect(() => {
        if (visible) {
            translateY.value = -8;
            opacity.value = 0;
            translateY.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
            opacity.value = withTiming(1, { duration: 150 });

            Haptics.selectionAsync();

            const timer = setTimeout(() => {
                hide();
            }, options.duration || 3000);

            return () => clearTimeout(timer);
        }
    }, [visible, insets.top, options.duration, hide, opacity, translateY]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
        opacity: opacity.value,
    }));

    const panGesture = Gesture.Pan()
        .onUpdate((event) => {
            if (event.translationY < 0) {
                translateY.value = event.translationY;
            }
        })
        .onEnd((event) => {
            if (event.translationY < -20) {
                runOnJS(hide)();
            } else {
                translateY.value = withTiming(0, { duration: 150, easing: Easing.out(Easing.cubic) });
            }
        });

    if (!visible) return null;

    return (
        <GestureDetector gesture={panGesture}>
            <Animated.View style={[styles.container, animatedStyle, { top: insets.top + 8 }]}>
                <BlurView intensity={72} tint="light" style={styles.blurContainer}>
                    <View style={styles.content}>
                        <View style={styles.textContainer}>
                            <Text style={styles.title} numberOfLines={2}>{options.title}</Text>
                            {options.message && (
                                <Text style={styles.message} numberOfLines={2}>{options.message}</Text>
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
        minWidth: 176,
        maxWidth: Math.min(width - 48, 340),
        alignSelf: 'center',
        zIndex: 9999,
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: 0.1,
                shadowRadius: 12,
            },
            android: {
                elevation: 10,
            },
        }),
    },
    blurContainer: {
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(228,228,231,0.9)',
    },
    content: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        paddingHorizontal: 18,
        backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.68)' : 'rgba(250,250,248,0.97)',
    },
    textContainer: {
        alignItems: 'center',
    },
    title: {
        fontSize: 15,
        fontFamily: 'Inter_700Bold',
        color: '#18181B',
        textAlign: 'center',
    },
    message: {
        fontSize: 12,
        lineHeight: 16,
        fontFamily: 'Inter_500Medium',
        color: '#71717A',
        marginTop: 1,
        textAlign: 'center',
    },
});

export default SystemToast;
