import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { NarrationPlayer } from '../components/NarrationPlayer';
import { useSystemNotifications } from './SystemNotificationContext';

type ToggleNarrationInput = {
  messageId: string;
  text: string;
};

type NarrationContextValue = {
  toggleNarration: (input: ToggleNarrationInput) => Promise<void>;
  playingMessageId: string | null;
  loadedMessageId: string | null;
  loadingMessageId: null;
};

type Session = {
  messageId: string;
  text: string;
  playing: boolean;
  elapsedSeconds: number;
  totalSeconds: number;
  speed: number;
};

type NarrationPlayerContextValue = {
  session: Session | null;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seekBy: (deltaSeconds: number) => Promise<void>;
  changeSpeed: () => Promise<void>;
  clear: () => Promise<void>;
};

const SPEEDS = [1, 1.25, 1.5, 0.75] as const;
const NarrationContext = createContext<NarrationContextValue | null>(null);
const NarrationPlayerContext = createContext<NarrationPlayerContextValue | null>(null);

function narrationText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' Code block omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[|*_>~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.min(Speech.maxSpeechInputLength, 6000));
}

function estimateDuration(text: string, speed: number) {
  const words = Math.max(1, text.split(/\s+/).length);
  return Math.max(1, (words / (165 * speed)) * 60);
}

function snapToWordStart(text: string, index: number) {
  let cursor = Math.max(0, Math.min(text.length - 1, Math.floor(index)));
  while (cursor > 0 && !/\s/.test(text[cursor - 1])) cursor -= 1;
  return cursor;
}

