import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Linking,
  useWindowDimensions,
} from 'react-native';
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

// Board "v2 · Splash" is drawn on a 390-wide frame. Every number below is that board's,
// scaled by the device's width so the crop and rhythm hold on any phone.
const BOARD_W = 390;
// The photo is not a cover fill: the board places it at its own size, pushed left, so the
// counter lands where it does. splash_store_dither.png is that image baked at 2x.
const PHOTO_W = 1074;
const PHOTO_H = 806;
const PHOTO_LEFT = -281;
// Top scrim: the board's rotated overlay resolves to this dark-leaf wash over the top 282px.
const TOP_SCRIM_H = 282;
const TOP_SCRIM = 'rgba(9,18,0,0.54)';
const BOTTOM_SCRIM_H = 420;

const InitialScreen = ({ navigation }: Props) => {
  const { width } = useWindowDimensions();
  const s = width / BOARD_W;

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  if (!fontsLoaded) {
    return <AnimatedGradientBackground />;
  }

  return (
    <View style={styles.root}>
      <Image
        source={require('../assets/splash_store_dither.png')}
        style={{
          position: 'absolute',
          top: 0,
          left: PHOTO_LEFT * s,
          width: PHOTO_W * s,
          height: PHOTO_H * s,
        }}
      />

      <LinearGradient
        colors={[TOP_SCRIM, 'rgba(9,18,0,0)']}
        style={[styles.topScrim, { height: TOP_SCRIM_H * s }]}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.78)', 'rgba(0,0,0,1)']}
        locations={[0, 0.46, 1]}
        style={[styles.bottomScrim, { height: BOTTOM_SCRIM_H * s }]}
        pointerEvents="none"
      />

      <View style={styles.content}>
        <View style={styles.logoRow}>
          <Image
            source={require('../assets/anorha_mark_splash.png')}
            style={styles.mark}
          />
          <Text style={styles.wordmark}>anorha</Text>
        </View>

        <View style={styles.bottom}>
          <Text style={styles.headline}>Sell anything, anywhere, fast.</Text>

          <TouchableOpacity
            style={styles.continueButton}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Auth', { mode: 'login' })}
          >
            <Text style={styles.continueButtonText}>Continue</Text>
          </TouchableOpacity>

          <View style={styles.termsRow}>
            <Text style={styles.terms}>By continuing, you agree to our</Text>
            <Text
              style={[styles.terms, styles.termsLink]}
              onPress={() => Linking.openURL('https://anorha.app/terms')}
            >
              terms of service
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000C38',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingTop: 96,
  },
  mark: {
    width: 40,
    height: 39,
    borderRadius: 6,
    resizeMode: 'contain',
  },
  wordmark: {
    fontSize: 32,
    lineHeight: 40,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.64,
  },
  bottom: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  headline: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: 'Inter_800ExtraBold',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.44,
    marginBottom: 12,
  },
  continueButton: {
    width: '100%',
    height: 54,
    borderRadius: 16,
    backgroundColor: '#93C822',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: '#1C1B17',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  continueButtonText: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingTop: 6,
  },
  terms: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: 'Inter_500Medium',
    color: '#FFFFFF',
  },
  termsLink: {
    textDecorationLine: 'underline',
  },
});

export default InitialScreen;
