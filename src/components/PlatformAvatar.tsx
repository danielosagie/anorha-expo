import React from 'react';
import {
  View,
  StyleSheet,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';
import WhatnotSvg from '../assets/whatnot.svg';
import DepopSvg from '../assets/depop-icon.svg';

interface PlatformAvatarProps {
  platformType: string;
  size?: 'small' | 'medium' | 'large';
}

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
  const type = platformType.toLowerCase().trim();

  const platformSvgMap: Record<string, React.FC<any>> = {
    shopify: ShopifySvg,
    square: SquareSvg,
    clover: CloverSvg,
    amazon: AmazonSvg,
    ebay: EbaySvg,
    facebook: FacebookSvg,
    whatnot: WhatnotSvg,
    depop: DepopSvg,
  };

  // Find the SVG component that matches
  let SVGComponent = null;
  for (const [key, component] of Object.entries(platformSvgMap)) {
    if (type.includes(key)) {
      SVGComponent = component;
      break;
    }
  }

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
      {SVGComponent ? (
        <SVGComponent
          width={config.icon}
          height={config.icon}
        />
      ) : (
        <Icon
          name="store"
          size={config.icon}
          color={'#666'}
        />
      )}
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
});

export default PlatformAvatar;
