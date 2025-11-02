import React from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';

interface PlatformAvatarProps {
  platformType: string;
  size?: 'small' | 'medium' | 'large';
}

const getPlatformIcon = (platformType: string) => {
    const type = platformType.toLowerCase();
    if (type.includes('shopify')) return ShopifySvg;
    if (type.includes('square')) return SquareSvg;
    if (type.includes('clover')) return CloverSvg;
    if (type.includes('amazon')) return AmazonSvg;
    if (type.includes('ebay')) return EbaySvg;
    if (type.includes('facebook')) return FacebookSvg;
    return null; // Return nul
};

const PlatformAvatar: React.FC<PlatformAvatarProps> = ({
  platformType,
  size = 'medium',
}) => {
  const sizeConfig = {
    small: { container: 28, icon: 14 },
    medium: { container: 32, icon: 16 },
    large: { container: 40, icon: 20 },
  };

  const config = sizeConfig[size];
  const icon = getPlatformIcon(platformType);

  return (
    <View
      style={[
        styles.avatar,
        {
          width: config.container,
          height: config.container,
          borderRadius: config.container / 2,
        },
      ]}
    >
      {(() => {
        const IconComponent = getPlatformIcon(platformType);
        return IconComponent ? (
            <IconComponent
            width={16}
            height={16}
            />
        ) : (
            <Icon
            name="store"
            size={16}
            color={'#FFFFFF'}
            style={styles.platformIcon}
            />
        );
        })()}
    </View>
  );
};

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D8D8D8',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 1,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  platformIcon: {
    marginRight: 6,
  },
});

export default PlatformAvatar;
