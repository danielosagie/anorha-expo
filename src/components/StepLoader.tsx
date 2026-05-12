import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Blurred } from './Blurred';

// Define a fixed height for each item in our "film strip".
const ITEM_HEIGHT = 30;

function StepLoader({ stages, style, currentStageIndex }: { stages: string[], style: any, currentStageIndex: number }) {
  // This shared value will hold the vertical position of our film strip.
  const translateY = useSharedValue(0);

  // This effect runs whenever the currentStageIndex changes.
  useEffect(() => {
    // We animate the translateY value to move the correct stage into the center.
    // The target position is the negative of the index multiplied by the item height.
    translateY.value = withTiming(-currentStageIndex * ITEM_HEIGHT, {
      duration: 350,
      easing: Easing.out(Easing.ease),
    });
  }, [currentStageIndex, translateY]);

  // This creates the animated style that will be applied to our film strip.
  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  return (
    // This is our "viewport" with a fixed height and hidden overflow.
    <View style={[styles.viewport, style]}>
      {/* This is the "film strip" that contains all stages and moves up and down. */}
      <Animated.View style={animatedStyle}>
        {stages.map((stage, index) => {
          // Figure out which row this is relative to the current stage
          const isCurrent = index === currentStageIndex;
          const isTopRow = index === currentStageIndex + 1;
          const isBottomRow = index === currentStageIndex - 1;

          const textStyle = isCurrent
            ? styles.font
            : (isTopRow || isBottomRow)
              ? styles.adjacentText
              : styles.hiddenText; // Hide stages that are far away

          if (isTopRow || isBottomRow) {
            return (
              <View key={stage} style={[styles.stageItem, { height: ITEM_HEIGHT }]}>
                <Blurred intensity={isTopRow ? 3 : 7} tint="light">
                  <Text style={textStyle}>{stage}</Text>
                </Blurred>
              </View>
            );
          }

          return (
            <View key={stage} style={[styles.stageItem, { height: ITEM_HEIGHT }]}>
              <Text style={textStyle}>{stage}</Text>
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

export default StepLoader;

const styles = StyleSheet.create({
  viewport: {
    height: ITEM_HEIGHT * 3,
    overflow: 'hidden', // This is crucial to hide the other stages.
  },
  stageItem: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  font: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '600',
  },
  adjacentText: {
    color: '#6B7280',
    fontSize: 18,
    fontWeight: '400',
    opacity: 0.6,
  },
  hiddenText: {
    opacity: 0,
    fontSize: 16,
  },
});