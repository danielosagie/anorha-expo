import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Animated, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClerk } from '@clerk/expo';
// Core 3 split: classic resource API (attemptFirstFactor / attemptEmailAddressVerification)
// lives under /legacy; the main hooks are the new Future/signals API.
import { useSignUp, useSignIn } from '@clerk/expo/legacy';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const INK = '#1C1B17';
const SUB = '#6B6A63';
const GREEN = '#93C822';
const GREEN_DEEP = '#4A7C00';
const DEEP_ICON = '#3C5A14';
const FIELD = '#F6F5F1';
const BORDER = '#EAE6DA';
const PLACEHOLDER = '#A8A69C';

type VerifyCodeRoute = {
  params?: {
    contactLabel?: string;
    mode?: 'signup' | 'signin' | 'reset';
  };
};

type Props = {
  navigation: any;
  route: VerifyCodeRoute;
};

const CELL_COUNT = 6;

const VerifyCodeScreen: React.FC<Props> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const contactLabel = route?.params?.contactLabel ?? '';
  const mode = route?.params?.mode ?? 'signup';
  const isResetMode = mode === 'reset';
  const { signUp, isLoaded: isSignUpLoaded } = useSignUp();
  const { signIn, isLoaded: isSignInLoaded } = useSignIn();
  // Core 3: useAuth no longer exposes setActive; the active session is set via
  // the Clerk instance (useClerk().setActive).
  const clerk = useClerk();

  const [digits, setDigits] = useState<string[]>(Array(CELL_COUNT).fill(''));
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const inputs = useRef<Array<TextInput | null>>([]);
  const code = useMemo(() => digits.join(''), [digits]);
  const errorShakeAnim = useRef(new Animated.Value(0)).current;
  const hasAutoSubmitted = useRef(false);

  // Shake animation for error
  const triggerErrorShake = useCallback(() => {
    Animated.sequence([
      Animated.timing(errorShakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(errorShakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(errorShakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(errorShakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [errorShakeAnim]);

  // Handle paste - detect when user pastes a full code
  const handleChangeText = (index: number, value: string) => {
    if (errorMessage) setErrorMessage(null);
    const cleanValue = value.replace(/\D/g, '');

    if (cleanValue.length > 1) {
      // User pasted multiple digits - fill all cells
      const newDigits = [...digits];
      for (let i = 0; i < CELL_COUNT; i++) {
        newDigits[i] = cleanValue[i] || '';
      }
      setDigits(newDigits);
      const lastFilledIndex = Math.min(cleanValue.length - 1, CELL_COUNT - 1);
      if (cleanValue.length >= CELL_COUNT) {
        inputs.current[CELL_COUNT - 1]?.blur();
      } else {
        inputs.current[lastFilledIndex + 1]?.focus();
      }
    } else {
      const v = cleanValue.slice(0, 1);
      const newDigits = [...digits];
      newDigits[index] = v;
      setDigits(newDigits);
      if (v && index < CELL_COUNT - 1) {
        inputs.current[index + 1]?.focus();
      }
    }
  };

  const onKeyPress = (index: number, key: string) => {
    if (key === 'Backspace') {
      if (!digits[index] && index > 0) {
        const newDigits = [...digits];
        newDigits[index - 1] = '';
        setDigits(newDigits);
        inputs.current[index - 1]?.focus();
      } else if (digits[index]) {
        const newDigits = [...digits];
        newDigits[index] = '';
        setDigits(newDigits);
      }
    }
  };

  const submit = useCallback(async () => {
    if (submitting) return;
    try {
      if (code.length !== CELL_COUNT) return;
      if (isResetMode) {
        if (!isSignInLoaded || !signIn) {
          setErrorMessage('Please wait, we are preparing.');
          return;
        }
        if (newPassword.length < 8) {
          setErrorMessage('Password must be at least 8 characters.');
          return;
        }
      } else {
        if (!isSignUpLoaded || !signUp) {
          setErrorMessage('Please wait, we are preparing verification.');
          return;
        }
      }
      setSubmitting(true);
      setErrorMessage(null);

      if (isResetMode) {
        const res = await signIn!.attemptFirstFactor({
          strategy: 'reset_password_email_code',
          code,
          password: newPassword,
        });
        if (res.status === 'complete' && res.createdSessionId) {
          try { await clerk.setActive({ session: res.createdSessionId }); } catch { }
        } else if (res.status === 'needs_second_factor') {
          setErrorMessage('Additional verification is required. Please contact support.');
          triggerErrorShake();
        } else {
          setErrorMessage('Unable to reset password. Please try again.');
          triggerErrorShake();
        }
      } else {
        const res = await signUp!.attemptEmailAddressVerification({ code });
        if (res.status === 'complete' && res.createdSessionId) {
          try { await clerk.setActive({ session: res.createdSessionId }); } catch { }
          navigation.reset({ index: 0, routes: [{ name: 'AppStack', params: { initialScreenName: 'CreateAccountScreen' } }] });
        } else {
          setErrorMessage('Unable to complete verification. Please try again.');
          triggerErrorShake();
        }
      }
    } catch (e: any) {
      const message = e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? e?.message ?? (isResetMode ? 'Invalid code or password. Please try again.' : 'Invalid code. Please check and try again.');
      setErrorMessage(message);
      triggerErrorShake();
      setDigits(Array(CELL_COUNT).fill(''));
      hasAutoSubmitted.current = false;
      setTimeout(() => inputs.current[0]?.focus(), 100);
    } finally {
      setSubmitting(false);
    }
  }, [code, newPassword, isResetMode, isSignInLoaded, signIn, isSignUpLoaded, signUp, clerk, navigation, submitting, triggerErrorShake]);

  // Auto-submit when all 6 digits are filled (signup only; reset mode requires password)
  useEffect(() => {
    if (isResetMode) return;
    if (code.length === CELL_COUNT && !hasAutoSubmitted.current && !submitting) {
      hasAutoSubmitted.current = true;
      setTimeout(() => { submit(); }, 150);
    }
  }, [code, submit, submitting, isResetMode]);

  useEffect(() => {
    if (code.length < CELL_COUNT) hasAutoSubmitted.current = false;
  }, [code]);

  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  const handleResend = async () => {
    if (resendTimer > 0) return;
    try {
      setSubmitting(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      if (isResetMode) {
        if (!isSignInLoaded || !signIn || !contactLabel) return;
        await signIn.create({ strategy: 'reset_password_email_code', identifier: contactLabel });
        setSuccessMessage('Password reset code resent.');
      } else {
        if (!isSignUpLoaded || !signUp) return;
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        setSuccessMessage('Verification code resent.');
      }
      setResendTimer(60);
    } catch (e: any) {
      const message = e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? 'Failed to resend code. Please try again later.';
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = code.length !== CELL_COUNT || submitting || (isResetMode && newPassword.length < 8);

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.body, { paddingTop: insets.top }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="chevron-left" size={26} color={INK} />
          </TouchableOpacity>

          <View style={styles.iconSquare}>
            <Icon name={isResetMode ? 'lock-reset' : 'email-outline'} size={28} color={DEEP_ICON} />
          </View>

          <Text style={styles.title}>{isResetMode ? 'Reset your password' : 'Check your email'}</Text>
          <Text style={styles.subtitle}>
            {isResetMode
              ? `Enter the code sent to ${contactLabel || 'your email'} and choose a new password.`
              : `Enter the code we just sent${contactLabel ? ` to ${contactLabel}` : ' you'}.`}
          </Text>

          <Animated.View style={[styles.otpRow, { transform: [{ translateX: errorShakeAnim }] }]}>
            {digits.map((d, i) => (
              <TextInput
                key={i}
                ref={(el) => { inputs.current[i] = el; }}
                style={[
                  styles.cell,
                  d ? styles.cellFilled : focusedIndex === i ? styles.cellActive : null,
                  errorMessage ? styles.cellError : null,
                ]}
                value={d}
                onChangeText={(v) => handleChangeText(i, v)}
                onKeyPress={({ nativeEvent }) => onKeyPress(i, nativeEvent.key)}
                onFocus={() => setFocusedIndex(i)}
                onBlur={() => setFocusedIndex(null)}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus={i === 0}
                selectTextOnFocus
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
              />
            ))}
          </Animated.View>

          {isResetMode && (
            <TextInput
              style={styles.passwordInput}
              placeholder="New password (8+ characters)"
              placeholderTextColor={PLACEHOLDER}
              value={newPassword}
              onChangeText={(text) => { setNewPassword(text); if (errorMessage) setErrorMessage(null); }}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
            />
          )}

          {errorMessage && (
            <View style={styles.errorContainer}>
              <Icon name="alert-circle-outline" size={17} color="#DC2626" />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}
          {successMessage && (
            <View style={[styles.errorContainer, styles.successContainer]}>
              <Icon name="check-circle-outline" size={17} color="#059669" />
              <Text style={[styles.errorText, { color: '#059669' }]}>{successMessage}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, disabled && styles.buttonDisabled]}
            onPress={submit}
            disabled={disabled}
            activeOpacity={0.9}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>{isResetMode ? 'Reset password' : 'Verify'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.resendRow} onPress={handleResend} disabled={resendTimer > 0 || submitting} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.resendText}>Didn't get it? </Text>
            <Text style={[styles.resendLink, (resendTimer > 0 || submitting) && { opacity: 0.5 }]}>
              {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend code'}
            </Text>
          </TouchableOpacity>

          <View style={styles.flex} />
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
  iconSquare: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: 'rgba(147,200,34,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  title: {
    marginTop: 18,
    fontSize: 28,
    lineHeight: 34,
    fontFamily: 'Inter_800ExtraBold',
    color: INK,
    letterSpacing: -0.56,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Inter_500Medium',
    color: SUB,
  },
  otpRow: { flexDirection: 'row', gap: 10, marginTop: 28 },
  cell: {
    flex: 1,
    height: 58,
    borderRadius: 13,
    backgroundColor: FIELD,
    borderWidth: 1.5,
    borderColor: BORDER,
    textAlign: 'center',
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: INK,
  },
  cellFilled: { backgroundColor: '#FFFFFF', borderColor: GREEN },
  cellActive: { backgroundColor: FIELD, borderColor: INK },
  cellError: { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  passwordInput: {
    marginTop: 16,
    height: 54,
    borderRadius: 14,
    backgroundColor: FIELD,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: INK,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  successContainer: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  errorText: { color: '#DC2626', fontSize: 13, flex: 1, fontFamily: 'Inter_500Medium' },
  button: {
    marginTop: 28,
    height: 54,
    borderRadius: 999,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
  resendRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 18 },
  resendText: { color: SUB, fontSize: 14, fontFamily: 'Inter_500Medium' },
  resendLink: { color: GREEN_DEEP, fontSize: 14, fontFamily: 'Inter_700Bold' },
});

export default VerifyCodeScreen;
