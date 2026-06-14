import React from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import PlaceholderImage from './Placeholder';
import { getPlatformColor, getPlatformIcon } from '../config/platforms';

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

const PlatformSelector = ({ platforms: selectedPlatforms, onChange }: { platforms: Record<string, boolean>; onChange: (next: Record<string, boolean>) => void }) => {
  const theme = useTheme();

  const togglePlatform = (platformId: string) => {
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
              icon={getPlatformIcon(platform.id)}
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