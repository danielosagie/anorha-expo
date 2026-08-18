import React from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { UPDATE_ID_FRAGMENT } from '../lib/updateIdentity';
import { logSessionDiagnostic, SessionDiagnosticEvents } from '../lib/mobileFlowLogger';

type SessionReconnectScreenProps = {
  /** Human-readable reason the live session couldn't be established. */
  message?: string;
  /** True while a retry is in flight (disables the button + shows a spinner). */
  reconnecting?: boolean;
  onRetry: () => void;
  onSignOut: () => void;
};

/**
 * Shown when the user IS signed in to Clerk but the live Supabase bridge could not
 * be established (no/stale token). Before this existed the app rendered its normal
 * screens against a dead bridge, so every page showed NO DATA silently. This makes
 * that state LOUD and recoverable: Try again re-runs session validation; Sign out is
 * the escape hatch. The app never renders data screens without a working bridge.
 */
const SessionReconnectScreen: React.FC<SessionReconnectScreenProps> = ({
  message,
  reconnecting,
  onRetry,
  onSignOut,
}) => {
  // This screen renders before AppNavigator (the only other splash-hide site), so it
  // must drop the native splash itself or it is invisible under the splash forever.
  React.useEffect(() => {
    logSessionDiagnostic(SessionDiagnosticEvents.RECONNECT_SHOWN);
    SplashScreen.hideAsync().catch(() => { });
  }, []);
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Can't reach your account</Text>
        <Text style={styles.message}>
          {message ||
            "You're signed in, but we couldn't connect to your account services, so your data can't load. Check your connection and try again."}
        </Text>

        <TouchableOpacity
          style={[styles.primaryButton, reconnecting && styles.primaryButtonDisabled]}
          onPress={onRetry}
          disabled={reconnecting}
          activeOpacity={0.8}
        >
          {reconnecting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Try again</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.signOutButton} onPress={onSignOut} activeOpacity={0.7}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.updateId}>{UPDATE_ID_FRAGMENT}</Text>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  title: { fontSize: 22, fontWeight: '700', color: '#111113', textAlign: 'center', marginBottom: 12 },
  message: { fontSize: 15, lineHeight: 22, color: '#5B5B61', textAlign: 'center', marginBottom: 28 },
  primaryButton: {
    width: '100%',
    maxWidth: 320,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#93C822',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  signOutButton: { marginTop: 18, paddingVertical: 10, paddingHorizontal: 16 },
  signOutText: { color: '#5B5B61', fontSize: 15, fontWeight: '500' },
  updateId: { position: 'absolute', bottom: 8, alignSelf: 'center', color: '#A0A0A6', fontSize: 10 },
});

export default SessionReconnectScreen;
