import React, { useContext, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BRAND_PRIMARY } from '../../../design/tokens';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Markdown from 'react-native-markdown-display';
import type { ActivityPayload, ChatJobCardMeta, ConversationMessage, DecisionPrompt } from '../types';
import { TimestampRevealContext } from './timestampReveal';
import ActivityCard from './activity/ActivityCard';
import { deriveActivities } from './activity/deriveActivities';

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

// Photos the seller attached to a message (or the agent posted), shown as
// thumbnails in the bubble so the chat history actually shows what was sent.
const AttachedImages = ({ urls }: { urls: string[] }) => {
  if (!urls.length) return null;
  const single = urls.length === 1;
  return (
    <View style={styles.attachedRow}>
      {urls.slice(0, 6).map((uri, i) => (
        <Image
          key={`${uri}-${i}`}
          source={{ uri }}
          style={[styles.attachedImage, single && styles.attachedImageSingle]}
          resizeMode="cover"
        />
      ))}
    </View>
  );
};

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

type Props = {
  message: MessageWithTime;
  onDecision: (prompt: DecisionPrompt, action: 'approve' | 'revise' | 'follow_up') => void;
  onRetry: (clientMessageId: string) => void;
  onOpenCart?: (sessionId: string) => void;
  onCancelQueued?: (clientMessageId: string) => void;
  /** Open the review tray for a tapped activity card (price change, routine, etc.). */
  onOpenTray?: (payload: ActivityPayload) => void;
  /** Jump from an activity to the product it touched. */
  onOpenItem?: (productId: string) => void;
};

const StreamingMessageBubbleBase = ({ message, onDecision, onRetry, onOpenCart, onCancelQueued, onOpenTray, onOpenItem }: Props) => {
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
  const jobCard = !isUser ? ((message.metadata as any)?.jobCard as ChatJobCardMeta | undefined) : undefined;
  // The inline activity cards (tool receipts, price/inventory diffs, routines).
  // deriveActivities keeps legacy toolSteps-only turns byte-identical to before.
  const activities = useMemo(() => deriveActivities(message, isStreaming), [message, isStreaming]);
  const imageUrls = Array.isArray(message.imageUrls)
    ? message.imageUrls.filter((u): u is string => typeof u === 'string' && !!u)
    : [];

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

        {/* The inline activity cards for the turn: a quiet live "working on it"
            pill, the foldable tool receipt (legacy turns render exactly as before),
            and the tappable price/inventory/status diff + routine cards that open
            the review tray. deriveActivities decides which, with full back-compat. */}
        {!isUser && activities.length > 0
          ? activities.map((a) => (
              <ActivityCard
                key={a.id}
                payload={a}
                streaming={isStreaming}
                onOpenTray={onOpenTray}
                onOpenItem={onOpenItem}
              />
            ))
          : null}

        {/* Attached photos render above the text, like iMessage — so the chat
            history shows what the seller (or agent) actually sent. */}
        {imageUrls.length ? <AttachedImages urls={imageUrls} /> : null}

        {isUser ? (
          content ? <Text style={[styles.messageText, styles.userMessageText]}>{content}</Text> : null
        ) : renderMarkdown ? (
          // Stream the reply live: render the partial markdown as deltas arrive
          // (content accumulates via appendAssistantDelta). The typing bubble only
          // shows BEFORE the first token, while the agent is still working or calling
          // tools (the activity card above shows those steps as they land).
          <MarkdownBoundary content={content}>
            <Markdown style={styles.markdown}>{content}</Markdown>
          </MarkdownBoundary>
        ) : null}

        {/* The tappable cart card sits BELOW the agent's message response (the seller
            reads the value check first, then taps to review the draft listing). */}
        {jobCard?.sessionId ? (
          <View style={styles.jobCardWrap}>
            <ChatJobCard card={jobCard} onOpen={onOpenCart} />
          </View>
        ) : null}

        {/* Queued/sending state for messages the seller lined up while Sprout was responding.
            A still-queued message can be pulled back with the ✕ before it's sent. */}
        {isUser && (message.deliveryState === 'queued' || message.deliveryState === 'sending') ? (
          <View style={styles.queuedRow}>
            <Text style={styles.queuedText}>
              {message.deliveryState === 'queued' ? 'Queued' : 'Sending…'}
            </Text>
            {message.deliveryState === 'queued' && onCancelQueued && message.clientMessageId ? (
              <TouchableOpacity
                onPress={() => onCancelQueued(message.clientMessageId!)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="close-circle" size={15} color="rgba(255,255,255,0.75)" />
              </TouchableOpacity>
            ) : null}
          </View>
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
  // Tool steps, reasoning, and structured activities arrive as metadata updates
  // WITHOUT changing content, so they must be in the equality check or the
  // activity cards never update live as a turn streams in.
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
    activitySignature(a.metadata) === activitySignature(b.metadata) &&
    ((a.metadata as any)?.jobCard?.sessionId || '') === ((b.metadata as any)?.jobCard?.sessionId || '') &&
    (a.imageUrls?.join('|') || '') === (b.imageUrls?.join('|') || '')
  );
});

// Cheap signature of the structured activity payloads, so a card re-renders when
// a diff value, a status, or a routine's paused state changes mid-stream.
function activitySignature(metadata: ConversationMessage['metadata']): string {
  const meta = (metadata ?? {}) as any;
  const acts = Array.isArray(meta.activities) ? meta.activities : [];
  const actSig = acts
    .map((x: any) => {
      const c = x?.changes?.[0];
      return `${x?.kind || ''}:${x?.status || ''}:${c ? `${c.from ?? ''}>${c.to ?? ''}` : ''}:${x?.routine?.paused ? 1 : 0}`;
    })
    .join('|');
  // Tool steps carry `changes` when a diff streams in (a reprice/publish promoted
  // to a value-change card). Fold them in so the bubble re-renders as it lands.
  const steps = Array.isArray(meta.toolSteps) ? meta.toolSteps : [];
  const stepSig = steps
    .map((s: any) => {
      const c = s?.changes?.[0];
      return `${s?.status || ''}:${s?.changes?.length || 0}:${c ? `${c.from ?? ''}>${c.to ?? ''}` : ''}`;
    })
    .join('|');
  const routineSig = meta.routine ? `r:${meta.routine.id || ''}:${meta.routine.paused ? 1 : 0}` : '';
  return `${acts.length}#${actSig}#${routineSig}#${steps.length}@${stepSig}`;
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    marginBottom: 10,
  },
  jobCardWrap: {
    marginTop: 8,
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
  attachedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  attachedImage: {
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: '#E5E7EB',
  },
  attachedImageSingle: {
    width: 200,
    height: 200,
    maxWidth: '100%',
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
  queuedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    marginTop: 5,
  },
  queuedText: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  cursor: {
    color: BRAND_PRIMARY,
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
