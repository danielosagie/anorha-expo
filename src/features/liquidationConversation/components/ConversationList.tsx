import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BRAND_PRIMARY } from '../../../design/tokens';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { StreamingMessageBubble } from './StreamingMessageBubble';
import { TimestampRevealContext } from './timestampReveal';
import ActivityTraySheet from './activity/ActivityTraySheet';
import { useActivityTray } from './activity/useActivityTray';
import type {
  ActivityPayload,
  CampaignItem,
  ConversationMessage,
  DecisionPrompt,
  InventorySelectionProposal,
  PlanPayload,
  ValueChange,
} from '../types';
import { useMessageNarration } from '../useMessageNarration';
import { useChatPreferences } from '../chatPreferences';

type MessageWithTime = ConversationMessage & { time: string };
const CHAT_SCROLL_BEHAVIOR = {
  startRenderingFromBottom: true,
  autoscrollToBottomThreshold: 0.2,
  animateAutoScrollToBottom: false,
} as const;

type Props = {
  messages: MessageWithTime[];
  planItems?: CampaignItem[];
  loading: boolean;
  onDecision: (prompt: DecisionPrompt, action: 'approve' | 'revise' | 'follow_up') => void;
  onRetry: (clientMessageId: string) => void;
  onOpenCart?: (sessionId: string) => void;
  onCancelQueued?: (clientMessageId: string) => void;
  /** Record a thumbs up/down on an assistant reply. */
  onFeedback?: (messageId: string, vote: 'up' | 'down' | null) => void;
  /** Ask one of the contextual questions shown under the latest reply. */
  onFollowUp?: (prompt: string) => void;
  /** Jump from an activity card / tray to the product it touched. */
  onOpenItem?: (productId: string) => void;
  /** Revert a value change from the review tray (optimistic). */
  onUndo?: (payload: ActivityPayload, change?: ValueChange) => Promise<void> | void;
  /** Pause / resume / edit / delete a routine or reminder from its tray. */
  onRoutineAction?: (id: string, action: 'pause' | 'resume' | 'edit' | 'delete' | 'cancel') => void;
  /** Send the seller's revision request for a report back to Sprout. */
  onReviseDocument?: (documentId: string, title: string, note: string) => void;
  /** Approve / Revise / Follow-up a proposed plan from its tray. */
  onApprovePlan?: (
    planId: string,
    action: 'approve' | 'revise' | 'follow_up',
    plan?: PlanPayload,
  ) => void;
  /** Move an open plan into the composer so the seller can describe a revision. */
  onEditPlan?: (plan: PlanPayload) => void;
  onResolveSelection?: (proposal: InventorySelectionProposal) => string[];
  onApplySelection?: (proposal: InventorySelectionProposal) => void;
  /** Pending plan mutation; disables repeat approval taps until it settles. */
  submittingDecisionId?: string | null;
  ListHeaderComponent?: React.ReactElement | null;
  /** Padding so the feed clears the floating glass header/footer. */
  contentTopInset?: number;
  contentBottomInset?: number;
  /** Scroll to a message selected from chat search. */
  scrollToMessageId?: string;
  scrollRequestKey?: number;
  ListEmptyComponent?: React.ReactElement | null;
  scrollEnabled?: boolean;
};

