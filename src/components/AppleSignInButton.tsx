import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Text,
  TouchableOpacity,
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
      d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.955 4.45z"
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
          <AppleMark size={logoSize} color={tint} />
          <Text style={textStyle}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

export default AppleSignInButton;
