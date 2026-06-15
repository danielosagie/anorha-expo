import React from 'react';
import { View, StyleSheet, ViewStyle, TouchableOpacity } from 'react-native';
import ShadowSurface from './ui/ShadowSurface';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[] | any;
  onPress?: () => void;
  /** Drop-shadow level; pass "none" for a flat card. */
  shadow?: 'none' | 'xs' | 'sm' | 'md' | 'lg';
}

const Card: React.FC<CardProps> = ({ children, style, onPress, shadow = 'sm' }) => {
  if (onPress) {
    return (
      <ShadowSurface shadow={shadow} style={[styles.cardOuter, style]} innerStyle={styles.cardSurface}>
        <TouchableOpacity style={styles.cardContent} onPress={onPress} activeOpacity={0.7}>
          {children}
        </TouchableOpacity>
      </ShadowSurface>
    );
  }

  return (
    <ShadowSurface shadow={shadow} style={[styles.cardOuter, style]} innerStyle={styles.cardSurface}>
      <View style={styles.cardContent}>{children}</View>
    </ShadowSurface>
  );
};

const styles = StyleSheet.create({
  cardOuter: {
    marginBottom: 16,
  },
  cardSurface: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  cardContent: {
    padding: 16,
  },
});

export default Card; 
