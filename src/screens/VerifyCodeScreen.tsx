import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useSignUp, useAuth } from '@clerk/clerk-expo';

type VerifyCodeRoute = {
  params?: {
    contactLabel?: string;
    mode?: 'signup' | 'signin';
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
  const { signUp, isLoaded: isSignUpLoaded } = useSignUp();
  const auth = useAuth() as any; // setActive may not be typed in some versions

  const [digits, setDigits] = useState<string[]>(Array(CELL_COUNT).fill(''));
  const [submitting, setSubmitting] = useState(false);
  const inputs = useRef<Array<TextInput | null>>([]);
  const code = useMemo(() => digits.join(''), [digits]);

  const onChangeDigit = (index: number, value: string) => {
    const v = value.replace(/\D/g, '').slice(0, 1);
    const next = [...digits];
    next[index] = v;
    setDigits(next);
    if (v && index < CELL_COUNT - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const submit = async () => {
    try {
      if (code.length !== CELL_COUNT) return;
      if (!isSignUpLoaded || !signUp) {
        Alert.alert('Please wait', 'We are preparing verification.');
        return;
      }
      setSubmitting(true);
      const res = await signUp.attemptEmailAddressVerification({ code });
      if (res.status === 'complete' && res.createdSessionId) {
        // Activate the new session so getToken() starts working
        try { await auth.setActive?.({ session: res.createdSessionId }); } catch {}
        navigation.reset({ index: 0, routes: [{ name: 'AppStack', params: { initialScreenName: 'TabNavigator' } }] });
      } else {
        Alert.alert('Verification', 'Unable to complete verification.');
      }
    } catch (e: any) {
      Alert.alert('Verification failed', e?.errors?.[0]?.message || e?.message || 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.title}>Enter code</Text>
        <Text style={styles.subtitle}>Enter the 6 digit code that was sent to you{contactLabel ? ` at ${contactLabel}` : ''}</Text>
        <View style={styles.row}>
          {digits.map((d, i) => (
            <TextInput
              key={i}
              ref={(el) => { inputs.current[i] = el; }}
              style={styles.cell}
              value={d}
              onChangeText={(v) => onChangeDigit(i, v)}
              keyboardType="number-pad"
              maxLength={1}
              autoFocus={i === 0}
            />
          ))}
        </View>
        <TouchableOpacity style={[styles.button, submitting && { opacity: 0.6 }]} onPress={submit} disabled={code.length !== CELL_COUNT || submitting}>
          <Text style={styles.buttonText}>{submitting ? 'Verifying…' : 'Continue'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f7f9fb' },
  card: { width: '90%', maxWidth: 560, backgroundColor: 'white', borderRadius: 12, padding: 24, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8, color: '#111' },
  subtitle: { fontSize: 14, color: '#555', marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  cell: { width: 48, height: 56, backgroundColor: '#f3f7ea', borderRadius: 8, textAlign: 'center', fontSize: 22, color: '#1b2e0a' },
  button: { backgroundColor: '#294306', height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});

export default VerifyCodeScreen;


