import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../components/Button';
import AnimatedGradientBackground from '../components/AnimatedGradientBackground';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';


type Props = {
  navigation: any; // Or better, use proper navigation type
};

const InitialScreen = ({ navigation }: Props) => {
  const insets = useSafeAreaInsets();
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {

  }, []);

  if (!fontsLoaded) {
    return <AnimatedGradientBackground />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.contentContainer}>
        <View style={styles.logoContainer}>
          <View style={styles.logoBox}>
            <Image source={require('../assets/anorha_logo.png')} style={styles.logoImage} />
          </View>
          <Text style={styles.title}>anorha</Text>
        </View>

        <View style={styles.textContainer}>
          <Text style={styles.heading}>
            Sync Everywhere,{'\n'}
            List Faster,{'\n'}
            Work Together.
          </Text>
        </View>
      </View>

      <View style={styles.ActionContainer}>
        <View style={styles.pillRow}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>
              Make your inventory work <Text style={styles.underline}>for</Text> you
            </Text>
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Continue"
            onPress={() => navigation.navigate('OnboardingSlides')}
            style={styles.continueButton}
            textStyle={styles.continueButtonText}
          />

          <Text style={styles.terms}>
            By continuing, you agree to our Terms & Privacy Policy
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  ActionContainer: {
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 20,
  },
  buttonContainer: {
    gap: 16,
  },
  container: {
    backgroundColor: '#F6F7F4',
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  contentContainer: {
    justifyContent: 'center',
    flex: 1,
    gap: 24,
    alignItems: 'center',
  },
  logoContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    zIndex: 1,
    gap: 16,
    marginBottom: 32,
  },
  logoBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  logoImage: {
    width: 80,
    height: 80,
    resizeMode: 'stretch',
  },
  textContainer: {
    alignItems: 'center',
  },
  heading: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: '#18181B',
    textAlign: 'center',
    lineHeight: 40,
  },
  title: {
    fontSize: 34,
    fontFamily: 'Inter_700Bold',
    color: '#18181B',
    textAlign: 'center',
  },
  pillRow: {
    alignItems: 'center',
  },
  pill: {
    backgroundColor: '#18181B',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pillText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  underline: {
    textDecorationLine: 'underline',
  },
  continueButton: {
    backgroundColor: '#93C822',
    borderRadius: 16,
    paddingVertical: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  continueButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  terms: {
    color: '#71717A',
    textAlign: 'center',
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
});

export default InitialScreen;