export const ConversationList = ({
  messages,
  planItems,
  loading,
  onDecision,
  onRetry,
  onOpenCart,
  onCancelQueued,
  onFeedback,
  onFollowUp,
  onOpenItem,
  onUndo,
  onRoutineAction,
  onReviseDocument,
  onApprovePlan,
  onEditPlan,
  onResolveSelection,
  onApplySelection,
  submittingDecisionId,
  ListHeaderComponent = null,
  contentTopInset,
  contentBottomInset,
  scrollToMessageId,
  scrollRequestKey,
  ListEmptyComponent,
  scrollEnabled = true,
}: Props) => {
  // One review-tray instance for the whole feed (hoisted here so FlashList
  // recycling can never unmount an open tray as its row scrolls off).
  const { openTray, trayProps } = useActivityTray();
  const { suggestedFollowUps } = useChatPreferences();
  const listRef = useRef<any>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const canJump = useMemo(() => messages.length > 2, [messages.length]);
  const { toggleNarration, playingMessageId, loadedMessageId, loadingMessageId } = useMessageNarration();
  const latestAssistantId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === 'assistant' && message.deliveryState !== 'streaming' && message.deliveryState !== 'failed') {
        return message.id;
      }
    }
    return null;
  }, [messages]);
  const nearBottomRef = useRef(true);
  const userDraggingRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const prevLenRef = useRef(0);
  const prevBottomRef = useRef(contentBottomInset ?? 0);
  const prevTailRef = useRef(0);

  // Coalesce all automatic pins into one frame. The old implementation forced three
  // scrolls per update, which visibly fought a seller dragging through history.
  const scrollToBottom = useCallback((animated: boolean) => {
    if (scrollFrameRef.current != null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => () => {
    if (scrollFrameRef.current != null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  useEffect(() => {
    if (!scrollToMessageId || loading) return;
    const index = messages.findIndex(message => message.id === scrollToMessageId);
    if (index < 0) return;
    const frame = requestAnimationFrame(() => {
      nearBottomRef.current = index >= messages.length - 2;
      setShowJumpToLatest(index < messages.length - 2);
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.22 });
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, messages, scrollRequestKey, scrollToMessageId]);

  const threadKey = messages[0]?.threadId ?? null;
  const autoScrollThreadRef = useRef<string | null>(threadKey);

  // iMessage-style swipe-left to reveal timestamps on the right.
  const dragX = useSharedValue(0);
  const revealPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-14, 14])
        .failOffsetY([-12, 12])
        .onChange(e => {
          'worklet';
          dragX.value = Math.max(-64, Math.min(0, dragX.value + e.changeX));
        })
        .onFinalize(() => {
          'worklet';
          dragX.value = withTiming(0, { duration: 180 });
        }),
    [dragX],
  );

  // Keep pinned to the bottom without flicker: stream deltas pin instantly
  // (animated:false), only a brand-new message gets a gentle animated scroll.
  // Also re-pin when the bottom inset grows (the keyboard opening pushes the feed up
  // via contentBottomInset) so the latest message stays visible above the lifted
  // composer — unless the seller has scrolled up to read history (showJumpToLatest).
  // A signal that grows as the LAST bubble streams in (text tokens, reasoning, tool steps)
  // even though messages.length stays the same — without this we never re-pin during a
  // response and its bottom scrolls out of view as it grows past the viewport.
  const tailGrowth = (() => {
    const last = messages[messages.length - 1];
    if (!last) return 0;
    const meta = (last.metadata ?? {}) as any;
    const steps = Array.isArray(meta.toolSteps) ? meta.toolSteps.length : 0;
    const reasoningLen = typeof meta.reasoning === 'string' ? meta.reasoning.length : 0;
    return (last.content?.length ?? 0) + reasoningLen + steps * 40;
  })();
  useEffect(() => {
    if (threadKey !== autoScrollThreadRef.current) {
      autoScrollThreadRef.current = threadKey;
      prevLenRef.current = messages.length;
      prevBottomRef.current = contentBottomInset ?? 0;
      prevTailRef.current = tailGrowth;
      nearBottomRef.current = true;
      setShowJumpToLatest(false);
      return;
    }
    if (!nearBottomRef.current || userDraggingRef.current) {
      prevLenRef.current = messages.length;
      prevBottomRef.current = contentBottomInset ?? 0;
      prevTailRef.current = tailGrowth;
      return;
    }
    const grew = messages.length > prevLenRef.current;
    const insetGrew = (contentBottomInset ?? 0) > prevBottomRef.current;
    const tailGrew = tailGrowth > prevTailRef.current; // streaming tokens grew the last bubble
    prevLenRef.current = messages.length;
    prevBottomRef.current = contentBottomInset ?? 0;
    prevTailRef.current = tailGrowth;
    if (grew || insetGrew || tailGrew) {
      // New message → gentle animated scroll; streaming growth → instant pin (no jank).
      scrollToBottom(grew);
    }
  }, [messages, contentBottomInset, tailGrowth, scrollToBottom, threadKey]);

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="small" color={BRAND_PRIMARY} />
        <Text style={styles.loadingText}>Loading messages...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TimestampRevealContext.Provider value={dragX}>
      <GestureDetector gesture={revealPan}>
      <FlashList
        key={threadKey ?? 'empty-thread'}
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        maintainVisibleContentPosition={CHAT_SCROLL_BEHAVIOR}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingTop: contentTopInset ?? 10,
          paddingBottom: contentBottomInset ?? 18,
        }}
        ListHeaderComponent={ListHeaderComponent}
        renderItem={({ item }) => (
          <StreamingMessageBubble
            message={item}
            onDecision={onDecision}
            onRetry={onRetry}
            onOpenCart={onOpenCart}
            onCancelQueued={onCancelQueued}
            onOpenTray={openTray}
            onOpenItem={onOpenItem}
            onFeedback={onFeedback}
            planItems={planItems}
            onResolveSelection={onResolveSelection}
            onApplySelection={onApplySelection}
            showDisclaimer={item.id === latestAssistantId}
            showFollowUps={suggestedFollowUps && item.id === latestAssistantId && messages[messages.length - 1]?.id === item.id}
            onFollowUp={onFollowUp}
            narrationState={
              loadingMessageId === item.id
                ? 'loading'
                : playingMessageId === item.id
                  ? 'playing'
                  : loadedMessageId === item.id
                    ? 'paused'
                    : 'idle'
            }
            onToggleNarration={(messageId, text) => toggleNarration({ messageId, text })}
          />
        )}
        ListEmptyComponent={ListEmptyComponent === undefined ? (
          <View style={styles.emptyState}>
            <Icon name="chat-outline" size={24} color="#71717A" />
            <Text style={styles.emptyTitle}>Start the conversation</Text>
            <Text style={styles.emptyText}>Ask the liquidation agent what to do next or trigger an action from Home.</Text>
          </View>
        ) : ListEmptyComponent}
        scrollEnabled={scrollEnabled}
        onScroll={({ nativeEvent }) => {
          const layoutHeight = nativeEvent.layoutMeasurement.height;
          const offsetY = nativeEvent.contentOffset.y;
          const contentHeight = nativeEvent.contentSize.height;
          const nearBottom = contentHeight - (layoutHeight + offsetY) < 120;
          nearBottomRef.current = nearBottom;
          setShowJumpToLatest((current) => current === !nearBottom ? current : !nearBottom);
        }}
        onScrollBeginDrag={() => { userDraggingRef.current = true; }}
        onScrollEndDrag={() => { userDraggingRef.current = false; }}
        onMomentumScrollEnd={() => { userDraggingRef.current = false; }}
        scrollEventThrottle={32}
      />
      </GestureDetector>
      </TimestampRevealContext.Provider>

      {showJumpToLatest && canJump ? (
        <TouchableOpacity
          style={styles.jumpButton}
          onPress={() => {
            nearBottomRef.current = true;
            setShowJumpToLatest(false);
            scrollToBottom(true);
          }}
          activeOpacity={0.85}
          accessibilityLabel="Jump to latest"
        >
          <Icon name="chevron-down" size={22} color="#18181B" />
        </TouchableOpacity>
      ) : null}

      {/* The single review tray for the whole feed — opened by any activity card. */}
      <ActivityTraySheet
        {...trayProps}
        planItems={planItems}
        onOpenItem={onOpenItem}
        onUndo={onUndo}
        onRoutineAction={onRoutineAction}
        onReviseDocument={onReviseDocument}
        onApprovePlan={onApprovePlan}
        onEditPlan={onEditPlan}
        submittingPlanId={submittingDecisionId}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 18,
  },
  loadingWrap: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#71717A',
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  emptyState: {
    marginTop: 80,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: '#111827',
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  emptyText: {
    maxWidth: 260,
    textAlign: 'center',
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
  },
  // Small circular down-arrow bubble (iMessage/Claude-style), floats bottom-right above
  // the composer. White with a hairline + soft shadow to match the app's calm surfaces.
  jumpButton: {
    position: 'absolute',
    right: 16,
    bottom: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
});
