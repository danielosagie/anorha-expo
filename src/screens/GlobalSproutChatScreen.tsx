import React, { useCallback, useEffect } from 'react';
import { BackHandler, StatusBar, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useUser } from '@clerk/expo';
import { PortalHost } from 'react-native-teleport';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import {
  QUICK_CHAT_FULL_HOST,
  quickChatProgress,
  quickChatTransition,
  useQuickChatTransition,
} from '../components/sprout/quickChatTransition';
import {
  StandaloneGlobalSproutChat,
} from '../components/sprout/QuickChatSheet';
import { TELEPORT_AVAILABLE } from '../components/sprout/teleportAvailability';

const TRANSITION_MS = 240;

export default function GlobalSproutChatScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useUser();
  const firstName =
    route.params?.firstName ||
    user?.firstName ||
    user?.fullName?.trim()?.split(/\s+/)[0] ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split('@')[0] ||
    'there';

  if (!TELEPORT_AVAILABLE) {
    return (
      <View style={[styles.root, styles.standaloneRoot]}>
        <StatusBar barStyle="dark-content" backgroundColor="#F7F8F4" />
        <StandaloneGlobalSproutChat
          firstName={firstName}
          campaignId={route.params?.campaignId}
          suggestedQuestions={route.params?.suggestedQuestions}
          placeholder={route.params?.placeholder}
          emptyHint={route.params?.emptyHint}
          onClose={() => navigation.goBack()}
        />
      </View>
    );
  }

  return <TeleportedGlobalSproutChatScreen />;
}

function TeleportedGlobalSproutChatScreen() {
  const navigation = useNavigation<any>();
  const transition = useQuickChatTransition();

  const finishCollapse = useCallback(() => {
    quickChatTransition.finishCollapse();
    requestAnimationFrame(() => navigation.goBack());
  }, [navigation]);

  const collapse = useCallback(() => {
    const current = quickChatTransition.getSnapshot();
    if (current.transitioning) return;
    quickChatTransition.beginCollapse();
    quickChatProgress.set(
      withTiming(0, { duration: TRANSITION_MS }, finished => {
        if (finished) runOnJS(finishCollapse)();
      }),
    );
  }, [finishCollapse]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      quickChatTransition.beginFull();
      quickChatProgress.set(
        withTiming(1, { duration: TRANSITION_MS }, finished => {
          if (finished) runOnJS(quickChatTransition.finishFull)();
        }),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    quickChatTransition.setCollapseHandler(collapse);
    return () => quickChatTransition.setCollapseHandler(null);
  }, [collapse]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      collapse();
      return true;
    });
    return () => subscription.remove();
  }, [collapse]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      quickChatProgress.get(),
      [0, 1],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <View style={styles.root} pointerEvents={transition.destination === 'full' ? 'auto' : 'none'}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <PortalHost name={QUICK_CHAT_FULL_HOST} style={StyleSheet.absoluteFill} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  standaloneRoot: {
    backgroundColor: '#F7F8F4',
  },
  backdrop: {
    backgroundColor: '#F7F8F4',
  },
});
