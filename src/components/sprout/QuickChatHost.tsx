import React, { useCallback, useEffect } from 'react';
import { Keyboard, Linking } from 'react-native';
import { useUser } from '@clerk/expo';
import { QuickChatSheet } from './QuickChatSheet';
import { closeQuickChat, openQuickChat, useQuickChatStore } from './quickChatStore';

// Dev-only hook so headless tooling (simulator automation, agents) can open the
// quick chat without touch input: xcrun simctl openurl booted "<scheme>://dev/quick-chat"
function useDevQuickChatDeepLink() {
  useEffect(() => {
    if (!__DEV__) return;
    const handle = (url: string | null) => {
      if (url && url.includes('dev/quick-chat')) openQuickChat();
    };
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    Linking.getInitialURL().then(handle).catch(() => {});
    return () => sub.remove();
  }, []);
}

export function QuickChatHost() {
  useDevQuickChatDeepLink();
  const { user } = useUser();
  const { visible, focusRequestKey, options } = useQuickChatStore();
  const firstName =
    user?.firstName ||
    user?.fullName?.trim()?.split(/\s+/)[0] ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split('@')[0] ||
    'there';

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    options?.onDismiss?.();
    closeQuickChat();
  }, [options]);

  if (!visible) return null;

  return (
    <QuickChatSheet
      {...options}
      firstName={firstName}
      focusRequestKey={focusRequestKey}
      onClose={handleClose}
    />
  );
}

export default QuickChatHost;
