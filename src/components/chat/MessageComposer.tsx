import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Animated as RNAnimated, Image, Linking, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Plus, ArrowRight, Mic, X, Check, Clock, Pencil, Camera, Images, Paperclip } from 'lucide-react-native';
import { API_BASE_URL } from '../../config/env';
import { persistPendingVoice, getPendingVoice, clearPendingVoice, fileExists } from '../../features/liquidationConversation/pendingVoice';

// The reusable chat composer (extracted from the liquidation conversation). Rounded pill,
// attach menu (camera / photo library / file), and a simple tap-to-record voice memo that
// transcribes server-side and appends to the draft. Use it anywhere a chat-style input is
// wanted (chat, the Generate Details "wanna change something" tray, etc.).
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
  /** Compact non-file context carried with the next message. */
  contextAttachment?: { label: string } | null;
  onRemoveContextAttachment?: () => void;
  /** Increment to focus an already-mounted composer. */
  focusRequestKey?: number;
  /** Hide attachment controls when the surface only accepts text or voice. */
  hideAttach?: boolean;
};

const BRAND = '#93C822';
const FONT = { medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold' };
const WAVE_BARS = 32;

// Map a metering reading (dBFS) to a 0..1 amplitude for the waveform. We normalize across
// the band where a voice actually lives (~-55..-10 dBFS) instead of the full -60..0, then
// apply a gentle expansion curve. That drops the noise floor near the baseline and lets
// loud syllables punch toward the top — so the bars track the real sound with motion
// rather than hovering at a uniform mid height.
const FLOOR_DB = -55;
const CEIL_DB = -10;
// Resting waveform amplitude (silence / no reading) — bars sit just above the baseline.
const BASE_LEVEL = 0.05;
const meterToLevel = (db: number | undefined): number => {
  if (db == null || Number.isNaN(db)) return BASE_LEVEL;
  const clamped = Math.max(FLOOR_DB, Math.min(CEIL_DB, db));
  const n = (clamped - FLOOR_DB) / (CEIL_DB - FLOOR_DB); // 0..1 across the voice band
  return Math.max(BASE_LEVEL, Math.pow(n, 1.4));
};

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
  contextAttachment,
  onRemoveContextAttachment,
  focusRequestKey = 0,
  hideAttach = false,
}: Props) => {
  // Metering on, so the waveform reacts to the seller's actual voice level (Claude-style)
  // instead of a canned pulse.
  const recordOptions = useMemo(() => ({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true }), []);
  const recorder = useAudioRecorder(recordOptions);
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // When the failure is a denied permission we offer a jump to Settings; other
  // failures (audio session, prepare) shouldn't blame the mic permission.
  const [voiceErrorSettings, setVoiceErrorSettings] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  // Rolling levels (0..1) that drive the live waveform bars.
  const [levels, setLevels] = useState<number[]>(() => new Array(WAVE_BARS).fill(BASE_LEVEL));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Last waveform level, used for the fast-attack/quick-decay envelope.
  const peakRef = useRef(BASE_LEVEL);
  // Latest draft/setter so transcription appends correctly even on crash-resume.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChangeText);
  onChangeRef.current = onChangeText;
  const resumedRef = useRef(false);
  const pulseLoop = useRef<RNAnimated.CompositeAnimation | null>(null);
  const inputRef = useRef<TextInput>(null);
  const attachProgress = useSharedValue(0);

  const hasText = value.trim().length > 0;
  const canSend = hasText || (!hideAttach && imageUris.length > 0);

  const tap = (s: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) =>
    Haptics.impactAsync(s).catch(() => undefined);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (meterRef.current) clearInterval(meterRef.current);
  }, []);

  useEffect(() => {
    if (!hideAttach) return;
    setAttachMenuOpen(false);
    setImageUris([]);
  }, [hideAttach]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    attachProgress.value = withTiming(attachMenuOpen ? 1 : 0, {
      duration: reduceMotion ? 1 : attachMenuOpen ? 210 : 150,
      easing: attachMenuOpen
        ? Easing.bezier(0.22, 1, 0.36, 1)
        : Easing.bezier(0.4, 0, 1, 1),
    });
  }, [attachMenuOpen, attachProgress, reduceMotion]);

  const attachMenuStyle = useAnimatedStyle(() => ({
    opacity: attachProgress.value,
    transform: [
      { translateY: (1 - attachProgress.value) * 10 },
      { scaleX: 0.94 + attachProgress.value * 0.06 },
      { scaleY: 0.92 + attachProgress.value * 0.08 },
    ],
  }));

  const attachButtonStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 - attachProgress.value * 0.06 },
      { rotate: `${attachProgress.value * 45}deg` },
    ],
  }));

  useEffect(() => {
    if (!focusRequestKey) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusRequestKey]);

  // Clear a transient voice error a few seconds after it shows.
  useEffect(() => {
    if (!voiceError) return;
    const t = setTimeout(() => setVoiceError(null), 4000);
    return () => clearTimeout(t);
  }, [voiceError]);

  const addUris = useCallback((uris: string[]) => {
    if (!uris.length) return;
    setImageUris(prev => [...prev, ...uris].slice(0, maxImages));
  }, [maxImages]);

  const pickFromLibrary = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Photos access needed', 'Enable photo access in Settings to attach images.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsMultipleSelection: true,
        selectionLimit: maxImages,
      });
      if (!res.canceled && res.assets?.length) addUris(res.assets.map(a => a.uri));
    } catch {
      /* ignore */
    }
  }, [addUris, maxImages]);

  const pickFromCamera = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera access needed', 'Enable camera access in Settings to take a photo.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (!res.canceled && res.assets?.length) addUris(res.assets.map(a => a.uri));
    } catch {
      /* ignore */
    }
  }, [addUris]);

  const pickFile = useCallback(async () => {
    try {
      // Image files from the Files app / iCloud Drive (the chat pipeline consumes images).
      const res = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (!res.canceled && res.assets?.length) addUris(res.assets.map(a => a.uri));
    } catch {
      /* ignore */
    }
  }, [addUris]);

  const runAttachAction = useCallback((action: () => void) => {
    setAttachMenuOpen(false);
    tap();
    const delay = reduceMotion ? 0 : 110;
    setTimeout(action, delay);
  }, [reduceMotion]);

  const toggleAttachMenu = useCallback(() => {
    tap();
    setAttachMenuOpen(open => !open);
  }, []);

  const stopWave = () => {
    pulseLoop.current?.stop();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (meterRef.current) {
      clearInterval(meterRef.current);
      meterRef.current = null;
    }
    setLevels(new Array(WAVE_BARS).fill(0.12));
  };

  // Start capturing audio. Distinguishes a denied permission from a capture failure so
  // the message we show is honest: a granted mic that fails to start is NOT a permission
  // problem. Returns 'ok' | 'denied' | 'error'.
  const beginCapture = useCallback(async (): Promise<'ok' | 'denied' | 'error'> => {
    // Don't re-prompt if it's already granted — check first, only request when needed.
    let granted = false;
    try {
      const current = await AudioModule.getRecordingPermissionsAsync();
      granted = current.granted;
      if (!granted && current.canAskAgain) {
        granted = (await AudioModule.requestRecordingPermissionsAsync()).granted;
      }
    } catch {
      granted = false;
    }
    if (!granted) return 'denied';

    try {
      // playsInSilentMode is required on iOS — without it prepare/record can fail or
      // capture silence even when the mic permission is granted. This was the actual
      // cause of the misleading "microphone access is needed" message.
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setDuration(0);
      setLevels(new Array(WAVE_BARS).fill(BASE_LEVEL));
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      // Poll the recorder's metering to drive a live, scrolling waveform. Sample fast
      // (~22fps) so the bars feel snappy. Fast attack / quick decay: a louder reading
      // snaps the bar up instantly, a quieter one eases down — so peaks pop with the
      // voice instead of getting smoothed into a sluggish blob.
      if (meterRef.current) clearInterval(meterRef.current);
      peakRef.current = BASE_LEVEL;
      meterRef.current = setInterval(() => {
        let level = BASE_LEVEL;
        try {
          const status: any = recorder.getStatus?.();
          level = meterToLevel(status?.metering);
        } catch {
          level = BASE_LEVEL;
        }
        const prevPeak = peakRef.current;
        const next = level >= prevPeak ? level : prevPeak * 0.7 + level * 0.3;
        peakRef.current = next;
        setLevels(prev => [...prev.slice(1), next]);
      }, 45);
      return 'ok';
    } catch (e) {
      // Surface the real reason in logs without blaming the mic permission.
      console.warn('[MessageComposer] recording failed to start:', e);
      return 'error';
    }
  }, [recorder]);

  // Tap the mic to start a voice memo (shows the recording bar). The seller taps ✓ to
  // finish (transcribe) or ✕ to discard.
  const startRecording = useCallback(async () => {
    if (recording || transcribing) return;
    tap(Haptics.ImpactFeedbackStyle.Medium);
    setVoiceError(null);
    setVoiceErrorSettings(false);
    const result = await beginCapture();
    if (result === 'ok') {
      setRecording(true);
    } else if (result === 'denied') {
      setVoiceError('Microphone access is off. Turn it on in Settings to record.');
      setVoiceErrorSettings(true);
    } else {
      setVoiceError('Couldn’t start recording. Please try again.');
    }
  }, [beginCapture, recording, transcribing]);

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
  // the pending marker/file. On failure: surface an error and leave it so it can
  // retry (next finish or next app launch). Reads value/setter via refs so a
  // crash-resume still appends to the current draft.
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
      if (!token) {
        setVoiceError('Sign-in expired. Couldn’t transcribe. Try again.');
        return; // keep pending; retry once auth is available
      }
      const form = new FormData();
      form.append('file', { uri, type: 'audio/m4a', name: 'voice.m4a' } as any);
      const resp = await fetch(`${API_BASE_URL}${transcriptionPath}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!resp.ok) {
        setVoiceError('Couldn’t transcribe that. Please try again.');
        return; // keep pending for retry
      }
      const json = await resp.json();
      const text = String(json?.text || json?.transcription || '').trim();
      if (text) {
        const prev = valueRef.current;
        onChangeRef.current(prev ? `${prev} ${text}` : text);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      } else {
        setVoiceError('Didn’t catch that. Try recording again.');
      }
      await clearPendingVoice(uri); // transcribed (or empty) → safe to delete
    } catch {
      setVoiceError('Couldn’t transcribe that. Please try again.');
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
      setVoiceError('Nothing was recorded. Try again.');
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

      {voiceError ? (
        <View style={styles.voiceErrorBanner}>
          <Text style={styles.voiceErrorText}>{voiceError}</Text>
          {voiceErrorSettings ? (
            <TouchableOpacity onPress={() => Linking.openSettings().catch(() => undefined)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={styles.voiceErrorAction}>Settings</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {recording ? (
        <View style={styles.recordingBar}>
          <TouchableOpacity style={styles.recCancel} onPress={cancelRecording} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={20} color="#6B7280" />
          </TouchableOpacity>
          <View style={styles.recCenter}>
            <View style={styles.recDot} />
            <View style={styles.waveRow}>
              {levels.map((lv, i) => (
                <View
                  key={i}
                  style={[styles.waveBar, { height: 3 + lv * 25 }]}
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
          {!hideAttach ? (
            <>
              <Animated.View
                pointerEvents={attachMenuOpen ? 'auto' : 'none'}
                style={[styles.attachMenu, attachMenuStyle]}
                accessibilityViewIsModal={attachMenuOpen}
              >
                <Pressable
                  style={({ pressed }) => [styles.attachOption, pressed && styles.attachOptionPressed]}
                  onPress={() => runAttachAction(() => void pickFromCamera())}
                  accessibilityRole="button"
                  accessibilityLabel="Open camera"
                >
                  <View style={styles.attachOptionIcon}><Camera size={20} color="#3F3F46" strokeWidth={2} /></View>
                  <Text style={styles.attachOptionText}>Camera</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.attachOption, pressed && styles.attachOptionPressed]}
                  onPress={() => runAttachAction(() => void pickFromLibrary())}
                  accessibilityRole="button"
                  accessibilityLabel="Choose photos"
                >
                  <View style={styles.attachOptionIcon}><Images size={20} color="#3F3F46" strokeWidth={2} /></View>
                  <Text style={styles.attachOptionText}>Photos</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.attachOption, pressed && styles.attachOptionPressed]}
                  onPress={() => runAttachAction(() => void pickFile())}
                  accessibilityRole="button"
                  accessibilityLabel="Choose files"
                >
                  <View style={styles.attachOptionIcon}><Paperclip size={20} color="#3F3F46" strokeWidth={2} /></View>
                  <Text style={styles.attachOptionText}>Files</Text>
                </Pressable>
              </Animated.View>

              <Pressable onPress={toggleAttachMenu} accessibilityRole="button" accessibilityLabel={attachMenuOpen ? 'Close attachment menu' : 'Add to chat'}>
                {({ pressed }) => (
                  <Animated.View style={[styles.attachBtn, attachButtonStyle, pressed && styles.attachBtnPressed]}>
                    <Plus size={22} color="#18181B" strokeWidth={2.2} />
                  </Animated.View>
                )}
              </Pressable>
            </>
          ) : null}

          <View style={styles.card}>
            {contextAttachment ? (
              <View style={styles.contextRow}>
                <View style={styles.contextChip}>
                  <Pencil size={13} color="#5D7E16" />
                  <Text style={styles.contextText}>{contextAttachment.label}</Text>
                  {onRemoveContextAttachment ? (
                    <TouchableOpacity
                      style={styles.contextRemove}
                      onPress={onRemoveContextAttachment}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${contextAttachment.label}`}
                    >
                      <X size={13} color="#5D7E16" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}
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
                ref={inputRef}
                style={styles.input}
                placeholder={placeholder}
                placeholderTextColor="#9CA3AF"
                multiline
                autoFocus={autoFocus}
                value={value}
                onChangeText={onChangeText}
                onFocus={() => setAttachMenuOpen(false)}
                editable={!transcribing}
              />
              {transcribing ? (
                <View style={[styles.actionBtn, styles.neutralBtn]}>
                  <ActivityIndicator size="small" color="#71717A" />
                </View>
              ) : (
                <>
                  {/* Tap to record a voice memo (mic stays available even with text so
                      voice keeps appending). */}
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.voiceBtn]}
                    onPress={startRecording}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Record a voice memo"
                  >
                    <Mic size={19} color="#FFFFFF" />
                  </TouchableOpacity>
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
  queueText: { color: '#5D7E16', fontFamily: FONT.medium, fontSize: 13 },

  voiceErrorBanner: {
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  voiceErrorText: { flex: 1, color: '#B91C1C', fontFamily: FONT.medium, fontSize: 13 },
  voiceErrorAction: { color: '#B91C1C', fontFamily: FONT.semibold, fontSize: 13, textDecorationLine: 'underline' },

  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 9 },
  attachMenu: {
    position: 'absolute',
    left: 0,
    bottom: 58,
    width: 224,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    zIndex: 20,
  },
  attachOption: {
    minHeight: 54,
    paddingHorizontal: 8,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  attachOptionPressed: { backgroundColor: '#F4F4F5' },
  attachOptionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F4F5',
  },
  attachOptionText: { color: '#18181B', fontFamily: FONT.medium, fontSize: 17 },
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
  attachBtnPressed: { opacity: 0.82 },
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
  contextRow: { flexDirection: 'row', paddingTop: 2, paddingBottom: 6 },
  contextChip: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 4,
    borderRadius: 16,
    backgroundColor: 'rgba(147,200,34,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(147,200,34,0.28)',
  },
  contextText: { color: '#5D7E16', fontFamily: FONT.semibold, fontSize: 13.5 },
  contextRemove: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 34,
    maxHeight: 120,
    color: '#18181B',
    fontFamily: FONT.medium,
    fontSize: 17,
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
  recCancel: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1F2EE', alignItems: 'center', justifyContent: 'center' },
  recCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#EF4444' },
  waveRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 28, gap: 2 },
  waveBar: { width: 3, minHeight: 3, backgroundColor: BRAND, borderRadius: 1.5 },
  recTimer: { fontFamily: FONT.semibold, fontSize: 14, color: '#EF4444', fontVariant: ['tabular-nums'] },
  recDone: { width: 40, height: 40, borderRadius: 20, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
});
