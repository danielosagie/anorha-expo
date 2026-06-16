import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BRAND_PRIMARY } from '../../../design/tokens';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { StreamingMessageBubble } from './StreamingMessageBubble';
import { TimestampRevealContext } from './timestampReveal';
import type { ConversationMessage, DecisionPrompt } from '../types';

type MessageWithTime = ConversationMessage & { time: string };

type Props = {
  messages: MessageWithTime[];
  loading: boolean;
  onDecision: (prompt: DecisionPrompt, action: 'approve' | 'revise' | 'follow_up') => void;
  onRetry: (clientMessageId: string) => void;
  onOpenCart?: (sessionId: string) => void;
  onCancelQueued?: (clientMessageId: string) => void;
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
  ListHeaderComponent = null,
  contentTopInset,
  contentBottomInset,
}: Props) => {
  const listRef = useRef<any>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const canJump = useMemo(() => messages.length > 2, [messages.length]);

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
  useEffect(() => {
    if (showJumpToLatest) {
      prevLenRef.current = messages.length;
      prevBottomRef.current = contentBottomInset ?? 0;
      return;
    }
    const grew = messages.length > prevLenRef.current;
    const insetGrew = (contentBottomInset ?? 0) > prevBottomRef.current;
    prevLenRef.current = messages.length;
    prevBottomRef.current = contentBottomInset ?? 0;
    if (grew || insetGrew) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: grew }));
    }
  }, [messages, showJumpToLatest, contentBottomInset]);

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
        renderItem={({ item }) => (
          <StreamingMessageBubble message={item} onDecision={onDecision} onRetry={onRetry} onOpenCart={onOpenCart} onCancelQueued={onCancelQueued} />
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
        <TouchableOpacity style={styles.jumpButton} onPress={() => listRef.current?.scrollToEnd({ animated: true })}>
          <Icon name="arrow-down" size={14} color="#FFFFFF" />
          <Text style={styles.jumpButtonText}>Latest</Text>
        </TouchableOpacity>
      ) : null}
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
  jumpButton: {
    position: 'absolute',
    right: 18,
    bottom: 12,
    borderRadius: 16,
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  jumpButtonText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
});
