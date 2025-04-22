import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, Image } from 'react-native';
import AnimatedGradientBackground from '../components/AnimatedGradientBackground';
import Button from '../components/Button';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../../lib/supabase';
// import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
// Import Phone Number Input (Commented out for now)
// import PhoneInput from 'react-native-phone-number-input';
// import { useRef } from 'react';


type AuthScreenProps = {
  navigation: any;
};

const AuthScreen: React.FC<AuthScreenProps> = ({ navigation }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  // Comment out phone state for now
  // const [phoneNumber, setPhoneNumber] = useState('');
  // const [formattedPhoneNumber, setFormattedPhoneNumber] = useState('');
  // const [countryCode, setCountryCode] = useState('US');
  
  const authContext = useContext(AuthContext);
  // Comment out phone ref for now
  // const phoneInputRef = useRef<PhoneInput>(null);
  
  const handleAuth = async () => {
    if (!authContext) {
      console.error("Auth context is not available");
      return;
    }
    
    setLoading(true);
    
    try {
      if (isLogin) {
        // Handle login
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        
        if (error) throw error;
        
        if (data?.session) {
          authContext.signIn(data.session.access_token);
          // Now the AppNavigator will automatically navigate to the main app
        }
      } else {
        // Handle signup
        if (!firstName || !lastName) {
          Alert.alert('Error', 'Please enter your first and last name');
          setLoading(false);
          return;
        }
        
        // --- Phone validation removed --- //
        // const checkValid = phoneInputRef.current?.isValidNumber(phoneNumber);
        // ... rest of phone validation ...
        // ------------------------------- //

        // Step 1: Sign up the user WITHOUT the phone number
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          // phone: formattedPhoneNumber, // REMOVED phone from signup
          options: {
            data: {
              firstName: firstName,
              lastName: lastName,
            }
          }
        });

        if (signUpError) {
            // Handle specific errors, e.g., user already exists
             if (signUpError.message.includes('User already registered')) {
                Alert.alert('Error', 'An account with this email already exists. Please log in.');
                // Optionally switch to login view
                // setIsLogin(true);
             } else {
                throw signUpError; // Rethrow other signup errors
             }
             setLoading(false);
             return; // Stop execution if signup failed
        }

        // --- Skip OTP, Navigate Directly to CreateAccountScreen --- //
        // Alert.alert('Account Created', 'Please complete your profile.'); // Inform user - Handled by arriving at CreateAccountScreen
        // navigation.navigate('CreateAccountScreen'); // REMOVE: AppNavigator handles navigation based on token change
        // --------------------------------------------------------- //

        /* // --- Original OTP Logic (Commented Out) ---
        // Step 2: If signup seems successful... attempt to send OTP
        if (signUpData.user || !signUpError) {
          try {
              console.log(`Signup successful for ${email}, attempting to send OTP to ${formattedPhoneNumber}`);
              const { error: otpError } = await supabase.auth.signInWithOtp({
                phone: formattedPhoneNumber,
              });

              if (otpError) {
                console.error("OTP Send Error after signup:", otpError);
                Alert.alert(
                    'Account Created (Verification Needed)',
                    `Your account was created, but we failed to send a verification OTP to ${formattedPhoneNumber}. Please verify your email (if sent) and try phone verification later.\nError: ${otpError.message}`
                );

              } else {
                console.log(`OTP sent successfully to ${formattedPhoneNumber}, navigating to verification.`);
                navigation.navigate('PhoneAuthScreen', { phoneNumber: formattedPhoneNumber });
                Alert.alert('Account Created', 'Please verify your phone number with the OTP sent.');
              }
          } catch (otpRelatedError: any) {
              console.error("Error during OTP send/navigation phase:", otpRelatedError);
              Alert.alert('Error', `Account created, but an error occurred during phone verification setup: ${otpRelatedError.message}`);
          }
        } else {
             console.error("Signup reported no error, but no user object returned and email verification might be off.");
             Alert.alert('Error', 'Account creation incomplete. Please try again.');
        }
        */ // --- End of Original OTP Logic ---
      }
    } catch (error: any) {
      // Catch errors from the initial validation or the signUp call itself
      console.error("Overall Auth Error:", error);
      Alert.alert('Error', error.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };
  
  const handleForgotPassword = async () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email');
      return;
    }
    
    setLoading(true);
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      
      if (error) throw error;
      
      Alert.alert('Success', 'Check your email for the password reset link.');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };
  
  // Implemented handleGoogleAuth
  /* // Commenting out Google Auth for now
  const handleGoogleAuth = async () => {
    if (!authContext) {
      console.error("Auth context is not available");
      Alert.alert('Error', 'Authentication service unavailable.');
      return;
    }
    setLoading(true); // Indicate loading state
    try {
      // Check if device has Google Play Services installed/updated
      await GoogleSignin.hasPlayServices();

      // Get the user's ID token from Google
      const userInfo = await GoogleSignin.signIn();

      // Use type assertion to access idToken due to potential type mismatch
      const idToken = (userInfo as any)?.idToken;

      if (idToken) {
        // Sign in with Supabase using the Google ID token
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });

        if (error) throw error;

        // If successful, Supabase provides a session, update AuthContext
        if (data?.session) {
           console.log('Google Sign-In Success:', data.session.user.email);
           // The AuthContext listener should handle navigation
           // Or call authContext.signIn(data.session.access_token); explicitly if needed
        } else {
           throw new Error("Google Sign-In successful but no session received.");
        }

      } else {
        throw new Error('Google Sign-In failed: No ID token received.');
      }
    } catch (error: any) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        // User cancelled the login flow
        console.log('Google Sign-In Cancelled');
      } else if (error.code === statusCodes.IN_PROGRESS) {
        // Operation (e.g. sign in) is in progress already
        Alert.alert('Wait', 'Sign-in is already in progress.');
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        // Play services not available or outdated
        Alert.alert('Error', 'Google Play Services not available or outdated.');
      } else {
        // Some other error happened
        console.error('Google Auth Error:', error);
        Alert.alert('Error', error.message || 'An error occurred during Google Sign-In.');
      }
    } finally {
      setLoading(false); // Stop loading indicator
    }
  };
  */

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <AnimatedGradientBackground />
      
      <View style={styles.logoContainer}>
        <Image source={require('../assets/rounded_sssync.png')} style={styles.logo} />
        <Text style={styles.title}>sssync</Text>
      </View>
      
      <Animated.View 
        style={styles.formContainer}
        entering={FadeInDown.delay(300).duration(500)}
      >
        <Text style={styles.headerText}>
          {isLogin ? 'Log Back In' : 'Create Account'}
        </Text>
        
        {!isLogin && (
          <TextInput
            style={styles.input}
            placeholder="First Name"
            placeholderTextColor="#aaa"
            value={firstName}
            onChangeText={setFirstName}
          />
        )}

        {!isLogin && (
          <TextInput
            style={styles.input}
            placeholder="Last Name"
            placeholderTextColor="#aaa"
            value={lastName}
            onChangeText={setLastName}
          />
        )}
        
        {/* --- Add Phone Input for Signup (Commented Out) --- */}
        {/* {!isLogin && (
          <PhoneInput
              ref={phoneInputRef}
              defaultValue={phoneNumber}
              defaultCode={countryCode as any}
              layout="first"
              onChangeText={(text) => {
                setPhoneNumber(text);
              }}
              onChangeFormattedText={(text) => {
                setFormattedPhoneNumber(text);
              }}
              onChangeCountry={(country: any) => setCountryCode(country.cca2)}
              containerStyle={styles.phoneContainer}
              textContainerStyle={styles.phoneTextContainer}
              textInputStyle={styles.phoneTextInput}
              codeTextStyle={styles.phoneCodeText}
              countryPickerButtonStyle={styles.phoneCountryPickerButton}
              placeholder="Phone Number"
              withShadow
            />
        )} */}
        {/* ----------------------------------- */}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#aaa"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />
        
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#aaa"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        
        <Button 
          title={isLogin ? "Log In" : "Sign Up"} 
          onPress={handleAuth} 
          style={styles.button}
          loading={loading}
          icon={isLogin ? "login" : "account-plus"}
          textStyle={styles.buttonText}
        />
        
        {isLogin && (
          <TouchableOpacity onPress={handleForgotPassword}>
            <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
          </TouchableOpacity>
        )}
        
        <View style={styles.switchContainer}>
          <Text style={styles.switchText}>
            {isLogin ? "Don't have an account?" : "Already have an account?"}
          </Text>
          <TouchableOpacity onPress={() => setIsLogin(!isLogin)}>
            <Text style={styles.switchButton}>
              {isLogin ? "Sign Up" : "Log In"}
            </Text>
          </TouchableOpacity>
        </View>
        
    
        
        {/* Commenting out Google Auth Button */}
        {/* 
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>
        
        <TouchableOpacity style={styles.socialButton} onPress={handleGoogleAuth} disabled={loading}>
          <Text style={styles.socialButtonText}>Continue with Google</Text>
        </TouchableOpacity> */}
        
        {/* --- Conditionally show Phone Button only on Login (Commented Out) --- */}

        {/* {isLogin && (
          <TouchableOpacity
            style={styles.socialButton}
            onPress={() => navigation.navigate('PhoneAuthScreen')}
            disabled={loading}
          >
            <Text style={styles.socialButtonText}>Continue with Phone Number</Text>
          </TouchableOpacity>
        )} */}
        {/* --------------------------------------------------- */}
      </Animated.View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
  },
  title: {
    fontSize: 30,
    fontWeight: 'bold',
    color: 'white',
  },
  formContainer: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  headerText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  input: {
    width: '100%',
    height: 50,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginBottom: 16,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  button: {
    width: '100%',
    backgroundColor: '#5c9c00',
    borderRadius: 8,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  forgotPasswordText: {
    color: '#5c9c00',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 16,
  },
  switchContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  switchText: {
    color: '#666',
    marginRight: 8,
  },
  switchButton: {
    color: '#5c9c00',
    fontWeight: 'bold',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  dividerText: {
    color: '#999',
    marginHorizontal: 8,
    fontSize: 14,
  },
  socialButton: {
    width: '100%',
    backgroundColor: 'white',
    borderRadius: 8,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  socialButtonText: {
    color: '#333',
    fontWeight: '600',
  },
  // --- Add styles for PhoneInput (Commented Out) ---
  /* phoneContainer: {
    width: '100%',
    height: 50,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRightColor: '#d0d0d0',
  }, */
  // ------------------------------------------------------------------
});

export default AuthScreen; 