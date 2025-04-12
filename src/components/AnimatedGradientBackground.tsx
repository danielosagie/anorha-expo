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
  useAnimatedReaction,
  cancelAnimation
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

// Optimize by memoizing the component
const AnimatedGradientBackground = React.memo(() => {
  const animation = useSharedValue(0);
  
  useEffect(() => {
    // Use slower animation with native driver for better performance
    animation.value = withRepeat(
      withTiming(1, { 
        duration: 15000, 
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
      [0, height * 0.05] // Reduced motion for better performance
    );
    
    return {
      transform: [{ translateY }]
    };
  }, []);

  return (
    <View style={styles.container}>
      <AnimatedLinearGradient
        style={[styles.gradient, animatedStyles]}
        colors={['#5c9c00', '#8cc63f', '#5c9c00']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        // Using cacheEnabled for better performance
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
    width: width * 1.5,
    height: height * 1.5,
    borderRadius: height * 0.75,
    top: -height * 0.25,
    left: -width * 0.25,
  },
});

export default AnimatedGradientBackground; 