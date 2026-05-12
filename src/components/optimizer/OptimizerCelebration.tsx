import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withDelay,
    withSequence,
    Easing
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');

const CONFETTI_COLORS = ['#8cc63f', '#ffc800', '#58cc02', '#fa5252', '#228be6', '#845ef7'];
const PARTICLE_COUNT = 30;

const ConfettiParticle = ({ index }: { index: number }) => {
    const translateY = useSharedValue(-20);
    const translateX = useSharedValue(Math.random() * width);
    const rotation = useSharedValue(0);
    const opacity = useSharedValue(1);

    const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];

    useEffect(() => {
        const duration = 2000 + Math.random() * 2000;
        const delay = Math.random() * 1000;

        translateY.value = withDelay(delay, withTiming(height + 100, {
            duration,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1)
        }));

        translateX.value = withDelay(delay, withTiming(translateX.value + (Math.random() - 0.5) * 100, {
            duration
        }));

        rotation.value = withDelay(delay, withTiming(Math.random() * 360 * 4, {
            duration
        }));

        opacity.value = withDelay(delay + duration - 500, withTiming(0, { duration: 500 }));
    }, []);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateY: translateY.value },
            { translateX: translateX.value },
            { rotate: `${rotation.value}deg` }
        ],
        opacity: opacity.value,
        backgroundColor: color,
    }));

    return <Animated.View style={[styles.particle, animatedStyle]} />;
};

export const OptimizerCelebration = ({ onComplete }: { onComplete: () => void }) => {
    useEffect(() => {
        const timer = setTimeout(onComplete, 4000);
        return () => clearTimeout(timer);
    }, []);

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {Array.from({ length: PARTICLE_COUNT }).map((_, i) => (
                <ConfettiParticle key={i} index={i} />
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    particle: {
        width: 10,
        height: 10,
        position: 'absolute',
        top: 0,
        borderRadius: 2,
    },
});
