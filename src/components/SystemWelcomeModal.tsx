import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    ScrollView,
    Dimensions,
    SafeAreaView,
    Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Bell, CheckCircle, ShieldCheck, Zap } from 'lucide-react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    FadeInUp,
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');

export interface WelcomeFeature {
    icon: React.ReactNode;
    title: string;
    description: string;
    iconBgColor?: string;
}

export interface SystemWelcomeOptions {
    title: string;
    subtitle?: string;
    features: WelcomeFeature[];
    buttonText?: string;
    onComplete?: () => void;
}

interface SystemWelcomeModalProps {
    visible: boolean;
    options: SystemWelcomeOptions;
    onClose: () => void;
}

const SystemWelcomeModal: React.FC<SystemWelcomeModalProps> = ({ visible, options, onClose }) => {
    const handleComplete = () => {
        if (options.onComplete) {
            options.onComplete();
        }
        onClose();
    };

    if (!visible) return null;

    return (
        <Modal
            transparent
            visible={visible}
            animationType="slide"
            onRequestClose={onClose}
        >
            <View style={styles.container}>
                <SafeAreaView style={styles.safeArea}>
                    <ScrollView contentContainerStyle={styles.scrollContent}>
                        <View style={styles.header}>
                            <View style={styles.bellIconWrapper}>
                                <BlurView intensity={20} tint="light" style={styles.iconBlur}>
                                    <Bell size={40} color="#1a1a1a" />
                                </BlurView>
                            </View>
                            <Text style={styles.title}>{options.title}</Text>
                            {options.subtitle && (
                                <Text style={styles.subtitle}>{options.subtitle}</Text>
                            )}
                        </View>

                        <View style={styles.featuresContainer}>
                            {options.features.map((feature, index) => (
                                <Animated.View
                                    key={index}
                                    entering={FadeInUp.delay(index * 200).springify()}
                                    style={styles.featureCard}
                                >
                                    <View style={[styles.featureIconContainer, { backgroundColor: feature.iconBgColor || '#F3F4F6' }]}>
                                        {feature.icon}
                                    </View>
                                    <View style={styles.featureTextContainer}>
                                        <Text style={styles.featureTitle}>{feature.title}</Text>
                                        <Text style={styles.featureDescription}>{feature.description}</Text>
                                    </View>
                                </Animated.View>
                            ))}
                        </View>
                    </ScrollView>

                    <View style={styles.footer}>
                        <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={handleComplete}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.buttonText}>{options.buttonText || 'Continue'}</Text>
                        </TouchableOpacity>
                    </View>
                </SafeAreaView>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    safeArea: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 24,
        paddingTop: 40,
        paddingBottom: 100,
    },
    header: {
        alignItems: 'center',
        marginBottom: 40,
    },
    bellIconWrapper: {
        width: 80,
        height: 80,
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
        backgroundColor: '#F9FAFB',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
    },
    iconBlur: {
        width: '100%',
        height: '100%',
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: '#1a1a1a',
        textAlign: 'center',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: '#666',
        textAlign: 'center',
        lineHeight: 24,
    },
    featuresContainer: {
        gap: 16,
    },
    featureCard: {
        flexDirection: 'row',
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 20,
        borderWidth: 1,
        borderColor: '#F3F4F6',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03,
        shadowRadius: 8,
    },
    featureIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    featureTextContainer: {
        flex: 1,
    },
    featureTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: '#1a1a1a',
        marginBottom: 4,
    },
    featureDescription: {
        fontSize: 14,
        color: '#666',
        lineHeight: 20,
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 24,
        paddingBottom: Platform.OS === 'ios' ? 40 : 24,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
    },
    primaryButton: {
        backgroundColor: '#1a1a1a',
        borderRadius: 16,
        height: 56,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 5,
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 17,
        fontWeight: '600',
    },
});

export default SystemWelcomeModal;
