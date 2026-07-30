import React, { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';
import {
  Canvas,
  LinearGradient,
  Mask,
  Rect,
  Text as SkiaText,
  matchFont,
  useFont,
  vec,
  type SkFont,
} from '@shopify/react-native-skia';
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

type ThinkingTextProps = {
  children: string;
  style?: StyleProp<TextStyle>;
};

type FontWeight = '400' | '500' | '600' | '700';

const BASE_COLOR = '#6e6e6e';
const HIGHLIGHT_COLOR = '#ededed';
const TRANSPARENT_HIGHLIGHT = 'rgba(237, 237, 237, 0)';
const SHIMMER_DURATION_MS = 2000;
const FONT_SOURCES: Record<FontWeight, number> = {
  '400': Inter_400Regular,
  '500': Inter_500Medium,
  '600': Inter_600SemiBold,
  '700': Inter_700Bold,
};

// A Skia text mask keeps the light band inside the glyphs like the web treatment.
export function ThinkingText({ children, style }: ThinkingTextProps) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // Stay static until the preference resolves so reduced motion never sees a sweep.
  if (reduceMotion !== false) {
    return <Text style={[style, styles.staticText]}>{children}</Text>;
  }

  return <AnimatedThinkingText style={style}>{children}</AnimatedThinkingText>;
}

function AnimatedThinkingText({ children, style }: ThinkingTextProps) {
  const textStyle = StyleSheet.flatten(style) ?? {};
  const fontSize = textStyle.fontSize ?? 14;
  const fontWeight = resolveFontWeight(textStyle);
  const fontFamily = textStyle.fontFamily;
  const usesInter = fontFamily?.startsWith('Inter_') ?? false;
  const interFont = useFont(usesInter ? FONT_SOURCES[fontWeight] : null, fontSize);
  const systemFont = useMemo(
    () => matchFont({
      fontFamily: fontFamily ?? 'System',
      fontSize,
      fontWeight,
    }),
    [fontFamily, fontSize, fontWeight]
  );
  const font = usesInter ? interFont : systemFont;

  // Keep native text visible while the matching Skia typeface loads.
  if (!font) {
    return <Text style={[style, styles.staticText]}>{children}</Text>;
  }

  return <MaskedShimmerText font={font} fontSize={fontSize} style={style}>{children}</MaskedShimmerText>;
}

function MaskedShimmerText({
  children,
  font,
  fontSize,
  style,
}: ThinkingTextProps & {
  font: SkFont;
  fontSize: number;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ready = size.width > 0 && size.height > 0;
  const metrics = font.getMetrics();
  const baseline = (size.height - (metrics.descent - metrics.ascent)) / 2 - metrics.ascent;
  const bandWidth = Math.max(size.width * 0.55, fontSize * 2.2);
  const progress = useSharedValue(0);
  const gradientStart = useDerivedValue(() => {
    const center = -bandWidth / 2 + (size.width + bandWidth) * progress.get();
    return vec(center - bandWidth / 2, size.height / 2);
  }, [bandWidth, size.height, size.width]);
  const gradientEnd = useDerivedValue(() => {
    const center = -bandWidth / 2 + (size.width + bandWidth) * progress.get();
    return vec(center + bandWidth / 2, size.height / 2);
  }, [bandWidth, size.height, size.width]);

  useEffect(() => {
    progress.set(0);
    progress.set(withRepeat(
      withTiming(1, { duration: SHIMMER_DURATION_MS, easing: Easing.linear }),
      -1,
      false
    ));
    return () => cancelAnimation(progress);
  }, [progress]);

  return (
    <View
      style={styles.root}
      accessible
      accessibilityRole="text"
      accessibilityLabel={children}
    >
      <Text
        style={[style, styles.staticText, ready ? styles.measure : null]}
        accessible={false}
        importantForAccessibility="no"
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setSize((current) => (
            current.width === width && current.height === height
              ? current
              : { width, height }
          ));
        }}
      >
        {children}
      </Text>
      {ready ? (
        <Canvas
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <SkiaText text={children} font={font} x={0} y={baseline} color={BASE_COLOR} />
          <Mask
            mask={<SkiaText text={children} font={font} x={0} y={baseline} color="#ffffff" />}
          >
            <Rect x={0} y={0} width={size.width} height={size.height}>
              <LinearGradient
                start={gradientStart}
                end={gradientEnd}
                colors={[TRANSPARENT_HIGHLIGHT, HIGHLIGHT_COLOR, TRANSPARENT_HIGHLIGHT]}
                positions={[0, 0.5, 1]}
              />
            </Rect>
          </Mask>
        </Canvas>
      ) : null}
    </View>
  );
}

function resolveFontWeight(style: TextStyle): FontWeight {
  const familyWeight = style.fontFamily?.match(/_(400|500|600|700)/)?.[1];
  const requestedWeight = familyWeight ?? style.fontWeight ?? '400';
  const numericWeight = requestedWeight === 'normal'
    ? 400
    : requestedWeight === 'bold'
      ? 700
      : Number(requestedWeight);

  if (numericWeight >= 650) return '700';
  if (numericWeight >= 550) return '600';
  if (numericWeight >= 450) return '500';
  return '400';
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'flex-start',
  },
  staticText: {
    color: BASE_COLOR,
  },
  measure: {
    opacity: 0,
  },
});
