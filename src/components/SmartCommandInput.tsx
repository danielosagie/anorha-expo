import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Animated,
    LayoutAnimation,
    Platform,
    UIManager,
    FlatList,
    Keyboard,
    ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecorder, RecordingPresets, AudioModule } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface FieldOption {
    key: string;       // e.g. 'shopify.title', 'ebay.description'
    label: string;     // e.g. 'Title', 'Description (eBay)'
    platform?: string; // e.g. 'shopify', 'ebay'
}

/** Preset behaviour modes – each sets sensible defaults that individual props can override. */
export type SmartCommandMode = 'quick_fix' | 'voice_search' | 'voice_filter';

const MODE_PRESETS: Record<SmartCommandMode, {
    label: string;
    headerTitle: string;
    placeholder: string;
    submitLabel: string;
    collapsedIcon: string;
    initialMode: 'text' | 'voice';
}> = {
    quick_fix: {
        label: 'Something not right?',
        headerTitle: 'What needs to change?',
        placeholder: 'e.g. make the description more casual, or @Title make it catchier',
        submitLabel: 'Update',
        collapsedIcon: 'sparkles',
        initialMode: 'text',
    },
    voice_search: {
        label: 'Search by voice',
        headerTitle: 'Voice search',
        placeholder: 'Tap the mic or type your search…',
        submitLabel: 'Search',
        collapsedIcon: 'mic',
        initialMode: 'voice',
    },
    voice_filter: {
        label: 'Filter by voice',
        headerTitle: 'Speak your filter',
        placeholder: 'e.g. under 50 dollars, low stock, on eBay',
        submitLabel: 'Apply',
        collapsedIcon: 'mic',
        initialMode: 'voice',
    },
};

export interface SmartCommandInputProps {
    /** Behaviour mode — sets sensible defaults for label, placeholder etc. */
    mode?: SmartCommandMode;
    /** Collapsed-state label (overrides mode default) */
    label?: string;
    /** TextInput placeholder (overrides mode default) */
    placeholder?: string;
    /** Available fields for @ autocomplete */
    availableFields?: FieldOption[];
    /** Called when user submits the command */
    onSubmit: (text: string, mentionedFields: string[]) => void | Promise<void>;
    /** External loading state */
    isLoading?: boolean;
    /** Submit button text (overrides mode default) */
    submitLabel?: string;
    /** Force a specific initial interaction mode */
    initialMode?: 'text' | 'voice';
    /** API base URL for Groq transcription */
    apiBaseUrl?: string;
    /** Auth token getter for transcription */
    getAuthToken?: () => Promise<string | null>;
    /** Whether the component is presented inside a modal (skip the collapsed state) */
    startExpanded?: boolean;
    /** Called when collapsed-CTA is tapped — lets parent control visibility */
    onExpand?: () => void;
    /** Called when user taps close/cancel */
    onCollapse?: () => void;
    /**
     * variant='inline': Removes outer card styling, header, and cancel button.
     * Useful when embedding inside another card/modal.
     */
    variant?: 'default' | 'inline';
    /** If true, the component will not adjust its position based on keyboard height (useful if wrapped in KeyboardAvoidingView) */
    disableKeyboardHandling?: boolean;
    /** If true, the component will extend to the full width of its container (removing horizontal margins) */
    fullWidth?: boolean;
}

type ComponentState = 'collapsed' | 'expanded' | 'recording' | 'transcribing' | 'loading';

// ── Component ──────────────────────────────────────────────────────────────

