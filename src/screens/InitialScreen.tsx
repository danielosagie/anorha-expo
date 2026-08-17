import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AnimatedGradientBackground from '../components/AnimatedGradientBackground';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { useFonts } from 'expo-font';

type Props = {
  navigation: any;
};

/** How long the brand holds before the screen continues on its own. */
const HOLD_MS = 900;
/** Dissolve to white so the hand-off to the (white) auth surface is not a hard cut. */
const FADE_MS = 300;

/**
 * Brand splash. It holds a beat and continues by itself into Auth, which is the one
 * surface that presents every way in. `replace` rather than `navigate`, so continuing
 * cannot be undone by a back gesture into a screen that would only continue again.
 */
const InitialScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const fade = useRef(new Animated.Value(0)).current;

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    // Start the beat only once the wordmark can actually render, or the brand flashes by.
    if (!fontsLoaded) return;
    let done = false;
    const hold = setTimeout(() => {
      Animated.timing(fade, {
        toValue: 1,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start(() => {
        if (done) return;
        done = true;
        navigation.replace('Auth', { mode: 'login' });
      });
    }, HOLD_MS);
    return () => {
      done = true;
      clearTimeout(hold);
    };
  }, [fontsLoaded, fade, navigation]);

  if (!fontsLoaded) {
    return <AnimatedGradientBackground />;
  }

  return (
    <View style={styles.root}>
      <Image
        source={require('../assets/splash_store_dither.png')}
        style={styles.photo}
        resizeMode="cover"
      />
      <LinearGradient
        colors={[
          'rgba(0,0,0,0.64)',
          'rgba(0,0,0,0.04)',
          'rgba(0,0,0,0.75)',
          'rgba(0,0,0,0.95)',
        ]}
        locations={[0, 0.3, 0.74, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View
        style={[
          styles.content,
          { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 40 },
        ]}
      >
        <View style={styles.logoRow}>
          <Image
            source={require('../assets/anorha_mark_splash.png')}
            style={styles.mark}
          />
          <Text style={styles.wordmark}>anorha</Text>
        </View>

        <Text style={styles.headline}>Sell anything, anywhere, fast.</Text>
      </View>

      <Animated.View pointerEvents="none" style={[styles.fade, { opacity: fade }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000C38',
  },
  photo: {
    height: '100%',
    width: '100%',
    bottom: 60,
    position: 'absolute',
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  mark: {
    width: 38,
    height: 38,
    resizeMode: 'contain',
  },
  wordmark: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.64,
  },
  headline: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: 'Inter_800ExtraBold',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.44,
    minWidth: '60%',
  },
  fade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
  },
});

export default InitialScreen;
