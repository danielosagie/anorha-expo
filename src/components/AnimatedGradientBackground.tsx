import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  cancelAnimation
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

// Static gradient option for low-end devices
const StaticGradient = () => (
  <LinearGradient
    style={StyleSheet.absoluteFill}
    colors={['#5c9c00', '#8cc63f', '#5c9c00']}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 1 }}
  />
);

// Optimize by memoizing the component
const AnimatedGradientBackground = React.memo((props: any) => {
  // Use this flag to disable animation on low-end devices
  const useStaticGradient = false;

  // If static mode is enabled, render a simple non-animated gradient
  if (useStaticGradient) {
    return <StaticGradient />;
  }

  const animation = useSharedValue(0);

  useEffect(() => {
    // Slower animation with longer duration for better performance
    animation.value = withRepeat(
      withTiming(1, {
        duration: 30000, // Doubled duration for less CPU usage
        easing: Easing.inOut(Easing.ease)
      }),
      -1, // Infinite repeat
      true // Reverse
    );

    // Cleanup animation when component unmounts
    return () => {
      cancelAnimation(animation);
    };
  }, []);

  // Pre-compute animated styles for performance
  const animatedStyles = useAnimatedStyle(() => {
    const translateY = interpolate(
      animation.value,
      [0, 1],
      [0, height * 0.03] // Reduced motion even further
    );

    return {
      transform: [{ translateY }]
    };
  });

  return (
    <View style={[styles.container, props.style]}>
      <AnimatedLinearGradient
        style={[styles.gradient, animatedStyles]}
        colors={['#5c9c00', '#8cc63f', '#5c9c00']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        locations={[0, 0.5, 1]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: width,
    height: height,
    overflow: 'hidden',
  },
  gradient: {
    position: 'absolute',
    width: width * 1.2, // Reduced size multiplier
    height: height * 1.2, // Reduced size multiplier
    borderRadius: height * 0.6, // Adjusted for new size
    top: -height * 0.1, // Adjusted for new size
    left: -width * 0.1, // Adjusted for new size
  },
});

export default AnimatedGradientBackground; 