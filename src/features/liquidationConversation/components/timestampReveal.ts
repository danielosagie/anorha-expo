import { createContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';

/**
 * Drives the iMessage-style "swipe the thread left to reveal per-message
 * timestamps on the right" gesture. ConversationList owns the shared value;
 * each StreamingMessageBubble reads it to translate and reveal its time.
 * Value range: 0 (rest) to -64 (fully revealed).
 */
export const TimestampRevealContext = createContext<SharedValue<number> | null>(null);
