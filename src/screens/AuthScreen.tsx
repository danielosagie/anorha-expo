import React, { useState, useContext, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Image, Animated as RNAnimated, Dimensions, Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import AnimatedGradientBackground from '../components/AnimatedGradientBackground';
import Button from '../components/Button';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { supabase } from '../../lib/supabase';
import { LinearGradient } from 'expo-linear-gradient';
import { useSignIn, useSignUp } from '@clerk/clerk-expo';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ErrorModal from '../components/ErrorModal';

// Flag to use static gradient for better performance
const USE_STATIC_GRADIENT = true;
// Flag to disable form animations for better performance
const DISABLE_FORM_ANIMATIONS = true;

// Password requirement checker
const getPasswordRequirements = (pass: string) => {
  return [
    { label: "8+ characters", met: pass.length >= 8 },
    { label: "Uppercase & Lowercase", met: /[A-Z]/.test(pass) && /[a-z]/.test(pass) },
    { label: "Number", met: /\d/.test(pass) },
    { label: "Special character", met: /[^A-Za-z0-9]/.test(pass) },
  ];
};

// Field error type
interface FieldErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
}

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
  fieldErrors: FieldErrors;
  validateField: (field: keyof FieldErrors) => void;
  clearFieldError: (field: keyof FieldErrors) => void;
  isBiometricSupported: boolean;
  handleBiometricLogin: () => void;
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
  setShowPassword,
  fieldErrors,
  validateField,
  clearFieldError,
  isBiometricSupported,
  handleBiometricLogin,
}: FormContentProps) => (
  <>
    <Text style={styles.headerText}>
      {isLogin ? 'Log Back In' : 'Create Account'}
    </Text>

    {!isLogin && (
      <View style={styles.inputWrapper}>
        <TextInput
          style={[styles.input, fieldErrors.firstName && styles.inputError]}
          placeholder="First Name"
          placeholderTextColor="#aaa"
          value={firstName}
          onChangeText={(text) => {
            setFirstName(text);
            clearFieldError('firstName');
          }}
          onBlur={() => validateField('firstName')}
          // Autofill support
          textContentType="givenName"
          autoComplete="given-name"
          autoCapitalize="words"
        />
        {fieldErrors.firstName && (
          <Text style={styles.fieldError}>{fieldErrors.firstName}</Text>
        )}
      </View>
    )}

    {!isLogin && (
      <View style={styles.inputWrapper}>
        <TextInput
          style={[styles.input, fieldErrors.lastName && styles.inputError]}
          placeholder="Last Name"
          placeholderTextColor="#aaa"
          value={lastName}
          onChangeText={(text) => {
            setLastName(text);
            clearFieldError('lastName');
          }}
          onBlur={() => validateField('lastName')}
          // Autofill support
          textContentType="familyName"
          autoComplete="family-name"
          autoCapitalize="words"
        />
        {fieldErrors.lastName && (
          <Text style={styles.fieldError}>{fieldErrors.lastName}</Text>
        )}
      </View>
    )}

    <View style={styles.inputWrapper}>
      <TextInput
        style={[styles.input, fieldErrors.email && styles.inputError]}
        placeholder="Email"
        placeholderTextColor="#aaa"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          clearFieldError('email');
        }}
        onBlur={() => validateField('email')}
        // Autofill support
        textContentType="emailAddress"
        autoComplete="email"
      />
      {fieldErrors.email && (
        <Text style={styles.fieldError}>{fieldErrors.email}</Text>
      )}
    </View>

    <View style={styles.inputWrapper}>
      <View style={[styles.passwordContainer, fieldErrors.password && styles.inputError]}>
        <TextInput
          style={styles.passwordInput}
          placeholder="Password"
          placeholderTextColor="#aaa"
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={(text) => {
            setPassword(text);
            clearFieldError('password');
          }}
          onBlur={() => validateField('password')}
          // Autofill support - different for login vs signup
          textContentType={isLogin ? "password" : "newPassword"}
          autoComplete={isLogin ? "password" : "password-new"}
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
      {fieldErrors.password && (
        <Text style={styles.fieldError}>{fieldErrors.password}</Text>
      )}
    </View>

    {!isLogin && password.length > 0 && (
      <View style={styles.passwordRequirements}>
        <Text style={styles.requirementHeader}>Password Strength:</Text>
        <View style={styles.requirementsGrid}>
          {getPasswordRequirements(password).map((req, i) => (
            <View key={i} style={styles.requirementItem}>
              <Icon
                name={req.met ? "check-circle-outline" : "circle-outline"}
                size={14}
                color={req.met ? "#5c9c00" : "#9CA3AF"}
              />
              <Text style={[styles.requirementText, req.met && styles.requirementTextMet]}>
                {req.label}
              </Text>
            </View>
          ))}
        </View>
      </View>
    )}

    <View style={[{ width: "100%", flexDirection: 'column', gap: -12, marginBottom: 16 }]}>
      <Button
        title={isLogin ? "Log In" : "Sign Up"}
        onPress={handleAuth}
        style={styles.button}
        loading={loading}
        icon={isLogin ? "login" : "account-plus"}
        textStyle={styles.buttonText}
      />

      {isLogin && isBiometricSupported && (
        <TouchableOpacity
          onPress={handleBiometricLogin}
          style={styles.biometricButton}
        >
          <Icon name="face-recognition" size={24} color="#6b6b6bff" />
          <Text style={styles.biometricText}>Log in with Face ID</Text>
        </TouchableOpacity>
      )}
    </View>


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
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);

  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const savedEmail = await SecureStore.getItemAsync('biometric_email');
      setIsBiometricSupported(compatible && enrolled && !!savedEmail);
    })();
  }, []);

  // The actual authentication logic
  const handleBiometricLogin = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Log in with Face ID',
        fallbackLabel: 'Use Password',
      });

      if (result.success) {
        setLoading(true);
        const e = await SecureStore.getItemAsync('biometric_email');
        const p = await SecureStore.getItemAsync('biometric_password');

        if (e && p && signIn) {
          try {
            const res = await signIn.create({ identifier: e, password: p });
            if (res.status === 'complete' && res.createdSessionId) {
              await signInSetActive!({ session: res.createdSessionId });
            }
          } catch (err: any) {
            showErrorModal('Login Failed', err.errors?.[0]?.message || 'Biometric login failed', 'error');
          }
        }
        setLoading(false);
      }
    } catch (err) {
      setLoading(false);
    }
  };

  // Field-level errors for inline validation
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Error modal state
  const [errorModal, setErrorModal] = useState<{
    visible: boolean;
    type: 'error' | 'warning' | 'info' | 'success';
    title: string;
    message: string;
  }>({
    visible: false,
    type: 'error',
    title: '',
    message: '',
  });

  // Notification state (for non-blocking feedback)
  const [notification, setNotification] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const notificationAnim = useRef(new RNAnimated.Value(-100)).current;

  const showNotification = useCallback((message: string, type: 'error' | 'success' = 'error') => {
    setNotification({ message, type });
    RNAnimated.sequence([
      RNAnimated.timing(notificationAnim, {
        toValue: 20,
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

  const showErrorModal = useCallback((title: string, message: string, type: 'error' | 'warning' | 'info' | 'success' = 'error') => {
    setErrorModal({ visible: true, type, title, message });
  }, []);

  const closeErrorModal = useCallback(() => {
    setErrorModal(prev => ({ ...prev, visible: false }));
  }, []);

  // Validation functions
  const validateEmail = (value: string): string | undefined => {
    if (!value) return 'Email is required';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return 'Please enter a valid email';
    return undefined;
  };

  const validatePassword = (value: string): string | undefined => {
    if (!value) return 'Password is required';
    if (!isLogin) {
      if (value.length < 8) return 'Password must be at least 8 characters';
      // Recommendations only - no longer blocking sign up
    }
    return undefined;
  };

  const validateName = (value: string, fieldName: string): string | undefined => {
    if (!isLogin && !value) return `${fieldName} is required`;
    return undefined;
  };

  const validateField = useCallback((field: keyof FieldErrors) => {
    let error: string | undefined;
    switch (field) {
      case 'email':
        error = validateEmail(email);
        break;
      case 'password':
        error = validatePassword(password);
        break;
      case 'firstName':
        error = validateName(firstName, 'First name');
        break;
      case 'lastName':
        error = validateName(lastName, 'Last name');
        break;
    }
    setFieldErrors(prev => ({ ...prev, [field]: error }));
  }, [email, password, firstName, lastName, isLogin]);

  const clearFieldError = useCallback((field: keyof FieldErrors) => {
    setFieldErrors(prev => ({ ...prev, [field]: undefined }));
  }, []);

  const validateAllFields = useCallback((): boolean => {
    const errors: FieldErrors = {};

    errors.email = validateEmail(email);
    errors.password = validatePassword(password);

    if (!isLogin) {
      errors.firstName = validateName(firstName, 'First name');
      errors.lastName = validateName(lastName, 'Last name');
    }

    setFieldErrors(errors);
    return !Object.values(errors).some(error => error !== undefined);
  }, [email, password, firstName, lastName, isLogin]);

  // const authContext = useContext(AuthContext); // Removed legacy AuthContext
  const { signIn, isLoaded: isSignInLoaded, setActive: signInSetActive } = useSignIn();
  const { signUp, isLoaded: isSignUpLoaded, setActive: signUpSetActive } = useSignUp();

  const handleAuth = useCallback(async () => {
    // Legacy AuthContext check removed
    // if (!authContext) {
    //   console.error("Auth context is not available");
    //   return;
    // }

    console.log('[AuthScreen] handleAuth called. isLogin:', isLogin);


    // Validate all fields first
    if (!validateAllFields()) {
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

          // Prompt for Biometrics if supported and not yet enabled
          const compatible = await LocalAuthentication.hasHardwareAsync();
          const enrolled = await LocalAuthentication.isEnrolledAsync();
          if (compatible && enrolled) {
            const savedEmail = await SecureStore.getItemAsync('biometric_email');
            if (savedEmail !== email) {
              Alert.alert(
                "Enable Face ID?",
                "Would you like to use Face ID for faster login next time?",
                [
                  { text: "No", style: "cancel" },
                  {
                    text: "Yes", onPress: async () => {
                      await SecureStore.setItemAsync('biometric_email', email);
                      await SecureStore.setItemAsync('biometric_password', password);
                      setIsBiometricSupported(true);
                    }
                  }
                ]
              );
            }
          }
          return;
        } else if ((res as any)?.status === 'needs_first_factor') {
          const r2 = await signIn.attemptFirstFactor({ strategy: 'password', password });
          if (r2.status === 'complete' && r2.createdSessionId) {
            console.log('[AuthScreen] First factor complete, calling setActive');
            await signInSetActive({ session: r2.createdSessionId });
            console.log('[AuthScreen] ✓ First factor login successful');
            return;
          } else {
            showErrorModal('Additional Verification Required', 'Please complete the additional verification step to sign in.', 'warning');
          }
        } else {
          showErrorModal('Sign In Failed', 'Unable to complete sign-in. Please try again.', 'error');
        }
      } else {
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
          const errorMessage = err.errors?.[0]?.message || 'Signup failed. Please check your details.';
          const errorLongMessage = err.errors?.[0]?.longMessage || errorMessage;
          showErrorModal('Sign Up Failed', errorLongMessage, 'error');
        }
      }
    } catch (error: any) {
      if (error.errors && error.errors[0]?.message) {
        const msg = error.errors[0].message;
        const longMsg = error.errors[0].longMessage || msg;

        // Map common error messages to field errors
        if (msg.toLowerCase().includes('email') || msg.toLowerCase().includes('identifier')) {
          setFieldErrors(prev => ({ ...prev, email: msg }));
        } else if (msg.toLowerCase().includes('password')) {
          setFieldErrors(prev => ({ ...prev, password: msg }));
        } else {
          showErrorModal(
            isLogin ? 'Sign In Failed' : 'Sign Up Failed',
            longMsg,
            'error'
          );
        }
      } else if (error.message?.includes('already signed in')) {
        console.log('Already signed in');
      } else {
        showErrorModal(
          'Something Went Wrong',
          error.message || 'An unexpected error occurred. Please try again.',
          'error'
        );
      }
    } finally {
      setLoading(false);
    }
  }, [isLogin, email, password, firstName, lastName, isSignInLoaded, isSignUpLoaded, signIn, signUp, signInSetActive, signUpSetActive, navigation, validateAllFields, showErrorModal]);

  const handleForgotPassword = useCallback(async () => {
    if (!email) {
      setFieldErrors(prev => ({ ...prev, email: 'Please enter your email first' }));
      return;
    }

    const emailError = validateEmail(email);
    if (emailError) {
      setFieldErrors(prev => ({ ...prev, email: emailError }));
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      showErrorModal(
        'Check Your Email',
        'We\'ve sent a password reset link to your email address.',
        'success'
      );
    } catch (error: any) {
      showErrorModal(
        'Reset Failed',
        error.message || 'Unable to send reset email. Please try again.',
        'error'
      );
    } finally {
      setLoading(false);
    }
  }, [email, showErrorModal]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Error Modal */}
      <ErrorModal
        visible={errorModal.visible}
        type={errorModal.type}
        title={errorModal.title}
        message={errorModal.message}
        onClose={closeErrorModal}
      />

      {/* In-App Notification (for non-blocking feedback) */}
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
            fieldErrors={fieldErrors}
            validateField={validateField}
            clearFieldError={clearFieldError}
            isBiometricSupported={isBiometricSupported}
            handleBiometricLogin={handleBiometricLogin}
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
            fieldErrors={fieldErrors}
            validateField={validateField}
            clearFieldError={clearFieldError}
            isBiometricSupported={isBiometricSupported}
            handleBiometricLogin={handleBiometricLogin}
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
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  headerText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    color: '#1a1a1a',
  },
  inputWrapper: {
    width: '100%',
    marginBottom: 4,
  },
  input: {
    width: '100%',
    height: 52,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    marginBottom: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputError: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  fieldError: {
    color: '#EF4444',
    fontSize: 12,
    marginTop: -8,
    marginBottom: 8,
    marginLeft: 4,
  },
  passwordContainer: {
    width: '100%',
    height: 52,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'transparent',
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
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 0,
    marginTop: 8,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  forgotPasswordText: {
    color: '#5c9c00',
    fontSize: 14,
    marginTop: 4,
    marginBottom: 16,
  },
  switchContainer: {
    flexDirection: 'row',
    marginBottom: 8,
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
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
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
  passwordRequirements: {
    width: '100%',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  requirementHeader: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
    fontWeight: '600',
  },
  requirementsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  requirementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
    marginBottom: 4,
  },
  requirementText: {
    fontSize: 11,
    color: '#9CA3AF',
    marginLeft: 4,
  },
  requirementTextMet: {
    color: '#5c9c00',
    fontWeight: '500',
  },
  biometricButton: {
    width: '100%',
    backgroundColor: '#D9D9D9', // Gray background
    borderRadius: 12,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    gap: 8,
  },
  biometricText: {
    color: '#545454ff', // Dark gray text
    fontSize: 16,
    fontWeight: '600',
  },
});



export default AuthScreen;