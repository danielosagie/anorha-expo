// PlatformBrandChip — the rounded brand square used in the publish + published screens.
//
// Each channel shows its REAL logo asset (from the platform registry) in its native
// brand colours, sitting on a neutral light chip with a hairline border — the familiar
// app-icon look. eBay's asset is already the full multicolour mark, so it just works;
// no hand-rolled wordmark and no white-on-colour glyphs.

import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import PlatformLogo from './PlatformLogo';

// Neutral chip behind every logo (the logos carry their own colour).
const CHIP_BG: Record<string, string> = {
  shopify: '#f4f4f4',
  ebay: '#f4f4f4',
  facebook: '#f4f4f4',
  square: '#f4f4f4',
  clover: '#f4f4f4',
  amazon: '#f4f4f4',
  whatnot: '#f4f4f4',
  etsy: '#f4f4f4',
  depop: '#f4f4f4',
};

interface Props {
  platform: string;
  /** Chip edge length in px. Default 32. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

const PlatformBrandChip: React.FC<Props> = ({ platform, size = 32, style }) => {
  const p = String(platform || '').toLowerCase();
  const radius = Math.round(size * 0.27); // 9 at both 32 and 34 — matches the design
  const bg = CHIP_BG[p] || '#f4f4f4';
  return (
    <View
      style={[
        styles.chip,
        { width: size, height: size, borderRadius: radius, backgroundColor: bg, borderWidth: 1, borderColor: '#E5E7EB' },
        style,
      ]}
    >
      {/* No `color` → the registry SVG renders in its own brand colours. */}
      <PlatformLogo type={p} size={Math.round(size * 0.66)} />
    </View>
  );
};

const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});

export default PlatformBrandChip;
