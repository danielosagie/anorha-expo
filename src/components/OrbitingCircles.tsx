import React, { useState, useEffect } from 'react';
import { View, Animated, Easing, StyleSheet, Image } from 'react-native';

function OrbitAnimation( { firstPhotos }: { firstPhotos: any[] } ) {
  const spinValue = new Animated.Value(0);
  const radius = 100; // Define the orbit radius

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 5000, // 5 seconds for a full orbit
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const getOrbitingItemStyle = (offsetAngle: number) => {
    const angle = spinValue.interpolate({
      inputRange: [0, 1],
      outputRange: [`${offsetAngle}deg`, `${offsetAngle + 360}deg`],
    }) as Animated.AnimatedInterpolation<number>;

    return {
      position: 'absolute' as const,
      transform: [
        { translateX: radius * Math.cos(angle as unknown as number) }, // Calculate X position
        { translateY: radius * Math.sin(angle as unknown as number) }, // Calculate Y position
        { rotate: angle } // Rotate the item itself if desired
      ],
    };
  };

  return (
    <View style={styles.container}>
      <View style={styles.center} /> {/* Central element */}
      <Animated.View style={[styles.orbitingItem, getOrbitingItemStyle(0)]}>
        <Image source={{ uri: firstPhotos[0] }} style={styles.image} />
      </Animated.View>
      <Animated.View style={[styles.orbitingItem, getOrbitingItemStyle(120)]}>
        <Image source={{ uri: firstPhotos[1] }} style={styles.image} />
      </Animated.View>
      <Animated.View style={[styles.orbitingItem, getOrbitingItemStyle(240)]}>
        <Image source={{ uri: firstPhotos[2] }} style={styles.image} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'black',
  },
  center: {
    width: 300,
    height: 300,
    borderRadius: 10,
    backgroundColor: 'white',
    position: 'absolute',
  },
  orbitingItem: {
    // You might need to adjust the item's own width and height
    // and center it within its container if it's not already centered
    width: 300, 
    height: 300,
    borderRadius: 15,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: 300,
    height: 300,
  }
});

export default OrbitAnimation;
