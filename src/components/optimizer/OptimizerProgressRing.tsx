import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import * as Progress from 'react-native-progress';

interface OptimizerProgressRingProps {
    progress: number; // 0 to 1
    size?: number;
}

export const OptimizerProgressRing: React.FC<OptimizerProgressRingProps> = ({ progress, size = 120 }) => {
    const animatedProgress = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
        Animated.timing(animatedProgress, {
            toValue: progress,
            duration: 1000,
            useNativeDriver: false,
        }).start();
    }, [progress]);

    return (
        <View style={styles.container}>
            <Progress.Circle
                size={size}
                progress={progress}
                thickness={8}
                color="#8cc63f"
                unfilledColor="#f1f3f5"
                borderWidth={0}
                strokeCap="round"
            />
            <View style={[styles.innerContent, { width: size, height: size }]}>
                <Text style={styles.percentText}>{Math.round(progress * 100)}%</Text>
                <Text style={styles.label}>Health</Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    innerContent: {
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
    },
    percentText: {
        fontSize: 28,
        fontWeight: '900',
        color: '#1a1a1a',
        letterSpacing: -1,
    },
    label: {
        fontSize: 10,
        fontWeight: '700',
        color: '#6c757d',
        textTransform: 'uppercase',
        marginTop: -2,
    },
});
