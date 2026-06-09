import React, { useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Markdown from 'react-native-markdown-display';
import type { ConversationMessage, DecisionPrompt } from '../types';
import { TimestampRevealContext } from './timestampReveal';

const TypingDot = ({ delay }: { delay: number }) => {
  const progress = useSharedValue(0.3);
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 520, easing: Easing.inOut(Easing.ease) }), -1, true),
    );
  }, [delay, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.65,
    transform: [{ scale: 0.85 + progress.value * 0.2 }],
  }));
  return <Animated.View style={[styles.typingDot, style]} />;
};

const TypingIndicator = () => (
  <View style={styles.typingRow}>
    <TypingDot delay={0} />
    <TypingDot delay={140} />
    <TypingDot delay={280} />
  </View>
);

type MessageWithTime = ConversationMessage & { time: string };

type Props = {
  message: MessageWithTime;
  onDecision: (prompt: DecisionPrompt, action: 'approve' | 'revise' | 'follow_up') => void;
  onRetry: (clientMessageId: string) => void;
};

export const StreamingMessageBubble = ({ message, onDecision, onRetry }: Props) => {
  const [cursorVisible, setCursorVisible] = useState(true);
  const isUser = message.role === 'user';
  const isStreaming = message.deliveryState === 'streaming';
  const isFailed = message.deliveryState === 'failed';

  const dragX = useContext(TimestampRevealContext);
  const revealRowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dragX?.value ?? 0 }] }));
  const revealTimeStyle = useAnimatedStyle(() => ({ opacity: dragX ? Math.min(1, -dragX.value / 46) : 0 }));

  useEffect(() => {
    if (!isStreaming) {
      setCursorVisible(false);
      return;
    }
    const timer = setInterval(() => {
      setCursorVisible(prev => !prev);
    }, 420);
    return () => clearInterval(timer);
  }, [isStreaming]);

  const statusLabel = useMemo(() => {
    if (message.kind === 'action') {
      return message.actionMeta?.status === 'completed'
        ? 'Action complete'
        : message.actionMeta?.status === 'failed'
          ? 'Action failed'
          : 'Running action';
    }
    if (message.deliveryState === 'queued') return 'Queued';
    if (message.deliveryState === 'sending') return 'Sending';
    if (message.deliveryState === 'streaming') return 'Streaming';
    if (message.deliveryState === 'failed') return 'Failed';
    return null;
  }, [message.actionMeta?.status, message.deliveryState, message.kind]);

  // Safety net: the seller wants no em dashes in chat. Strip them from assistant
  // text in case the model slips one in.
  const content = isUser
    ? message.content
    : (message.content || '').replace(/\s*[—]\s*/g, ', ').replace(/[–]/g, '-');
  const renderMarkdown = !isUser && !isStreaming;

  return (
    <Animated.View entering={FadeIn.duration(180)} style={[styles.row, isUser ? styles.rowRight : styles.rowLeft, revealRowStyle]}>
      <Animated.Text style={[styles.revealTime, revealTimeStyle]} numberOfLines={1}>{message.time}</Animated.Text>
      <View style={[styles.card, message.kind === 'action' ? styles.actionCard : isUser ? styles.userCard : styles.assistantCard]}>
        {message.kind === 'action' ? (
          <View style={styles.actionMetaRow}>
            <Icon name="flash-outline" size={13} color="#5D7E16" />
            <Text style={styles.actionMetaText}>
              {message.actionMeta?.actionType?.replace(/_/g, ' ') || 'Action'}
            </Text>
          </View>
        ) : null}

        {!isUser && isStreaming && !content ? (
          <TypingIndicator />
        ) : renderMarkdown ? (
          <Markdown style={styles.markdown}>{content}</Markdown>
        ) : (
          <Text style={[styles.messageText, isUser && styles.userMessageText]}>
            {content}
            {!isUser && isStreaming && cursorVisible ? <Text style={styles.cursor}>|</Text> : null}
          </Text>
        )}

        {message.actionMeta?.summary ? (
          <Text style={styles.summaryText}>{message.actionMeta.summary}</Text>
        ) : null}

        {statusLabel ? <Text style={styles.statusText}>{statusLabel}</Text> : null}

        {!isUser && message.decisionPrompt ? (
          <View style={styles.decisionCard}>
            <Text style={styles.decisionTitle}>{message.decisionPrompt.title}</Text>
            {message.decisionPrompt.description ? (
              <Text style={styles.decisionBody}>{message.decisionPrompt.description}</Text>
            ) : null}
            <View style={styles.decisionActions}>
              <TouchableOpacity
                style={[styles.decisionButton, styles.decisionPrimary]}
                onPress={() => onDecision(message.decisionPrompt!, 'approve')}
              >
                <Text style={styles.decisionPrimaryText}>{message.decisionPrompt.approveLabel || 'Approve'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.decisionButton}
                onPress={() => onDecision(message.decisionPrompt!, 'revise')}
              >
                <Text style={styles.decisionSecondaryText}>{message.decisionPrompt.reviseLabel || 'Revise'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.decisionButton}
                onPress={() => onDecision(message.decisionPrompt!, 'follow_up')}
              >
                <Text style={styles.decisionSecondaryText}>{message.decisionPrompt.followUpLabel || 'Follow-up'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {isFailed && message.clientMessageId ? (
          <TouchableOpacity style={styles.retryButton} onPress={() => onRetry(message.clientMessageId!)}>
            <Icon name="refresh" size={13} color="#EF4444" />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  row: {
    width: '100%',
    marginBottom: 10,
  },
  rowLeft: {
    alignItems: 'flex-start',
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  card: {
    maxWidth: '86%',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  assistantCard: {
    maxWidth: '96%',
    backgroundColor: 'transparent',
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  userCard: {
    backgroundColor: '#F0F0F3',
  },
  actionCard: {
    backgroundColor: '#FBFBFA',
    borderWidth: 1,
    borderColor: '#ECEBE6',
  },
  actionMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  actionMetaText: {
    color: '#5D7E16',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    textTransform: 'capitalize',
  },
  userActionMetaText: {
    color: '#E5E7EB',
  },
  messageText: {
    color: '#111827',
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  markdown: {
    body: {
      color: '#111827',
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      lineHeight: 20,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 8,
    },
    heading1: {
      fontFamily: 'Inter_700Bold',
      fontSize: 18,
      marginBottom: 10,
    },
    heading2: {
      fontFamily: 'Inter_700Bold',
      fontSize: 16,
      marginBottom: 8,
    },
    heading3: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 15,
      marginBottom: 6,
    },
    strong: {
      fontFamily: 'Inter_700Bold',
    },
    em: {
      fontFamily: 'Inter_500Medium',
      fontStyle: 'italic',
    },
    bullet_list: {
      marginBottom: 8,
    },
    ordered_list: {
      marginBottom: 8,
    },
    list_item: {
      flexDirection: 'row',
      marginBottom: 4,
    },
    bullet_list_icon: {
      marginRight: 6,
    },
    ordered_list_icon: {
      marginRight: 6,
    },
    code_inline: {
      backgroundColor: '#F3F4F6',
      color: '#111827',
      borderRadius: 4,
      paddingHorizontal: 4,
      paddingVertical: 2,
      fontFamily: 'Menlo',
      fontSize: 12,
    },
    code_block: {
      backgroundColor: '#0F172A',
      color: '#F8FAFC',
      borderRadius: 8,
      padding: 10,
      marginBottom: 8,
      fontFamily: 'Menlo',
      fontSize: 12,
    },
    fence: {
      backgroundColor: '#0F172A',
      color: '#F8FAFC',
      borderRadius: 8,
      padding: 10,
      marginBottom: 8,
      fontFamily: 'Menlo',
      fontSize: 12,
    },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: '#D1D5DB',
      paddingLeft: 10,
      color: '#4B5563',
      marginBottom: 8,
    },
    link: {
      color: '#2563EB',
    },
    table: {
      borderWidth: 1,
      borderColor: '#E5E7EB',
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: 8,
    },
    thead: {
      backgroundColor: '#F9FAFB',
    },
    tr: {
      flexDirection: 'row',
    },
    th: {
      flex: 1,
      padding: 6,
      borderRightWidth: 1,
      borderRightColor: '#E5E7EB',
      borderBottomWidth: 1,
      borderBottomColor: '#E5E7EB',
    },
    td: {
      flex: 1,
      padding: 6,
      borderRightWidth: 1,
      borderRightColor: '#E5E7EB',
      borderBottomWidth: 1,
      borderBottomColor: '#E5E7EB',
    },
    th_text: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 12,
      color: '#111827',
    },
    td_text: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      color: '#111827',
    },
  } as any,
  userMessageText: {
    color: '#18181B',
  },
  summaryText: {
    marginTop: 8,
    color: '#4B5563',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  userSummaryText: {
    color: '#D1D5DB',
  },
  footerRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timeText: {
    color: '#9CA3AF',
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  userTimeText: {
    color: '#D1D5DB',
  },
  statusText: {
    color: '#A1A1AA',
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    marginTop: 6,
  },
  cursor: {
    color: '#93C822',
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#93C822',
  },
  revealTime: {
    position: 'absolute',
    right: -52,
    top: 14,
    width: 46,
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: '#9CA3AF',
  },
  decisionCard: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 12,
  },
  decisionTitle: {
    color: '#111827',
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  decisionBody: {
    marginTop: 4,
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  decisionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  decisionButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  decisionPrimary: {
    borderColor: '#93C822',
    backgroundColor: 'rgba(147,200,34,0.12)',
  },
  decisionPrimaryText: {
    color: '#5D7E16',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  decisionSecondaryText: {
    color: '#111827',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  retryButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  retryText: {
    color: '#EF4444',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
});
