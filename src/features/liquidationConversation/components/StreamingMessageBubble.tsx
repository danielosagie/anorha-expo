import React, { useContext, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { BRAND_PRIMARY } from '../../../design/tokens';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Check, Copy, Pause, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react-native';
import { AnorhaFace } from '../../../components/brand/AnorhaFace';
import Markdown from 'react-native-markdown-display';
import { HorizontalFadeScroll } from './HorizontalFadeScroll';
import type { ActivityPayload, CampaignItem, ChatJobCardMeta, ConversationMessage, DecisionPrompt } from '../types';
import { TimestampRevealContext } from './timestampReveal';
import ActivityCard from './activity/ActivityCard';
import { deriveActivities } from './activity/deriveActivities';
import { sanitizeDisplayText } from '../displayText';
import { useSystemNotifications } from '../../../context/SystemNotificationContext';
import { SproutDisclaimer } from './SproutDisclaimer';
import { DiaTextReveal } from '../../../components/DiaTextReveal';

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

const ACTION_HITSLOP = { top: 10, bottom: 10, left: 10, right: 10 };

// The control bar under a finished assistant reply — copy, retry, and a thumbs
// up/down. Bigger tap targets than before (the row was fiddly to hit). Copy grabs
// the whole message; retry re-asks the same prompt; the vote is recorded server-side
// via onFeedback (optimistic — the icon fills the instant you tap).
const MessageActions = ({
  text,
  messageId,
  onFeedback,
  narrationState,
  onToggleNarration,
}: {
  text: string;
  messageId: string;
  onFeedback?: (messageId: string, vote: 'up' | 'down' | null) => void;
  narrationState: 'idle' | 'loading' | 'playing' | 'paused';
  onToggleNarration?: (messageId: string, text: string, title?: string) => void;
}) => {
  const { showToast } = useSystemNotifications();
  const [copied, setCopied] = useState(false);
  const [vote, setVote] = useState<null | 'up' | 'down'>(null);
  const tap = () => Haptics.selectionAsync().catch(() => undefined);
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      tap();
      showToast({ title: 'Response copied', type: 'success', icon: 'check-circle-outline', duration: 1600 });
      setTimeout(() => setCopied(false), 1400);
    } catch {
      showToast({ title: 'Could not copy response', type: 'error', icon: 'alert-circle-outline', duration: 2000 });
    }
  };
  const castVote = (next: 'up' | 'down') => {
    tap();
    const resolved = vote === next ? null : next;
    setVote(resolved);
    onFeedback?.(messageId, resolved);
    showToast({
      title: resolved ? 'Feedback saved' : 'Feedback cleared',
      message: resolved === 'down' ? 'Thanks, this helps Sprout improve.' : undefined,
      type: 'success',
      icon: resolved ? 'check-circle-outline' : 'close-circle-outline',
      duration: 1700,
    });
  };
  return (
    <View style={styles.actionsRow}>
      <Pressable style={styles.actionIcon} onPress={copy} hitSlop={ACTION_HITSLOP} accessibilityRole="button" accessibilityLabel="Copy response">
        {copied
          ? <Check size={19} color="#5D7E16" strokeWidth={2.2} />
          : <Copy size={19} color="#9CA3AF" strokeWidth={2} />}
      </Pressable>
      <Pressable
        style={[styles.actionIcon, narrationState === 'playing' && styles.actionIconActive]}
        onPress={() => { tap(); onToggleNarration?.(messageId, text, 'Sprout response'); }}
        disabled={narrationState === 'loading' || !onToggleNarration}
        hitSlop={ACTION_HITSLOP}
        accessibilityRole="button"
        accessibilityLabel={narrationState === 'playing' ? 'Pause reading response' : 'Read response aloud'}
      >
        {narrationState === 'loading' ? (
          <ActivityIndicator size="small" color="#5D7E16" />
        ) : (
          narrationState === 'playing'
            ? <Pause size={20} color="#5D7E16" fill="#5D7E16" strokeWidth={2} />
            : <Volume2 size={20} color={narrationState === 'paused' ? '#5D7E16' : '#9CA3AF'} strokeWidth={2} />
        )}
      </Pressable>
      <Pressable
        style={styles.actionIcon}
        onPress={() => castVote('up')}
        hitSlop={ACTION_HITSLOP}
        accessibilityRole="button"
        accessibilityLabel="Helpful response"
      >
        <ThumbsUp size={19} color={vote === 'up' ? '#5D7E16' : '#9CA3AF'} fill={vote === 'up' ? '#5D7E16' : 'transparent'} strokeWidth={2} />
      </Pressable>
      <Pressable
        style={styles.actionIcon}
        onPress={() => castVote('down')}
        hitSlop={ACTION_HITSLOP}
        accessibilityRole="button"
        accessibilityLabel="Unhelpful response"
      >
        <ThumbsDown size={19} color={vote === 'down' ? '#52525B' : '#9CA3AF'} fill={vote === 'down' ? '#52525B' : 'transparent'} strokeWidth={2} />
      </Pressable>
    </View>
  );
};

