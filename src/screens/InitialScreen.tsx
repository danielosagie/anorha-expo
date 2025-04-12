import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import Button from '../components/Button';
import AnimatedGradientBackground from '../components/AnimatedGradientBackground';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';
import { useFonts } from 'expo-font';


type Props = {
  navigation: any; // Or better, use proper navigation type
};

const InitialScreen = ({ navigation }: Props) => {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_700Bold,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {

  }, []);

  if (!fontsLoaded) {
    return <AnimatedGradientBackground />;
  }

  return (
    <View style={styles.container}>
      <AnimatedGradientBackground />
      

      <View style={styles.contentContainer}>  
        <View style={styles.logoContainer}>
            <View style={styles.logoBox}>
            <Image source={require('../assets/rounded_sssync.png')} style={styles.logoImage} />
            </View>
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
            <Text style={styles.subheading}>
                Make your inventory work <Text style={styles.underline}>for</Text> you.
            </Text>
            
            <View style={styles.buttonContainer}>
                <Button 
                title="Continue" 
                onPress={() => navigation.navigate('OnboardingSlides')} 
                style={styles.continueButton} 
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
        gap: 24,
        paddingBottom: 24,
    },
    buttonContainer: {
        gap: 24,
    },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
  },
  contentContainer: {
    justifyContent: 'center',
    flex: 1,
    gap: 24,
    alignItems: 'center',
    padding: 24,
  },
  logoContainer: {
    marginTop: 80,
    alignItems: 'center',
    zIndex: 1,
  },
  logoBox: {
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  logoImage: {
    width: 100,
    height: 100,
    resizeMode: 'contain',
  },
  logoText: {
    fontSize: 60,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: 'white',
  },
  textContainer: {
    alignItems: 'center',
  },
  heading: {
    fontSize: 32,
    fontFamily: 'PlusJakartaSans_700Bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 24,
  },
  subheading: {
    fontSize: 24,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: 'white',
    textAlign: 'center',
  },
  underline: {
    textDecorationLine: 'underline',
  },
  footer: {
    width: '100%',
    marginBottom: 20,
  },
  continueButton: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 8,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  terms: {
    color: 'white',
    textAlign: 'center',
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_500Medium',
  },
});

export default InitialScreen; 