import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const ProgressBarOverlay: React.FC<{
  progressWidth: any;
  spinRotation: any;
}> = ({ progressWidth, spinRotation }) => {
  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinRotation.value}deg` }],
  }));

  return (
    <View style={styles.progressBarContainer}>
      <View style={styles.progressBarBackground}>
        <Animated.View style={[styles.progressBarFill, progressBarStyle]} />
      </View>
      <Animated.View style={[styles.progressSpinner, spinnerStyle]}>
        <Icon name="loading" size={20} color="#4CAF50" />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  progressBarContainer: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 20,
  },
  progressBarBackground: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#93C822',
    borderRadius: 2,
  },
  progressSpinner: {
    marginLeft: 12,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