// Markdown tables can be wider than the bubble (many columns). Wrap them in the same
// horizontal fade-scroller the document viewer uses so they extend right and hint "more →"
// instead of squishing every column to fit.
const TABLE_COLUMN_WIDTHS = [156, 90, 112, 220];
const tableColumnWidth = (index?: number) => TABLE_COLUMN_WIDTHS[index ?? 0] ?? 148;

const markdownRules = {
  table: (node: any, children: React.ReactNode) => (
    <HorizontalFadeScroll key={node.key} fadeColor="#FFFFFF" style={styles.mdTableScroll}>
      <View style={styles.mdTable}>{children}</View>
    </HorizontalFadeScroll>
  ),
  // Mobile tables need semantic column widths. Equal 108px cells forced long item
  // names and explanations into narrow vertical stacks, making every row enormous.
  th: (node: any, children: React.ReactNode) => (
    <View key={node.key} style={[styles.mdTableCell, styles.mdTableHeadCell, { width: tableColumnWidth(node.index) }]}>
      {children}
    </View>
  ),
  td: (node: any, children: React.ReactNode) => (
    <View key={node.key} style={[styles.mdTableCell, { width: tableColumnWidth(node.index) }]}>
      {children}
    </View>
  ),
  // Make the reply's text long-press selectable so the seller can grab part of a
  // message (not only the whole-message Copy button). textgroup wraps the text of
  // paragraphs, headings, list items and table cells, so one override covers them all.
  textgroup: (node: any, children: React.ReactNode, _parent: any, mdStyles: any) => (
    <Text key={node.key} style={mdStyles.textgroup} selectable>
      {children}
    </Text>
  ),
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

type AssistantBlock =
  | { type: 'text'; key: string; text: string }
  | { type: 'card'; key: string; payload: ActivityPayload };

// Snap a card's anchor to a line boundary so a text block never gets split mid-line
// (which would break markdown). At/after the end → render beneath the whole reply.
const clampAnchor = (text: string, anchor: number | undefined, len: number): number => {
  if (typeof anchor !== 'number' || anchor >= len) return len;
  if (anchor <= 0) return 0;
  if (text[anchor - 1] === '\n') return anchor;
  const nl = text.lastIndexOf('\n', anchor - 1);
  return nl >= 0 ? nl + 1 : anchor;
};

// Weave the reply text and its activity cards into one ordered list, so each card sits
// inline where the reply produced it (tool receipt up top, a diff mid-reply, the report
// beneath the closing line) — instead of every card stacked above the text.
const buildBlocks = (raw: string, activities: ActivityPayload[]): AssistantBlock[] => {
  const len = raw.length;
  if (!activities.length) return raw ? [{ type: 'text', key: 't0', text: raw }] : [];
  const placed = activities
    .map((a, i) => ({ a, i, at: clampAnchor(raw, a.anchor, len) }))
    .sort((x, y) => x.at - y.at || x.i - y.i);
  const blocks: AssistantBlock[] = [];
  let cursor = 0;
  placed.forEach(({ a, at }) => {
    if (at > cursor) {
      blocks.push({ type: 'text', key: `t${cursor}`, text: raw.slice(cursor, at) });
      cursor = at;
    }
    blocks.push({ type: 'card', key: a.id, payload: a });
  });
  if (cursor < len) blocks.push({ type: 'text', key: `t${cursor}`, text: raw.slice(cursor) });
  return blocks;
};

// One markdown text segment of an assistant reply (em-dashes stripped at render).
const TextBlock = ({ text, streaming, animationKey }: { text: string; streaming: boolean; animationKey: string }) => {
  const md = sanitizeDisplayText(text);
  if (!md.trim()) return null;
  if (streaming) {
    return (
      <DiaTextReveal
        text={md}
        style={styles.messageText}
        revealFrom="#FFFFFF"
        revealTo="#111827"
        duration={900}
        delay={0}
        animationKey={animationKey}
      />
    );
  }
  return (
    <MarkdownBoundary content={md}>
      <Markdown style={styles.markdown} rules={markdownRules}>{md}</Markdown>
    </MarkdownBoundary>
  );
};

// The assistant reply body: text and activity cards interleaved in reply order.
const AssistantBody = ({
  raw,
  activities,
  isStreaming,
  onOpenTray,
  onOpenItem,
  planItems,
}: {
  raw: string;
  activities: ActivityPayload[];
  isStreaming: boolean;
  onOpenTray?: (payload: ActivityPayload) => void;
  onOpenItem?: (productId: string) => void;
  planItems?: CampaignItem[];
}) => {
  const blocks = useMemo(() => buildBlocks(raw, activities), [raw, activities]);
  return (
    <>
      {blocks.map((b) =>
        b.type === 'card' ? (
          <ActivityCard
            key={b.key}
            payload={b.payload}
            streaming={isStreaming}
            onOpenTray={onOpenTray}
            onOpenItem={onOpenItem}
            planItems={planItems}
          />
        ) : (
          <TextBlock key={b.key} text={b.text} streaming={isStreaming} animationKey={b.key} />
        ),
      )}
    </>
  );
};

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
  /** Record a thumbs up/down on this reply (null clears it). */
  onFeedback?: (messageId: string, vote: 'up' | 'down' | null) => void;
  planItems?: CampaignItem[];
  showDisclaimer?: boolean;
  showFollowUps?: boolean;
  onFollowUp?: (prompt: string) => void;
  narrationState?: 'idle' | 'loading' | 'playing' | 'paused';
  onToggleNarration?: (messageId: string, text: string, title?: string) => void;
};

