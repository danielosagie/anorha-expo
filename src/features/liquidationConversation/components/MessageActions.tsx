import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Check, Copy, Pause, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react-native';
import { useSystemNotifications } from '../../../context/SystemNotificationContext';

export type NarrationState = 'idle' | 'loading' | 'playing' | 'paused';

type MessageActionsProps = {
  text: string;
  messageId: string;
  onFeedback?: (messageId: string, vote: 'up' | 'down' | null) => void;
  narrationState: NarrationState;
  onToggleNarration?: (messageId: string, text: string, title?: string) => void;
  tintColor?: string;
  upActiveColor?: string;
  downActiveColor?: string;
  narrationActiveColor?: string;
  activeBackgroundColor?: string;
  style?: StyleProp<ViewStyle>;
};

const ACTION_HITSLOP = { top: 10, bottom: 10, left: 10, right: 10 };

export function MessageActions({
  text,
  messageId,
  onFeedback,
  narrationState,
  onToggleNarration,
  tintColor = '#9CA3AF',
  upActiveColor = '#5D7E16',
  downActiveColor = '#52525B',
  narrationActiveColor = '#5D7E16',
  activeBackgroundColor = 'rgba(147,200,34,0.12)',
  style,
}: MessageActionsProps) {
  const { showToast } = useSystemNotifications();
  const [copied, setCopied] = useState(false);
  const [vote, setVote] = useState<null | 'up' | 'down'>(null);

  useEffect(() => {
    setCopied(false);
    setVote(null);
  }, [messageId]);

  const tap = () => Haptics.selectionAsync().catch(() => undefined);
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      tap();
      showToast({
        title: 'Response copied',
        type: 'success',
        icon: 'check-circle-outline',
        duration: 1600,
      });
      setTimeout(() => setCopied(false), 1400);
    } catch {
      showToast({
        title: 'Could not copy response',
        type: 'error',
        icon: 'alert-circle-outline',
        duration: 2000,
      });
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
    <View style={[styles.actionsRow, style]}>
      <Pressable
        style={styles.actionIcon}
        onPress={copy}
        hitSlop={ACTION_HITSLOP}
        accessibilityRole="button"
        accessibilityLabel="Copy response"
      >
        {copied
          ? <Check size={19} color={upActiveColor} strokeWidth={2.2} />
          : <Copy size={19} color={tintColor} strokeWidth={2} />}
      </Pressable>
      <Pressable
        style={[
          styles.actionIcon,
          narrationState === 'playing' && { backgroundColor: activeBackgroundColor },
        ]}
        onPress={() => {
          tap();
          onToggleNarration?.(messageId, text, 'Sprout response');
        }}
        disabled={narrationState === 'loading' || !onToggleNarration}
        hitSlop={ACTION_HITSLOP}
        accessibilityRole="button"
        accessibilityLabel={
          narrationState === 'playing'
            ? 'Pause reading response'
            : 'Read response aloud'
        }
      >
        {narrationState === 'loading' ? (
          <ActivityIndicator size="small" color={narrationActiveColor} />
        ) : narrationState === 'playing' ? (
          <Pause
            size={20}
            color={narrationActiveColor}
            fill={narrationActiveColor}
            strokeWidth={2}
          />
        ) : (
          <Volume2
            size={20}
            color={narrationState === 'paused' ? narrationActiveColor : tintColor}
            strokeWidth={2}
          />
        )}
      </Pressable>
      <Pressable
        style={styles.actionIcon}
        onPress={() => castVote('up')}
        hitSlop={ACTION_HITSLOP}
        accessibilityRole="button"
        accessibilityLabel="Helpful response"
      >
        <ThumbsUp
          size={19}
          color={vote === 'up' ? upActiveColor : tintColor}
          fill={vote === 'up' ? upActiveColor : 'transparent'}
          strokeWidth={2}
        />
      </Pressable>
      <Pressable
        style={styles.actionIcon}
        onPress={() => castVote('down')}
        hitSlop={ACTION_HITSLOP}
        accessibilityRole="button"
        accessibilityLabel="Unhelpful response"
      >
        <ThumbsDown
          size={19}
          color={vote === 'down' ? downActiveColor : tintColor}
          fill={vote === 'down' ? downActiveColor : 'transparent'}
          strokeWidth={2}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
