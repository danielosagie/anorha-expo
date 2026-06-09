import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { StreamingMessageBubble } from './StreamingMessageBubble';
import type { ConversationMessage, DecisionPrompt } from '../types';

type MessageWithTime = ConversationMessage & { time: string };

type Props = {
  messages: MessageWithTime[];
  loading: boolean;
  onDecision: (prompt: DecisionPrompt, action: 'approve' | 'revise' | 'follow_up') => void;
  onRetry: (clientMessageId: string) => void;
  ListHeaderComponent?: React.ReactElement | null;
};

export const ConversationList = ({
  messages,
  loading,
  onDecision,
  onRetry,
  ListHeaderComponent = null,
}: Props) => {
  const listRef = useRef<any>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const canJump = useMemo(() => messages.length > 2, [messages.length]);

  useEffect(() => {
    if (!showJumpToLatest) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages, showJumpToLatest]);

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="small" color="#93C822" />
        <Text style={styles.loadingText}>Loading messages...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlashList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.clientMessageId || item.serverMessageId || item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={ListHeaderComponent}
        renderItem={({ item }) => (
          <StreamingMessageBubble message={item} onDecision={onDecision} onRetry={onRetry} />
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