export const SmartCommandInput: React.FC<SmartCommandInputProps> = ({
    mode: modeProp = 'quick_fix',
    label: labelOverride,
    placeholder: placeholderOverride,
    availableFields = [],
    onSubmit,
    isLoading = false,
    submitLabel: submitLabelOverride,
    initialMode: initialModeOverride,
    apiBaseUrl,
    getAuthToken,
    startExpanded = false,
    onExpand,
    onCollapse,
    variant = 'default',
    disableKeyboardHandling = false,
    fullWidth = false,
}) => {
    // Resolve mode presets with explicit overrides
    const preset = MODE_PRESETS[modeProp];
    const label = labelOverride ?? preset.label;
    const placeholder = placeholderOverride ?? preset.placeholder;
    const submitLabel = submitLabelOverride ?? preset.submitLabel;
    const initialMode = initialModeOverride ?? preset.initialMode;
    const collapsedIcon = preset.collapsedIcon as any;
    const headerTitle = preset.headerTitle;
    // ── State ──
    const [state, setState] = useState<ComponentState>(startExpanded ? 'expanded' : 'collapsed');
    const [text, setText] = useState('');
    const [mentionedFields, setMentionedFields] = useState<string[]>([]);
    const [showMentions, setShowMentions] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [recordingError, setRecordingError] = useState<string | null>(null);
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Use expo-audio recorder
    const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

    // ── Animations ──
    const expandAnim = useRef(new Animated.Value(0)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const waveAnim = useRef(new Animated.Value(0)).current;
    const inputRef = useRef<TextInput>(null);
    const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

    // ── Auto-expand / voice-start if configured ──
    useEffect(() => {
        if (startExpanded) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setState('expanded');
            Animated.spring(expandAnim, {
                toValue: 1,
                friction: 8, // Less bouncy
                tension: 40,
                useNativeDriver: true,
            }).start(() => {
                if (initialMode === 'voice') {
                    startRecording();
                } else {
                    inputRef.current?.focus();
                }
            });
        }
    }, [startExpanded]); // Depend on startExpanded so it triggers when parent toggles it

    // ── Sync loading state ──
    useEffect(() => {
        if (isLoading) {
            setState('loading');
        } else if (state === 'loading') {
            setState('expanded');
        }
    }, [isLoading]);

    // ── Keyboard Listeners ──
    useEffect(() => {
        const showSubscription = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
            (e) => {
                setKeyboardHeight(e.endCoordinates.height);
            }
        );
        const hideSubscription = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
            () => {
                setKeyboardHeight(0);
            }
        );

        return () => {
            showSubscription.remove();
            hideSubscription.remove();
        };
    }, []);

    // ── Expand/Collapse ──
    const handleExpand = useCallback(() => {
        onExpand?.();
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setState('expanded');
        Animated.spring(expandAnim, {
            toValue: 1,
            friction: 8, // Less bouncy
            tension: 40,
            useNativeDriver: true,

        }).start(() => {
            inputRef.current?.focus();
        });
    }, [expandAnim]);

    const handleCollapse = useCallback(() => {
        Keyboard.dismiss();
        onCollapse?.();
        Animated.spring(expandAnim, {
            toValue: 0,
            friction: 8, // Less bouncy
            tension: 40,
            useNativeDriver: true,
        }).start(() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setState('collapsed');
            setText('');
            setMentionedFields([]);
            setShowMentions(false);
            setRecordingError(null);
        });
    }, [expandAnim]);

    // ── Voice Recording ──
    const startRecording = useCallback(async () => {
        try {
            // Clear any previous error
            setRecordingError(null);

            // Request permissions using AudioModule
            const permission = await AudioModule.requestRecordingPermissionsAsync();
            if (!permission.granted) {
                console.warn('[SmartCommandInput] Microphone permission denied');
                setRecordingError('Microphone permission denied. Please enable microphone access in settings.');
                return;
            }

            // Enable recording mode on iOS (required for expo-audio)
            await AudioModule.setAudioModeAsync({
                allowsRecording: true,
            });

            // Prepare and start recording
            await audioRecorder.prepareToRecordAsync();
            audioRecorder.record();
            setState('recording');
            setRecordingDuration(0);

            // Start duration timer
            timerRef.current = setInterval(() => {
                setRecordingDuration(prev => prev + 1);
            }, 1000);

            // Start pulse animation for waveform bars
            pulseLoop.current = Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.4,
                        duration: 500,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 500,
                        useNativeDriver: true,
                    }),
                ])
            );
            pulseLoop.current.start();
        } catch (err) {
            console.error('[SmartCommandInput] Could not start recording:', err);
            setRecordingError('Unable to start recording. Please try again or type your command.');
            // Reset to expanded state so user can try again or type instead
            setState('expanded');
        }
    }, [pulseAnim, audioRecorder]);

    const stopRecording = useCallback(async () => {
        if (!audioRecorder.isRecording) return;

        // Clear timer
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        pulseLoop.current?.stop();
        pulseAnim.setValue(1);
        waveAnim.setValue(0);

        setState('transcribing');

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
                    setText(transcribedText);
                    setState('expanded');

                    // Auto-submit if we got text
                    if (transcribedText.trim()) {
                        setTimeout(() => handleSubmit(transcribedText), 500);
                    }
                } else {
                    throw new Error(`Transcription failed: ${response.status}`);
                }
            } else {
                setState('expanded');
            }
        } catch (err) {
            console.error('[SmartCommandInput] Transcription error:', err);
            setState('expanded');
        }
    }, [audioRecorder, apiBaseUrl, getAuthToken, pulseAnim, waveAnim]);

    // ── @ Mentions ──
    const handleTextChange = useCallback((value: string) => {
        setText(value);

        // Detect @ trigger
        const lastAtIndex = value.lastIndexOf('@');
        if (lastAtIndex !== -1) {
            const afterAt = value.substring(lastAtIndex + 1);
            // Only show if the @ is at start or preceded by a space
            const charBefore = lastAtIndex > 0 ? value[lastAtIndex - 1] : ' ';
            if (charBefore === ' ' || lastAtIndex === 0) {
                if (!afterAt.includes(' ')) {
                    setShowMentions(true);
                    setMentionFilter(afterAt.toLowerCase());
                    return;
                }
            }
        }
        setShowMentions(false);
    }, []);

    const insertMention = useCallback((field: FieldOption) => {
        const lastAtIndex = text.lastIndexOf('@');
        if (lastAtIndex !== -1) {
            const before = text.substring(0, lastAtIndex);
            const newText = `${before}@${field.label} `;
            setText(newText);
            setMentionedFields(prev => [...new Set([...prev, field.key])]);
        }
        setShowMentions(false);
        inputRef.current?.focus();
    }, [text]);

    const filteredFields = availableFields.filter(f =>
        f.label.toLowerCase().includes(mentionFilter)
    );

    // ── Submit ──
    const handleSubmit = useCallback(async (overrideText?: string) => {
        const submitText = overrideText || text;
        if (!submitText.trim()) return;

        // Extract mentioned fields from text
        const fieldMentions = [...mentionedFields];
        // Also scan for @mentions in text that weren't selected from dropdown
        const atRegex = /@([\w\s()]+?)(?=\s@|\s*$|,)/g;
        let match: RegExpExecArray | null;
        while ((match = atRegex.exec(submitText)) !== null) {
            const mentioned = match[1].trim();
            const matchedField = availableFields.find(
                f => f.label.toLowerCase() === mentioned.toLowerCase()
            );
            if (matchedField && !fieldMentions.includes(matchedField.key)) {
                fieldMentions.push(matchedField.key);
            }
        }

        setState('loading');
        try {
            await onSubmit(submitText, fieldMentions);
        } catch (e) {
            console.error('[SmartCommandInput] Submit error:', e);
        }
    }, [text, mentionedFields, availableFields, onSubmit]);

    // ── Render: Collapsed ──
    if (state === 'collapsed') {
        return (

            <TouchableOpacity style={styles.collapsedSimple} onPress={handleExpand} activeOpacity={0.7}>
                <Ionicons name="pencil" size={16} color="#6B7280" />
                <Text style={styles.collapsedSimpleText}>{label}</Text>
            </TouchableOpacity>

        );
    }

    // Format duration as M:SS
    const formatDuration = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    // ── Render: Recording (compact inline bar) ──
    if (state === 'recording') {
        return (
            <Animated.View
                style={[
                    variant === 'inline'
                        ? styles.inlineExpanded
                        : disableKeyboardHandling
                            ? [styles.expanded, fullWidth && { width: '100%', borderRadius: 0, marginHorizontal: 0 }]
                            : [styles.expandedAboveKeyboard, { bottom: Math.max(80, keyboardHeight + 10) }],
                    { opacity: expandAnim, transform: [{ translateY: expandAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] },
                ]}
            >
                <View style={styles.recordingBar}>
                    {/* Cancel */}
                    <TouchableOpacity
                        style={styles.recordingBarButton}
                        onPress={() => {
                            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
                            if (audioRecorder.isRecording) {
                                audioRecorder.stop();
                            }
                            pulseLoop.current?.stop();
                            pulseAnim.setValue(1);
                            handleCollapse();
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="close" size={20} color="#6B7280" />
                    </TouchableOpacity>

                    {/* Waveform + Timer */}
                    <View style={styles.recordingBarCenter}>
                        <View style={styles.compactWaveContainer}>
                            {[0.6, 0.9, 1.2, 0.8, 1.4, 1.0, 0.7, 1.3, 0.9, 1.1, 0.6, 0.8, 1.2, 1.0, 0.7].map((scale, i) => (
                                <Animated.View
                                    key={i}
                                    style={[
                                        styles.compactWaveBar,
                                        {
                                            transform: [
                                                {
                                                    scaleY: pulseAnim.interpolate({
                                                        inputRange: [1, 1.4],
                                                        outputRange: [scale, scale * (i % 3 === 0 ? 1.6 : 1.3)],
                                                    }),
                                                },
                                            ],
                                        },
                                    ]}
                                />
                            ))}
                        </View>
                        <Text style={styles.recordingTimer}>{formatDuration(recordingDuration)}</Text>
                    </View>

                    {/* Submit (stop + transcribe) */}
                    <TouchableOpacity
                        style={styles.recordingBarSubmit}
                        onPress={stopRecording}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="checkmark" size={20} color="#fff" />
                    </TouchableOpacity>
                </View>
            </Animated.View>
        );
    }

    // ── Render: Transcribing (compact inline) ──
    if (state === 'transcribing') {
        return (
            <Animated.View
                style={[
                    variant === 'inline'
                        ? styles.inlineExpanded
                        : disableKeyboardHandling
                            ? [styles.expanded, fullWidth && { width: '100%', borderRadius: 0, marginHorizontal: 0 }]
                            : [styles.expandedAboveKeyboard, { bottom: Math.max(80, keyboardHeight + 10) }],
                    { opacity: expandAnim, transform: [{ translateY: expandAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] },
                ]}
            >
                <View style={styles.recordingBar}>
                    <ActivityIndicator size="small" color="#8BB04F" />
                    <Text style={styles.transcribingInlineText}>Transcribing…</Text>
                    <View style={{ width: 36 }} />
                </View>
            </Animated.View >
        );
    }

    // ── Render: Expanded (text input) / Loading ──
    return (
        <Animated.View
            style={[
                variant === 'inline'
                    ? styles.inlineExpanded
                    : disableKeyboardHandling
                        ? [styles.expanded, fullWidth && { width: '100%', borderRadius: 0, marginHorizontal: 0 }]
                        : [styles.expandedAboveKeyboard, { bottom: Math.max(80, keyboardHeight + 10) }],
                { opacity: expandAnim, transform: [{ translateY: expandAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] },
            ]}
        >
            {/* Header (only for default variant) */}
            {variant === 'default' && (
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>{headerTitle}</Text>
                    <TouchableOpacity onPress={handleCollapse} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Ionicons name="close" size={20} color="#666" />
                    </TouchableOpacity>
                </View>
            )}

            {/* Recording error message */}
            {recordingError && (
                <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle" size={16} color="#EF4444" />
                    <Text style={styles.errorText}>{recordingError}</Text>
                    <TouchableOpacity onPress={() => setRecordingError(null)} hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}>
                        <Ionicons name="close" size={16} color="#9CA3AF" />
                    </TouchableOpacity>
                </View>
            )}

            {/* Mention chips */}
            {mentionedFields.length > 0 && (
                <View style={styles.chipRow}>
                    {mentionedFields.map(fieldKey => {
                        const field = availableFields.find(f => f.key === fieldKey);
                        return (
                            <View key={fieldKey} style={styles.chip}>
                                <Text style={styles.chipText}>@{field?.label || fieldKey}</Text>
                                <TouchableOpacity
                                    onPress={() => setMentionedFields(prev => prev.filter(k => k !== fieldKey))}
                                    hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                                >
                                    <Ionicons name="close-circle" size={14} color="#666" />
                                </TouchableOpacity>
                            </View>
                        );
                    })}
                </View>
            )}

            {/* Input row */}
            <View style={[styles.inputRow, variant === 'inline' && styles.inlineInputRow]}>
                <TextInput
                    ref={inputRef}
                    style={styles.textInput}
                    value={text}
                    onChangeText={handleTextChange}
                    placeholder={placeholder}
                    placeholderTextColor="#999"
                    multiline
                    maxLength={500}
                    editable={state !== 'loading'}
                />
                <TouchableOpacity
                    style={styles.micButton}
                    onPress={startRecording}
                    disabled={state === 'loading'}
                >
                    <Ionicons name="mic" size={22} color={state === 'loading' ? '#999' : '#8BB04F'} />
                </TouchableOpacity>
            </View>

            {/* @ Autocomplete dropdown */}
            {showMentions && filteredFields.length > 0 && (
                <View style={styles.mentionDropdown}>
                    <FlatList
                        data={filteredFields.slice(0, 8)}
                        keyExtractor={item => item.key}
                        keyboardShouldPersistTaps="handled"
                        renderItem={({ item }) => (
                            <TouchableOpacity
                                style={styles.mentionItem}
                                onPress={() => insertMention(item)}
                            >
                                <Ionicons name="at" size={14} color="#8BB04F" />
                                <Text style={styles.mentionLabel}>{item.label}</Text>
                                {item.platform && (
                                    <Text style={styles.mentionPlatform}>{item.platform}</Text>
                                )}
                            </TouchableOpacity>
                        )}
                    />
                </View>
            )}

            {/* Actions */}
            <View style={styles.actions}>
                {variant === 'default' && (
                    <TouchableOpacity style={styles.cancelButton} onPress={handleCollapse} disabled={state === 'loading'}>
                        <Text style={styles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity
                    style={[styles.submitButton, (!text.trim() || state === 'loading') && styles.submitDisabled]}
                    onPress={() => handleSubmit()}
                    disabled={!text.trim() || state === 'loading'}
                >
                    {state === 'loading' ? (
                        <ActivityIndicator size="small" color="#fff" />
                    ) : (
                        <Text style={styles.submitText}>{submitLabel}</Text>
                    )}
                </TouchableOpacity>
            </View>
        </Animated.View>
    );
};

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    // Collapsed
    collapsedGradient: {
        paddingTop: 20,
        paddingBottom: 8,
    },
    collapsed: {
        marginHorizontal: 16,
        marginVertical: 8,
        backgroundColor: '#fff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        overflow: 'hidden',
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.05,
                shadowRadius: 3,
            },
            android: {
                elevation: 2,
            },
        }),
    },
    collapsedInner: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        gap: 8,
    },
    collapsedText: {
        flex: 1,
        color: '#4B5563',
        fontSize: 14,
        fontWeight: '500',
    },
    // Simple clean collapsed style (no border/card)
    collapsedSimple: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        gap: 8,
    },
    collapsedSimpleText: {
        color: '#6B7280',
        fontSize: 14,
        fontWeight: '500',
    },

    // Expanded
    expanded: {
        marginHorizontal: 16,
        marginVertical: 8,
        backgroundColor: '#fff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        padding: 20,
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.1,
                shadowRadius: 12,
            },
            android: {
                elevation: 6,
            },
        }),
    },
    // Expanded state positioned above keyboard
    expandedAboveKeyboard: {
        position: 'absolute',
        bottom: 80,
        left: 0,
        right: 0,
        marginHorizontal: 16,
        backgroundColor: '#fff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        padding: 20,
        ...Platform.select({
            ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 16,
            },
            android: {
                elevation: 8,
            },
        }),
    },
    inlineExpanded: {
        backgroundColor: 'transparent',
        paddingHorizontal: 0,
        paddingTop: 8,
        paddingBottom: 0,
    },
    inlineInputRow: {
        backgroundColor: '#F9FAFB',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        minHeight: 56,
    },

    // Header
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    headerTitle: {
        color: '#111',
        fontSize: 18,
        fontWeight: '700',
    },

    // Chips
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3F4F6',
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 4,
        gap: 4,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    chipText: {
        color: '#8BB04F',
        fontSize: 12,
        fontWeight: '600',
    },

    // Input
    inputRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        // Default style for card-based input (no background)
    },
    textInput: {
        flex: 1,
        fontSize: 17,
        color: '#111',
        minHeight: 50,
        paddingTop: 8,
        paddingBottom: 8,
        paddingRight: 12,
        lineHeight: 24,
    },
    micButton: {
        padding: 8,
    },

    // Mention dropdown
    mentionDropdown: {
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        backgroundColor: '#fff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E7EB',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        zIndex: 100,
        marginBottom: 8,
    },
    mentionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
        gap: 8,
    },
    mentionLabel: {
        flex: 1,
        fontSize: 14,
        color: '#111',
        fontWeight: '500',
    },
    mentionPlatform: {
        fontSize: 12,
        color: '#6B7280',
    },

    // Actions
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        marginTop: 16,
        gap: 12,
    },
    cancelButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    cancelText: {
        color: '#6B7280',
        fontSize: 14,
        fontWeight: '500',
    },
    submitButton: {
        backgroundColor: '#8BB04F',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center',
    },
    submitDisabled: {
        opacity: 0.5,
    },
    submitText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },

    // Recording — compact inline bar
    recordingBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 4,
    },
    recordingBarButton: {
        padding: 8,
        backgroundColor: '#F3F4F6',
        borderRadius: 20,
    },
    recordingBarCenter: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    compactWaveContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
        gap: 2,
    },
    compactWaveBar: {
        width: 3,
        backgroundColor: '#8BB04F',
        borderRadius: 1.5,
    },
    recordingTimer: {
        fontSize: 14,
        fontVariant: ['tabular-nums'],
        color: '#EF4444',
        fontWeight: '600',
    },
    recordingBarSubmit: {
        padding: 8,
        backgroundColor: '#8BB04F',
        borderRadius: 20,
    },

    // Transcribing — inline
    transcribingInlineText: {
        fontSize: 14,
        color: '#4B5563',
        fontStyle: 'italic',
    },

    // Error message
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF2F2',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 12,
        gap: 8,
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    errorText: {
        flex: 1,
        fontSize: 13,
        color: '#DC2626',
    },
});

export default SmartCommandInput;
