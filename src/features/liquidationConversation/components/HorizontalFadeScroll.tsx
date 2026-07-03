// HorizontalFadeScroll — wraps wide content (tables) in a horizontal scroller with a
// soft gradient fade on whichever edge has more content off-screen. The fade is the
// "there's more →" affordance you see in Claude's document tables: it appears on the
// right until you scroll, then on the left once you've scrolled past the start, and
// disappears entirely when the content fits. Pure presentational, no deps beyond the
// gradient.
import React, { useState } from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type Props = {
  children: React.ReactNode;
  /** The surface color the table sits on — the fade dissolves INTO this. */
  fadeColor?: string;
  /** Width of the fade in px. */
  fadeWidth?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

// '#FFFFFF' -> 'rgba(255,255,255,0)'. Handles 3- and 6-digit hex; falls back to the
// input (already rgba) with an alpha swap best-effort.
const toTransparent = (color: string): string => {
  const hex = color.trim();
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(hex);
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(hex);
  let r = 255, g = 255, b = 255;
  if (m6) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  } else if (m3) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  }
  return `rgba(${r},${g},${b},0)`;
};

export function HorizontalFadeScroll({ children, fadeColor = '#FFFFFF', fadeWidth = 28, style, contentStyle }: Props) {
  const [containerW, setContainerW] = useState(0);
  const [contentW, setContentW] = useState(0);
  const [offsetX, setOffsetX] = useState(0);

  const maxX = Math.max(0, contentW - containerW);
  const canScroll = maxX > 1;
  const showRight = canScroll && offsetX < maxX - 1;
  const showLeft = canScroll && offsetX > 1;

  const transparent = toTransparent(fadeColor);

  return (
    <View
      style={style}
      onLayout={(e: LayoutChangeEvent) => setContainerW(e.nativeEvent.layout.width)}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => setOffsetX(e.nativeEvent.contentOffset.x)}
        onContentSizeChange={(w) => setContentW(w)}
        contentContainerStyle={contentStyle}
      >
        {children}
      </ScrollView>

      {showLeft ? (
        <LinearGradient
          pointerEvents="none"
          colors={[fadeColor, transparent]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.fade, { left: 0, width: fadeWidth }]}
        />
      ) : null}
      {showRight ? (
        <LinearGradient
          pointerEvents="none"
          colors={[transparent, fadeColor]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.fade, { right: 0, width: fadeWidth }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
});

export default HorizontalFadeScroll;
