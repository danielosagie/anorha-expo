import React, { useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { OnboardingCheckContext } from '../context/OnboardingCheckContext';
import { AuthContext } from '../context/AuthContext';

export default function AccountSyncIssueScreen() {
  const onboardingCtx = useContext(OnboardingCheckContext);
  const authCtx = useContext(AuthContext);
  const onRetry = onboardingCtx?.retryOnboardingCheck ?? (() => {});
  const debugInfo = onboardingCtx?.debugInfo ?? '';
  const onSignOut = () => authCtx?.signOut();
  const theme = useTheme();
  const isDark = false; // theme is static (no dark-mode variant)

  const handleCopyDebug = async () => {
    try {
      await Clipboard.setStringAsync(debugInfo);
    } catch (e) {
      console.warn('[AccountSyncIssue] Copy failed:', e);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#0B1F1C' : '#F7F7F2' }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: isDark ? '#13201C' : '#FFFFFF', borderColor: isDark ? 'rgba(15, 118, 110, 0.3)' : 'rgba(15, 118, 110, 0.14)' }]}>
          <View style={[styles.iconWrapper, { backgroundColor: isDark ? '#f4f4f4' : '#f4f4f4' }]}>
            <Icon name="account-sync" size={32} color="#666" />
          </View>
          <Text style={[styles.title, { color: isDark ? '#F7F7F2' : '#13201C' }]}>
            Account sync issue
          </Text>
          <Text style={[styles.message, { color: isDark ? '#9CA3AF' : '#51615C' }]}>
            We couldn't confirm your account status. This can happen when your session is out of sync. Try again or sign out.
          </Text>

          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: '#666' }]} onPress={onRetry}>
            <Icon name="refresh" size={20} color="#FFFFFF" style={styles.buttonIcon} />
            <Text style={styles.primaryButtonText}>Retry</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.secondaryButton, { borderColor: isDark ? '#374151' : '#D1D5DB' }]} onPress={handleCopyDebug}>
            <Icon name="content-copy" size={18} color={isDark ? '#9CA3AF' : '#6B7280'} style={styles.buttonIcon} />
            <Text style={[styles.secondaryButtonText, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Copy debug info</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.secondaryButton, { borderColor: isDark ? '#374151' : '#D1D5DB' }]} onPress={onSignOut}>
            <Icon name="logout" size={18} color={isDark ? '#9CA3AF' : '#6B7280'} style={styles.buttonIcon} />
            <Text style={[styles.secondaryButtonText, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    paddingHorizontal: 24,
    paddingVertical: 28,
    borderRadius: 28,
    borderWidth: 1,
    shadowColor: '#0B1F1C',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  iconWrapper: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    marginBottom: 10,
  },
  message: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 12,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  buttonIcon: {
    marginRight: 8,
  },
  primaryButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  secondaryButtonText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
  },
});
