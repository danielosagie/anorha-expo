import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Animated as RNAnimated,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useSSO, useAuth, useClerk } from '@clerk/expo';
// Core 3 split: the main useSignIn/useSignUp are the new Future/signals API.
// The custom email/password + code flows here use the classic resource API
// (attemptFirstFactor, setActive, createdSessionId), which lives under /legacy.
import { useSignIn, useSignUp } from '@clerk/expo/legacy';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ErrorModal from '../components/ErrorModal';
import { BRAND_PRIMARY } from '../design/tokens';
import { createLogger } from '../utils/logger';
const log = createLogger('AuthScreen');

// ── v2 palette (warm white) ──────────────────────────────────────────────────
const INK = '#1C1B17';
const LABEL = '#6B6A63';
const FIELD_BG = '#F6F5F1';
const FIELD_BORDER = '#EAE6DA';
const GREEN_DEEP = '#4A7C00';
const MUTED = '#8A887E';
const OR_GRAY = '#A8A69C';
const SOCIAL_BORDER = '#E0DCCF';
const PLACEHOLDER = '#A8A69C';

// Password requirement checker (used by the strength hint on sign up)
const getPasswordRequirements = (pass: string) => [
  { label: '8+ characters', met: pass.length >= 8 },
  { label: 'Upper & lowercase', met: /[A-Z]/.test(pass) && /[a-z]/.test(pass) },
  { label: 'Number', met: /\d/.test(pass) },
  { label: 'Special character', met: /[^A-Za-z0-9]/.test(pass) },
];

interface FieldErrors {
  email?: string;
  password?: string;
}

