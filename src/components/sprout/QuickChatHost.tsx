import React, { useCallback } from 'react';
import { Keyboard } from 'react-native';
import { useUser } from '@clerk/expo';
import { QuickChatSheet } from './QuickChatSheet';
import { closeQuickChat, useQuickChatStore } from './quickChatStore';

export function QuickChatHost() {
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