type FollowUpSuggestion = { label: string; prompt: string };

const normalizeFollowUps = (message: ConversationMessage, activities: ActivityPayload[]): FollowUpSuggestion[] => {
  const metadata = (message.metadata ?? {}) as any;
  const authored = metadata.followUps ?? metadata.follow_ups ?? metadata.suggestedQuestions;
  if (Array.isArray(authored)) {
    const normalized = authored
      .map((suggestion: unknown): FollowUpSuggestion | null => {
        if (typeof suggestion === 'string') {
          const label = suggestion.trim();
          return label ? { label, prompt: label } : null;
        }
        if (!suggestion || typeof suggestion !== 'object') return null;
        const record = suggestion as Record<string, unknown>;
        const label = typeof record.label === 'string'
          ? record.label.trim()
          : typeof record.question === 'string'
            ? record.question.trim()
            : '';
        const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : label;
        return label && prompt ? { label, prompt } : null;
      })
      .filter((suggestion: FollowUpSuggestion | null): suggestion is FollowUpSuggestion => !!suggestion)
      .slice(0, 3);
    if (normalized.length) return normalized;
  }

  const kinds = new Set(activities.map(activity => activity.kind));
  if (kinds.has('plan')) {
    return [
      { label: 'What is the biggest risk in this plan?', prompt: 'What is the biggest risk in this plan?' },
      { label: 'What would you change first?', prompt: 'What would you change first in this plan, and why?' },
    ];
  }
  if (kinds.has('document')) {
    return [
      { label: 'What matters most in this report?', prompt: 'What matters most in this report?' },
      { label: 'What should I do next?', prompt: 'Based on this report, what should I do next?' },
    ];
  }
  if (kinds.has('value-change') || kinds.has('publish')) {
    return [
      { label: 'Why did these values change?', prompt: 'Why did these values change?' },
      { label: 'What should I watch next?', prompt: 'What should I watch next after these changes?' },
    ];
  }

  const content = message.content.toLowerCase();
  if (content.includes('price') || content.includes('revenue') || content.includes('target')) {
    return [
      { label: 'Can we still hit the target?', prompt: 'Can we still hit the target?' },
      { label: 'Which item should move first?', prompt: 'Which item should move first, and why?' },
    ];
  }
  return [
    { label: 'What should I do next?', prompt: 'What should I do next?' },
    { label: 'What is the biggest risk?', prompt: 'What is the biggest risk right now?' },
  ];
};

