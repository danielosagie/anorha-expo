import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useClerk } from '@clerk/expo';
import { useSignInWithApple } from '@clerk/expo/apple';

/**
 * The Apple logo, unmodified, as a vector so it never distorts at any button height.
 * Path is the Apple mark at its published proportions; only the fill colour changes,
 * which Apple permits (black on light buttons, white on dark).
 */
const AppleMark = ({ size, color }: { size: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      fill={color}
      d="M17.05 12.54c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.81 3.15-.46 7.81 1.3 10.37.86 1.25 1.89 2.66 3.24 2.61 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.38.81 1.4-.02 2.28-1.28 3.13-2.54.99-1.45 1.4-2.86 1.42-2.93-.03-.01-2.72-1.05-2.75-4.15M14.5 4.91c.71-.87 1.19-2.08 1.06-3.28-1.03.04-2.27.69-3.01 1.55-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.58 3.03-1.45"
    />
  </Svg>
);

type Props = {
  /**
   * The sibling social button's own style object. Apple is rendered as a literal peer of
   * Google here — same box, same radius, same spacing — rather than as Apple's prefab
   * button, which brings its own height and type and never matches (guideline 4.8 asks
   * that Apple read as an equal, not that the prefab button be used).
   */
  style: StyleProp<ViewStyle>;
  /** The sibling button's label style, so typography matches exactly. */
  textStyle: StyleProp<TextStyle>;
  /** Logo, label and spinner colour. Black on light buttons, white on dark. */
  tint: string;
  /** Apple-approved title. Keep it in Apple's sanctioned set. */
  label?: string;
  logoSize?: number;
  onError: (message: string) => void;
};

/**
 * Sign in with Apple, wired to Clerk's native Apple strategy (`oauth_token_apple`).
 *
 * Renders nothing off iOS and nothing on an iOS device where Apple authentication is
 * unavailable, so the surrounding layout is unchanged on those platforms.
 */
const AppleSignInButton = ({
  style,
  textStyle,
  tint,
  label = 'Continue with Apple',
  logoSize = 19,
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

  return (
    <TouchableOpacity
      style={style}
      activeOpacity={0.9}
      onPress={handlePress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <>
          {/* The mark's optical centre sits below its box centre, so lift it a hair. */}
          <View style={styles.mark}>
            <AppleMark size={logoSize} color={tint} />
          </View>
          <Text style={textStyle}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  mark: { marginTop: -2 },
});

export default AppleSignInButton;
