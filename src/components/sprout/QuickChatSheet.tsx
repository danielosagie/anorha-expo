/* eslint-disable max-lines */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  BlurMask,
  Canvas,
  LinearGradient,
  Rect,
  vec,
} from '@shopify/react-native-skia';
import { Portal, PortalHost } from 'react-native-teleport';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { ChevronDown, Maximize2, X } from 'lucide-react-native';
import { ConversationList } from '../../features/liquidationConversation/components/ConversationList';
import { ConvexLiveMessages } from '../../features/liquidationConversation/ConvexLiveMessages';
import PlanCard from '../../features/liquidationConversation/components/PlanCard';
import QuestionCard from '../../features/liquidationConversation/components/QuestionCard';
import { HybridConversationDataAdapter } from '../../features/liquidationConversation/HybridConversationDataAdapter';
import { useLiquidationConversationController } from '../../features/liquidationConversation/useLiquidationConversationController';
import type {
  ConversationContextAttachment,
  DecisionPrompt,
  InventoryBulkAction,
  InventorySelectionProposal,
  PlanPayload,
} from '../../features/liquidationConversation/types';
import { MessageComposer } from '../chat/MessageComposer';
import { AnorhaFace } from '../brand/AnorhaFace';
import { ensureSupabaseJwt } from '../../../lib/supabase';
import {
  QUICK_CHAT_FULL_HOST,
  QUICK_CHAT_SHEET_HOST,
  quickChatProgress,
  quickChatTransition,
  useQuickChatTransition,
} from './quickChatTransition';
import { TELEPORT_AVAILABLE } from './teleportAvailability';
import {
  ChatChromeHeader,
  ChatComposerFooter,
  ChatSurfaceWash,
} from '../../features/liquidationConversation/components/ChatChrome';
import { CHAT_COLORS } from '../../design/chatGlass';

const CONVEX_TEMPLATE =
  process.env.EXPO_PUBLIC_CLERK_CONVEX_JWT_TEMPLATE ||
  process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ||
  'mobile';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const DEFAULT_PEEK_RATIO = 0.55;
const MAX_SHEET_H = Math.round(SCREEN_H * 0.9);
const EXPAND_AT = Math.round(SCREEN_H * 0.7);
const GRABBER_H = 22;
const SHEET_BORDER = 1;
// The chat surface paints a cream wash under its floating header, so a pure white grabber
// strip above it reads as a stripe across the top of the sheet. Matching the wash's top
// colour keeps the sheet one continuous surface.
const SHEET_TOP_WASH = '#F8FCF0';
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const dismissKeyboard = () => Keyboard.dismiss();

function RecordingWindowGlow({ active }: { active: boolean }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0);

  // Fade the state change without adding a distracting loop while capture is active.
  useEffect(() => {
    opacity.set(withTiming(active ? 1 : 0, {
      duration: reduceMotion ? 1 : active ? 220 : 180,
    }));
  }, [active, opacity, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.recordingWindowGlow, animatedStyle]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Rect
          x={2}
          y={2}
          width={SCREEN_W - 4}
          height={SCREEN_H - 4}
          style="stroke"
          strokeWidth={3}
          opacity={0.5}
        >
          <LinearGradient
            start={vec(0, 0)}
            end={vec(SCREEN_W, SCREEN_H)}
            colors={[CHAT_COLORS.brandDeep, CHAT_COLORS.brand, CHAT_COLORS.brandDeep]}
            positions={[0, 0.52, 1]}
          />
          <BlurMask blur={12} style="normal" />
        </Rect>
        <Rect
          x={1}
          y={1}
          width={SCREEN_W - 2}
          height={SCREEN_H - 2}
          style="stroke"
          strokeWidth={1}
          opacity={0.28}
        >
          <LinearGradient
            start={vec(0, 0)}
            end={vec(SCREEN_W, SCREEN_H)}
            colors={[CHAT_COLORS.brandDeep, CHAT_COLORS.brand, CHAT_COLORS.brandDeep]}
            positions={[0, 0.52, 1]}
          />
        </Rect>
      </Canvas>
    </Animated.View>
  );
}

/** JS-side keyboard height, for layout values (insets, padding) that can't read a worklet. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', event =>
      setHeight(event.endCoordinates?.height ?? 0),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export type QuickChatSheetProps = {
  firstName: string;
  campaignId?: string;
  suggestedQuestions?: string[];
  placeholder?: string;
  emptyHint?: string;
  /** Inventory uses a shorter peek so the live list and lifted selection pill stay visible. */
  peekHeightRatio?: number;
  contextAttachment?: {
    kind: ConversationContextAttachment['kind'];
    label: string;
    getPayload: () => Record<string, unknown>;
  };
  onResolveSelection?: (proposal: InventorySelectionProposal) => string[];
  onApplySelection?: (proposal: InventorySelectionProposal) => number;
  onInventoryActionApplied?: (action: InventoryBulkAction) => void;
  focusRequestKey?: number;
  onClose: () => void;
};

