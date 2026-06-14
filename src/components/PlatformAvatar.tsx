import React from 'react';
import {
  View,
  StyleSheet,
  Platform,
} from 'react-native';
import PlatformLogo from './PlatformLogo';

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
      <PlatformLogo type={platformType} size={config.icon} fallbackIcon="store" />
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
