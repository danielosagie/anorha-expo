import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, Image, PanResponder, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { Plus, ArrowRight, AudioLines, X, Check, Clock } from 'lucide-react-native';
import { API_BASE_URL } from '../../config/env';
import { persistPendingVoice, getPendingVoice, clearPendingVoice, fileExists } from '../../features/liquidationConversation/pendingVoice';

// The reusable chat composer (extracted from the liquidation conversation). Rounded pill,
// image attach, tap/hold push-to-talk voice → transcribe + append. Use it anywhere a
// chat-style input is wanted (chat, the Generate Details "wanna change something" tray, etc.).
type Props = {
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  onSend: (photos?: string[]) => void;
  queuedCount: number;
  isStreaming: boolean;
  /** Returns a Supabase JWT for the transcription request. */
  getAuthToken?: () => Promise<string | null>;
  /** Transcription endpoint path (appended to API_BASE_URL). */
  transcriptionPath?: string;
  /** Max images that can be attached. */
  maxImages?: number;
  /** Focus the input on mount (e.g. when revealed from a collapsed button). */
  autoFocus?: boolean;
};

const BRAND = '#93C822';
const FONT = { medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold' };

const SCREEN_H = Dimensions.get('window').height;
// Static base amplitudes for the push-to-talk waveform bars (animated by pulse).
const WAVE_BARS = Array.from({ length: 50 }, (_, i) => 0.35 + 0.5 * Math.abs(Math.sin(i * 0.9)));

export const MessageComposer = ({
  value,
  placeholder,
  onChangeText,
  onSend,
  queuedCount,
  isStreaming,
  getAuthToken,
  transcriptionPath = '/api/audio/transcribe',
  maxImages = 8,
  autoFocus = false,
}: Props) => {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [imageUris, setImageUris] = useState<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Latest draft/setter so transcription appends correctly even on crash-resume.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChangeText);
  onChangeRef.current = onChangeText;
  const resumedRef = useRef(false);
  const pulse = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  // Push-to-talk: hold the mic → an iMessage-style takeover (dark gradient +
  // waveform). Release sends (transcribe + append); slide up to cancel.
  const [holding, setHolding] = useState(false);
  const [cancelArmedView, setCancelArmedView] = useState(false);
  const holdAnim = useRef(new Animated.Value(0)).current;
  const pressStart = useRef(0);
  const cancelArmed = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginRef = useRef<() => void>(() => {});
  const endRef = useRef<() => void>(() => {});
  const HOLD_MS = 220;
  const CANCEL_DY = -80;

  // Created once; its handlers call beginRef/endRef which are refreshed each
  // render, so they always run the latest closures (no stale `value`).
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => beginRef.current(),
      onPanResponderMove: (_e, g) => {
        const c = g.dy < CANCEL_DY;
        if (c !== cancelArmed.current) {
          cancelArmed.current = c;
          setCancelArmedView(c);
        }
      },
      onPanResponderRelease: () => endRef.current(),
      onPanResponderTerminate: () => endRef.current(),
    }),
  ).current;

  const hasText = value.trim().length > 0;
  const canSend = hasText || imageUris.length > 0;

  const tap = (s: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) =>
    Haptics.impactAsync(s).catch(() => undefined);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
  }, []);

  const attach = useCallback(async () => {
    tap();
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsMultipleSelection: true,
        selectionLimit: maxImages,
      });
      if (!res.canceled && res.assets?.length) {
        setImageUris(prev => [...prev, ...res.assets.map(a => a.uri)].slice(0, maxImages));
      }
    } catch {
      /* ignore */
    }
  }, [maxImages]);

  const startWave = () => {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.4, duration: 450, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
    );
    pulseLoop.current.start();
  };

  const stopWave = () => {
    pulseLoop.current?.stop();
    pulse.setValue(1);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Start capturing audio. UI mode (hold overlay vs. recording bar) is set by
  // the caller. Returns whether capture actually began.
  const beginCapture = useCallback(async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return false;
      await AudioModule.setAudioModeAsync({ allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setDuration(0);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      startWave();
      return true;
    } catch {
      return false;
    }
  }, [recorder]);

  const cancelRecording = useCallback(() => {
    tap();
    stopWave();
    try {
      if (recorder.isRecording) recorder.stop();
    } catch {
      /* ignore */
    }
    setRecording(false);
  }, [recorder]);

  // Transcribe a PERSISTED audio file. On success: append to the draft and clear
  // the pending marker/file. On failure: leave it so it can retry (next finish
  // or next app launch). Reads value/setter via refs so a crash-resume still
  // appends to the current draft.
  const transcribeFile = useCallback(async (uri: string) => {
    setTranscribing(true);
    try {
      // The recorder writes to the volatile ExpoAudio cache; if persisting failed
      // and the cache file was already purged, uploading it throws NSCocoaError 260
      // ("no such file") deep in RCTNetworking. Bail (and drop the dead marker) instead.
      if (!(await fileExists(uri))) {
        await clearPendingVoice(uri);
        return;
      }
      const token = getAuthToken ? await getAuthToken() : null;
      if (!token) return; // keep pending; retry once auth is available
      const form = new FormData();
      form.append('file', { uri, type: 'audio/m4a', name: 'voice.m4a' } as any);
      const resp = await fetch(`${API_BASE_URL}${transcriptionPath}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!resp.ok) return; // keep pending for retry
      const json = await resp.json();
      const text = String(json?.text || json?.transcription || '').trim();
      if (text) {
        const prev = valueRef.current;
        onChangeRef.current(prev ? `${prev} ${text}` : text);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }
      await clearPendingVoice(uri); // transcribed → safe to delete
    } catch {
      /* keep pending for retry */
    } finally {
      setTranscribing(false);
    }
  }, [getAuthToken, transcriptionPath]);

  // Finish: stop, PERSIST the audio to disk first (so a crash mid-transcription
  // can't lose it), then transcribe.
  const finishRecording = useCallback(async () => {
    tap();
    stopWave();
    setRecording(false);
    setTranscribing(true);
    try {
      await recorder.stop();
    } catch {
      /* ignore */
    }
    const src = recorder.uri;
    if (!src) {
      setTranscribing(false);
      return;
    }
    const pending = await persistPendingVoice(src);
    await transcribeFile(pending?.uri || src);
  }, [recorder, transcribeFile]);

  // Resume a voice note left pending by a crash/kill — transcribe it once.
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    (async () => {
      const pending = await getPendingVoice();
      if (pending) await transcribeFile(pending.uri);
    })();
  }, [transcribeFile]);

  // Gesture handlers, refreshed every render so the once-created PanResponder
  // always calls the latest closures.
  beginRef.current = () => {
    pressStart.current = Date.now();
    cancelArmed.current = false;
    setCancelArmedView(false);
    tap(Haptics.ImpactFeedbackStyle.Medium);
    beginCapture();
    // Only reveal the full-screen takeover once it's clearly a hold; a quick tap
    // never flashes it and goes straight to the recording bar.
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      setHolding(true);
      Animated.timing(holdAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }, HOLD_MS);
  };
  endRef.current = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const held = Date.now() - pressStart.current;
    setHolding(false);
    setCancelArmedView(false);
    Animated.timing(holdAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start();
    if (held < HOLD_MS) {
      setRecording(true); // quick tap → persistent recording bar (tap ✓ to finish)
    } else if (cancelArmed.current) {
      cancelRecording(); // slid up → discard
    } else {
      finishRecording(); // released → transcribe + append
    }
  };

  const send = useCallback(() => {
    tap();
    const photos = imageUris;
    setImageUris([]);
    onSend(photos.length ? photos : undefined);
  }, [onSend, imageUris]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <View style={styles.wrap}>
      {/* Only surfaced when messages are actually queued behind the current one. */}
      {queuedCount > 1 ? (
        <View style={styles.queueBanner}>
          <Clock size={13} color="#5D7E16" />
          <Text style={styles.queueText}>
            {queuedCount - 1} message{queuedCount - 1 === 1 ? '' : 's'} queued.
          </Text>
        </View>
      ) : null}

      {recording ? (
        <View style={styles.recordingBar}>
          <TouchableOpacity style={styles.recCancel} onPress={cancelRecording} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={20} color="#6B7280" />
          </TouchableOpacity>
          <View style={styles.recCenter}>
            <View style={styles.waveRow}>
              {[0.5, 0.8, 1.2, 0.7, 1.4, 0.9, 0.6, 1.3, 0.8, 1.1, 0.5, 0.9, 1.2, 0.7, 1.0, 1.3, 0.6, 0.9].map((s, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.waveBar,
                    {
                      transform: [
                        {
                          scaleY: pulse.interpolate({
                            inputRange: [1, 1.4],
                            outputRange: [s, s * (i % 3 === 0 ? 1.6 : 1.25)],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.recTimer}>{fmt(duration)}</Text>
          </View>
          <TouchableOpacity style={styles.recDone} onPress={finishRecording} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Check size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.row}>
          <TouchableOpacity style={styles.attachBtn} onPress={attach} activeOpacity={0.8}>
            <Plus size={22} color="#18181B" />
          </TouchableOpacity>

          <View style={styles.card}>
            {imageUris.length ? (
              <View style={styles.previewRow}>
                {imageUris.map((uri, i) => (
                  <View key={`${uri}-${i}`} style={styles.previewItem}>
                    <Image source={{ uri }} style={styles.previewImg} />
                    <TouchableOpacity
                      style={styles.previewRemove}
                      onPress={() => setImageUris(prev => prev.filter((_, idx) => idx !== i))}
                    >
                      <X size={11} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder={placeholder}
                placeholderTextColor="#9CA3AF"
                multiline
                autoFocus={autoFocus}
                value={value}
                onChangeText={onChangeText}
                editable={!transcribing}
              />
              {transcribing ? (
                <View style={[styles.actionBtn, styles.neutralBtn]}>
                  <ActivityIndicator size="small" color="#71717A" />
                </View>
              ) : (
                <>
                  {/* Mic stays available even with text so voice keeps appending. */}
                  <View
                    {...pan.panHandlers}
                    style={[styles.actionBtn, styles.voiceBtn]}
                    accessibilityRole="button"
                    accessibilityLabel="Tap to start a voice memo, or hold to push-to-talk"
                  >
                    <AudioLines size={19} color="#FFFFFF" />
                  </View>
                  {canSend ? (
                    <TouchableOpacity style={[styles.actionBtn, styles.sendBtn]} onPress={send} activeOpacity={0.85}>
                      <ArrowRight size={19} color="#FFFFFF" />
                    </TouchableOpacity>
                  ) : null}
                </>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Push-to-talk takeover — a tall dark gradient over everything while the mic is held. */}
      {holding && (
        <Animated.View pointerEvents="none" style={[styles.holdOverlay, { opacity: holdAnim }]}>
          <LinearGradient
            colors={['#0A0D07', '#161B10', '#232B1A']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View
            style={[
              styles.holdContent,
              { transform: [{ translateY: holdAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] },
            ]}
          >
            <Text style={[styles.holdHint, cancelArmedView && styles.holdHintCancel]}>
              {cancelArmedView ? 'Release to cancel' : 'Release to send, slide up to cancel'}
            </Text>
            <View style={styles.holdWave}>
              {WAVE_BARS.map((amp, i) => (
                <Animated.View
                  key={i}
                  style={[
                    styles.holdBar,
                    cancelArmedView && styles.holdBarCancel,
                    {
                      transform: [
                        {
                          scaleY: pulse.interpolate({
                            inputRange: [1, 1.4],
                            outputRange: [amp, amp * (i % 4 === 0 ? 2.2 : 1.4)],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.holdTimer}>{fmt(duration)}</Text>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
};

export default MessageComposer;

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 2,
    backgroundColor: 'transparent',
  },
  queueBanner: {
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(147,200,34,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(147,200,34,0.3)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  queueText: { color: '#5D7E16', fontFamily: FONT.medium, fontSize: 12 },

  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  attachBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  card: {
    flex: 1,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    paddingLeft: 18,
    paddingRight: 6,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  previewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8, marginTop: 2, paddingLeft: 2 },
  previewItem: { width: 64, height: 64 },
  previewImg: { width: 64, height: 64, borderRadius: 12, backgroundColor: '#F3F4F6' },
  previewRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 34,
    maxHeight: 120,
    color: '#18181B',
    fontFamily: FONT.medium,
    fontSize: 16,
    paddingTop: 7,
    paddingBottom: 7,
  },
  actionBtn: {
    minWidth: 48,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 1,
  },
  sendBtn: { backgroundColor: BRAND },
  voiceBtn: { backgroundColor: '#A1A1AA' },
  neutralBtn: { backgroundColor: '#F1F2EE' },

  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 7,
    minHeight: 56,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  holdOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -200,
    height: SCREEN_H + 240,
    overflow: 'hidden',
    zIndex: 50,
    elevation: 50,
  },
  holdContent: {
    position: 'absolute',
    top: SCREEN_H * 0.28,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  holdHint: { color: '#C7CBD2', fontFamily: FONT.medium, fontSize: 18, textAlign: 'center', marginBottom: 44 },
  holdHintCancel: { color: '#FF6B6B' },
  holdWave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: 40 },
  holdBar: { width: 2.5, height: 16, borderRadius: 1.5, backgroundColor: BRAND },
  holdBarCancel: { backgroundColor: '#FF6B6B' },
  holdTimer: { color: '#8A8F9A', fontFamily: FONT.semibold, fontSize: 13, marginTop: 22, fontVariant: ['tabular-nums'] },

  recCancel: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1F2EE', alignItems: 'center', justifyContent: 'center' },
  recCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  waveRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 26, gap: 2 },
  waveBar: { width: 3, height: 14, backgroundColor: BRAND, borderRadius: 1.5 },
  recTimer: { fontFamily: FONT.semibold, fontSize: 13, color: '#EF4444', fontVariant: ['tabular-nums'] },
  recDone: { width: 40, height: 40, borderRadius: 20, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
});