type HeroSuggestion = {
  icon: string;
  title: string;
  subtitle: string;
  prompt: string;
};

const FALLBACK_SUGGESTIONS: HeroSuggestion[] = [
  {
    icon: 'trending-up',
    title: 'What is moving',
    subtitle: 'Find the listings gaining traction.',
    prompt: 'What is moving in my inventory right now?',
  },
  {
    icon: 'progress-wrench',
    title: 'What is stuck',
    subtitle: 'Spot inventory that needs a move.',
    prompt: 'What is stuck and what should I do next?',
  },
];

const toHeroSuggestions = (questions: string[] | undefined): HeroSuggestion[] => {
  const clean = (questions || []).map(question => question.trim()).filter(Boolean).slice(0, 2);
  if (!clean.length) return FALLBACK_SUGGESTIONS;
  return clean.map((prompt, index) => {
    const words = prompt.replace(/[?.!,;:]+/g, '').split(/\s+/).filter(Boolean);
    const title = words.slice(0, 4).join(' ');
    return {
      icon: index === 0 ? 'chart-line' : 'lightbulb-on-outline',
      title,
      subtitle: words.length > 4 ? prompt : 'Ask Sprout to dig in.',
      prompt,
    };
  });
};

const useSproutConversationController = (campaignId?: string) => {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const adapter = useMemo(
    () =>
      new HybridConversationDataAdapter({
        getClerkToken: () =>
          getTokenRef.current({ template: CONVEX_TEMPLATE }).catch(async () => getTokenRef.current()),
      }),
    [],
  );

  return useLiquidationConversationController({
    adapter,
    initialCampaignId: campaignId,
    global: !campaignId,
  });
};

