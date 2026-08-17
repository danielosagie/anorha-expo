import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useClerk } from '@clerk/expo';
import { useSignInWithApple } from '@clerk/expo/apple';

type Props = {
  /**
   * Apple's own colour scheme. App Review requires the real Apple button, so the surface
   * picks the closest Apple-approved scheme rather than restyling it.
   */
  buttonStyle: AppleAuthentication.AppleAuthenticationButtonStyle;
  /** Match the sibling social button so Apple reads as a peer, never as a lesser option. */
  cornerRadius: number;
  height: number;
  spinnerColor: string;
  containerStyle?: ViewStyle;
  onError: (message: string) => void;
};

/**
 * Sign in with Apple, wired to Clerk's native Apple strategy (`oauth_token_apple`).
 *
 * Renders nothing off iOS and nothing on an iOS device where Apple authentication is
 * unavailable, so the surrounding layout is unchanged on those platforms.
 */
const AppleSignInButton = ({
  buttonStyle,
  cornerRadius,
  height,
  spinnerColor,
  containerStyle,
  onError,
}: Props) => {
  const clerk = useClerk();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let cancelled = false;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => {
        if (!cancelled) setAvailable(ok);
      })
      .catch(() => {
        /* leave the button hidden rather than render one that cannot work */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePress = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      let result;
      try {
        result = await startAppleAuthenticationFlow();
      } catch (err: any) {
        // Same stale-session trap Google hits: a session left on this device by a previous
        // tester makes Clerk reject a fresh sign-in with `session_exists`. The user is
        // signing in as themselves, so clear the stale session and retry once.
        const code = err?.errors?.[0]?.code ?? err?.code;
        const msg = err?.errors?.[0]?.message ?? err?.message ?? '';
        if (code === 'session_exists' || /already (signed in|exists)|session already exists/i.test(msg)) {
          await clerk.signOut();
          result = await startAppleAuthenticationFlow();
        } else {
          throw err;
        }
      }
      const { createdSessionId, setActive } = result;
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
    } catch (err: any) {
      // Cancelling the Apple sheet resolves with no session instead of throwing, so anything
      // landing here is a real failure. That includes Clerk answering "apple is not enabled"
      // until the Apple provider is turned on in the Clerk dashboard.
      onError(err?.errors?.[0]?.message ?? err?.message ?? 'Could not sign in with Apple.');
    } finally {
      setBusy(false);
    }
  }, [busy, startAppleAuthenticationFlow, clerk, onError]);

  if (Platform.OS !== 'ios' || !available) return null;

  if (busy) {
    // Apple's button takes no children, so the busy state is a same-sized stand-in. Its
    // background follows the Apple scheme because Apple forbids recolouring the button.
    const isDark = buttonStyle === AppleAuthentication.AppleAuthenticationButtonStyle.BLACK;
    return (
      <View
        style={[
          styles.busy,
          containerStyle,
          { height, borderRadius: cornerRadius, backgroundColor: isDark ? '#000000' : '#FFFFFF' },
        ]}
      >
        <ActivityIndicator size="small" color={spinnerColor} />
      </View>
    );
  }

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={buttonStyle}
      cornerRadius={cornerRadius}
      style={[styles.button, containerStyle, { height }]}
      onPress={handlePress}
    />
  );
};

const styles = StyleSheet.create({
  button: { width: '100%' },
  busy: { width: '100%', alignItems: 'center', justifyContent: 'center' },
});

export default AppleSignInButton;
