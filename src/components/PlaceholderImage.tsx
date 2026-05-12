import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface PlaceholderImageProps {
  size?: number;
  borderRadius?: number;
  color?: string;
  type?: 'plain' | 'gradient' | 'icon' | 'text' | 'image';
  icon?: string;
  text?: string;
  uri?: string | null;
  gradientColors?: string[] | null;
  style?: any;
}

const PlaceholderImage: React.FC<PlaceholderImageProps> = ({ 
  size = 100, 
  borderRadius = 8, 
  color = '#555555',
  type = 'plain', // 'plain', 'gradient', 'icon', 'text', 'image'
  icon = 'image',
  text = '',
  uri = null,
  gradientColors = null,
  style = {}
}) => {
  // If an image URI is provided, render the image and a fallback icon if it fails
  if (type === 'image' && uri) {
    return (
      <View style={[
        styles.placeholder,
        { 
          width: size, 
          height: size, 
          borderRadius: borderRadius,
          backgroundColor: adjustColor(color, -10)
        },
        style
      ]}>
        <Image 
          source={{ uri }}
          style={[
            styles.image, 
            { 
              width: size, 
              height: size, 
              borderRadius: borderRadius
            },
          ]}
          onError={(e) => {
            // This is a simple fallback, you could set a state to show an icon instead
            console.log('Failed to load image:', e.nativeEvent.error);
          }}
        />
      </View>
    );
  }

  // If gradientColors not provided, create a gradient based on the color
  const colors = gradientColors || [
    color,
    adjustColor(color, -20)
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
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    resizeMode: 'cover',
  },
  placeholderText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
  }
});

export default PlaceholderImage; 