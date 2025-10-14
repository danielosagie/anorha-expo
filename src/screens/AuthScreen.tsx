import React, { useState, useContext, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, Image } from 'react-native';
import AnimatedGradientBackground from '../components/AnimatedGradientBackground';
import Button from '../components/Button';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { LinearGradient } from 'expo-linear-gradient';
// import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
// Import Phone Number Input (Commented out for now)
// import PhoneInput from 'react-native-phone-number-input';
// import { useRef } from 'react';
import { useSignIn, useSignUp, useAuth, getClerkInstance, useOAuth } from '@clerk/clerk-expo';

// Flag to use static gradient for better performance
const USE_STATIC_GRADIENT = true;
// Flag to disable form animations for better performance
const DISABLE_FORM_ANIMATIONS = true;

// Define props interface for FormContent
interface FormContentProps {
  isLogin: boolean;
  firstName: string;
  setFirstName: (value: string) => void;
  lastName: string;
  setLastName: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  handleAuth: () => Promise<void>;
  loading: boolean;
  handleForgotPassword: () => Promise<void>;
  setIsLogin: (value: boolean) => void;
}

// Memoize form component for better performance
const FormContent = React.memo(({ 
  isLogin, 
  firstName, 
  setFirstName, 
  lastName, 
  setLastName, 
  email, 
  setEmail, 
  password, 
  setPassword, 
  handleAuth, 
  loading, 
  handleForgotPassword, 
  setIsLogin 
}: FormContentProps) => (
  <>
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
  </>
));

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
  const { signIn, isLoaded: isSignInLoaded } = useSignIn();
  const { signUp, isLoaded: isSignUpLoaded } = useSignUp();
  const auth = useAuth() as any; // setActive may not be typed in some versions
  const { startOAuthFlow: startGoogleOAuth } = useOAuth({ strategy: 'oauth_google' });
  // Comment out phone ref for now
  // const phoneInputRef = useRef<PhoneInput>(null);
  
  // Use useCallback for event handlers to prevent unnecessary re-renders
  const handleAuth = useCallback(async () => {
    if (!authContext) {
      console.error("Auth context is not available");
      return;
    }
    
    setLoading(true);
    
    try {
      if (isLogin) {
        if (!isSignInLoaded || !signIn) return;
        console.log('[AuthScreen] Attempting signIn.create with email:', email);
        const res = await signIn.create({ identifier: email, password });
        console.log('[AuthScreen] signIn.create result:', res.status, res.createdSessionId ? 'has session' : 'no session');
        if (res.status === 'complete' && res.createdSessionId) {
          try {
            const clerk = getClerkInstance?.();
            const setActiveFn = auth?.setActive || clerk?.setActive;
            console.log('[AuthScreen] setActive available:', !!setActiveFn);
            await setActiveFn?.({ session: res.createdSessionId });
            // Force resource reload to propagate state in-process on native
            try { await (clerk as any)?.__internal_reloadInitialResources?.(); } catch {}
            console.log('[AuthScreen] ✓ setActive + resources reload; App will switch branches when Clerk updates.');
            return; // Do not navigate here; App.tsx will react to isSignedIn
          } catch (e) {
            console.error('[AuthScreen] setActive failed:', e);
          }
        } else if ((res as any)?.status === 'needs_first_factor') {
          const r2 = await signIn.attemptFirstFactor({ strategy: 'password', password });
          if (r2.status === 'complete' && r2.createdSessionId) {
            try {
              const clerk = getClerkInstance?.();
              const setActiveFn = auth?.setActive || clerk?.setActive;
              console.log('[AuthScreen] setActive available (first factor):', !!setActiveFn);
              await setActiveFn?.({ session: r2.createdSessionId });
              try { await (clerk as any)?.__internal_reloadInitialResources?.(); } catch {}
              console.log('[AuthScreen] ✓ First factor login successful; App will switch branches when Clerk updates.');
              return;
            } catch (e) {
              console.error('[AuthScreen] setActive failed after first factor:', e);
            }
          } else {
            Alert.alert('Login', 'Additional authentication required.');
          }
        } else {
          Alert.alert('Login', 'Unable to complete sign-in.');
        }
      } else {
        // Handle signup with Clerk (email + password)
        if (!email || !password) {
          Alert.alert('Error', 'Please enter email and password');
          setLoading(false);
          return;
        }
        if (!isSignUpLoaded || !signUp) return;
        const res = await signUp.create({ emailAddress: email, password, firstName, lastName });
        if (res.status === 'complete' && res.createdSessionId) {
          try {
            const clerk = getClerkInstance?.();
            const setActiveFn = auth?.setActive || clerk?.setActive;
            console.log('[AuthScreen] setActive available (signup):', !!setActiveFn);
            await setActiveFn?.({ session: res.createdSessionId });
            try { await (clerk as any)?.__internal_reloadInitialResources?.(); } catch {}
            console.log('[AuthScreen] ✓ Signup successful; App will switch branches when Clerk updates.');
            return;
          } catch (e) {
            console.error('[AuthScreen] setActive failed during sign-up:', e);
          }
        } else {
          try {
            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
            navigation.navigate('VerifyCode', { contactLabel: email, mode: 'signup' });
          } catch {
            Alert.alert('Verify Email', 'Please verify your email to complete signup.');
          }
        }
      }
    } catch (error: any) {
      // Handle "already signed in" error specifically
      if (error.message?.includes('already signed in')) {
        console.log('[AuthScreen] User is already signed in, checking current state...');
        console.log('[AuthScreen] Current auth.isSignedIn:', auth.isSignedIn);
        console.log('[AuthScreen] Current auth.isLoaded:', auth.isLoaded);
        
        // If Clerk says we're signed in but our UI doesn't reflect it, something is wrong
        if (auth.isSignedIn) {
          console.log('[AuthScreen] Auth state indicates signed in, waiting for UI to catch up...');
          setLoading(false);
          return;
        } else {
          console.log('[AuthScreen] Auth state shows not signed in despite error, clearing session...');
          try {
            await auth.signOut?.();
            console.log('[AuthScreen] Signed out successfully, please try again');
            Alert.alert('Please try again', 'There was a session conflict. Please sign in again.');
          } catch (signOutError) {
            console.error('[AuthScreen] Failed to sign out:', signOutError);
            Alert.alert('Error', 'Please restart the app and try again.');
          }
        }
      } else {
        console.error("Overall Auth Error:", error);
        Alert.alert('Error', error.message || 'An error occurred');
      }
    } finally {
      setLoading(false);
    }
  }, [authContext, isLogin, email, password, firstName, lastName, isSignInLoaded, isSignUpLoaded, signIn, signUp, auth, navigation]);
  
  const handleForgotPassword = useCallback(async () => {
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
  }, [email]);
  
  // Implemented handleGoogleAuth
  const handleGoogleAuth = useCallback(async () => {
    setLoading(true);
    try {
      const result = await startGoogleOAuth();
      if (result?.createdSessionId) {
        const clerk = getClerkInstance?.();
        const setActiveFn = auth?.setActive || clerk?.setActive;
        await setActiveFn?.({ session: result.createdSessionId });
        try { await (clerk as any)?.__internal_reloadInitialResources?.(); } catch {}
        return;
      }
      if (result?.setActive) {
        await result.setActive({ session: result?.createdSessionId });
        return;
      }
      Alert.alert('Google Sign-In', 'Could not complete Google sign-in.');
    } catch (e: any) {
      console.error('[AuthScreen] Google OAuth error:', e);
      Alert.alert('Google Sign-In Error', e?.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [startGoogleOAuth, auth]);

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {USE_STATIC_GRADIENT ? (
        <LinearGradient
          colors={['#5c9c00', '#8cc63f', '#5c9c00']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      ) : (
        <AnimatedGradientBackground />
      )}
      
      <View style={styles.logoContainer}>
        <Image source={require('../assets/rounded_anorha.png')} style={styles.logo} />
        <Text style={styles.title}>Anorha</Text>
      </View>
      
      {DISABLE_FORM_ANIMATIONS ? (
        <View style={styles.formContainer}>
          <FormContent 
            isLogin={isLogin}
            firstName={firstName}
            setFirstName={setFirstName}
            lastName={lastName}
            setLastName={setLastName}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            handleAuth={handleAuth}
            loading={loading}
            handleForgotPassword={handleForgotPassword}
            setIsLogin={setIsLogin}
          />
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>
          <TouchableOpacity style={styles.socialButton} onPress={handleGoogleAuth} disabled={loading}>
            <Image source={require('../assets/google.png')} style={{ width: 20, height: 20, marginRight: 8 }} />
            <Text style={styles.socialButtonText}>Continue with Google</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Animated.View 
          style={styles.formContainer}
          entering={FadeInDown.delay(300).duration(500)}
        >
          <FormContent 
            isLogin={isLogin}
            firstName={firstName}
            setFirstName={setFirstName}
            lastName={lastName}
            setLastName={setLastName}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            handleAuth={handleAuth}
            loading={loading}
            handleForgotPassword={handleForgotPassword}
            setIsLogin={setIsLogin}
          />
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>
          <TouchableOpacity style={styles.socialButton} onPress={handleGoogleAuth} disabled={loading}>
            <Image source={require('../assets/google.png')} style={{ width: 20, height: 20, marginRight: 8 }} />
            <Text style={styles.socialButtonText}>Continue with Google</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
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