/* eslint-disable max-lines */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
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
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { ChevronDown, History, Maximize2, X } from 'lucide-react-native';
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
  ChatChromeHeader,
  ChatCircleButton,
  ChatComposerFooter,
  ChatSurfaceWash,
} from '../../features/liquidationConversation/components/ChatChrome';
import { CHAT_COLORS } from '../../design/chatGlass';
import { getSproutTheme, sproutLightTheme } from '../../design/sproutTheme';
import { useToastAnchor } from '../../context/ToastContext';

const CONVEX_TEMPLATE =
  process.env.EXPO_PUBLIC_CLERK_CONVEX_JWT_TEMPLATE ||
  process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ||
  'mobile';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const DEFAULT_PEEK_RATIO = 0.55;
const GRABBER_H = 22;
const SHEET_BORDER = 1;
// The chat surface paints a cream wash under its floating header, so a pure white grabber
// strip above it reads as a stripe across the top of the sheet. Matching the wash's top
// colour keeps the sheet one continuous surface.
const SHEET_TOP_WASH = sproutLightTheme.chat.surfaceElevated;
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

// Keyboard height is read from JS Keyboard events, not Reanimated's useAnimatedKeyboard.
// The surface used to live inside a native Modal — its own UIWindow on iOS — where
// useAnimatedKeyboard reported 0 forever and the composer stayed buried under the keys.
// The Modal is gone, but these listeners are correct, cheap, and work on both platforms.
const KB_SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const KB_HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

/** JS-side keyboard height, for layout values (insets, padding) that can't read a worklet. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(KB_SHOW_EVENT, (event: any) =>
      setHeight(event?.endCoordinates?.height ?? 0),
    );
    const hide = Keyboard.addListener(KB_HIDE_EVENT, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/** Same signal as a shared value, so the sheet/composer worklets can read it. */