const FollowUpPrompts = ({ suggestions, onPress }: { suggestions: FollowUpSuggestion[]; onPress: (prompt: string) => void }) => (
  <View style={styles.followUps} accessibilityLabel="Suggested follow-up questions">
    {suggestions.map((suggestion, index) => (
      <Pressable
        key={`${suggestion.label}-${index}`}
        style={({ pressed }) => [styles.followUpRow, pressed && styles.followUpRowPressed]}
        onPress={() => {
          Haptics.selectionAsync().catch(() => undefined);
          onPress(suggestion.prompt);
        }}
        accessibilityRole="button"
        accessibilityLabel={suggestion.label}
      >
        <Icon name="arrow-right" size={19} color="#A1A1AA" />
        <Text style={styles.followUpText}>{suggestion.label}</Text>
      </Pressable>
    ))}
  </View>
);

const StreamingMessageBubbleBase = ({ message, onDecision, onRetry, onOpenCart, onCancelQueued, onOpenTray, onOpenItem, onFeedback, planItems, showDisclaimer = false, showFollowUps = false, onFollowUp, narrationState = 'idle', onToggleNarration }: Props) => {
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

  // Assistant text is kept raw for interleaving because card anchors are offsets into it.
  // Display punctuation is normalized after blocks are placed.
  const assistantRaw = isUser ? '' : (message.content || '');
  const content = sanitizeDisplayText(isUser ? message.content : assistantRaw);
  // Render assistant text as markdown the WHOLE time, including mid-stream, so it
  // never shows raw ** ## - syntax. (Previously markdown only rendered once the
  // turn finished, so the seller watched raw markdown the entire response.)
  const renderMarkdown = !isUser && !!content;
  const jobCard = !isUser ? ((message.metadata as any)?.jobCard as ChatJobCardMeta | undefined) : undefined;
  // The inline activity cards (tool receipts, price/inventory diffs, routines).
  // deriveActivities keeps legacy toolSteps-only turns byte-identical to before.
  const activities = useMemo(() => deriveActivities(message, isStreaming), [message, isStreaming]);
  const followUps = useMemo(() => normalizeFollowUps(message, activities), [message, activities]);
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
            <AnorhaFace size={15} />
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

        {/* Attached photos render above the text, like iMessage — so the chat
            history shows what the seller (or agent) actually sent. */}
        {imageUrls.length ? <AttachedImages urls={imageUrls} /> : null}

        {isUser ? (
          content ? <Text selectable style={[styles.messageText, styles.userMessageText]}>{content}</Text> : null
        ) : (
          // The reply body: text and its activity cards (live pill, tool receipt,
          // price/status diffs, and the report card) INTERLEAVED in reply order —
          // a card sits inline where the reply produced it, or beneath the closing
          // line, instead of every card stacked above the text. Streams live as
          // deltas + tool steps arrive; deriveActivities keeps full back-compat.
          <AssistantBody
            raw={assistantRaw}
            activities={activities}
            isStreaming={isStreaming}
            onOpenTray={onOpenTray}
            onOpenItem={onOpenItem}
            planItems={planItems}
          />
        )}

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

        {/* The after-message control bar — only under a finished assistant reply. */}
        {!isUser && !isStreaming && !isFailed && renderMarkdown ? (
          <MessageActions
            text={content}
            messageId={message.serverMessageId || message.id}
            onFeedback={onFeedback}
            narrationState={narrationState}
            onToggleNarration={onToggleNarration}
          />
        ) : null}
        {!isUser && !isStreaming && !isFailed && renderMarkdown && showFollowUps && onFollowUp ? (
          <FollowUpPrompts suggestions={followUps} onPress={onFollowUp} />
        ) : null}
        {!isUser && !isStreaming && !isFailed && renderMarkdown && showDisclaimer ? <SproutDisclaimer /> : null}
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
    && prev.planItems === next.planItems
    && prev.showDisclaimer === next.showDisclaimer
    && prev.showFollowUps === next.showFollowUps
    && prev.onFollowUp === next.onFollowUp
    && prev.narrationState === next.narrationState
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
    fontSize: 15,
  },
  jobCardSub: {
    color: '#5D7E16',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
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
    width: '96%',
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
    fontSize: 12,
    textTransform: 'capitalize',
  },
  userActionMetaText: {
    color: '#E5E7EB',
  },
  messageText: {
    color: '#111827',
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 22,
  },
  markdown: {
    body: {
      color: '#111827',
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
      lineHeight: 22,
    },
    paragraph: {
      marginTop: 0,
      marginBottom: 8,
    },
    heading1: {
      fontFamily: 'Inter_700Bold',
      fontSize: 19,
      marginBottom: 10,
    },
    heading2: {
      fontFamily: 'Inter_700Bold',
      fontSize: 17,
      marginBottom: 8,
    },
    heading3: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 16,
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
      fontSize: 13,
    },
    code_block: {
      backgroundColor: '#0F172A',
      color: '#F8FAFC',
      borderRadius: 8,
      padding: 10,
      marginBottom: 8,
      fontFamily: 'Menlo',
      fontSize: 13,
    },
    fence: {
      backgroundColor: '#0F172A',
      color: '#F8FAFC',
      borderRadius: 8,
      padding: 10,
      marginBottom: 8,
      fontFamily: 'Menlo',
      fontSize: 13,
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
    // The `table` rule is overridden (markdownRules) to wrap in a fade-scroller; these
    // th/td get fixed widths so a wide table extends right instead of squishing to fit.
    thead: {
      backgroundColor: '#F9FAFB',
    },
    tr: {
      flexDirection: 'row',
    },
    th: {
      width: 108,
      padding: 6,
      borderRightWidth: 1,
      borderRightColor: '#E5E7EB',
      borderBottomWidth: 1,
      borderBottomColor: '#E5E7EB',
    },
    td: {
      width: 108,
      padding: 6,
      borderRightWidth: 1,
      borderRightColor: '#E5E7EB',
      borderBottomWidth: 1,
      borderBottomColor: '#E5E7EB',
    },
    th_text: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 13,
      color: '#111827',
    },
    td_text: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
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
    fontSize: 13,
    lineHeight: 19,
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
    fontSize: 14,
  },
  decisionBody: {
    marginTop: 4,
    color: '#6B7280',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
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
    fontSize: 13,
  },
  decisionSecondaryText: {
    color: '#111827',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
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
    fontSize: 13,
  },
  // After-message control bar (copy / retry / thumbs). Bigger, easier-to-hit targets.
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginLeft: -8,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconActive: { backgroundColor: 'rgba(147,200,34,0.12)' },
  followUps: {
    marginTop: 8,
  },
  followUpRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  followUpRowPressed: {
    opacity: 0.58,
  },
  followUpText: {
    flex: 1,
    color: '#27272A',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
  // Wide markdown tables — scroller wrapper + the bordered table container.
  mdTableScroll: {
    width: '100%',
    maxWidth: '100%',
    marginBottom: 8,
  },
  mdTable: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  mdTableCell: {
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  mdTableHeadCell: {
    backgroundColor: '#F9FAFB',
  },
});
