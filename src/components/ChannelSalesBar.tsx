import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';

const ChannelSalesBar = ({ channel, delay = 0 }) => {
  const theme = useTheme();
  const barWidth = useSharedValue(0);
  
  useEffect(() => {
    setTimeout(() => {
      barWidth.value = withTiming(channel.percentage, { duration: 800 });
    }, delay);
  }, []);
  
  const barStyle = useAnimatedStyle(() => {
    return {
      width: `${barWidth.value}%`,
    };
  });
  
  return (
    <View style={styles.container}>
      <View style={styles.labelContainer}>
        <Text style={styles.channelName}>{channel.name}</Text>
      </View>
      <View style={styles.barContainer}>
        <Animated.View 
          style={[
            styles.bar, 
            barStyle, 
            { backgroundColor: channel.color || theme.colors.primary }
          ]}
        />
      </View>
      <Text style={styles.value}>{channel.value}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  labelContainer: {
    width: 70,
  },
  channelName: {
    fontSize: 14,
    color: '#555',
  },
  barContainer: {
    flex: 1,
    height: 16,
    backgroundColor: '#f2f2f2',
    borderRadius: 8,
    overflow: 'hidden',
    marginHorizontal: 12,
  },
  bar: {
    height: '100%',
  },
  value: {
    width: 40,
    fontSize: 14,
    textAlign: 'right',
    fontWeight: '500',
  },
});

export default ChannelSalesBar; 