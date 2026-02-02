import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Audio } from 'expo-av';
import { ensureSupabaseJwt } from '../lib/supabase';

const API_BASE = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || 'https://api.sssync.app';

export interface SpeechModalProps {
  visible: boolean;
  onClose: () => void;
  onTranscript: (text: string) => void;
  title?: string;
}

/**
 * Modal for speech input: record → transcribe via Groq → show transcript with "Use this".
 * Design matches GenerateDetailsScreen "Editing This Field" modal (backdrop + card + header + content).
 */
export default function SpeechModal({
  visible,
  onClose,
  onTranscript,
  title = 'Speech input',
}: SpeechModalProps) {
  const [transcript, setTranscript] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingDisplay, setStreamingDisplay] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const recordingRef = useRef<Audio.Recording | null>(null);
  const lastSentUri = useRef<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const setup = async () => {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Microphone', 'Allow microphone access to use voice input.');
        onClose();
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    };
    setup();
  }, [visible, onClose]);

  useEffect(() => {
    if (!isRecording) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.9, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isRecording, pulseAnim]);

  const startRecording = useCallback(async () => {
    setError(null);
    setTranscript('');
    setStreamingDisplay('');
    setRecordingUri(null);
    lastSentUri.current = null;
    try {
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start recording');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      recordingRef.current = null;
      setIsRecording(false);
      setRecordingUri(uri ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop recording');
      recordingRef.current = null;
      setIsRecording(false);
    }
  }, []);

  const sendForTranscription = useCallback(async (uri: string) => {
    if (!uri) {
      setError('No recording to transcribe');
      return;
    }
    setTranscribing(true);
    setError(null);
    setStreamingDisplay('Transcribing…');
    try {
      const token = await ensureSupabaseJwt();
      if (!token) {
        throw new Error('Not authenticated');
      }
      const formData = new FormData();
      formData.append('file', {
        uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
        type: 'audio/m4a',
        name: 'audio.m4a',
      } as any);

      const response = await fetch(`${API_BASE}/api/audio/transcribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(Platform.OS === 'web' ? {} : { 'Content-Type': 'multipart/form-data' }),
        },
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `Transcription failed: ${response.status}`);
      }

      const data = await response.json();
      const text = (data?.text ?? '').trim();
      setTranscript(text);
      setStreamingDisplay('');
      if (!text) {
        setError('No speech detected. Try again.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transcription failed');
      setStreamingDisplay('');
    } finally {
      setTranscribing(false);
    }
  }, []);

  useEffect(() => {
    if (!recordingUri || recordingUri === lastSentUri.current || transcribing) return;
    lastSentUri.current = recordingUri;
    sendForTranscription(recordingUri);
  }, [recordingUri, transcribing, sendForTranscription]);

  const handleUseThis = useCallback(() => {
    if (transcript) {
      onTranscript(transcript);
      onClose();
    }
  }, [transcript, onTranscript, onClose]);

  if (!visible) return null;

  return (
    <>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={styles.modalBackdrop} />
      <View style={styles.modalCard}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Icon name="microphone" size={18} color="#000" />
            <Text style={styles.headerTitle}>{title}</Text>
          </View>
          <TouchableOpacity style={styles.backButton} onPress={onClose}>
            <Icon name="arrow-left" size={18} color="#000" />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        </View>

        {!isRecording && !recordingUri ? (
          <View style={styles.recordSection}>
            <TouchableOpacity style={styles.recordButton} onPress={startRecording}>
              <Icon name="microphone" size={40} color="#fff" />
              <Text style={styles.recordButtonLabel}>Tap to record</Text>
            </TouchableOpacity>
          </View>
        ) : isRecording ? (
          <View style={styles.recordSection}>
            <Animated.View style={[styles.recordingPill, { transform: [{ scale: pulseAnim }] }]}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>Recording…</Text>
            </Animated.View>
            <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
              <Text style={styles.stopButtonText}>Stop</Text>
            </TouchableOpacity>
          </View>
        ) : transcribing ? (
          <View style={styles.transcribingSection}>
            <ActivityIndicator size="large" color="#000" style={{ marginBottom: 12 }} />
            <Text style={styles.transcribingText}>{streamingDisplay}</Text>
          </View>
        ) : error ? (
          <View style={styles.errorSection}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.recordAgainButton} onPress={startRecording}>
              <Text style={styles.recordAgainButtonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : transcript ? (
          <>
            <View style={styles.transcriptCard}>
              <Text style={styles.transcriptLabel}>Transcript</Text>
              <View style={styles.transcriptContent}>
                <Text style={styles.transcriptText}>{transcript}</Text>
              </View>
            </View>
            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.useThisButton} onPress={handleUseThis}>
                <Text style={styles.useThisButtonText}>Use this</Text>
                <Icon name="arrow-right" size={18} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.recordAgainButton} onPress={startRecording}>
                <Text style={styles.recordAgainButtonText}>Record again</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 6000,
  },
  modalCard: {
    position: 'absolute',
    top: '18%',
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    zIndex: 6001,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  backButtonText: {
    color: '#000',
    fontWeight: '600',
    marginLeft: 6,
  },
  recordSection: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  recordButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#000',
  },
  recordButtonLabel: {
    marginTop: 8,
    fontSize: 14,
    color: '#71717A',
  },
  recordingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
    gap: 10,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  recordingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  stopButton: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: '#374151',
    borderRadius: 10,
  },
  stopButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  transcribingSection: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  transcribingText: {
    fontSize: 15,
    color: '#71717A',
  },
  errorSection: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#dc2626',
    marginBottom: 12,
    textAlign: 'center',
  },
  transcriptCard: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    marginBottom: 16,
    overflow: 'hidden',
  },
  transcriptLabel: {
    paddingHorizontal: 10,
    paddingTop: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#71717A',
    textTransform: 'uppercase',
  },
  transcriptContent: {
    marginHorizontal: 8,
    marginBottom: 10,
    padding: 10,
    backgroundColor: '#FAFAFA',
    borderRadius: 8,
  },
  transcriptText: {
    fontSize: 15,
    color: '#000',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
  },
  useThisButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    gap: 8,
  },
  useThisButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  recordAgainButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  recordAgainButtonText: {
    color: '#374151',
    fontWeight: '600',
  },
});
