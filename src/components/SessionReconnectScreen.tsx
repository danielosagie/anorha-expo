import React from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
    backgroundColor: '#4CA827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  signOutButton: { marginTop: 18, paddingVertical: 10, paddingHorizontal: 16 },
  signOutText: { color: '#5B5B61', fontSize: 15, fontWeight: '500' },
});

export default SessionReconnectScreen;
