import React, { useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BRAND_PRIMARY } from '../../../design/tokens';
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
import type { ChatJobCardMeta, ConversationMessage, DecisionPrompt } from '../types';
import { TimestampRevealContext } from './timestampReveal';

// A tappable cart card the agent drops in after turning photos into draft listings.
// Tapping it opens the AddProduct cart hydrated from the quick-scan session.
const ChatJobCard = ({ card, onOpen }: { card: ChatJobCardMeta; onOpen?: (sessionId: string) => void }) => (
  <TouchableOpacity
    style={styles.jobCard}
    activeOpacity={0.85}
    disabled={!onOpen}
    onPress={() => card.sessionId && onOpen?.(card.sessionId)}
  >
    {card.coverImageUrl ? (
      <Image source={{ uri: card.coverImageUrl }} style={styles.jobCardImage} />
    ) : (
      <View style={[styles.jobCardImage, styles.jobCardImageFallback]}>
        <Icon name="image-multiple-outline" size={20} color="#5D7E16" />
      </View>
    )}
    <View style={styles.jobCardBody}>
      <Text style={styles.jobCardTitle} numberOfLines={1}>
        {card.title || (card.itemCount === 1 ? 'New item' : `${card.itemCount} items`)}
      </Text>
      <Text style={styles.jobCardSub} numberOfLines={1}>
        {card.itemCount} item{card.itemCount === 1 ? '' : 's'} · tap to review and publish
      </Text>
    </View>
    <Icon name="chevron-right" size={22} color="#9CA3AF" />
  </TouchableOpacity>
);

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

// Rendering partial markdown on every stream delta is normally safe, but a
// half-written table/fence can occasionally throw inside the markdown renderer.
// Without a boundary that crash takes down the whole chat list (the user reported
// the chat "crashing"). Catch it, fall back to plain text, and retry once more
// tokens arrive.
class MarkdownBoundary extends React.Component<
  { content: string; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidUpdate(prev: { content: string }) {
    if (prev.content !== this.props.content && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  render() {
    if (this.state.hasError) {
      return <Text style={styles.messageText}>{this.props.content}</Text>;
    }
    return this.props.children as React.ReactElement;
  }
}

type MessageWithTime = ConversationMessage & { time: string };

type ToolStep = { tool: string; label: string; status?: string; durationMs?: number };

// Icon per tool family for the step items (reference: Slack/Gmail-style step rows).
const toolStepIcon = (tool: string): string => {
  const t = (tool || '').toLowerCase();
  if (t.includes('query') || t.startsWith('supabase')) return 'database-outline';
  if (t.includes('search') || t.includes('research')) return 'magnify';
  if (t.includes('price')) return 'tag-outline';
  if (t.includes('publish') || t.includes('delist') || t.includes('listing')) return 'storefront-outline';
  if (t.includes('text') || t.includes('sms')) return 'message-text-outline';
  if (t.includes('email')) return 'email-outline';
  if (t.includes('note')) return 'note-text-outline';
  if (t.includes('reminder')) return 'bell-outline';
  if (t.includes('campaign')) return 'rocket-launch-outline';
  if (t.includes('slow')) return 'trending-down';
  return 'cog-outline';
};

// Collapsible "activity" card — the agent's reasoning + the tools it ran, shown
// the way Poke/Claude surface their work: a tidy header you can fold away, with
// one clean row per step. Arguments/SQL never reach here (arg-free by contract),
// so rows are non-tappable except the Reasoning trace, which expands inline.
const ToolActivityCard = ({
  steps,
  reasoning,
  streaming,
}: {
  steps: ToolStep[];
  reasoning?: string;
  streaming: boolean;
}) => {
  const hasReasoning = !!(reasoning && reasoning.trim().length);
  const count = steps.length;
  // Collapsed by default — the header (Working · N / N steps · Xs) is enough at a
  // glance; tap to open the step list. Keeps the chat feeling like a chat.
  const [expanded, setExpanded] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);

  if (!count && !hasReasoning) return null;

  const totalMs = steps.reduce((sum, s) => sum + (typeof s.durationMs === 'number' ? s.durationMs : 0), 0);
  const totalSecs = totalMs > 0 ? (totalMs / 1000).toFixed(1) : null;
  const summary = count > 0
    ? `${count} step${count === 1 ? '' : 's'}${totalSecs ? ` · ${totalSecs}s` : ''}`
    : 'Thinking';

  return (
    <View style={styles.activityCard}>
      {/* Quiet summary line — no loud icon; just status, a count, and a fold toggle. */}
      <TouchableOpacity style={styles.activityHeader} onPress={() => setExpanded(e => !e)} activeOpacity={0.6}>
        {streaming ? (
          <ActivityIndicator size="small" color="#9CA3AF" style={styles.activitySpinner} />
        ) : null}
        <Text style={styles.activityHeaderText}>
          {streaming ? `Working${count ? ` · ${count}` : ''}` : summary}
        </Text>
        <View style={styles.activitySpacer} />
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color="#C4C4CC" />
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.activityBody}>
          {hasReasoning ? (
            <>
              <TouchableOpacity style={styles.activityRow} onPress={() => setShowReasoning(s => !s)} activeOpacity={0.7}>
                <View style={styles.activityIconChip}>
                  <Icon name="lightbulb-on-outline" size={13} color="#5D7E16" />
                </View>
                <Text style={styles.activityRowLabel}>Reasoning</Text>
                <View style={styles.activitySpacer} />
                <Text style={styles.activityRowMeta}>{reasoning!.trim().length} chars</Text>
                <Icon name={showReasoning ? 'chevron-up' : 'chevron-right'} size={14} color="#C4C4CC" />
              </TouchableOpacity>
              {showReasoning ? <Text style={styles.reasoningText}>{reasoning!.trim()}</Text> : null}
            </>
          ) : null}

          {steps.map((step, index) => (
            <Animated.View key={`${step.tool}-${index}`} entering={FadeIn.duration(180)} style={styles.activityRow}>
              <View style={[styles.activityIconChip, step.status === 'failed' && styles.activityIconChipFail]}>
                <Icon
                  name={toolStepIcon(step.tool)}
                  size={13}
                  color={step.status === 'failed' ? '#D04848' : '#5D7E16'}
                />
              </View>
              <Text style={styles.activityRowLabel} numberOfLines={1}>{step.label}</Text>
              {step.status === 'failed' ? <Text style={styles.activityRowFail}>failed</Text> : null}
              <View style={styles.activitySpacer} />
              {typeof step.durationMs === 'number' && step.durationMs > 0 ? (
                <Text style={styles.activityRowMeta}>{(step.durationMs / 1000).toFixed(1)}s</Text>
              ) : null}
            </Animated.View>
          ))}
        </View>
      ) : null}
    </View>
  );
};

