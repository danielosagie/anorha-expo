import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Animated, Image, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import { Plus, ArrowRight, Mic, X, Check, Clock } from 'lucide-react-native';
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
};

const BRAND = '#93C822';
const FONT = { medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold' };

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
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Latest draft/setter so transcription appends correctly even on crash-resume.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChangeText);
  onChangeRef.current = onChangeText;
  const resumedRef = useRef(false);
  const pulse = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  const hasText = value.trim().length > 0;
  const canSend = hasText || imageUris.length > 0;

  const tap = (s: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) =>
    Haptics.impactAsync(s).catch(() => undefined);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

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

  // The + button opens an attach menu: camera, photo library, or a file from the Files app.
  const attach = useCallback(() => {
    tap();
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Take Photo', 'Photo Library', 'Choose File', 'Cancel'], cancelButtonIndex: 3 },
        (i) => {
          if (i === 0) void pickFromCamera();
          else if (i === 1) void pickFromLibrary();
          else if (i === 2) void pickFile();
        },
      );
    } else {
      Alert.alert('Add to chat', undefined, [
        { text: 'Take Photo', onPress: () => void pickFromCamera() },
        { text: 'Photo Library', onPress: () => void pickFromLibrary() },
        { text: 'Choose File', onPress: () => void pickFile() },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [pickFromCamera, pickFromLibrary, pickFile]);

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

  // Start capturing audio. Returns whether capture actually began.
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

  // Tap the mic to start a voice memo (shows the recording bar). Simple and reliable —
  // no push-to-talk gesture. The seller taps ✓ to finish (transcribe) or ✕ to discard.
  const startRecording = useCallback(async () => {
    if (recording || transcribing) return;
    tap(Haptics.ImpactFeedbackStyle.Medium);
    setVoiceError(null);
    const ok = await beginCapture();
    if (ok) {
      setRecording(true);
    } else {
      setVoiceError('Microphone access is needed to record a voice memo.');
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
        setVoiceError('Sign-in expired — couldn’t transcribe. Try again.');
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
        setVoiceError('Couldn’t transcribe that — please try again.');
        return; // keep pending for retry
      }
      const json = await resp.json();
      const text = String(json?.text || json?.transcription || '').trim();
      if (text) {
        const prev = valueRef.current;
        onChangeRef.current(prev ? `${prev} ${text}` : text);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      } else {
        setVoiceError('Didn’t catch that — try recording again.');
      }
      await clearPendingVoice(uri); // transcribed (or empty) → safe to delete
    } catch {
      setVoiceError('Couldn’t transcribe that — please try again.');
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
      setVoiceError('Nothing was recorded — try again.');
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
  queueText: { color: '#5D7E16', fontFamily: FONT.medium, fontSize: 12 },

  voiceErrorBanner: {
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  voiceErrorText: { color: '#B91C1C', fontFamily: FONT.medium, fontSize: 12 },

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
  recCancel: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F1F2EE', alignItems: 'center', justifyContent: 'center' },
  recCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  waveRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 26, gap: 2 },
  waveBar: { width: 3, height: 14, backgroundColor: BRAND, borderRadius: 1.5 },
  recTimer: { fontFamily: FONT.semibold, fontSize: 13, color: '#EF4444', fontVariant: ['tabular-nums'] },
  recDone: { width: 40, height: 40, borderRadius: 20, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
});
