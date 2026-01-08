import React, { useState, useContext, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, Image, Animated as RNAnimated, Dimensions } from 'react-native';
import AnimatedGradientBackground from '../components/AnimatedGradientBackground';
import Button from '../components/Button';
import Animated, { FadeInDown, FadeIn, FadeOut } from 'react-native-reanimated';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { LinearGradient } from 'expo-linear-gradient';
import { useSignIn, useSignUp } from '@clerk/clerk-expo';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

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
  showPassword: boolean;
  setShowPassword: (value: boolean) => void;
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
  setIsLogin,
  showPassword,
  setShowPassword
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

    <View style={styles.passwordContainer}>
      <TextInput
        style={styles.passwordInput}
        placeholder="Password"
        placeholderTextColor="#aaa"
        secureTextEntry={!showPassword}
        value={password}
        onChangeText={setPassword}
      />
      <TouchableOpacity
        onPress={() => setShowPassword(!showPassword)}
        style={styles.eyeIcon}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Icon
          name={showPassword ? "eye" : "eye-off"}
          size={20}
          color="#aaa"
        />
      </TouchableOpacity>
    </View>

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
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  // Notification state
  const [notification, setNotification] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const notificationAnim = useRef(new RNAnimated.Value(-100)).current;

  const showNotification = useCallback((message: string, type: 'error' | 'success' = 'error') => {
    setNotification({ message, type });
    RNAnimated.sequence([
      RNAnimated.timing(notificationAnim, {
        toValue: 20, // Top margin
        duration: 300,
        useNativeDriver: true,
      }),
      RNAnimated.delay(3000),
      RNAnimated.timing(notificationAnim, {
        toValue: -100,
        duration: 300,
        useNativeDriver: true,
      })
    ]).start(() => setNotification(null));
  }, [notificationAnim]);

  const authContext = useContext(AuthContext);
  const { signIn, isLoaded: isSignInLoaded, setActive: signInSetActive } = useSignIn();
  const { signUp, isLoaded: isSignUpLoaded, setActive: signUpSetActive } = useSignUp();

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

        if (res.status === 'complete' && res.createdSessionId) {
          console.log('[AuthScreen] Calling setActive with session:', res.createdSessionId);
          await signInSetActive({ session: res.createdSessionId });
          console.log('[AuthScreen] ✓ Login successful, session activated');
          return;
        } else if ((res as any)?.status === 'needs_first_factor') {
          const r2 = await signIn.attemptFirstFactor({ strategy: 'password', password });
          if (r2.status === 'complete' && r2.createdSessionId) {
            console.log('[AuthScreen] First factor complete, calling setActive');
            await signInSetActive({ session: r2.createdSessionId });
            console.log('[AuthScreen] ✓ First factor login successful');
            return;
          } else {
            showNotification('Additional authentication required.');
          }
        } else {
          showNotification('Unable to complete sign-in.');
        }
      } else {
        if (!email || !password) {
          showNotification('Please enter email and password');
          setLoading(false);
          return;
        }
        if (!isSignUpLoaded || !signUp) return;

        try {
          const res = await signUp.create({ emailAddress: email, password, firstName, lastName });
          if (res.status === 'complete' && res.createdSessionId) {
            await signUpSetActive({ session: res.createdSessionId });
            return;
          } else {
            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
            navigation.navigate('VerifyCode', { contactLabel: email, mode: 'signup' });
          }
        } catch (err: any) {
          if (err.errors && err.errors[0]?.message) {
            showNotification(err.errors[0].message);
          } else {
            showNotification('Signup failed. Please check your details.');
          }
        }
      }
    } catch (error: any) {
      if (error.errors && error.errors[0]?.message) {
        showNotification(error.errors[0].message);
      } else if (error.message?.includes('already signed in')) {
        // Handle "already signed in" silently or with specific logic
        console.log('Already signed in');
      } else {
        showNotification(error.message || 'An error occurred');
      }
    } finally {
      setLoading(false);
    }
  }, [authContext, isLogin, email, password, firstName, lastName, isSignInLoaded, isSignUpLoaded, signIn, signUp, signInSetActive, signUpSetActive, navigation, showNotification]);

  const handleForgotPassword = useCallback(async () => {
    if (!email) {
      showNotification('Please enter your email');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      showNotification('Check your email for the password reset link.', 'success');
    } catch (error: any) {
      showNotification(error.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [email, showNotification]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* In-App Notification */}
      {notification && (
        <RNAnimated.View
          style={[
            styles.notification,
            { transform: [{ translateY: notificationAnim }] },
            notification.type === 'success' ? styles.notificationSuccess : styles.notificationError
          ]}
        >
          <Icon
            name={notification.type === 'success' ? "check-circle" : "alert-circle"}
            size={20}
            color="#fff"
          />
          <Text style={styles.notificationText}>{notification.message}</Text>
        </RNAnimated.View>
      )}

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
            showPassword={showPassword}
            setShowPassword={setShowPassword}
          />
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
            showPassword={showPassword}
            setShowPassword={setShowPassword}
          />
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
    borderRadius: 8,
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
  passwordContainer: {
    width: '100%',
    height: 50,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  passwordInput: {
    flex: 1,
    height: '100%',
    fontSize: 16,
  },
  eyeIcon: {
    padding: 4,
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
  notification: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    borderRadius: 8,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    gap: 10,
  },
  notificationError: {
    backgroundColor: '#EF4444',
  },
  notificationSuccess: {
    backgroundColor: '#10B981',
  },
  notificationText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});

export default AuthScreen;