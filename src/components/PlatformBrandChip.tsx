// PlatformBrandChip — the rounded brand square used in the publish + published screens.
//
// Each channel gets its AUTHENTIC mark, matching the Paper publish designs:
//   • eBay → its multicolour wordmark (e·b·a·y) on a light neutral chip — never a
//     white glyph on red, which is what a plain colour-chip would produce.
//   • everyone else → a white glyph on the platform's brand colour (yellow brands
//     get a dark glyph so the mark stays legible).

import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import PlatformLogo from './PlatformLogo';
import { getPlatform } from '../config/platforms';

// eBay's wordmark is four letters in four brand colours — reproduced here so it
// reads correctly on a light chip instead of collapsing to a single fill.
const EBAY_LETTERS: Array<{ ch: string; color: string }> = [
  { ch: 'e', color: '#E53238' },
  { ch: 'b', color: '#0064D2' },
  { ch: 'a', color: '#F5AF02' },
  { ch: 'y', color: '#86B817' },
];

// Chip backgrounds tuned to each brand (matches the design swatches).
const CHIP_BG: Record<string, string> = {
  shopify: '#95BF47',
  facebook: '#1877F2',
  square: '#1C1C1C',
  clover: '#4B9E3F',
  amazon: '#FF9900',
  whatnot: '#FFC700',
  etsy: '#F1641E',
  depop: '#FF2300',
};

// Light/yellow chips need a dark glyph for contrast.
const DARK_GLYPH = new Set(['whatnot', 'amazon']);

interface Props {
  platform: string;
  /** Chip edge length in px. Default 32. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

const PlatformBrandChip: React.FC<Props> = ({ platform, size = 32, style }) => {
  const p = String(platform || '').toLowerCase();
  const radius = Math.round(size * 0.27); // 9 at both 32 and 34 — matches the design

  if (p === 'ebay') {
    return (
      <View
        style={[
          styles.chip,
          { width: size, height: size, borderRadius: radius, backgroundColor: '#F4F4F1', borderWidth: 1, borderColor: '#E5E7EB' },
          style,
        ]}
      >
        <Text style={[styles.wordmark, { fontSize: Math.round(size * 0.45) }]} allowFontScaling={false}>
          {EBAY_LETTERS.map((l) => (
            <Text key={l.ch} style={{ color: l.color }}>{l.ch}</Text>
          ))}
        </Text>
      </View>
    );
  }

  const bg = CHIP_BG[p] || getPlatform(p)?.brandColor || '#6B7280';
  const glyph = DARK_GLYPH.has(p) ? '#18181B' : '#FFFFFF';
  return (
    <View style={[styles.chip, { width: size, height: size, borderRadius: radius, backgroundColor: bg }, style]}>
      <PlatformLogo type={p} size={Math.round(size * 0.55)} color={glyph} />
    </View>
  );
};

const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center' },
  wordmark: { fontWeight: '800', letterSpacing: -0.5, includeFontPadding: false },
});

export default PlatformBrandChip;