export function QuickChatSheet({
  firstName,
  campaignId,
  suggestedQuestions,
  placeholder = 'Ask Sprout',
  emptyHint,
  peekHeightRatio = DEFAULT_PEEK_RATIO,
  contextAttachment,
  onResolveSelection,
  onApplySelection,
  onInventoryActionApplied,
  focusRequestKey = 0,
  onClose,
}: QuickChatSheetProps) {
  const navigation = useNavigation<any>();
  const transition = useQuickChatTransition();
  const sheetRef = useRef<View>(null);
  const expandRequestedRef = useRef(false);
  const sheetPresentedRef = useRef(false);
  const peekHeight = Math.round(SCREEN_H * Math.max(0.3, Math.min(0.65, peekHeightRatio)));
  const sheetHeight = useSharedValue(peekHeight);
  const sheetTranslateY = useSharedValue(peekHeight + 24);
  const backdropOpacity = useSharedValue(0);
  const [recordingActive, setRecordingActive] = useState(false);
  const controller = useSproutConversationController(campaignId);
  const heroSuggestions = useMemo(
    () => toHeroSuggestions(suggestedQuestions),
    [suggestedQuestions],
  );
  // Before the first exchange the sheet is only the composer, so it rests at the chrome it
  // actually renders instead of reserving the peek height. Gated on loaded state, never a
  // timer: a thread with history is still loading here, so it never flashes the short sheet.
  const [chromeHeight, setChromeHeight] = useState(0);
  const reportChromeHeight = useCallback((height: number) => {
    setChromeHeight(current => (Math.abs(current - height) < 1 ? current : height));
  }, []);
  const hasSproutResponse = controller.activeMessages.some(message => message.role === 'assistant');
  const composerOnly =
    !controller.loading &&
    !controller.isLoadingMessages &&
    !hasSproutResponse;
  const restingHeight = composerOnly && chromeHeight > 0
    ? Math.min(peekHeight, chromeHeight + GRABBER_H + SHEET_BORDER * 2)
    : peekHeight;
  const restingHeightReady =
    !controller.loading &&
    !controller.isLoadingMessages &&
    (!composerOnly || chromeHeight > 0);
  const restHeight = useSharedValue(peekHeight);

  // Wait offscreen for history and chrome measurement so the first visible frame is compact.
  useEffect(() => {
    if (!restingHeightReady) return;
    restHeight.set(restingHeight);
    if (!sheetPresentedRef.current) {
      sheetPresentedRef.current = true;
      sheetHeight.set(restingHeight);
      sheetTranslateY.set(restingHeight + 24);
      quickChatTransition.resetSheet({
        y: SCREEN_H - restingHeight + GRABBER_H,
        height: restingHeight - GRABBER_H,
      });
      const frame = requestAnimationFrame(() => {
        sheetTranslateY.set(withSpring(0, { damping: 26, stiffness: 260, mass: 0.72 }));
        backdropOpacity.set(withTiming(1, { duration: 180 }));
      });
      return () => cancelAnimationFrame(frame);
    }

    // The first Sprout response grows the same measured rest surface without overshoot.
    sheetHeight.set(withSpring(restingHeight, { damping: 30, stiffness: 240, mass: 0.9 }));
    if (!quickChatTransition.getSnapshot().transitioning) {
      quickChatTransition.setFrame({
        y: SCREEN_H - restingHeight + GRABBER_H,
        height: restingHeight - GRABBER_H,
      });
    }
  }, [
    backdropOpacity,
    restHeight,
    restingHeight,
    restingHeightReady,
    sheetHeight,
    sheetTranslateY,
  ]);

  useEffect(() => {
    if (transition.destination === 'sheet' && !transition.transitioning) {
      expandRequestedRef.current = false;
    }
  }, [transition.destination, transition.transitioning]);

  const dismiss = useCallback(() => {
    if (transition.transitioning || transition.destination === 'full') return;
    dismissKeyboard();
    backdropOpacity.set(withTiming(0, { duration: 170 }));
    sheetTranslateY.set(
      withTiming(sheetHeight.get() + 24, { duration: 210 }, finished => {
        if (finished) runOnJS(onClose)();
      }),
    );
  }, [backdropOpacity, onClose, sheetHeight, sheetTranslateY, transition.destination, transition.transitioning]);

  const expand = useCallback(() => {
    if (!TELEPORT_AVAILABLE) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      navigation.navigate('GlobalSproutChat', {
        campaignId,
        firstName,
        suggestedQuestions,
        placeholder,
        emptyHint,
        peekHeightRatio,
      });
      onClose();
      return;
    }
    if (
      expandRequestedRef.current ||
      transition.transitioning ||
      transition.destination === 'full'
    ) return;
    expandRequestedRef.current = true;
    const navigateFull = (y: number, height: number) => {
      quickChatTransition.setFrame({
        y: y + GRABBER_H,
        height: Math.max(1, height - GRABBER_H),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      navigation.navigate('GlobalSproutChat');
    };
    const fallbackHeight = sheetHeight.get();
    if (sheetRef.current) {
      sheetRef.current.measureInWindow((_x, y, _width, height) => {
        navigateFull(y, height);
      });
      return;
    }
    navigateFull(SCREEN_H - fallbackHeight, fallbackHeight);
  }, [
    campaignId,
    emptyHint,
    firstName,
    navigation,
    onClose,
    placeholder,
    peekHeightRatio,
    sheetHeight,
    suggestedQuestions,
    transition.destination,
    transition.transitioning,
  ]);

  const startHeight = useSharedValue(peekHeight);
  const returnToPeek = useCallback(() => {
    dismissKeyboard();
    if (transition.destination === 'full') {
      quickChatTransition.requestCollapse();
      return;
    }
    sheetHeight.set(withSpring(restHeight.get(), { damping: 25, stiffness: 260 }));
  }, [restHeight, sheetHeight, transition.destination]);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          'worklet';
          startHeight.set(sheetHeight.get());
        })
        .onUpdate(event => {
          'worklet';
          const next = startHeight.get() - event.translationY;
          sheetHeight.set(Math.max(0, Math.min(MAX_SHEET_H, next)));
        })
        .onEnd(event => {
          'worklet';
          const height = sheetHeight.get();
          const rest = restHeight.get();
          if (height < rest * 0.58 || event.velocityY > 900) {
            runOnJS(dismissKeyboard)();
            sheetTranslateY.set(
              withTiming(height + 24, { duration: 190 }, finished => {
                if (finished) runOnJS(onClose)();
              }),
            );
            backdropOpacity.set(withTiming(0, { duration: 160 }));
          } else if (height > EXPAND_AT || event.velocityY < -800) {
            runOnJS(expand)();
          } else {
            sheetHeight.set(withSpring(rest, { damping: 25, stiffness: 260 }));
          }
        }),
    [backdropOpacity, expand, onClose, restHeight, sheetHeight, sheetTranslateY, startHeight],
  );

  const keyboard = useAnimatedKeyboard();
  // The composer lifts by the whole keyboard height INSIDE the sheet, so the sheet has to
  // extend behind the keyboard by the same amount or the composer is pushed up over the
  // messages and out the top. sheetHeight stays the part the seller sees and drags.
  //
  // This used to be gated to the composer-only rest height, which left the peek
  // presentation (any thread WITH history) as a fixed 55%-tall sheet under a ~45%-tall
  // keyboard: the keyboard swallowed nearly the whole sheet and the composer floated over
  // the transcript. Clamped to MAX_SHEET_H so the grown sheet can't run off the top.
  const sheetStyle = useAnimatedStyle(() => ({
    height: Math.min(MAX_SHEET_H, sheetHeight.get() + keyboard.height.value),
    transform: [{ translateY: sheetTranslateY.get() }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.get() * 0.32,
  }));

  const hostName =
    transition.destination === 'full' ? QUICK_CHAT_FULL_HOST : QUICK_CHAT_SHEET_HOST;
  const conversation = (
    <QuickChatConversation
      controller={controller}
      firstName={firstName}
      suggestions={heroSuggestions}
      placeholder={placeholder}
      emptyHint={emptyHint}
      contextAttachment={contextAttachment}
      onResolveSelection={onResolveSelection}
      onApplySelection={onApplySelection}
      onInventoryActionApplied={onInventoryActionApplied}
      focusRequestKey={focusRequestKey}
      onReturnToPeek={returnToPeek}
      onExpand={expand}
      onDismiss={dismiss}
      onCompactHeight={reportChromeHeight}
      onRecordingChange={setRecordingActive}
    />
  );

  return (
    <>
      <Modal
        visible={!TELEPORT_AVAILABLE || transition.destination === 'sheet'}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={dismiss}
      >
        <GestureHandlerRootView
          style={styles.overlay}
          pointerEvents={transition.destination === 'sheet' ? 'auto' : 'none'}
        >
          <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close Sprout" />
          <Animated.View ref={sheetRef} style={[styles.sheet, sheetStyle]}>
            <GestureDetector gesture={pan}>
              <View style={styles.grabberZone}>
                <View style={styles.grabber} />
              </View>
            </GestureDetector>
            {TELEPORT_AVAILABLE ? (
              <PortalHost name={QUICK_CHAT_SHEET_HOST} style={styles.sheetHost} />
            ) : (
              <View style={styles.sheetHost}>{conversation}</View>
            )}
          </Animated.View>
          <RecordingWindowGlow active={recordingActive} />
        </GestureHandlerRootView>
      </Modal>

      {TELEPORT_AVAILABLE ? (
        <Portal
          hostName={hostName}
          name="sprout-live-conversation"
          style={transition.destination === 'full' ? styles.fullPortal : styles.sheetPortal}
        >
          {conversation}
        </Portal>
      ) : null}
    </>
  );
}

