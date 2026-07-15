import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
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
};

/** Native counterpart to Magic UI's DiaTextReveal. The sweep resolves to solid text. */
export function DiaTextReveal({
  text,
  style,
  numberOfLines = 2,
  revealFrom = '#FAFAF8',
  revealTo = '#71717A',
}: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

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
    if (!size.width || reduceMotion) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 480,
      delay: 40,
      useNativeDriver: true,
    }).start();
  }, [progress, reduceMotion, size.width, text]);

  if (reduceMotion) {
    return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;
  }

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -size.width],
  });

  return (
    <View style={styles.root}>
      <Text
        style={[style, styles.measure]}
        numberOfLines={numberOfLines}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setSize((current) => current.width === width && current.height === height ? current : { width, height });
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
              colors={[revealFrom, revealFrom, revealTo, revealTo]}
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
