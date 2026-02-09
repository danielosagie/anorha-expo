import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface BackButtonProps {
  onPress: () => void;
  label?: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
  iconSize?: number;
  iconColor?: string;
}

const BackButton: React.FC<BackButtonProps> = ({
  onPress,
  label = 'Back',
  style,
  textStyle,
  iconSize = 18,
  iconColor = '#000',
}) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.button, style]}
    activeOpacity={0.8}
    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
  >
    <Icon name="arrow-left" size={iconSize} color={iconColor} />
    <Text style={[styles.label, textStyle]}>
      {label}
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  button: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.9)',
    minHeight: 34,
    maxHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    color: '#000',
    fontWeight: '600',
    marginLeft: 6,
    fontSize: 15,
  },
});

export default BackButton;