type ConversationController = ReturnType<typeof useLiquidationConversationController>;

const shortSelectionCriteria = (query: string): string => {
  const clean = query.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/g, '');
  return clean.length > 72 ? `${clean.slice(0, 69).trimEnd()}...` : clean;
};

const inventoryActionSummary = (action: InventoryBulkAction): string => {
  const noun = action.count === 1 ? 'item' : 'items';
  if (action.action === 'add_tag') {
    return `Tagged ${action.count} ${noun}${action.tag ? ` ${action.tag}` : ''}.\n\nWant changes?`;
  }
  return `Archived ${action.count} ${noun}.\n\nWant changes?`;
};

function QuickChatConversation({
  controller,
  firstName,
  suggestions,
  placeholder,
  emptyHint,
  contextAttachment,
  onResolveSelection,
  onApplySelection,
  onInventoryActionApplied,
  focusRequestKey,
  onReturnToPeek,
  onExpand,
  onDismiss,
  onCompactHeight,
  onRecordingChange,
  standaloneFull = false,
  onCollapse,
}: {
  controller: ConversationController;
  firstName: string;
  suggestions: HeroSuggestion[];
  placeholder: string;
  emptyHint?: string;
  contextAttachment?: QuickChatSheetProps['contextAttachment'];
  onResolveSelection?: QuickChatSheetProps['onResolveSelection'];
  onApplySelection?: QuickChatSheetProps['onApplySelection'];
  onInventoryActionApplied?: QuickChatSheetProps['onInventoryActionApplied'];
  focusRequestKey?: number;
  onReturnToPeek: () => void;
  onExpand: () => void;
  onDismiss: () => void;
  /** Compact only: the measured header + composer height the sheet collapses to. */
  onCompactHeight?: (height: number) => void;
  onRecordingChange?: (recording: boolean) => void;
  standaloneFull?: boolean;
  onCollapse?: () => void;
}) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const transition = useQuickChatTransition();
  const full = standaloneFull || transition.destination === 'full';
  const visualFull =
    standaloneFull || (transition.destination === 'full' && transition.phase !== 'expanding');
  const empty = !controller.isLoadingMessages && controller.activeMessages.length === 0;
  const [headerHeight, setHeaderHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const [recordingActive, setRecordingActive] = useState(false);
  const keyboardHeight = useKeyboardHeight();
  const localRetriesRef = useRef(new Map<string,
    | { kind: 'plan'; prompt: DecisionPrompt }
    | { kind: 'selection'; proposal: InventorySelectionProposal }
  >());
  const activeThread = controller.threads.find(thread => thread.id === controller.activeThreadId);
  const rawTitle = activeThread?.title || controller.activeCampaign?.title || 'Sprout';
  const threadTitle = rawTitle === 'Primary' || rawTitle === 'New chat' ? 'Sprout' : rawTitle;
  const getTurnContext = useCallback((): ConversationContextAttachment | undefined => {
    if (!contextAttachment) return undefined;
    return {
      kind: contextAttachment.kind,
      label: contextAttachment.label,
      payload: contextAttachment.getPayload(),
    };
  }, [contextAttachment]);

  // Lift composer capture state because only the window-level surfaces span safe areas.
  const handleRecordingChange = useCallback((recording: boolean) => {
    setRecordingActive(recording);
    onRecordingChange?.(recording);
  }, [onRecordingChange]);

  // Report the chrome the sheet has to keep visible when there is nothing else to show.
  // Compact only: the full surface pads for the status bar and the home indicator, which
  // would overstate the collapsed height.
  useEffect(() => {
    if (full || !onCompactHeight || !headerHeight || !footerHeight) return;
    onCompactHeight(headerHeight + footerHeight);
  }, [footerHeight, full, headerHeight, onCompactHeight]);

  const transitionStyle = useAnimatedStyle(() => {
    const progress = quickChatProgress.get();
    return {
      height: interpolate(
        progress,
        [0, 1],
        [transition.frame.height, SCREEN_H],
        Extrapolation.CLAMP,
      ),
      borderRadius: interpolate(progress, [0, 1], [26, 0], Extrapolation.CLAMP),
      transform: [
        {
          translateY: interpolate(
            progress,
            [0, 1],
            [transition.frame.y, 0],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  }, [transition.frame.height, transition.frame.y]);

  const sendSuggestion = useCallback((prompt: string) => {
    void controller.queueTextMessage(
      prompt,
      undefined,
      undefined,
      undefined,
      getTurnContext(),
    ).catch(() => {
      controller.setNotice('Could not send. Try again.');
    });
  }, [controller, getTurnContext]);

  const applySelection = useCallback((
    proposal: InventorySelectionProposal,
    retryMessageId?: string,
  ) => {
    if (!onApplySelection) return;
    onReturnToPeek();
    try {
      const count = onApplySelection(proposal);
      const noun = count === 1 ? 'item' : 'items';
      const summary = `Selected ${count} ${noun}: ${shortSelectionCriteria(proposal.query)}.\n\nWrong ones? Tell me what to change.`;
      if (retryMessageId) {
        controller.updateClientAssistantMessage(retryMessageId, {
          content: summary,
          deliveryState: 'sent',
        });
        localRetriesRef.current.delete(retryMessageId);
      } else {
        controller.appendClientAssistantMessage(summary);
      }
    } catch {
      const messageId = retryMessageId || controller.appendClientAssistantMessage(
        'Couldn’t update the selection.',
        'failed',
      );
      if (messageId) {
        controller.updateClientAssistantMessage(messageId, {
          content: 'Couldn’t update the selection.',
          deliveryState: 'failed',
        });
        localRetriesRef.current.set(messageId, { kind: 'selection', proposal });
      }
    }
  }, [controller, onApplySelection, onReturnToPeek]);

  const submitPlanDecision = useCallback(async (
    prompt: DecisionPrompt,
    action: 'approve' | 'revise' | 'follow_up',
    retryMessageId?: string,
  ) => {
    dismissKeyboard();
    if (retryMessageId) {
      controller.updateClientAssistantMessage(retryMessageId, {
        content: 'Trying those changes again.',
        deliveryState: 'sending',
      });
    }
    const applied = await controller.submitDecision(prompt, action, {
      retry: !!retryMessageId,
    });
    if (applied && action === 'approve' && prompt.inventoryAction) {
      const summary = inventoryActionSummary(prompt.inventoryAction);
      if (retryMessageId) {
        controller.updateClientAssistantMessage(retryMessageId, {
          content: summary,
          deliveryState: 'sent',
        });
        localRetriesRef.current.delete(retryMessageId);
      } else {
        controller.appendClientAssistantMessage(summary);
      }
      onInventoryActionApplied?.(prompt.inventoryAction);
      return;
    }
    if (!applied && action === 'approve' && prompt.inventoryAction) {
      const messageId = retryMessageId || controller.appendClientAssistantMessage(
        'Couldn’t apply those changes.',
        'failed',
      );
      if (messageId) {
        controller.updateClientAssistantMessage(messageId, {
          content: 'Couldn’t apply those changes.',
          deliveryState: 'failed',
        });
        localRetriesRef.current.set(messageId, { kind: 'plan', prompt });
      }
      return;
    }
    if (applied && action === 'revise') {
      controller.appendClientAssistantMessage('Revision requested. Tell me what to change.');
    } else if (applied && action === 'follow_up') {
      controller.appendClientAssistantMessage('Follow-up requested.');
    }
  }, [controller, onInventoryActionApplied]);

  const handleMessageRetry = useCallback((messageId: string) => {
    const retry = localRetriesRef.current.get(messageId);
    if (!retry) {
      void controller.retryMessage(messageId);
      return;
    }
    if (retry.kind === 'selection') {
      applySelection(retry.proposal, messageId);
      return;
    }
    void submitPlanDecision(retry.prompt, 'approve', messageId);
  }, [applySelection, controller, submitPlanDecision]);

  const handleDecision = useCallback((
    prompt: DecisionPrompt,
    action: 'approve' | 'revise' | 'follow_up',
  ) => {
    if (action === 'approve' && prompt.inventoryAction?.action === 'delete') {
      const count = prompt.inventoryAction.count;
      Alert.alert(
        'Delete items',
        `Delete ${count} item${count === 1 ? '' : 's'}? This archives them from inventory.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void submitPlanDecision(prompt, action);
            },
          },
        ],
      );
      return;
    }
    void submitPlanDecision(prompt, action);
  }, [submitPlanDecision]);

  const handleTrayPlan = useCallback((
    planId: string,
    action: 'approve' | 'revise' | 'follow_up',
    plan?: PlanPayload,
  ) => {
    handleDecision(
      {
        id: planId,
        kind: 'approve',
        title: plan?.title || 'Plan',
        planId,
        inventoryAction: plan?.inventoryAction,
      },
      action,
    );
  }, [handleDecision]);

  const collapse = useCallback(() => {
    if (standaloneFull) {
      onCollapse?.();
      return;
    }
    quickChatTransition.requestCollapse();
  }, [onCollapse, standaloneFull]);

  const keyboard = useAnimatedKeyboard();
  // The footer pads for the home indicator, so the lift gives that padding back when the
  // keyboard covers it. Without this the composer would float a whole inset above the keys.
  const composerLiftStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateY: -Math.max(keyboard.height.value - insets.bottom, 0) }],
    }),
    [insets.bottom],
  );
  // The list's bottom inset is a plain layout number, so it can't read the animated
  // keyboard value, it has to track the same lift in JS or the transcript scrolls under
  // the lifted composer and the newest turn is unreachable.
  const composerLift = Math.max(keyboardHeight - insets.bottom, 0);

  // Opening the sheet raised the keyboard immediately, mid entry-spring: the seller landed
  // on a sheet whose visible strip was the grabber, with the transcript they came to read
  // behind the keys. Focus is now (a) deferred until the sheet has settled and (b) only
  // automatic on an empty thread, where the sheet IS just a composer. With history, reading
  // comes first, tapping the composer still opens the keyboard.
  const [effectiveFocusKey, setEffectiveFocusKey] = useState(0);
  const consumedFocusKeyRef = useRef(0);
  useEffect(() => {
    if (!focusRequestKey || consumedFocusKeyRef.current === focusRequestKey) return;
    // Hold the request until the thread has loaded. "empty" is not knowable while
    // messages are still in flight, and guessing wrong is what put the keyboard over the
    // transcript.
    if (controller.isLoadingMessages) return;
    consumedFocusKeyRef.current = focusRequestKey;
    if (!empty && !full) return;
    const timer = setTimeout(() => setEffectiveFocusKey(focusRequestKey), 280);
    return () => clearTimeout(timer);
  }, [focusRequestKey, controller.isLoadingMessages, empty, full]);

  const pendingQuestion =
    controller.pendingQuestion &&
    (!controller.pendingQuestion.threadId || controller.pendingQuestion.threadId === controller.activeThreadId)
      ? controller.pendingQuestion
      : null;
  const pendingPlan =
    controller.pendingPlan &&
    (!controller.pendingPlan.threadId || controller.pendingPlan.threadId === controller.activeThreadId)
      ? controller.pendingPlan
      : null;

  return (
    <Animated.View
      style={[
        styles.conversationSurface,
        full ? styles.fullConversationSurface : styles.sheetConversationSurface,
        standaloneFull ? styles.standaloneConversationSurface : null,
        full && !standaloneFull ? transitionStyle : null,
      ]}
      pointerEvents={!standaloneFull && transition.transitioning ? 'none' : 'auto'}
    >
      <View style={styles.flex}>
        <ChatSurfaceWash />
        <ChatChromeHeader
          title={threadTitle}
          subtitle="Global chat"
          topInset={visualFull ? insets.top : 0}
          onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}
          leftAction={{
            icon: visualFull
              ? <ChevronDown size={18} color="#18181B" />
              : <Maximize2 size={17} color="#18181B" />,
            label: 'Chat',
            onPress: visualFull ? collapse : onExpand,
            accessibilityLabel: visualFull ? 'Return to quick chat' : 'Expand chat',
          }}
          rightAction={!visualFull ? {
            icon: <X size={21} color="#18181B" />,
            onPress: onDismiss,
            accessibilityLabel: 'Close chat',
          } : undefined}
        />

        <ConvexLiveMessages
          threadId={controller.activeThreadId}
          onMessages={controller.ingestLiveMessages}
        />

        <View style={[styles.flex, { paddingTop: headerHeight }]}>
          <ConversationList
            messages={controller.activeMessages}
            loading={controller.isLoadingMessages}
            onDecision={handleDecision}
            onRetry={handleMessageRetry}
            onCancelQueued={controller.cancelQueuedMessage}
            onFeedback={controller.submitMessageFeedback}
            onFollowUp={sendSuggestion}
            onOpenCart={(sessionId: string) => {
              const origin = { screen: 'GlobalSproutChat' };
              try {
                navigation.navigate('TabNavigator', {
                  screen: 'AddProduct',
                  params: { sessionId, origin },
                });
              } catch {
                navigation.navigate('AddProduct', { sessionId, origin });
              }
            }}
            onOpenItem={(productId: string) => navigation.navigate('ProductDetail', { productId })}
            onReviseDocument={(_documentId, title, note) => {
              controller.setComposerText(`Revise the "${title}" report: ${note}`);
            }}
            onApprovePlan={handleTrayPlan}
            onResolveSelection={onResolveSelection}
            onApplySelection={applySelection}
            submittingDecisionId={controller.submittingDecisionId}
            contentTopInset={8}
            contentBottomInset={footerHeight + composerLift + 8}
            scrollEnabled={!transition.transitioning}
            ListEmptyComponent={
              empty && full ? (
                <NewChatHero
                  firstName={firstName}
                  suggestions={suggestions}
                  hint={emptyHint}
                  onSelect={sendSuggestion}
                />
              ) : null
            }
          />
        </View>

        <Animated.View
          style={[styles.composerAvoider, composerLiftStyle]}
          pointerEvents="box-none"
        >
          <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}>
          {pendingPlan ? (
            <View style={styles.pendingCard}>
              <PlanCard
                prompt={pendingPlan}
                onDecision={handleDecision}
                submitting={!!controller.submittingDecisionId}
              />
            </View>
          ) : null}
          {pendingQuestion ? (
            <View style={styles.pendingCard}>
              <QuestionCard
                prompt={pendingQuestion}
                submitting={controller.answeringQuestion}
                onSubmit={(answers, other) => controller.submitAnswer(pendingQuestion, answers, other)}
              />
            </View>
          ) : null}
          <ChatComposerFooter
            bottomPadding={(insets.bottom || 10) + 12}
            error={controller.error}
            onRetry={controller.onRefresh}
            notice={controller.notice}
            onDismissNotice={() => controller.setNotice(null)}
          >
            <MessageComposer
              value={controller.composerText}
              placeholder={placeholder}
              onChangeText={controller.setComposerText}
              onSend={(photos) => {
                void controller.sendComposer(photos, undefined, getTurnContext());
              }}
              queuedCount={controller.queuedCount}
              isStreaming={controller.isStreaming}
              getAuthToken={ensureSupabaseJwt}
              contextAttachment={contextAttachment ? { label: contextAttachment.label } : null}
              hideAttach={!!contextAttachment}
              focusRequestKey={effectiveFocusKey}
              onRecordingChange={handleRecordingChange}
            />
          </ChatComposerFooter>
          </View>
        </Animated.View>
      </View>
      {full ? <RecordingWindowGlow active={recordingActive} /> : null}
    </Animated.View>
  );
}

export function StandaloneGlobalSproutChat({
  firstName,
  campaignId,
  suggestedQuestions,
  placeholder = 'Ask Sprout',
  emptyHint,
  onClose,
}: {
  firstName: string;
  campaignId?: string;
  suggestedQuestions?: string[];
  placeholder?: string;
  emptyHint?: string;
  onClose: () => void;
}) {
  const controller = useSproutConversationController(campaignId);
  const suggestions = useMemo(
    () => toHeroSuggestions(suggestedQuestions),
    [suggestedQuestions],
  );

  return (
    <QuickChatConversation
      controller={controller}
      firstName={firstName}
      suggestions={suggestions}
      placeholder={placeholder}
      emptyHint={emptyHint}
      onReturnToPeek={() => undefined}
      onExpand={() => undefined}
      onDismiss={onClose}
      standaloneFull
      onCollapse={onClose}
    />
  );
}

/** Full-surface only. The compact sheet is just the composer until the first turn lands. */
function NewChatHero({
  firstName,
  suggestions,
  hint,
  onSelect,
}: {
  firstName: string;
  suggestions: HeroSuggestion[];
  hint?: string;
  onSelect: (prompt: string) => void;
}) {
  return (
    <View style={styles.hero}>
      <AnorhaFace size={96} />
      <Text style={styles.heroDate}>{DATE_FORMATTER.format(new Date())}</Text>
      <Text style={styles.heroGreeting}>{`Ready when you are, ${firstName}.`}</Text>
      {hint ? (
        <Text style={styles.heroHint}>{hint}</Text>
      ) : (
        <View style={styles.suggestions}>
          {suggestions.slice(0, 2).map(suggestion => (
            <Pressable
              key={suggestion.prompt}
              style={styles.suggestionCard}
              onPress={() => onSelect(suggestion.prompt)}
              accessibilityRole="button"
            >
              <View style={styles.suggestionIcon}>
                <Icon name={suggestion.icon} size={18} color="#5D7E16" />
              </View>
              <View style={styles.suggestionCopy}>
                <Text style={styles.suggestionTitle} numberOfLines={1}>
                  {suggestion.title}
                </Text>
                <Text style={styles.suggestionSubtitle} numberOfLines={2}>
                  {suggestion.subtitle}
                </Text>
              </View>
              <Icon name="arrow-up-right" size={17} color="#9CA3AF" />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  recordingWindowGlow: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  backdrop: {
    backgroundColor: '#17200D',
  },
  sheet: {
    backgroundColor: SHEET_TOP_WASH,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
    borderWidth: SHEET_BORDER,
    borderColor: '#E5E7EB',
  },
  grabberZone: {
    height: GRABBER_H,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SHEET_TOP_WASH,
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D9DDE3',
  },
  sheetHost: { flex: 1 },
  sheetPortal: { flex: 1 },
  fullPortal: {
    ...StyleSheet.absoluteFillObject,
  },
  conversationSurface: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  sheetConversationSurface: {
    flex: 1,
  },
  fullConversationSurface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
  },
  standaloneConversationSurface: {
    ...StyleSheet.absoluteFillObject,
  },
  composerAvoider: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  pendingCard: {
    maxHeight: 220,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    minHeight: Math.max(480, SCREEN_H - 250),
    gap: 12,
  },
  heroDate: {
    color: '#8A8A91',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
  },
  heroGreeting: {
    color: '#18181B',
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    lineHeight: 28,
    textAlign: 'center',
  },
  heroHint: {
    maxWidth: 340,
    color: '#71717A',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  suggestions: {
    width: '100%',
    maxWidth: 420,
    gap: 10,
    marginTop: 8,
  },
  suggestionCard: {
    minHeight: 70,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E1E5D9',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  suggestionIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(147,200,34,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionCopy: { flex: 1 },
  suggestionTitle: {
    color: '#242426',
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    lineHeight: 18,
  },
  suggestionSubtitle: {
    marginTop: 3,
    color: '#71717A',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
  },
});

export default QuickChatSheet;
