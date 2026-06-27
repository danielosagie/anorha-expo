import React, { useCallback, useState, useEffect } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Mail } from 'lucide-react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSSO } from '@clerk/expo';
import * as LocalAuthentication from 'expo-local-authentication';
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

const InitialScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const { startSSOFlow } = useSSO();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [faceReady, setFaceReady] = useState(false);

  // Show Face ID whenever the device has biometric hardware — it's a quick-login affordance.
  useEffect(() => {
    (async () => {
      try {
        setFaceReady(await LocalAuthentication.hasHardwareAsync());
      } catch { /* ignore */ }
    })();
  }, []);

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  const handleGoogle = useCallback(async () => {
    if (googleLoading) return;
    setGoogleLoading(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: 'anorhaapp://redirect',
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
    } catch (err: any) {
      Alert.alert(
        'Google sign-in failed',
        err?.errors?.[0]?.message ?? err?.message ?? 'Could not sign in with Google.'
      );
    } finally {
      setGoogleLoading(false);
    }
  }, [googleLoading, startSSOFlow]);

  if (!fontsLoaded) {
    return <AnimatedGradientBackground />;
  }

  return (
    <View style={styles.root}>
      <Image
        source={require('../assets/splash_store_dither.png')}
        style={{height: "100%", width: "100%", bottom: 60, position: "absolute"}}
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
          { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 18 },
        ]}
      >
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
            style={styles.emailButton}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Auth', { mode: 'login' })}
          >
            <Mail size={20} color="#FFFFFF" strokeWidth={1.8} />
            <Text style={styles.emailButtonText}>Continue with email</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.googleButton}
            activeOpacity={0.9}
            onPress={handleGoogle}
            disabled={googleLoading}
          >
            {googleLoading ? (
              <ActivityIndicator size="small" color="#18181B" />
            ) : (
              <>
                <Image
                  source={require('../assets/google.png')}
                  style={styles.googleIcon}
                />
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          {faceReady && (
            <TouchableOpacity
              style={styles.faceButton}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Auth', { mode: 'login', autoFaceId: true })}
            >
              <Icon name="face-recognition" size={20} color="#1C1B17" />
              <Text style={styles.faceButtonText}>Sign in with Face ID</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.terms}>
            By continuing, you agree to our{' '}
            <Text style={styles.termsLink}>terms of service</Text>
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000C38',
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
  bottom: {
    width: '100%',
    alignItems: 'center',
  },
  headline: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: 'Inter_800ExtraBold',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.44,
    minWidth: "60%",
    marginBottom: 18,
  },
  emailButton: {
    width: '100%',
    height: 54,
    borderRadius: 16,
    backgroundColor: BRAND_PRIMARY,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 10,
  },
  emailButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },
  googleButton: {
    width: '100%',
    height: 54,
    borderRadius: 16,
    backgroundColor: '#F0EFEC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 10,
  },
  googleIcon: {
    width: 20,
    height: 20,
    resizeMode: 'contain',
  },
  googleButtonText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#18181B',
  },
  faceButton: {
    width: '100%',
    height: 54,
    borderRadius: 16,
    backgroundColor: '#F0EFEC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  faceButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#1C1B17',
  },
  terms: {
    marginTop: 14,
    fontSize: 14,
    lineHeight: 18,
    fontFamily: 'Inter_500Medium',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  termsLink: {
    fontFamily: 'Inter_500Medium',
    color: '#FFFFFF',
    textDecorationLine: 'underline',
  },
});

export default InitialScreen;