export const NarrationProvider = ({ children }: { children: ReactNode }) => {
  const { showToast } = useSystemNotifications();
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const generationRef = useRef(0);
  const currentCharRef = useRef(0);
  const segmentOffsetRef = useRef(0);
  const elapsedAnchorRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);

  const commitSession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const elapsedNow = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return 0;
    const running = current.playing && startedAtRef.current != null
      ? (Date.now() - startedAtRef.current) / 1000
      : 0;
    return Math.min(current.totalSeconds, elapsedAnchorRef.current + running);
  }, []);

  const clear = useCallback(async () => {
    generationRef.current += 1;
    startedAtRef.current = null;
    currentCharRef.current = 0;
    segmentOffsetRef.current = 0;
    elapsedAnchorRef.current = 0;
    commitSession(null);
    await Speech.stop();
  }, [commitSession]);

  const startAt = useCallback(async (
    messageId: string,
    text: string,
    characterIndex: number,
    elapsedSeconds: number,
    speed: number,
  ) => {
    generationRef.current += 1;
    const generation = generationRef.current;
    await Speech.stop();
    await setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: 'duckOthers',
      playsInSilentMode: true,
      shouldPlayInBackground: true,
    });

    const offset = snapToWordStart(text, characterIndex);
    const totalSeconds = estimateDuration(text, speed);
    currentCharRef.current = offset;
    segmentOffsetRef.current = offset;
    elapsedAnchorRef.current = Math.min(totalSeconds, Math.max(0, elapsedSeconds));
    startedAtRef.current = Date.now();
    commitSession({ messageId, text, playing: true, elapsedSeconds, totalSeconds, speed });

    Speech.speak(text.slice(offset), {
      language: 'en-US',
      rate: Math.min(1.5, 0.94 * speed),
      pitch: 1,
      useApplicationAudioSession: true,
      onBoundary: (event: { charIndex: number }) => {
        if (generationRef.current !== generation) return;
        currentCharRef.current = segmentOffsetRef.current + Number(event.charIndex || 0);
      },
      onDone: () => {
        if (generationRef.current === generation) void clear();
      },
      onStopped: () => {
        if (generationRef.current === generation) void clear();
      },
      onError: () => {
        if (generationRef.current !== generation) return;
        void clear();
        showToast({ title: 'Could not read this response', type: 'error', duration: 1900 });
      },
    });
  }, [clear, commitSession, showToast]);

  const pause = useCallback(async () => {
    const current = sessionRef.current;
    if (!current?.playing) return;
    const elapsedSeconds = elapsedNow();
    generationRef.current += 1;
    startedAtRef.current = null;
    elapsedAnchorRef.current = elapsedSeconds;
    commitSession({ ...current, playing: false, elapsedSeconds });
    await Speech.stop();
  }, [commitSession, elapsedNow]);

  const resume = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.playing) return;
    await startAt(
      current.messageId,
      current.text,
      currentCharRef.current,
      elapsedAnchorRef.current,
      current.speed,
    );
  }, [startAt]);

  const toggleNarration = useCallback(async ({ messageId, text }: ToggleNarrationInput) => {
    const current = sessionRef.current;
    if (current?.messageId === messageId) {
      if (current.playing) await pause();
      else await resume();
      return;
    }

    const cleaned = narrationText(text);
    if (!cleaned) {
      showToast({ title: 'Nothing to read', type: 'error', duration: 1700 });
      return;
    }
    await startAt(messageId, cleaned, 0, 0, 1);
  }, [pause, resume, showToast, startAt]);

  const seekBy = useCallback(async (deltaSeconds: number) => {
    const current = sessionRef.current;
    if (!current) return;
    const target = Math.max(0, Math.min(current.totalSeconds - 0.25, elapsedNow() + deltaSeconds));
    const targetCharacter = snapToWordStart(
      current.text,
      (target / current.totalSeconds) * current.text.length,
    );
    currentCharRef.current = targetCharacter;
    elapsedAnchorRef.current = target;

    if (current.playing) {
      await startAt(current.messageId, current.text, targetCharacter, target, current.speed);
    } else {
      commitSession({ ...current, elapsedSeconds: target });
    }
  }, [commitSession, elapsedNow, startAt]);

  const changeSpeed = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    const index = SPEEDS.indexOf(current.speed as (typeof SPEEDS)[number]);
    const speed = SPEEDS[(index + 1) % SPEEDS.length];
    const progress = current.text.length > 0 ? currentCharRef.current / current.text.length : 0;
    const totalSeconds = estimateDuration(current.text, speed);
    const elapsedSeconds = Math.min(totalSeconds, progress * totalSeconds);
    elapsedAnchorRef.current = elapsedSeconds;

    if (current.playing) {
      await startAt(
        current.messageId,
        current.text,
        currentCharRef.current,
        elapsedSeconds,
        speed,
      );
    } else {
      commitSession({ ...current, speed, totalSeconds, elapsedSeconds });
    }
  }, [commitSession, startAt]);

  useEffect(() => {
    if (!session?.playing) return undefined;
    const timer = setInterval(() => {
      const current = sessionRef.current;
      if (!current?.playing) return;
      setSession({ ...current, elapsedSeconds: elapsedNow() });
    }, 500);
    return () => clearInterval(timer);
  }, [elapsedNow, session?.playing]);

  useEffect(() => () => {
    generationRef.current += 1;
    void Speech.stop();
  }, []);

  const value = useMemo<NarrationContextValue>(() => ({
    toggleNarration,
    playingMessageId: session?.playing ? session.messageId : null,
    loadedMessageId: session && !session.playing ? session.messageId : null,
    loadingMessageId: null,
  }), [session, toggleNarration]);
  const playerValue = useMemo<NarrationPlayerContextValue>(() => ({
    session,
    pause,
    resume,
    seekBy,
    changeSpeed,
    clear,
  }), [changeSpeed, clear, pause, resume, seekBy, session]);

  return (
    <NarrationContext.Provider value={value}>
      <NarrationPlayerContext.Provider value={playerValue}>
        {children}
      </NarrationPlayerContext.Provider>
    </NarrationContext.Provider>
  );
};

// The playback session stays global so narration can continue with the screen
// locked. Only a chat screen mounts these controls, so the bar never follows the
// seller onto Home or another workflow.
export function NarrationPlayerHost() {
  const player = useContext(NarrationPlayerContext);
  if (!player) throw new Error('NarrationPlayerHost must be used within NarrationProvider');

  const { session, pause, resume, seekBy, changeSpeed, clear } = player;
  return (
    <NarrationPlayer
      visible={!!session}
      playing={!!session?.playing}
      elapsedSeconds={session?.elapsedSeconds ?? 0}
      speed={session?.speed ?? 1}
      onTogglePlayback={() => { void (session?.playing ? pause() : resume()); }}
      onSeekBack={() => { void seekBy(-15); }}
      onSeekForward={() => { void seekBy(15); }}
      onChangeSpeed={() => { void changeSpeed(); }}
      onClose={() => { void clear(); }}
    />
  );
}

export function useNarration() {
  const context = useContext(NarrationContext);
  if (!context) throw new Error('useNarration must be used within NarrationProvider');
  return context;
}