// ── icons (faithful brand marks via react-native-svg) ────────────────────────
const ChevronLeft = () => (
  <Svg width={24} height={24} viewBox="0 0 24 24">
    <Path d="m15 18-6-6 6-6" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const GoogleMark = () => (
  <Svg width={19} height={19} viewBox="0 0 24 24">
    <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" fill="#4285F4" />
    <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" fill="#34A853" />
    <Path d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88z" fill="#FBBC05" />
    <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" fill="#EA4335" />
  </Svg>
);

type AuthScreenProps = {
  navigation: any;
  route?: { params?: { mode?: 'login' | 'signup' } };
};

const AuthScreen: React.FC<AuthScreenProps> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const initialMode = route?.params?.mode;
  const [isLogin, setIsLogin] = useState(initialMode !== 'signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const savedEmail = await SecureStore.getItemAsync('biometric_email');
      setIsBiometricSupported(compatible && enrolled && !!savedEmail);
    })();
  }, []);

  // Error modal state
  const [errorModal, setErrorModal] = useState<{
    visible: boolean;
    type: 'error' | 'warning' | 'info' | 'success';
    title: string;
    message: string;
  }>({ visible: false, type: 'error', title: '', message: '' });

  // Notification state (non-blocking feedback)
  const [notification, setNotification] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const notificationAnim = useRef(new RNAnimated.Value(-120)).current;

  const showNotification = useCallback((message: string, type: 'error' | 'success' = 'error') => {
    setNotification({ message, type });
    RNAnimated.sequence([
      RNAnimated.timing(notificationAnim, { toValue: insets.top + 8, duration: 300, useNativeDriver: true }),
      RNAnimated.delay(3000),
      RNAnimated.timing(notificationAnim, { toValue: -120, duration: 300, useNativeDriver: true }),
    ]).start(() => setNotification(null));
  }, [notificationAnim, insets.top]);

  const showErrorModal = useCallback((title: string, message: string, type: 'error' | 'warning' | 'info' | 'success' = 'error') => {
    setErrorModal({ visible: true, type, title, message });
  }, []);

  const closeErrorModal = useCallback(() => {
    setErrorModal(prev => ({ ...prev, visible: false }));
  }, []);

  // Validation
  const validateEmail = (value: string): string | undefined => {
    if (!value) return 'Email is required';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return 'Please enter a valid email';
    return undefined;
  };
  const validatePassword = (value: string): string | undefined => {
    if (!value) return 'Password is required';
    if (!isLogin && value.length < 8) return 'Password must be at least 8 characters';
    return undefined;
  };
  const validateField = useCallback((field: keyof FieldErrors) => {
    const error = field === 'email' ? validateEmail(email) : validatePassword(password);
    setFieldErrors(prev => ({ ...prev, [field]: error }));
  }, [email, password, isLogin]);
  const clearFieldError = useCallback((field: keyof FieldErrors) => {
    setFieldErrors(prev => ({ ...prev, [field]: undefined }));
  }, []);
  const validateAllFields = useCallback((): boolean => {
    const errors: FieldErrors = { email: validateEmail(email), password: validatePassword(password) };
    setFieldErrors(errors);
    return !Object.values(errors).some(e => e !== undefined);
  }, [email, password, isLogin]);

  const { signIn, isLoaded: isSignInLoaded, setActive: signInSetActive } = useSignIn();
  const { signUp, isLoaded: isSignUpLoaded, setActive: signUpSetActive } = useSignUp();
  const { startSSOFlow } = useSSO();
  const { isSignedIn } = useAuth();
  const clerk = useClerk();
  const [googleLoading, setGoogleLoading] = useState(false);

  // "You're already signed in" (Clerk `session_exists`) means THIS device already holds
  // an active session. Recovery is to activate the existing session so the root navigator
  // (which gates on isSignedIn) routes into the app.
  const activateExistingSession = useCallback(async () => {
    try {
      const existing = clerk?.session?.id ?? clerk?.client?.sessions?.[0]?.id ?? null;
      if (existing) {
        await clerk.setActive({ session: existing });
        return true;
      }
    } catch (e) {
      log.error('[AuthScreen] activateExistingSession failed:', e);
    }
    return false;
  }, [clerk]);

  const handleBiometricLogin = useCallback(async () => {
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
    } catch {
      setLoading(false);
    }
  }, [signIn, signInSetActive, showErrorModal]);

  const handleSSO = useCallback(async (
    strategy: 'oauth_google',
    setBusy: (v: boolean) => void,
    label: string,
  ) => {
    setBusy(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy,
        redirectUrl: 'anorhaapp://redirect',
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
    } catch (err: any) {
      showErrorModal(
        `${label} Sign-In Failed`,
        err?.errors?.[0]?.message ?? err?.message ?? `Could not sign in with ${label}.`,
        'error',
      );
    } finally {
      setBusy(false);
    }
  }, [startSSOFlow, showErrorModal]);

  const handleGoogleSignIn = useCallback(() => handleSSO('oauth_google', setGoogleLoading, 'Google'), [handleSSO]);

  const handleAuth = useCallback(async () => {
    log.debug('[AuthScreen] handleAuth called. isLogin:', isLogin);

    // If this device already holds an active Clerk session, surface it instead of a
    // fresh signIn.create() (which would be rejected with `session_exists`).
    if (isLogin && isSignedIn) {
      await activateExistingSession();
      return;
    }

    if (!validateAllFields()) return;
    setLoading(true);

    try {
      if (isLogin) {
        if (!isSignInLoaded || !signIn) {
          setLoading(false);
          return;
        }
        const res = await signIn.create({ identifier: email, password });
        if (res.status === 'complete' && res.createdSessionId) {
          await signInSetActive({ session: res.createdSessionId });
          // Offer to enable biometrics for faster login next time.
          const compatible = await LocalAuthentication.hasHardwareAsync();
          const enrolled = await LocalAuthentication.isEnrolledAsync();
          if (compatible && enrolled) {
            const savedEmail = await SecureStore.getItemAsync('biometric_email');
            if (savedEmail !== email) {
              Alert.alert('Enable Face ID?', 'Use Face ID for faster login next time?', [
                { text: 'No', style: 'cancel' },
                {
                  text: 'Yes',
                  onPress: async () => {
                    await SecureStore.setItemAsync('biometric_email', email);
                    await SecureStore.setItemAsync('biometric_password', password);
                    setIsBiometricSupported(true);
                  },
                },
              ]);
            }
          }
          return;
        } else if ((res as any)?.status === 'needs_first_factor') {
          const r2 = await signIn.attemptFirstFactor({ strategy: 'password', password });
          if (r2.status === 'complete' && r2.createdSessionId) {
            await signInSetActive({ session: r2.createdSessionId });
            return;
          }
          showErrorModal('Additional Verification Required', 'Please complete the additional verification step to sign in.', 'warning');
        } else {
          showErrorModal('Sign In Failed', 'Unable to complete sign-in. Please try again.', 'error');
        }
      } else {
        if (!isSignUpLoaded || !signUp) {
          setLoading(false);
          return;
        }
        try {
          const res = await signUp.create({ emailAddress: email, password });
          if (res.status === 'complete' && res.createdSessionId) {
            await signUpSetActive({ session: res.createdSessionId });
            return;
          }
          await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
          navigation.navigate('VerifyCode', { contactLabel: email, mode: 'signup' });
        } catch (err: any) {
          const errorLongMessage = err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Signup failed. Please check your details.';
          showErrorModal('Sign Up Failed', errorLongMessage, 'error');
        }
      }
    } catch (error: any) {
      const clerkCode = error?.errors?.[0]?.code ?? error?.code;
      const clerkMsg = error?.errors?.[0]?.message ?? error?.message ?? '';
      if (clerkCode === 'session_exists' || /already signed in/i.test(clerkMsg)) {
        await activateExistingSession();
      } else if (error.errors && error.errors[0]?.message) {
        const msg = error.errors[0].message;
        const longMsg = error.errors[0].longMessage || msg;
        if (msg.toLowerCase().includes('email') || msg.toLowerCase().includes('identifier')) {
          setFieldErrors(prev => ({ ...prev, email: msg }));
        } else if (msg.toLowerCase().includes('password')) {
          setFieldErrors(prev => ({ ...prev, password: msg }));
        } else {
          showErrorModal(isLogin ? 'Sign In Failed' : 'Sign Up Failed', longMsg, 'error');
        }
      } else {
        showErrorModal('Something Went Wrong', error.message || 'An unexpected error occurred. Please try again.', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [isLogin, email, password, isSignInLoaded, isSignUpLoaded, signIn, signUp, signInSetActive, signUpSetActive, navigation, validateAllFields, showErrorModal, isSignedIn, activateExistingSession]);

  const handleForgotPassword = useCallback(async () => {
    const emailError = validateEmail(email);
    if (emailError) {
      setFieldErrors(prev => ({ ...prev, email: emailError === 'Email is required' ? 'Enter your email first' : emailError }));
      return;
    }
    if (!isSignInLoaded || !signIn) {
      showErrorModal('Not Ready', 'Please wait a moment and try again.', 'error');
      return;
    }
    setLoading(true);
    try {
      await signIn.create({ strategy: 'reset_password_email_code', identifier: email });
      showErrorModal('Check Your Email', "We've sent a password reset code. Enter it on the next screen with your new password.", 'success');
      navigation.navigate('VerifyCode', { contactLabel: email, mode: 'reset' });
    } catch (error: any) {
      const msg = error?.errors?.[0]?.longMessage ?? error?.errors?.[0]?.message ?? error?.message ?? 'Unable to send reset code. Please try again.';
      showErrorModal('Reset Failed', msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [email, isSignInLoaded, signIn, navigation, showErrorModal]);

  const onBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  const reqs = getPasswordRequirements(password);
  const metCount = reqs.filter(r => r.met).length;

  return (
    <View style={styles.container}>
      <ErrorModal
        visible={errorModal.visible}
        type={errorModal.type}
        title={errorModal.title}
        message={errorModal.message}
        onClose={closeErrorModal}
      />

      {notification && (
        <RNAnimated.View
          style={[
            styles.notification,
            { transform: [{ translateY: notificationAnim }] },
            notification.type === 'success' ? styles.notificationSuccess : styles.notificationError,
          ]}
        >
          <Icon name={notification.type === 'success' ? 'check-circle' : 'alert-circle'} size={20} color="#fff" />
          <Text style={styles.notificationText}>{notification.message}</Text>
        </RNAnimated.View>
      )}

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.body, { paddingTop: insets.top }]}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <ChevronLeft />
          </TouchableOpacity>

          <Text style={styles.header}>{isLogin ? 'Welcome back' : 'Create account'}</Text>

          <View style={styles.fields}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <View style={[styles.field, fieldErrors.email && styles.fieldError]}>
                <TextInput
                  style={styles.fieldInput}
                  placeholder="you@email.com"
                  placeholderTextColor={PLACEHOLDER}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  value={email}
                  onChangeText={t => { setEmail(t); clearFieldError('email'); }}
                  onBlur={() => validateField('email')}
                  textContentType="emailAddress"
                  autoComplete="email"
                />
              </View>
              {fieldErrors.email && <Text style={styles.errorText}>{fieldErrors.email}</Text>}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={[styles.field, fieldErrors.password && styles.fieldError]}>
                <TextInput
                  style={[styles.fieldInput, styles.passwordInput]}
                  placeholder="••••••••"
                  placeholderTextColor={PLACEHOLDER}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={t => { setPassword(t); clearFieldError('password'); }}
                  onBlur={() => validateField('password')}
                  textContentType={isLogin ? 'password' : 'newPassword'}
                  autoComplete={isLogin ? 'password' : 'password-new'}
                />
                <TouchableOpacity onPress={() => setShowPassword(s => !s)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Icon name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={MUTED} />
                </TouchableOpacity>
              </View>
              {fieldErrors.password && <Text style={styles.errorText}>{fieldErrors.password}</Text>}

              {!isLogin && password.length > 0 && (
                <View style={styles.strengthWrap}>
                  <View style={styles.strengthBar}>
                    {reqs.map((_, i) => (
                      <View
                        key={i}
                        style={[styles.strengthSeg, i < metCount && styles.strengthSegOn]}
                      />
                    ))}
                  </View>
                  <Text style={styles.strengthLabel}>
                    {metCount <= 1 ? 'Weak' : metCount <= 2 ? 'Fair' : metCount <= 3 ? 'Good' : 'Strong'}
                  </Text>
                </View>
              )}

              {isLogin && (
                <TouchableOpacity style={styles.forgotWrap} onPress={handleForgotPassword}>
                  <Text style={styles.forgotText}>Forgot password?</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.primaryBtnBusy]}
            onPress={handleAuth}
            activeOpacity={0.9}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>{isLogin ? 'Log in' : 'Create account'}</Text>
            )}
          </TouchableOpacity>

          {!isLogin && (
            <Text style={styles.terms}>By continuing you agree to our Terms & Privacy</Text>
          )}

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {isLogin && isBiometricSupported && (
            <TouchableOpacity style={styles.socialBtn} onPress={handleBiometricLogin} activeOpacity={0.9}>
              <Icon name="face-recognition" size={20} color={INK} />
              <Text style={styles.socialText}>Sign in with Face ID</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.socialBtn} onPress={handleGoogleSignIn} activeOpacity={0.9} disabled={googleLoading}>
            {googleLoading ? <ActivityIndicator size="small" color={INK} /> : <><GoogleMark /><Text style={styles.socialText}>Continue with Google</Text></>}
          </TouchableOpacity>

          <View style={styles.flexSpacer} />

          <View style={[styles.switchRow, { paddingBottom: insets.bottom + 18 }]}>
            <Text style={styles.switchText}>{isLogin ? 'New here?' : 'Have an account?'}</Text>
            <TouchableOpacity onPress={() => { setIsLogin(v => !v); setFieldErrors({}); }} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
              <Text style={styles.switchLink}>{isLogin ? 'Sign up' : 'Log in'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 24 },
  backBtn: { width: 40, height: 44, justifyContent: 'center', marginLeft: -8 },
  header: {
    marginTop: 18,
    fontSize: 30,
    lineHeight: 36,
    fontFamily: 'Inter_800ExtraBold',
    color: INK,
    letterSpacing: -0.6,
  },
  fields: { marginTop: 24, gap: 16 },
  fieldGroup: { gap: 8 },
  label: { fontSize: 13, lineHeight: 16, fontFamily: 'Inter_600SemiBold', color: LABEL },
  field: {
    height: 54,
    borderRadius: 14,
    backgroundColor: FIELD_BG,
    borderWidth: 1,
    borderColor: FIELD_BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  fieldError: { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
  fieldInput: { flex: 1, fontSize: 16, fontFamily: 'Inter_500Medium', color: INK, padding: 0 },
  passwordInput: { letterSpacing: 1 },
  errorText: { color: '#EF4444', fontSize: 12, fontFamily: 'Inter_500Medium', marginLeft: 2 },
  strengthWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  strengthBar: { flexDirection: 'row', gap: 4, flex: 1 },
  strengthSeg: { flex: 1, height: 4, borderRadius: 999, backgroundColor: '#ECE9DF' },
  strengthSegOn: { backgroundColor: BRAND_PRIMARY },
  strengthLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, width: 48, textAlign: 'right' },
  forgotWrap: { alignSelf: 'flex-start', marginVertical: 2 },
  forgotText: { fontSize: 14, lineHeight: 18, fontFamily: 'Inter_600SemiBold', color: GREEN_DEEP },
  primaryBtn: {
    marginTop: 20,
    height: 54,
    borderRadius: 999,
    backgroundColor: BRAND_PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnBusy: { opacity: 0.85 },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  terms: { marginTop: 14, textAlign: 'center', fontSize: 12, lineHeight: 17, fontFamily: 'Inter_500Medium', color: MUTED, paddingHorizontal: 6 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 22 },
  dividerLine: { flex: 1, height: 1, backgroundColor: FIELD_BORDER },
  dividerText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: OR_GRAY },
  socialBtn: {
    marginTop: 12,
    height: 52,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: SOCIAL_BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  socialText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: INK },
  flexSpacer: { flex: 1, minHeight: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingTop: 8 },
  switchText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: LABEL },
  switchLink: { fontSize: 14, fontFamily: 'Inter_700Bold', color: GREEN_DEEP },
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
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  notificationError: { backgroundColor: '#EF4444' },
  notificationSuccess: { backgroundColor: '#10B981' },
  notificationText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold', flex: 1 },
});

export default AuthScreen;
