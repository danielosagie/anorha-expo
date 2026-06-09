import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { API_BASE_URL } from '../../../config/env';

type Props = {
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  queuedCount: number;
  isStreaming: boolean;
  /** Returns a Supabase JWT for the transcription request. */
  getAuthToken?: () => Promise<string | null>;
};

const BRAND = '#93C822';
const FONT = { medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold' };

export const ConversationComposer = ({
  value,
  placeholder,
  onChangeText,
  onSend,
  queuedCount,
  isStreaming,
  getAuthToken,
}: Props) => {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  const hasText = value.trim().length > 0;

  const tap = (s: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) =>
    Haptics.impactAsync(s).catch(() => undefined);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const attach = useCallback(async () => {
    tap();
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (!res.canceled && res.assets?.[0]?.uri) setImageUri(res.assets[0].uri);
    } catch {
      /* ignore */
    }
  }, []);

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

  const startRecording = useCallback(async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await AudioModule.setAudioModeAsync({ allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      tap(Haptics.ImpactFeedbackStyle.Medium);
      setRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      startWave();
    } catch {
      setRecording(false);
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

  const finishRecording = useCallback(async () => {
    tap();
    stopWave();
    setRecording(false);
    setTranscribing(true);
    try {
      recorder.stop();
      await new Promise(r => setTimeout(r, 400));
      const uri = recorder.uri;
      const token = getAuthToken ? await getAuthToken() : null;
      if (uri && token) {
        const form = new FormData();
        form.append('file', { uri, type: 'audio/m4a', name: 'voice.m4a' } as any);
        const resp = await fetch(`${API_BASE_URL}/api/audio/transcribe`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (resp.ok) {
          const json = await resp.json();
          const text = String(json?.text || json?.transcription || '').trim();
          if (text) {
            onChangeText(value ? `${value} ${text}` : text);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
          }
        }
      }
    } catch {
      /* ignore */
    } finally {
      setTranscribing(false);
    }
  }, [recorder, getAuthToken, onChangeText, value]);

  const send = useCallback(() => {
    tap();
    setImageUri(null);
    onSend();
  }, [onSend]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <View style={styles.wrap}>
      {isStreaming || queuedCount > 1 ? (
        <View style={styles.queueBanner}>
          <Icon name="progress-clock" size={13} color="#5D7E16" />
          <Text style={styles.queueText}>
            {isStreaming ? 'Sprout is responding.' : 'Messages queued.'} {Math.max(queuedCount - 1, 0)} waiting.
          </Text>
        </View>
      ) : null}

      {imageUri && !recording ? (
        <View style={styles.previewRow}>
          <Image source={{ uri: imageUri }} style={styles.previewImg} />
          <TouchableOpacity style={styles.previewRemove} onPress={() => setImageUri(null)}>
            <Icon name="close" size={13} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      ) : null}

      {recording ? (
        <View style={styles.recordingBar}>
          <TouchableOpacity style={styles.recCancel} onPress={cancelRecording} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close" size={20} color="#6B7280" />
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
            <Icon name="check" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.row}>
          <TouchableOpacity style={styles.attachBtn} onPress={attach} activeOpacity={0.8}>
            <Icon name="plus" size={22} color="#52525B" />
          </TouchableOpacity>

          <View style={styles.card}>
            <TextInput
              style={styles.input}
              placeholder={placeholder}
              placeholderTextColor="#9CA3AF"
              multiline
              value={value}
              onChangeText={onChangeText}
              editable={!transcribing}
            />
            {transcribing ? (
              <View style={[styles.actionBtn, styles.neutralBtn]}>
                <ActivityIndicator size="small" color="#71717A" />
              </View>
            ) : hasText ? (
              <TouchableOpacity style={[styles.actionBtn, styles.sendBtn]} onPress={send}>
                <Icon name="arrow-up" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.actionBtn, styles.voiceBtn]} onPress={startRecording}>
                <Icon name="microphone" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
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

  previewRow: { marginBottom: 8, alignSelf: 'flex-start' },
  previewImg: { width: 64, height: 64, borderRadius: 12, backgroundColor: '#F3F4F6' },
  previewRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
  },

  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F1F2EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E4E4E7',
    backgroundColor: '#FFFFFF',
    paddingLeft: 16,
    paddingRight: 5,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    color: '#18181B',
    fontFamily: FONT.medium,
    fontSize: 15,
    paddingTop: 8,
    paddingBottom: 8,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendBtn: { backgroundColor: BRAND },
  voiceBtn: { backgroundColor: '#9CA3AF' },
  neutralBtn: { backgroundColor: '#F1F2EE' },

  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E4E7',
    borderRadius: 22,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 52,
  },
  recCancel: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F2EE', alignItems: 'center', justifyContent: 'center' },
  recCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  waveRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 26, gap: 2 },
  waveBar: { width: 3, height: 14, backgroundColor: BRAND, borderRadius: 1.5 },
  recTimer: { fontFamily: FONT.semibold, fontSize: 13, color: '#EF4444', fontVariant: ['tabular-nums'] },
  recDone: { width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
});