type Props = {
  message: MessageWithTime;
  onDecision: (prompt: DecisionPrompt, action: 'approve' | 'revise' | 'follow_up') => void;
  onRetry: (clientMessageId: string) => void;
  onOpenCart?: (sessionId: string) => void;
};

const StreamingMessageBubbleBase = ({ message, onDecision, onRetry, onOpenCart }: Props) => {
  const isUser = message.role === 'user';
  const isStreaming = message.deliveryState === 'streaming';
  const isFailed = message.deliveryState === 'failed';

  const dragX = useContext(TimestampRevealContext);
  const revealRowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dragX?.value ?? 0 }] }));
  const revealTimeStyle = useAnimatedStyle(() => ({ opacity: dragX ? Math.min(1, -dragX.value / 46) : 0 }));
  const [digestOpen, setDigestOpen] = useState(false);
  const isDigest = !isUser && (message.metadata as any)?.kind === 'digest';

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
  // Render assistant text as markdown the WHOLE time, including mid-stream, so it
  // never shows raw ** ## - syntax. (Previously markdown only rendered once the
  // turn finished, so the seller watched raw markdown the entire response.)
  const renderMarkdown = !isUser && !!content;
  const toolSteps = (!isUser && Array.isArray((message.metadata as any)?.toolSteps)
    ? (message.metadata as any).toolSteps as ToolStep[]
    : []);
  const reasoning = !isUser ? ((message.metadata as any)?.reasoning as string | undefined) : undefined;
  const jobCard = !isUser ? ((message.metadata as any)?.jobCard as ChatJobCardMeta | undefined) : undefined;

  // Digest / watch-cycle check-ins live in the feed but stay folded by default so
  // they don't crowd the conversation. Tap to expand.
  if (isDigest) {
    return (
      <Animated.View style={[styles.row, styles.rowLeft, revealRowStyle]}>
        <View style={[styles.card, styles.assistantCard, { backgroundColor: '#F4F9E8', borderColor: '#E4EFC9', borderWidth: 0.5 }]}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            activeOpacity={0.7}
            onPress={() => setDigestOpen(o => !o)}
          >
            <Icon name="leaf" size={14} color="#3B6D11" />
            <Text style={{ flex: 1, fontSize: 13, color: '#3B6D11', fontFamily: 'Inter_600SemiBold' }}>Sprout check-in</Text>
            <Icon name={digestOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#7A9B3C" />
          </TouchableOpacity>
          <Text
            numberOfLines={digestOpen ? undefined : 1}
            style={{ marginTop: digestOpen ? 8 : 4, fontSize: digestOpen ? 14 : 13, color: digestOpen ? '#3B5314' : '#5F7A2E', fontFamily: 'Inter_400Regular', lineHeight: 20 }}
          >
            {content}
          </Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft, revealRowStyle]}>
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

        {/* Reasoning + tool steps, folded into one collapsible activity card.
            Tool rows appear only once each RESULT lands (arg-free by contract). */}
        {!isUser ? (
          <ToolActivityCard steps={toolSteps} reasoning={reasoning} streaming={isStreaming} />
        ) : null}

        {jobCard?.sessionId ? (
          <ChatJobCard card={jobCard} onOpen={onOpenCart} />
        ) : null}

        {isUser ? (
          <Text style={[styles.messageText, styles.userMessageText]}>{content}</Text>
        ) : renderMarkdown ? (
          // Stream the reply live: render the partial markdown as deltas arrive
          // (content accumulates via appendAssistantDelta). The typing bubble only
          // shows BEFORE the first token, while the agent is still working or calling
          // tools (the activity card above shows those steps as they land).
          <MarkdownBoundary content={content}>
            <Markdown style={styles.markdown}>{content}</Markdown>
          </MarkdownBoundary>
        ) : isStreaming ? (
          <TypingIndicator />
        ) : null}

        {message.actionMeta?.summary ? (
          <Text style={styles.summaryText}>{message.actionMeta.summary}</Text>
        ) : null}

        {/* Only surface status on actions or failures. The old code printed
            "Streaming"/"Sending" under every bubble, which read as noise. */}
        {statusLabel && (message.kind === 'action' || isFailed) ? (
          <Text style={styles.statusText}>{statusLabel}</Text>
        ) : null}

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

// Memoized: activeMessages rebuilds every message object on each stream delta,
// so we compare the display-relevant fields and skip re-rendering bubbles that
// did not actually change. This is what stops the whole list from flickering
// while the assistant streams.
export const StreamingMessageBubble = React.memo(StreamingMessageBubbleBase, (prev, next) => {
  const a = prev.message;
  const b = next.message;
  // Tool steps and reasoning arrive as metadata updates WITHOUT changing content,
  // so they must be in the equality check or the activity card never updates live.
  const aSteps = (a.metadata as any)?.toolSteps as any[] | undefined;
  const bSteps = (b.metadata as any)?.toolSteps as any[] | undefined;
  return (
    a.id === b.id &&
    a.content === b.content &&
    a.deliveryState === b.deliveryState &&
    a.time === b.time &&
    a.kind === b.kind &&
    a.actionMeta?.status === b.actionMeta?.status &&
    a.actionMeta?.summary === b.actionMeta?.summary &&
    a.decisionPrompt === b.decisionPrompt &&
    (aSteps?.length || 0) === (bSteps?.length || 0) &&
    ((a.metadata as any)?.reasoning || '') === ((b.metadata as any)?.reasoning || '') &&
    ((a.metadata as any)?.jobCard?.sessionId || '') === ((b.metadata as any)?.jobCard?.sessionId || '')
  );
});

const styles = StyleSheet.create({
  row: {
    width: '100%',
    marginBottom: 10,
  },
  jobCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: '#F4F7EC',
    borderWidth: 1,
    borderColor: '#E2EAD0',
    minWidth: 220,
  },
  jobCardImage: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
  },
  jobCardImageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobCardBody: {
    flex: 1,
    minWidth: 0,
  },
  jobCardTitle: {
    color: '#1F2937',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  jobCardSub: {
    color: '#5D7E16',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: 2,
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
    color: BRAND_PRIMARY,
  },
  // ── Collapsible activity card (reasoning + tool steps) ──────────────
  activityCard: {
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: '#FAFAF7',
    borderWidth: 1,
    borderColor: '#ECEBE6',
    overflow: 'hidden',
    // Hug the content (a tidy pill) instead of stretching the full bubble width.
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  activityHeaderText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.1,
  },
  activitySpacer: {
    flex: 1,
  },
  activitySpinner: {
    transform: [{ scale: 0.7 }],
    marginRight: 2,
  },
  activityBody: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    paddingTop: 2,
    gap: 7,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  activityIconChip: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(147,200,34,0.14)',
  },
  activityIconChipFail: {
    backgroundColor: 'rgba(208,72,72,0.12)',
  },
  activityRowLabel: {
    fontSize: 12.5,
    color: '#3F3F46',
    fontFamily: 'Inter_500Medium',
    flexShrink: 1,
  },
  activityRowMeta: {
    fontSize: 11,
    color: '#A1A1AA',
    fontFamily: 'Inter_500Medium',
  },
  activityRowFail: {
    fontSize: 11,
    color: '#D04848',
    fontFamily: 'Inter_600SemiBold',
  },
  reasoningText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#71717A',
    fontFamily: 'Inter_400Regular',
    paddingLeft: 31,
    paddingRight: 4,
  },
  toolStepsBlock: {
    marginBottom: 8,
    gap: 6,
  },
  toolStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolStepLabel: {
    flexShrink: 1,
    fontSize: 12.5,
    fontWeight: '600',
    color: '#6B7280',
  },
  toolStepFailedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D04848',
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
    borderColor: BRAND_PRIMARY,
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
