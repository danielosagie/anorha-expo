import React, { useState, useRef, useEffect, useCallback } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Animated,
    ActivityIndicator,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecorder, RecordingPresets, AudioModule } from 'expo-audio';

interface VoiceRecorderProps {
    apiBaseUrl?: string;
    getAuthToken?: () => Promise<string | null>;
    onTranscription: (text: string) => void;
    onCancel: () => void;
    maxDuration?: number; // in seconds, default 60
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
    apiBaseUrl,
    getAuthToken,
    onTranscription,
    onCancel,
    maxDuration = 60,
}) => {
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

    // Use expo-audio recorder
    const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

    // Format duration as M:SS
    const formatDuration = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    // Start recording immediately on mount
    useEffect(() => {
        startRecording();
        
        // Cleanup on unmount
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
            pulseLoop.current?.stop();
            if (audioRecorder.isRecording) {
                audioRecorder.stop();
            }
        };
    }, []);

    const startRecording = useCallback(async () => {
        try {
            setError(null);
            
            // Request permissions using AudioModule
            const permission = await AudioModule.requestRecordingPermissionsAsync();
            if (!permission.granted) {
                setError('Microphone permission denied');
                return;
            }

            // Enable recording mode on iOS (required for expo-audio)
            await AudioModule.setAudioModeAsync({
                allowsRecording: true,
            });

            // Prepare and start recording
            await audioRecorder.prepareToRecordAsync();
            audioRecorder.record();
            setRecordingDuration(0);

            // Start duration timer
            timerRef.current = setInterval(() => {
                setRecordingDuration(prev => {
                    if (prev >= maxDuration - 1) {
                        // Auto-stop at max duration
                        stopRecording();
                        return prev;
                    }
                    return prev + 1;
                });
            }, 1000);

            // Start pulse animation for waveform bars
            pulseLoop.current = Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.5,
                        duration: 400,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 400,
                        useNativeDriver: true,
                    }),
                ])
            );
            pulseLoop.current.start();
        } catch (err) {
            console.error('[VoiceRecorder] Failed to start:', err);
            setError('Unable to start recording. Please try again.');
        }
    }, [audioRecorder, maxDuration]);

    const stopRecording = useCallback(async () => {
        if (!audioRecorder.isRecording) return;

        // Clear timer
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        pulseLoop.current?.stop();
        pulseAnim.setValue(1);

        setIsTranscribing(true);

        try {
            // Stop recording
            audioRecorder.stop();
            
            // Wait a moment for the recording to be finalized
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const uri = audioRecorder.uri;

            if (uri && apiBaseUrl && getAuthToken) {
                const token = await getAuthToken();
                if (!token) throw new Error('No auth token');

                const formData = new FormData();
                formData.append('audio', {
                    uri,
                    type: 'audio/m4a',
                    name: 'recording.m4a',
                } as any);

                const response = await fetch(`${apiBaseUrl}/api/audio/transcribe`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}` },
                    body: formData,
                });

                if (response.ok) {
                    const result = await response.json();
                    const transcribedText = result?.text || result?.transcription || '';
                    onTranscription(transcribedText);
                } else {
                    throw new Error(`Transcription failed: ${response.status}`);
                }
            } else {
                setIsTranscribing(false);
                setError('Transcription service unavailable');
            }
        } catch (err) {
            console.error('[VoiceRecorder] Transcription error:', err);
            setIsTranscribing(false);
            setError('Sorry, we didn\'t catch that. Please make sure your microphone is working.');
        }
    }, [audioRecorder, apiBaseUrl, getAuthToken, onTranscription]);

    const cancelRecording = useCallback(async () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        pulseLoop.current?.stop();
        
        if (audioRecorder.isRecording) {
            audioRecorder.stop();
        }
        
        onCancel();
    }, [audioRecorder, onCancel]);

    // Error state with nice styling like the image
    if (error) {
        return (
            <View style={styles.container}>
                <View style={styles.errorBanner}>
                    <Ionicons name="warning" size={20} color="#EF4444" />
                    <View style={styles.errorTextContainer}>
                        <Text style={styles.errorTitle}>Sorry, we didn't catch that</Text>
                        <Text style={styles.errorSubtitle}>{error}</Text>
                    </View>
                    <TouchableOpacity onPress={() => setError(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Ionicons name="close" size={20} color="#d21616ff" />
                    </TouchableOpacity>
                </View>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16}}>
                    <TouchableOpacity style={styles.cancelTextButton} onPress={cancelRecording}>
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.retryButton} onPress={startRecording}>
                        <Text style={styles.retryButtonText}>Try Again</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    if (isTranscribing) {
        return (
            <View style={styles.container}>
                <View style={styles.transcribingBar}>
                    <TouchableOpacity
                        style={styles.transcribeCancelButton}
                        onPress={cancelRecording}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <Ionicons name="close" size={24} color="#fff" />
                    </TouchableOpacity>
                    
                    <Text style={styles.transcribingText}>Transcribing...</Text>
                    
                    <View style={styles.transcribeCheckButton}>
                        <Ionicons name="checkmark" size={24} color="#3B82F6" />
                    </View>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Waveform */}
            <View style={styles.waveContainer}>
                {[0.6, 0.9, 1.2, 0.8, 1.4, 1.0, 0.7, 1.3, 0.9, 1.1, 0.6, 0.8, 1.2, 1.0, 0.7, 0.9, 1.1, 0.8, 1.3, 1.0].map((scale, i) => (
                    <Animated.View
                        key={i}
                        style={[
                            styles.waveBar,
                            {
                                transform: [
                                    {
                                        scaleY: pulseAnim.interpolate({
                                            inputRange: [1, 1.5],
                                            outputRange: [scale, scale * (i % 3 === 0 ? 1.8 : 1.5)],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    />
                ))}
            </View>

            {/* Timer */}
            <Text style={styles.timer}>{formatDuration(recordingDuration)}</Text>

            {/* Controls */}
            <View style={styles.controls}>
                <TouchableOpacity
                    style={styles.cancelControlButton}
                    onPress={cancelRecording}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    <Ionicons name="close" size={24} color="#6B7280" />
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.stopButton}
                    onPress={stopRecording}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                    <View style={styles.stopIcon} />
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#fff',
        borderRadius: 24,
        padding: 24,
        alignItems: 'center',
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 12,
            },
            android: {
                elevation: 8,
            },
        }),
    },
    waveContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 60,
        gap: 3,
        marginBottom: 16,
    },
    waveBar: {
        width: 4,
        height: 40,
        backgroundColor: BRAND_PRIMARY,
        borderRadius: 2,
    },
    timer: {
        fontSize: 18,
        fontWeight: '600',
        color: '#EF4444',
        fontVariant: ['tabular-nums'],
        marginBottom: 24,
    },
    controls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 32,
    },
    cancelControlButton: {
        padding: 12,
        backgroundColor: '#F3F4F6',
        borderRadius: 24,
    },
    stopButton: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#EF4444',
        alignItems: 'center',
        justifyContent: 'center',
    },
    stopIcon: {
        width: 20,
        height: 20,
        backgroundColor: '#fff',
        borderRadius: 4,
    },
    // Error banner styling - light theme
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEE2E2',
        borderRadius: 12,
        padding: 16,
        marginBottom: 20,
        gap: 12,
        width: '100%',
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    errorTextContainer: {
        flex: 1,
    },
    errorTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#991B1B',
        marginBottom: 2,
    },
    errorSubtitle: {
        fontSize: 13,
        color: '#DC2626',
    },
    retryButton: {
        flex: 1,
        backgroundColor: BRAND_PRIMARY,
        paddingHorizontal: 32,
        paddingVertical: 14,
        justifyContent: "center",
        borderRadius: 24,
        marginBottom: 12,
    },
    retryButtonText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
        textAlign: "center",
    },
    cancelTextButton: {
        flex: 1,
        backgroundColor: '#909090',
        paddingHorizontal: 32,
        justifyContent: "center",
        paddingVertical: 14,
        borderRadius: 24,
        marginBottom: 12,
    },
    cancelButtonText: {
        color: '#ffffffff',
        fontSize: 14,
        fontWeight: '600',
        textAlign: "center",
    },
    // Transcribing bar styling
    transcribingBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3F4F6',
        borderRadius: 32,
        paddingVertical: 12,
        paddingHorizontal: 16,
        width: '100%',
        justifyContent: 'space-between',
    },
    transcribeCancelButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#E5E7EB',
        alignItems: 'center',
        justifyContent: 'center',
    },
    transcribingText: {
        fontSize: 15,
        color: '#9CA3AF',
        fontWeight: '500',
    },
    transcribeCheckButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#3B82F6',
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default VoiceRecorder;
