import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  revealFrom?: string;
  revealTo?: string;
  duration?: number;
  delay?: number;
  animationKey?: string;
  onComplete?: () => void;
};

/** Native counterpart to Magic UI's DiaTextReveal. Resolves left to right. */
export function DiaTextReveal({
  text,
  style,
  numberOfLines,
  revealFrom = '#FAFAF8',
  revealTo = '#71717A',
  duration = 480,
  delay = 40,
  animationKey,
  onComplete,
}: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [layoutReady, setLayoutReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const completedKeyRef = useRef<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  const resolvedAnimationKey = animationKey ?? text;

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { if (mounted) setReduceMotion(enabled); })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!layoutReady) return;

    if (reduceMotion) {
      if (completedKeyRef.current !== resolvedAnimationKey) {
        completedKeyRef.current = resolvedAnimationKey;
        onCompleteRef.current?.();
      }
      return;
    }

    completedKeyRef.current = null;
    progress.stopAnimation();
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && completedKeyRef.current !== resolvedAnimationKey) {
        completedKeyRef.current = resolvedAnimationKey;
        onCompleteRef.current?.();
      }
    });

    return () => animation.stop();
  }, [delay, duration, layoutReady, progress, reduceMotion, resolvedAnimationKey]);

  if (reduceMotion) {
    return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;
  }

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-size.width, 0],
  });

  return (
    <View style={styles.root}>
      <Text
        style={[style, styles.measure]}
        numberOfLines={numberOfLines}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setSize((current) => current.width === width && current.height === height ? current : { width, height });
          if (width > 0 && height > 0) setLayoutReady(true);
        }}
      >
        {text}
      </Text>
      {size.width > 0 && size.height > 0 ? (
        <MaskedView
          style={[StyleSheet.absoluteFill, { width: size.width, height: size.height }]}
          maskElement={<Text style={style} numberOfLines={numberOfLines}>{text}</Text>}
          pointerEvents="none"
        >
          <Animated.View style={{ width: size.width * 2, height: size.height, transform: [{ translateX }] }}>
            <LinearGradient
              colors={[revealTo, revealTo, revealFrom, revealFrom]}
              locations={[0, 0.44, 0.56, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </MaskedView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'flex-start', maxWidth: '100%' },
  measure: { opacity: 0 },
});
