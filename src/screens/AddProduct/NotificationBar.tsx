import React from 'react';
import { TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const NotificationBar: React.FC<{
  message: string;
  opacity: any;
  translateY: any;
  onPress?: () => void;
}> = ({ message, opacity, translateY, onPress }) => {
  const notificationStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.notificationBar, notificationStyle]}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        style={{ flexDirection: 'row', alignItems: 'center' }}
      >
        <Icon name="information-outline" size={20} color="white" />
        <Text style={styles.notificationText}>{message}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  notificationBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 25,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 30,
  },
  notificationText: {
    color: 'white',
    fontSize: 14,
    marginLeft: 10,
    flex: 1,
    fontWeight: '500',
  },
});
