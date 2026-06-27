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
import type { ActivityPayload, ConversationMessage, DecisionPrompt, ValueChange } from '../types';

type MessageWithTime = ConversationMessage & { time: string };

type Props = {
  messages: MessageWithTime[];
  loading: boolean;
  onDecision: (prompt: DecisionPrompt, action: 'approve' | 'revise' | 'follow_up') => void;
  onRetry: (clientMessageId: string) => void;
  onOpenCart?: (sessionId: string) => void;
  onCancelQueued?: (clientMessageId: string) => void;
  /** Jump from an activity card / tray to the product it touched. */
  onOpenItem?: (productId: string) => void;
  /** Revert a value change from the review tray (optimistic). */
  onUndo?: (payload: ActivityPayload, change?: ValueChange) => Promise<void> | void;
  /** Pause / resume / edit / delete a routine or reminder from its tray. */
  onRoutineAction?: (id: string, action: 'pause' | 'resume' | 'edit' | 'delete' | 'cancel') => void;
  ListHeaderComponent?: React.ReactElement | null;
  /** Padding so the feed clears the floating glass header/footer. */
  contentTopInset?: number;
  contentBottomInset?: number;
};

export const ConversationList = ({
  messages,
  loading,
  onDecision,
  onRetry,
  onOpenCart,
  onCancelQueued,
  onOpenItem,
  onUndo,
  onRoutineAction,
  ListHeaderComponent = null,
  contentTopInset,
  contentBottomInset,
}: Props) => {
  // One review-tray instance for the whole feed (hoisted here so FlashList
  // recycling can never unmount an open tray as its row scrolls off).
  const { openTray, trayProps } = useActivityTray();
  const listRef = useRef<any>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const canJump = useMemo(() => messages.length > 2, [messages.length]);

  // FlashList can need a couple frames after content lands before scrollToEnd settles
  // on the true bottom; nudge it across a few frames so the chat always OPENS at the
  // latest message instead of the top.
  const scrollToBottom = useCallback((animated: boolean) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
    setTimeout(() => listRef.current?.scrollToEnd({ animated }), 120);
    setTimeout(() => listRef.current?.scrollToEnd({ animated }), 320);
  }, []);

  // Land at the bottom on first open AND whenever the thread switches (the list stays
  // mounted across thread switches, so a fresh thread would otherwise stay scrolled
  // wherever the last one was). Keyed off the rendered thread.
  const threadKey = messages[0]?.threadId ?? null;
  const didInitialScrollRef = useRef(false);
  const prevThreadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (threadKey !== prevThreadKeyRef.current) {
      prevThreadKeyRef.current = threadKey;
      didInitialScrollRef.current = false;
    }
  }, [threadKey]);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    if (loading || !messages.length) return;
    didInitialScrollRef.current = true;
    prevLenRef.current = messages.length;
    setShowJumpToLatest(false);
    scrollToBottom(false);
  }, [loading, messages.length, scrollToBottom]);

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
  const prevLenRef = useRef(0);
  const prevBottomRef = useRef(contentBottomInset ?? 0);
  const prevTailRef = useRef(0);
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
    if (showJumpToLatest) {
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
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: grew }));
    }
  }, [messages, showJumpToLatest, contentBottomInset, tailGrowth]);

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
        ref={listRef}
        data={messages}
        keyExtractor={item => item.clientMessageId || item.serverMessageId || item.id}
        contentContainerStyle={{
          paddingHorizontal: 12,
          paddingTop: contentTopInset ?? 10,
          paddingBottom: contentBottomInset ?? 18,
        }}
        ListHeaderComponent={ListHeaderComponent}
        onLoad={() => {
          // FlashList finished its first real layout — make sure we're pinned to the
          // newest message (this fires after content is measured, so scrollToEnd lands).
          if (messages.length && !showJumpToLatest) scrollToBottom(false);
        }}
        renderItem={({ item }) => (
          <StreamingMessageBubble
            message={item}
            onDecision={onDecision}
            onRetry={onRetry}
            onOpenCart={onOpenCart}
            onCancelQueued={onCancelQueued}
            onOpenTray={openTray}
            onOpenItem={onOpenItem}
          />
        )}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <Icon name="chat-outline" size={24} color="#71717A" />
            <Text style={styles.emptyTitle}>Start the conversation</Text>
            <Text style={styles.emptyText}>Ask the liquidation agent what to do next or trigger an action from Home.</Text>
          </View>
        )}
        onScroll={({ nativeEvent }) => {
          const layoutHeight = nativeEvent.layoutMeasurement.height;
          const offsetY = nativeEvent.contentOffset.y;
          const contentHeight = nativeEvent.contentSize.height;
          const nearBottom = contentHeight - (layoutHeight + offsetY) < 120;
          setShowJumpToLatest(!nearBottom);
        }}
      />
      </GestureDetector>
      </TimestampRevealContext.Provider>

      {showJumpToLatest && canJump ? (
        <TouchableOpacity
          style={styles.jumpButton}
          onPress={() => { setShowJumpToLatest(false); scrollToBottom(true); }}
          activeOpacity={0.85}
          accessibilityLabel="Jump to latest"
        >
          <Icon name="chevron-down" size={22} color="#18181B" />
        </TouchableOpacity>
      ) : null}

      {/* The single review tray for the whole feed — opened by any activity card. */}
      <ActivityTraySheet
        {...trayProps}
        onOpenItem={onOpenItem}
        onUndo={onUndo}
        onRoutineAction={onRoutineAction}
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
    fontSize: 13,
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
    fontSize: 15,
  },
  emptyText: {
    maxWidth: 260,
    textAlign: 'center',
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
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
