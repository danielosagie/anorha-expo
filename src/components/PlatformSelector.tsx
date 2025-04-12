import React from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import PlaceholderImage from './Placeholder';

const platforms = [
  {
    id: 'shopify',
    name: 'Shopify',
  },
  {
    id: 'amazon',
    name: 'Amazon',
  },
  {
    id: 'ebay',
    name: 'eBay',
  },
  {
    id: 'depop',
    name: 'Depop',
  },
  {
    id: 'whatnot',
    name: 'Whatnot',
  },
  {
    id: 'clover',
    name: 'Clover',
  },
  {
    id: 'square',
    name: 'Square',
  },
];

const getPlatformColor = (platformId) => {
  switch (platformId) {
    case 'shopify':
      return '#0E8F7F';
    case 'amazon':
      return '#F17F5F';
    case 'ebay':
      return '#E53238';
    case 'depop':
      return '#FF2300';
    case 'whatnot':
      return '#FFC107';
    case 'clover':
      return '#3CAD46';
    case 'square':
      return '#6C757D';
    default:
      return '#555555';
  }
};

const getIconForPlatform = (platform) => {
  switch (platform) {
    case 'shopify':
      return 'shopping';
    case 'amazon':
      return 'package';
    case 'ebay':
      return 'currency-usd';
    case 'depop':
      return 'tshirt-crew';
    case 'whatnot':
      return 'collage';
    case 'clover':
      return 'leaf';
    case 'square':
      return 'square-outline';
    default:
      return 'store';
  }
};

const PlatformSelector = ({ platforms: selectedPlatforms, onChange }) => {
  const theme = useTheme();
  
  const togglePlatform = (platformId) => {
    onChange({
      ...selectedPlatforms,
      [platformId]: !selectedPlatforms[platformId]
    });
  };
  
  return (
    <View style={styles.container}>
      {platforms.map((platform) => (
        <View key={platform.id} style={styles.platformItem}>
          <View style={styles.platformInfo}>
            <PlaceholderImage 
              size={32} 
              borderRadius={4} 
              color={getPlatformColor(platform.id)} 
              type="icon"
              icon={getIconForPlatform(platform.id)}
            />
            <Text style={styles.platformName}>{platform.name}</Text>
          </View>
          <Switch
            value={selectedPlatforms[platform.id]}
            onValueChange={() => togglePlatform(platform.id)}
            trackColor={{ false: '#e0e0e0', true: theme.colors.primary + '50' }}
            thumbColor={selectedPlatforms[platform.id] ? theme.colors.primary : '#f4f3f4'}
          />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  platformItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  platformIcon: {
    width: 32,
    height: 32,
    marginRight: 12,
  },
  platformName: {
    fontSize: 16,
    marginLeft: 12,
  },
});

export default PlatformSelector; 