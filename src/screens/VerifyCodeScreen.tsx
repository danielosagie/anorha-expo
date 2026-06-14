import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Animated } from 'react-native';
import { useSignUp, useSignIn, useAuth } from '@clerk/clerk-expo';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';

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
  const contactLabel = route?.params?.contactLabel ?? '';
  const mode = route?.params?.mode ?? 'signup';
  const isResetMode = mode === 'reset';
  const { signUp, isLoaded: isSignUpLoaded } = useSignUp();
  const { signIn, isLoaded: isSignInLoaded } = useSignIn();
  const auth = useAuth() as any;
  const theme = useTheme();

  const [digits, setDigits] = useState<string[]>(Array(CELL_COUNT).fill(''));
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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
    // Clear any previous error when user starts typing
    if (errorMessage) setErrorMessage(null);

    // Check if this is a paste of multiple digits (e.g., full 6-digit code)
    const cleanValue = value.replace(/\D/g, '');

    if (cleanValue.length > 1) {
      // User pasted multiple digits - fill all cells
      const newDigits = [...digits];
      for (let i = 0; i < CELL_COUNT; i++) {
        newDigits[i] = cleanValue[i] || '';
      }
      setDigits(newDigits);

      // Focus the last filled cell or the next empty one
      const lastFilledIndex = Math.min(cleanValue.length - 1, CELL_COUNT - 1);
      if (cleanValue.length >= CELL_COUNT) {
        inputs.current[CELL_COUNT - 1]?.blur();
      } else {
        inputs.current[lastFilledIndex + 1]?.focus();
      }
    } else {
      // Single digit entry
      const v = cleanValue.slice(0, 1);
      const newDigits = [...digits];
      newDigits[index] = v;
      setDigits(newDigits);

      // Move forward if digit entered
      if (v && index < CELL_COUNT - 1) {
        inputs.current[index + 1]?.focus();
      }
    }
  };

  const onKeyPress = (index: number, key: string) => {
    if (key === 'Backspace') {
      if (!digits[index] && index > 0) {
        // Current cell is empty, move to previous and clear it
        const newDigits = [...digits];
        newDigits[index - 1] = '';
        setDigits(newDigits);
        inputs.current[index - 1]?.focus();
      } else if (digits[index]) {
        // Current cell has value, clear it
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
          try { await auth.setActive?.({ session: res.createdSessionId }); } catch { }
          // App will react to isSignedIn and show main app; no navigation needed
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
          try { await auth.setActive?.({ session: res.createdSessionId }); } catch { }
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
  }, [code, newPassword, isResetMode, isSignInLoaded, signIn, isSignUpLoaded, signUp, auth, navigation, submitting, triggerErrorShake]);

  // Auto-submit when all 6 digits are filled (signup only; reset mode requires password)
  useEffect(() => {
    if (isResetMode) return;
    if (code.length === CELL_COUNT && !hasAutoSubmitted.current && !submitting) {
      hasAutoSubmitted.current = true;
      setTimeout(() => { submit(); }, 150);
    }
  }, [code, submit, submitting, isResetMode]);

  // Reset auto-submit flag when code changes
  useEffect(() => {
    if (code.length < CELL_COUNT) {
      hasAutoSubmitted.current = false;
    }
  }, [code]);

  // Handle resend countdown
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
        await signIn.create({
          strategy: 'reset_password_email_code',
          identifier: contactLabel,
        });
        setSuccessMessage('Password reset code resent!');
      } else {
        if (!isSignUpLoaded || !signUp) return;
        await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
        setSuccessMessage('Verification code resent successfully!');
      }
      setResendTimer(60);
    } catch (e: any) {
      const message = e?.errors?.[0]?.longMessage ?? e?.errors?.[0]?.message ?? 'Failed to resend code. Please try again later.';
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <View style={styles.iconContainer}>
          <Icon name={isResetMode ? 'lock-reset' : 'email-check-outline'} size={48} color="#294306" />
        </View>
        <Text style={styles.title}>{isResetMode ? 'Reset your password' : 'Verify your email'}</Text>
        <Text style={styles.subtitle}>
          {isResetMode
            ? `Enter the 6-digit code sent to ${contactLabel || 'your email'} and choose a new password.`
            : `Enter the 6-digit code sent to${contactLabel ? `\n${contactLabel}` : ' your email'}`
          }
        </Text>

        <Animated.View style={[styles.row, { transform: [{ translateX: errorShakeAnim }] }]}>
          {digits.map((d, i) => (
            <TextInput
              key={i}
              ref={(el) => { inputs.current[i] = el; }}
              style={[
                styles.cell,
                d && styles.cellFilled,
                errorMessage && styles.cellError,
              ]}
              value={d}
              onChangeText={(v) => handleChangeText(i, v)}
              onKeyPress={({ nativeEvent }) => onKeyPress(i, nativeEvent.key)}
              keyboardType="number-pad"
              maxLength={6} // Allow paste of full code
              autoFocus={i === 0}
              selectTextOnFocus
              textContentType="oneTimeCode" // iOS autofill support
              autoComplete="sms-otp" // Android autofill support
            />
          ))}
        </Animated.View>

        {isResetMode && (
          <TextInput
            style={[styles.cell, styles.passwordInput]}
            placeholder="New password (8+ characters)"
            placeholderTextColor="#9CA3AF"
            value={newPassword}
            onChangeText={(text) => {
              setNewPassword(text);
              if (errorMessage) setErrorMessage(null);
            }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
          />
        )}

        {/* Status Messages */}
        {errorMessage && (
          <View style={styles.errorContainer}>
            <Icon name="alert-circle-outline" size={18} color="#DC2626" />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        {successMessage && (
          <View style={[styles.errorContainer, { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }]}>
            <Icon name="check-circle-outline" size={18} color="#059669" />
            <Text style={[styles.errorText, { color: '#059669' }]}>{successMessage}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.button,
            (submitting || code.length !== CELL_COUNT || (isResetMode && newPassword.length < 8)) && styles.buttonDisabled,
          ]}
          onPress={submit}
          disabled={code.length !== CELL_COUNT || submitting || (isResetMode && newPassword.length < 8)}
          activeOpacity={0.8}
        >
          {submitting ? (
            <View style={styles.buttonContent}>
              <Icon name="loading" size={20} color="white" />
              <Text style={styles.buttonText}>{isResetMode ? 'Resetting...' : 'Verifying...'}</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>{isResetMode ? 'Reset password' : 'Continue'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.resendContainer}
          onPress={handleResend}
          disabled={resendTimer > 0 || submitting}
        >
          <Text style={styles.resendText}>Didn't receive the code? </Text>
          <Text style={[styles.resendLink, (resendTimer > 0 || submitting) && { opacity: 0.5 }]}>
            {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[styles.backButton, { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginTop: 20, alignSelf: 'center' }]}
        >
          <Icon name="arrow-left" size={20} color={theme.colors.text} />
          <Text style={{ marginLeft: 6, fontSize: 16, fontWeight: '500', color: theme.colors.text }}>Back</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f7f9fb',
  },
  card: {
    width: '90%',
    maxWidth: 400,
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 28,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 8,
    color: '#111',
    textAlign: 'center',
    fontFamily: 'Inter_700Bold',
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
    fontFamily: 'Inter_400Regular',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 8,
  },
  cell: {
    flex: 1,
    height: 56,
    backgroundColor: '#f5f7f3',
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '600',
    color: '#1b2e0a',
    borderWidth: 2,
    borderColor: '#e8ebe5',
  },
  cellFilled: {
    borderColor: BRAND_PRIMARY,
    backgroundColor: '#f8fbf2',
  },
  cellError: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  passwordInput: {
    width: '100%',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
    fontFamily: 'Inter_500Medium',
  },
  button: {
    backgroundColor: '#294306',
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#9CA3AF',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  resendContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  resendText: {
    color: '#666',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  resendLink: {
    color: '#294306',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
  },
  backButton: {
    // Basic hit slop area
  },
});

export default VerifyCodeScreen;


