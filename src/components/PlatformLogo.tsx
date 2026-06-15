import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getPlatform } from '../config/platforms';

interface PlatformLogoProps {
  /** Any platform spelling — key, label, or free-text PlatformType. */
  type: string;
  /** Pixel size of the logo. Default 16. */
  size?: number;
  /**
   * Fill color for the brand SVG (and the MDI fallback). Leave undefined to
   * render the SVG in its native brand colors (e.g. Shopify green).
   */
  color?: string;
  style?: StyleProp<ViewStyle>;
  /** MDI icon name used when the platform has no brand SVG. */
  fallbackIcon?: string;
}

/**
 * Renders a platform's brand SVG (or an MDI fallback for unknown platforms),
 * resolved through the central platform registry. Replaces the per-file
 * `getPlatformIcon`/`platformSvgMap` duplicates scattered across the app.
 */
const PlatformLogo: React.FC<PlatformLogoProps> = ({
  type,
  size = 16,
  color,
  style,
  fallbackIcon,
}) => {
  const def = getPlatform(type);

  if (def?.logo) {
    const Logo = def.logo;
    return <Logo width={size} height={size} fill={color} style={style} />;
  }

  return (
    <Icon
      name={fallbackIcon ?? def?.mdiIcon ?? 'store'}
      size={size}
      color={color ?? '#666'}
      style={style}
    />
  );
};

export default PlatformLogo;
