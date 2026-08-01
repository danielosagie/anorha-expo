import React from 'react';
import { StatusBar, StatusBarProps } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

/**
 * React Native's StatusBar is GLOBAL and last-write-wins: whichever mounted
 * <StatusBar> pushed its props most recently owns the real bar, and an entry is
 * only popped when that component unmounts.
 *
 * Tab roots never unmount once visited, so the camera screen's `light-content`
 * survived onto the white screens — an invisible clock/wifi/battery. Simply
 * adding `dark-content` to a light tab root does not fix it either: it just
 * hands the bug to whichever tab mounted earlier.
 *
 * This asserts a bar style ONLY while its screen is focused, so exactly one tab
 * root is ever in the stack and leaving a screen restores the newly focused
 * screen's own style.
 *
 * Use this in any screen a navigator keeps mounted while unfocused (i.e. every
 * tab root). A plain <StatusBar> is still correct inside pushed stack screens,
 * sheets and modals: those unmount on dismiss, which pops their entry for you.
 */
export default function FocusAwareStatusBar(props: StatusBarProps) {
  const isFocused = useIsFocused();
  return isFocused ? <StatusBar {...props} /> : null;
}
