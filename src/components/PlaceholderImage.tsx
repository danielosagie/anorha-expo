import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const PlaceholderImage = ({ 
  size = 100, 
  borderRadius = 8, 
  color = '#555555',
  type = 'plain', // 'plain', 'gradient', 'icon', 'text'
  icon = 'image',
  text = '',
  gradientColors = null,
  style = {}
}) => {
  // If gradientColors not provided, create a gradient based on the color
  const colors = gradientColors || [
    color,
    adjustColor(color, -30)
  ];
  
  // Default gradient direction
  const start = { x: 0, y: 0 };
  const end = { x: 1, y: 1 };
  
  const renderContent = () => {
    if (type === 'icon') {
      return (
        <Icon name={icon} size={size / 2} color="#ffffff" />
      );
    } else if (type === 'text') {
      return (
        <Text style={styles.placeholderText}>{text}</Text>
      );
    }
    return null;
  };
  
  if (type === 'gradient') {
    return (
      <LinearGradient
        colors={colors}
        start={start}
        end={end}
        style={[
          styles.placeholder,
          { 
            width: size, 
            height: size, 
            borderRadius: borderRadius
          },
          style
        ]}
      >
        {renderContent()}
      </LinearGradient>
    );
  }
  
  return (
    <View 
      style={[
        styles.placeholder, 
        { 
          width: size, 
          height: size, 
          borderRadius: borderRadius,
          backgroundColor: color 
        },
        style
      ]} 
    >
      {renderContent()}
    </View>
  );
};

// Helper function to adjust color brightness
const adjustColor = (color, amount) => {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const num = parseInt(hex, 16);
    let r = (num >> 16) + amount;
    let g = ((num >> 8) & 0x00FF) + amount;
    let b = (num & 0x0000FF) + amount;
    
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }
  
  // Default fallback
  return color;
};

const styles = StyleSheet.create({
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  placeholderText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
  }
});

export default PlaceholderImage; 