function useKeyboardOffset() {
  const offset = useSharedValue(0);
  useEffect(() => {
    // Mirror the OS animation curve so the sheet and the keys move together.
    const show = Keyboard.addListener(KB_SHOW_EVENT, (event: any) => {
      offset.set(withTiming(event?.endCoordinates?.height ?? 0, {
        duration: event?.duration || 250,
      }));
    });
    const hide = Keyboard.addListener(KB_HIDE_EVENT, (event: any) => {
      offset.set(withTiming(0, { duration: event?.duration || 220 }));
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [offset]);
  return offset;
}

export type QuickChatSheetProps = {
  firstName: string;
  campaignId?: string;
  suggestedQuestions?: string[];
  placeholder?: string;
  emptyHint?: string;
  /** Inventory uses a shorter peek so the live list and lifted selection pill stay visible. */
  peekHeightRatio?: number;
  /** Explicit dark opt-in from Sprout home. Shared hosts default to light. */
  dark?: boolean;
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
  dark = false,
  contextAttachment,
  onResolveSelection,
  onApplySelection,
  onInventoryActionApplied,
  focusRequestKey = 0,
  onClose,
}: QuickChatSheetProps) {
  const navigation = useNavigation<any>();
  const theme = getSproutTheme(dark);
  const peekHeight = Math.round(SCREEN_H * Math.max(0.3, Math.min(0.65, peekHeightRatio)));
  const [recordingActive, setRecordingActive] = useState(false);
  const controller = useSproutConversationController(campaignId);
  const heroSuggestions = useMemo(
    () => toHeroSuggestions(suggestedQuestions),
    [suggestedQuestions],
  );

  // Composer first. Tapping Sprout puts an input on screen and nothing else: no backdrop,
  // no sheet, no waiting on the network. The surface only grows into a transcript once a
  // turn actually lands in THIS session. Existing history is not "a result coming back" —
  // it stays folded behind the expand button, so the seller lands on an input rather than
  // on a conversation they didn't ask to reopen.
  //
  // This used to present a full-screen Modal that stayed invisible until the thread had
  // loaded and the chrome had measured. When either never resolved, the app was left under
  // a transparent Modal that ate every tap: "the chat doesn't open and I can't press
  // anything". Nothing here is allowed to gate on load state again.
  const [grown, setGrown] = useState(false);
  const grow = useCallback(() => setGrown(true), []);
  const messageCount = controller.activeMessages.length;
  const baselineCountRef = useRef<number | null>(null);
  useEffect(() => {
    // Only trust the count once a thread has actually resolved. There is a frame on entry
    // where the thread id is still null and the list is still empty, and taking THAT as
    // the baseline made every existing conversation look like a fresh result had just
    // landed — the surface opened as a transcript again, which is the whole complaint.
    if (!controller.activeThreadId || controller.isLoadingMessages) return;
    if (baselineCountRef.current === null) {
      baselineCountRef.current = messageCount;
      return;
    }
    if (messageCount > baselineCountRef.current) setGrown(true);
  }, [controller.activeThreadId, controller.isLoadingMessages, messageCount]);
  // A stream or a prompt is a result arriving whatever the count says.
  useEffect(() => {
    if (controller.isStreaming || controller.pendingPlan || controller.pendingQuestion) {
      setGrown(true);
    }
  }, [controller.isStreaming, controller.pendingPlan, controller.pendingQuestion]);

  // The surface's height is a plain style, never an animated one. Reanimated drives
  // layout props straight onto the view on the old architecture: the box resizes but its
  // children keep the layout Yoga gave them, so the peek sheet held a full-height
  // conversation and pushed the composer clean off the bottom of the screen. Everything
  // that moves here is a transform or an opacity.
  const dragY = useSharedValue(0);
  const enter = useSharedValue(0);
  const backdropOpacity = useSharedValue(0);

  // Start the entry animation in the effect body. It used to be deferred a frame with
  // requestAnimationFrame; that frame never landed, so the whole surface sat at opacity 0
  // while its buttons were happily in the accessibility tree — "the chat doesn't open".
  useEffect(() => {
    enter.set(withTiming(1, { duration: 190 }));
  }, [enter]);

  useEffect(() => {
    backdropOpacity.set(withTiming(grown ? 1 : 0, { duration: 200 }));
  }, [backdropOpacity, grown]);

  const dismiss = useCallback(() => {
    dismissKeyboard();
    backdropOpacity.set(withTiming(0, { duration: 150 }));
    enter.set(
      withTiming(0, { duration: 180 }, finished => {
        if (finished) runOnJS(onClose)();
      }),
    );
  }, [backdropOpacity, enter, onClose]);

  // One path to the full surface: hand the thread to its own screen and close the dock.
  // The draft is persisted per thread, so whatever was typed is still there on arrival.
  // This used to teleport the live conversation across a portal to keep it mounted, which
  // only existed to escape the Modal the dock no longer uses.
  const expand = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    navigation.navigate('GlobalSproutChat', {
      campaignId,
      firstName,
      suggestedQuestions,
      placeholder,
      emptyHint,
    });
    onClose();
  }, [
    campaignId,
    emptyHint,
    firstName,
    navigation,
    onClose,
    placeholder,
    suggestedQuestions,
  ]);

  const returnToPeek = useCallback(() => dismissKeyboard(), []);
  // The grabber drags the sheet away, nothing more. Dragging it taller used to be the only
  // way up; the expand button says so out loud instead, and a transform can't desync the
  // layout underneath it the way an animated height did.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate(event => {
          'worklet';
          dragY.set(Math.max(0, event.translationY));
        })
        .onEnd(event => {
          'worklet';
          if (dragY.get() > peekHeight * 0.32 || event.velocityY > 900) {
            runOnJS(dismissKeyboard)();
            backdropOpacity.set(withTiming(0, { duration: 160 }));
            enter.set(
              withTiming(0, { duration: 180 }, finished => {
                if (finished) runOnJS(onClose)();
              }),
            );
          } else {
            dragY.set(withSpring(0, { damping: 26, stiffness: 280 }));
          }
        }),
    [backdropOpacity, dragY, enter, onClose, peekHeight],
  );

  const keyboardOffset = useKeyboardOffset();
  const insets = useSafeAreaInsets();
  // Calm entry: a short fade and a 24pt rise. No spring — the old one overshot hard enough
  // that opening the inventory helper read as the whole page bouncing. The same transform
  // carries the drag and rides the whole surface above the keyboard, so the composer keeps
  // its place inside it instead of being lifted a second time.
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.get(),
    transform: [{
      translateY:
        (1 - enter.get()) * 24
        + dragY.get()
        - Math.max(keyboardOffset.get() - insets.bottom, 0),
    }],
  }), [insets.bottom]);
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.get() * 0.32,
  }));

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
      compact={!grown}
      dark={dark}
      onShowHistory={grow}
      onReturnToPeek={returnToPeek}
      onExpand={expand}
      onDismiss={dismiss}
      onRecordingChange={setRecordingActive}
    />
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Compact is a bare composer over a live screen: no backdrop, and box-none
          everywhere so every tap outside the composer still reaches the app. Only the
          grown sheet earns a scrim and a tap-to-close catcher. */}
      {grown ? (
        <>
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.backdrop,
              { backgroundColor: theme.chat.backdrop },
              backdropStyle,
            ]}
          />
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismiss}
            accessibilityLabel="Close Sprout"
          />
        </>
      ) : null}

      <Animated.View
        style={[
          styles.dock,
          grown ? styles.sheet : styles.dockCompact,
          grown ? { backgroundColor: theme.chat.surfaceElevated, borderColor: theme.chat.sheetBorder } : null,
          grown ? { height: peekHeight } : null,
          enterStyle,
        ]}
        pointerEvents="box-none"
      >
        {grown ? (
          <GestureDetector gesture={pan}>
            <View style={[styles.grabberZone, { backgroundColor: theme.chat.surfaceElevated }]}>
              <View style={[styles.grabber, { backgroundColor: theme.chat.grabber }]} />
            </View>
          </GestureDetector>
        ) : null}
        <View style={grown ? styles.sheetHost : styles.dockHost}>{conversation}</View>
      </Animated.View>

      <RecordingWindowGlow active={recordingActive} />
    </View>
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
  compact = false,
  dark = false,
  onShowHistory,
  onReturnToPeek,
  onExpand,
  onDismiss,
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
  /** Composer only — no transcript, no sheet chrome, nothing behind it. */
  compact?: boolean;
  dark?: boolean;
  /** Compact only: unfold the past turns in place, without leaving the screen. */
  onShowHistory?: () => void;
  onReturnToPeek: () => void;
  onExpand: () => void;
  onDismiss: () => void;
  onRecordingChange?: (recording: boolean) => void;
  standaloneFull?: boolean;
  onCollapse?: () => void;
}) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const theme = getSproutTheme(dark);
  const full = standaloneFull;
  const visualFull = standaloneFull;
  const empty = !controller.isLoadingMessages && controller.activeMessages.length === 0;
  const [headerHeight, setHeaderHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const [recordingActive, setRecordingActive] = useState(false);
  const keyboardHeight = useKeyboardHeight();
  const localRetriesRef = useRef(new Map<string,
    | { kind: 'plan'; prompt: DecisionPrompt }
    | { kind: 'selection'; proposal: InventorySelectionProposal }
  >());
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

  const collapse = useCallback(() => onCollapse?.(), [onCollapse]);

  const keyboardOffset = useKeyboardOffset();
  // The footer pads for the home indicator, so the lift gives that padding back when the
  // keyboard covers it. Without this the composer would float a whole inset above the keys.
  // Only the full surface lifts its own composer: it fills the window, so nothing above it
  // can move out of the keyboard's way. The dock is already ridden up by its container —
  // lifting again here would double the offset and float the composer mid-screen.
  const composerLiftStyle = useAnimatedStyle(
    () => ({
      transform: [{
        translateY: full ? -Math.max(keyboardOffset.get() - insets.bottom, 0) : 0,
      }],
    }),
    [full, insets.bottom],
  );
  // The list's bottom inset is a plain layout number, so it can't read the animated
  // keyboard value, it has to track the same lift in JS or the transcript scrolls under
  // the lifted composer and the newest turn is unreachable.
  const composerLift = full ? Math.max(keyboardHeight - insets.bottom, 0) : 0;
  useToastAnchor('quick-chat-composer', true, footerHeight + composerLift);

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

  // The floating chrome belongs to the docked composer only. Once the transcript is on
  // screen the composer goes back to being the plain in-chat composer: full width, no
  // satellite buttons. The sheet's own grabber and backdrop close it from there.
  const docked = compact && !full;

  // One row above the docked composer: history on the left, the icon-only open-up button
  // dead centre. No title, no "Global chat" label — the surface is Sprout, saying so is noise.
  const actionsRow = docked ? (
    <View style={styles.dockActions} pointerEvents="box-none">
      <View style={styles.dockActionsSide} pointerEvents="box-none">
        {onShowHistory ? (
          <TouchableOpacity
            style={[
              styles.historyPill,
              dark && {
                backgroundColor: theme.chat.surface,
                borderWidth: 1,
                borderColor: theme.chat.border,
              },
            ]}
            onPress={onShowHistory}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Show chat history"
          >
            <History size={15} color={theme.chat.text} />
            <Text style={[styles.historyPillText, { color: theme.chat.text }]}>Chat history</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <ChatCircleButton
        icon={<Maximize2 size={17} color={theme.chat.text} />}
        onPress={onExpand}
        accessibilityLabel="Expand chat"
        dark={dark}
      />
      <View style={styles.dockActionsSide} pointerEvents="box-none" />
    </View>
  ) : null;

  // The composer pill, with close as its own circle beside it rather than a header button.
  const decisionPending = !!pendingPlan || !!pendingQuestion;
  const bottomStack = (
    <View onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}>
      {pendingPlan ? (
        <View style={styles.pendingCard}>
          <PlanCard
            prompt={pendingPlan}
            onDecision={handleDecision}
            submitting={!!controller.submittingDecisionId}
            dark={dark}
          />
        </View>
      ) : null}
      {pendingQuestion ? (
        <View style={styles.pendingCard}>
          <QuestionCard
            prompt={pendingQuestion}
            submitting={controller.answeringQuestion}
            onSubmit={(answers, other) => controller.submitAnswer(pendingQuestion, answers, other)}
            dark={dark}
          />
        </View>
      ) : null}
      {decisionPending ? null : actionsRow}
      {/* A pending card owns the turn: its buttons ARE the input. The composer and the
          white wash it sits on both stand down, or the seller is looking at two things
          that both look like the next step. */}
      {decisionPending ? null : (
      <ChatComposerFooter
        dark={dark}
        bottomPadding={(insets.bottom || 10) + 12}
        error={controller.error}
        onRetry={controller.onRefresh}
        notice={controller.notice}
        onDismissNotice={() => controller.setNotice(null)}
      >
        <View style={styles.composerRow}>
          <View style={styles.flex}>
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
              dark={dark}
            />
          </View>
          {docked ? (
            <ChatCircleButton
              icon={<X size={21} color={theme.chat.text} />}
              onPress={onDismiss}
              accessibilityLabel="Close chat"
              dark={dark}
            />
          ) : null}
        </View>
      </ChatComposerFooter>
      )}
    </View>
  );

  // Compact: the composer and nothing else. No wash, no header bar, no transcript, no
  // absolute fill — the screen underneath stays visible and tappable.
  if (docked) {
    return (
      <Animated.View style={composerLiftStyle} pointerEvents="box-none">
        <ConvexLiveMessages
          threadId={controller.activeThreadId}
          onMessages={controller.ingestLiveMessages}
        />
        {bottomStack}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.conversationSurface,
        full ? styles.fullConversationSurface : styles.sheetConversationSurface,
        standaloneFull ? styles.standaloneConversationSurface : null,
        { backgroundColor: theme.chat.background },
      ]}
    >
      <View style={styles.flex}>
        <ChatSurfaceWash dark={dark} />
        {/* Full screen keeps a header, for the status bar inset and the way back down.
            The peek sheet carries no header at all: its buttons live above the composer,
            where the seller's thumb already is. */}
        {visualFull ? (
          <ChatChromeHeader
            dark={dark}
            topInset={insets.top}
            onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}
            centerAction={{
              icon: <ChevronDown size={18} color={theme.chat.text} />,
              onPress: collapse,
              accessibilityLabel: 'Collapse chat',
            }}
          />
        ) : null}

        <ConvexLiveMessages
          threadId={controller.activeThreadId}
          onMessages={controller.ingestLiveMessages}
        />

        <View style={[styles.flex, { paddingTop: visualFull ? headerHeight : 6 }]}>
          <ConversationList
            dark={dark}
            messages={controller.activeMessages}
            loading={controller.isLoadingMessages}
            onDecision={handleDecision}
            onRetry={handleMessageRetry}
            onCancelQueued={controller.cancelQueuedMessage}
            onFeedback={controller.submitMessageFeedback}
            onFollowUp={sendSuggestion}
            onOpenCart={(sessionId: string) => {
              const origin = { screen: 'GlobalSproutChat', params: { returnToHomeOnClose: true } };
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
          {bottomStack}
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
                <Icon name={suggestion.icon} size={18} color="#93C822" />
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
  recordingWindowGlow: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  backdrop: {
    backgroundColor: sproutLightTheme.chat.backdrop,
  },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  // Composer-only: no card, no border, no shadow. The composer already has its own pill.
  dockCompact: {
    backgroundColor: 'transparent',
  },
  dockHost: {
    width: '100%',
  },
  dockActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  // Equal side slots keep the expand button dead-centred whatever the left slot holds.
  dockActionsSide: {
    flex: 1,
  },
  historyPill: {
    alignSelf: 'flex-start',
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: sproutLightTheme.chat.surface,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  historyPillText: {
    fontSize: 15,
    color: sproutLightTheme.chat.text,
    fontFamily: 'Inter_600SemiBold',
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  sheet: {
    backgroundColor: SHEET_TOP_WASH,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
    borderWidth: SHEET_BORDER,
    borderColor: sproutLightTheme.chat.sheetBorder,
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
    backgroundColor: sproutLightTheme.chat.grabber,
  },
  sheetHost: { flex: 1 },
  conversationSurface: {
    backgroundColor: sproutLightTheme.chat.background,
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
    backgroundColor: sproutLightTheme.chat.background,
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
    borderColor: sproutLightTheme.chat.border,
    backgroundColor: sproutLightTheme.chat.surface,
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
