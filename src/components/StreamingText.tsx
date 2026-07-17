import React, { useCallback, useEffect, useRef } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';
import { DiaTextReveal } from './DiaTextReveal';

export interface StreamingTextProps {
    text: string;
    style?: StyleProp<TextStyle>;
    speed?: number;
    startDelay?: number;
    onComplete?: () => void;
    shouldStream?: boolean;
    revealFrom?: string;
    revealTo?: string;
    numberOfLines?: number;
}

/**
 * Reveals new text with the same left-to-right color sweep used by live tool work.
 * When `shouldStream` is false it renders instantly, so navigation never replays it.
 */
export const StreamingText: React.FC<StreamingTextProps> = React.memo(({
    text,
    style,
    speed = 20,
    startDelay = 0,
    onComplete,
    shouldStream = true,
    revealFrom = 'rgba(255,255,255,0.16)',
    revealTo,
    numberOfLines,
}) => {
    const completedKeyRef = useRef<string | null>(null);
    const complete = useCallback(() => {
        if (completedKeyRef.current === text) return;
        completedKeyRef.current = text;
        onComplete?.();
    }, [onComplete, text]);

    useEffect(() => {
        if (!shouldStream && completedKeyRef.current !== text) {
            const completion = setTimeout(() => {
                complete();
            }, 0);
            return () => clearTimeout(completion);
        }
        return undefined;
    }, [complete, shouldStream, text]);

    if (!shouldStream) return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;

    const resolvedColor = revealTo ?? StyleSheet.flatten(style)?.color;
    const duration = Math.min(1400, Math.max(520, text.length * Math.max(3, speed * 0.15)));
    return (
        <DiaTextReveal
            text={text}
            style={style}
            numberOfLines={numberOfLines}
            revealFrom={revealFrom}
            revealTo={typeof resolvedColor === 'string' ? resolvedColor : '#111827'}
            duration={duration}
            delay={startDelay}
            animationKey={text}
            onComplete={complete}
        />
    );
});

export default StreamingText;
