import React, { useState, useEffect } from 'react';
import { Text } from 'react-native';

export interface StreamingTextProps {
    text: string;
    style?: any;
    speed?: number;
    startDelay?: number;
    onComplete?: () => void;
    shouldStream?: boolean;
}

/**
 * Types text in character-by-character. When `shouldStream` is false it renders the
 * full text instantly (and still fires `onComplete` once). Shared by the chat insight
 * card and the home greeting so "streaming" happens ONLY when there's genuinely
 * something new to show — never a replay on remount or navigation back.
 */
export const StreamingText: React.FC<StreamingTextProps> = React.memo(({
    text,
    style,
    speed = 20,
    startDelay = 0,
    onComplete,
    shouldStream = true,
}) => {
    const [displayedText, setDisplayedText] = useState('');
    const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
    const completedRef = React.useRef(false);
    const lastTextRef = React.useRef<string>('');

    useEffect(() => {
        // Only restart animation if text actually changed.
        if (lastTextRef.current === text && displayedText.length > 0) {
            return;
        }
        lastTextRef.current = text;

        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);
        completedRef.current = false;

        if (!shouldStream) {
            setDisplayedText(text);
            if (!completedRef.current) {
                completedRef.current = true;
                onComplete?.();
            }
            return;
        }

        setDisplayedText('');
        let charIndex = 0;

        timeoutRef.current = setTimeout(() => {
            intervalRef.current = setInterval(() => {
                if (charIndex < text.length) {
                    setDisplayedText(text.slice(0, charIndex + 1));
                    charIndex++;
                } else {
                    if (intervalRef.current) clearInterval(intervalRef.current);
                    if (!completedRef.current) {
                        completedRef.current = true;
                        onComplete?.();
                    }
                }
            }, speed);
        }, startDelay);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [text, shouldStream, speed, startDelay]); // onComplete intentionally excluded to prevent loops

    return <Text style={style}>{displayedText}</Text>;
});

export default StreamingText;
