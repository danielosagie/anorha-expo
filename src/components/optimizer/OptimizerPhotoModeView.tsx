import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Dimensions,
    Image,
    Alert,
    Platform,
    Animated,
} from 'react-native';
import { Camera, CameraView, CameraType, FlashMode } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/clerk-expo';
import { ensureSupabaseJwt, supabase } from '../../lib/supabase';
import { OPTIMIZER_THRESHOLDS } from '../../hooks/useOptimizerQueues';

const { width } = Dimensions.get('window');

const COLORS = {
    primary: '#8cc63f',
    accent: '#ffc800',
    surface: '#ffffff',
    text: '#1a1a1a',
    textLight: '#6c757d',
    error: '#dc3545',
};

interface OptimizerPhotoModeViewProps {
    onBack: () => void;
    onComplete: (ids: string[]) => void;
    /** When provided, use this list instead of fetching (real queue data from useOptimizerQueues) */
    queueProducts?: any[];
}

export function OptimizerPhotoModeView({ onBack, onComplete, queueProducts }: OptimizerPhotoModeViewProps) {
    const { getToken } = useAuth();
    const cameraRef = useRef<CameraView>(null);
    const [facing, setFacing] = useState<CameraType>('back');
    const [flash, setFlash] = useState<FlashMode>('off');
    const [cameraActive, setCameraActive] = useState(true);

    const handleBack = () => {
        setCameraActive(false);
        setTimeout(() => onBack(), 100);
    };

    // Data State
    const [products, setProducts] = useState<any[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
    const [sessionStreak, setSessionStreak] = useState(0);
    const [sessionProductIds, setSessionProductIds] = useState<Set<string>>(new Set());

    // Animations
    const cardAnim = useRef(new Animated.Value(0)).current;
    const shutterAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (queueProducts && queueProducts.length > 0) {
            setProducts(queueProducts);
            setLoading(false);
            Animated.spring(cardAnim, { toValue: 1, useNativeDriver: true, tension: 50, friction: 8 }).start();
        } else {
            loadNeedPhotosProducts();
        }
    }, []);

    const loadNeedPhotosProducts = async () => {
        try {
            await ensureSupabaseJwt();
            const { data, error } = await supabase
                .from('ProductVariants')
                .select(`
                    Id, Title, Price, Sku,
                    ProductImages:ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl)
                `)
                .limit(100);

            if (error) throw error;
            const needingPhotos = (data || []).filter(
                p => !p.ProductImages || (Array.isArray(p.ProductImages) ? p.ProductImages.length : 0) < OPTIMIZER_THRESHOLDS.minImages
            );
            setProducts(needingPhotos);
            Animated.spring(cardAnim, { toValue: 1, useNativeDriver: true, tension: 50, friction: 8 }).start();
        } catch (err) {
            console.error('[OptimizerPhoto] Error loading products', err);
            Alert.alert('Error', 'Failed to load products.');
        } finally {
            setLoading(false);
        }
    };

    const handleCapture = async () => {
        if (!cameraRef.current) return;

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Animated.sequence([
            Animated.timing(shutterAnim, { toValue: 0.8, duration: 50, useNativeDriver: true }),
            Animated.timing(shutterAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
        ]).start();

        try {
            const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
            if (photo) {
                setCapturedPhotos(prev => [...prev, photo.uri]);
                setSessionStreak(prev => prev + 1);

                // Track this product as "touched"
                const currentId = products[currentIndex].Id;
                setSessionProductIds(prev => new Set(prev).add(currentId));

                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
        } catch (error) {
            console.error('[OptimizerPhoto] Capture failed', error);
        }
    };

    const nextProduct = () => {
        if (currentIndex < products.length - 1) {
            // "Next up" logic can happen here if we wanted an interstitial
            setCurrentIndex(prev => prev + 1);
            setCapturedPhotos([]);
        } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert(
                'Mission Accomplished! 🏆',
                `You captured ${sessionStreak} new angles. Your listings are looking great!`,
                [{ text: 'View Dashboard', onPress: () => onComplete(Array.from(sessionProductIds)) }]
            );
        }
    };

    const prevProduct = () => {
        if (currentIndex > 0) {
            setCurrentIndex(prev => prev - 1);
            setCapturedPhotos([]);
        }
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <Text>Loading Camera Session...</Text>
            </View>
        );
    }

    if (products.length === 0) {
        return (
            <View style={styles.loadingContainer}>
                <Text>No products need photos right now!</Text>
                <TouchableOpacity onPress={handleBack} style={{ marginTop: 20 }}>
                    <Text style={{ color: COLORS.primary, fontWeight: 'bold' }}>Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const currentProduct = products[currentIndex];

    return (
        <View style={styles.container}>
            <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing={facing}
                flash={flash}
                active={cameraActive}
            >
                {/* Header (Top Left Stack + Close) */}
                <LinearGradient
                    colors={['rgba(0,0,0,0.6)', 'transparent']}
                    style={styles.headerOverlay}
                >
                    <View style={styles.headerLeft}>
                        <TouchableOpacity onPress={handleBack} style={styles.closeBtn}>
                            <MaterialCommunityIcons name="close" size={24} color="#fff" />
                        </TouchableOpacity>

                        {/* Top Left Product Stack */}
                        <Animated.View style={[styles.productStack, { opacity: cardAnim }]}>
                            <View style={styles.stackInfo}>
                                <Text style={styles.stackLabel}>ITEM {currentIndex + 1} / {products.length}</Text>
                                <Text style={styles.stackTitle} numberOfLines={1}>{currentProduct.Title}</Text>
                            </View>
                            <View style={styles.stackThumbs}>
                                {/* Show existing + newly captured */}
                                {(currentProduct.ProductImages || []).slice(0, 1).map((img: any, i: number) => (
                                    <Image key={`exist-${i}`} source={{ uri: img.ImageUrl }} style={styles.miniThumb} />
                                ))}
                                {capturedPhotos.map((uri, idx) => (
                                    <Image key={`new-${idx}`} source={{ uri }} style={[styles.miniThumb, styles.newThumbBorder]} />
                                ))}
                                <View style={styles.addMoreStack}>
                                    <MaterialCommunityIcons name="plus" size={16} color="#fff" />
                                </View>
                            </View>
                        </Animated.View>
                    </View>

                    <View style={styles.headerRight}>
                        <View style={styles.streakContainer}>
                            <MaterialCommunityIcons name="fire" size={20} color={COLORS.accent} />
                            <Text style={styles.streakText}>{sessionStreak}</Text>
                        </View>
                        <TouchableOpacity onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')} style={styles.flipBtn}>
                            <MaterialCommunityIcons name="camera-flip" size={24} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </LinearGradient>

                {/* Bottom Controls */}
                <View style={styles.bottomControls}>
                    <View style={styles.shutterBar}>
                        <View style={styles.navAction}>
                            {currentIndex > 0 ? (
                                <TouchableOpacity onPress={prevProduct} style={[styles.nextBtn, {}]}>
                                    <Text style={styles.nextText}>BACK</Text>
                                    <MaterialCommunityIcons name="chevron-left" size={28} color="#fff" />
                                </TouchableOpacity>
                            ) : <View style={{ width: 28 }} />}
                        </View>

                        <TouchableOpacity onPress={handleCapture} activeOpacity={0.9}>
                            <Animated.View style={[styles.shutterBtnOuter, { transform: [{ scale: shutterAnim }] }]}>

                                <View style={styles.shutterBtnInner} />
                            </Animated.View>
                        </TouchableOpacity>

                        <TouchableOpacity style={[styles.nextBtn, { backgroundColor: COLORS.primary, paddingVertical: 0, paddingHorizontal: 0 }]} onPress={nextProduct}>
                            <View style={styles.nextBtn}>
                                <Text style={styles.nextText}>CONTINUE</Text>
                                <MaterialCommunityIcons name="chevron-right" size={24} color="#fff" />
                            </View>
                        </TouchableOpacity>
                    </View>
                </View>
            </CameraView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
    },
    camera: {
        flex: 1,
    },
    headerOverlay: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingTop: Platform.OS === 'ios' ? 60 : 40,
        paddingHorizontal: 20,
        paddingBottom: 60,
    },
    headerLeft: {
        flex: 1,
        alignItems: 'flex-start',
    },
    headerRight: {
        alignItems: 'flex-end',
        gap: 12,
    },
    closeBtn: {
        padding: 8,
        backgroundColor: 'rgba(0,0,0,0.3)',
        borderRadius: 20,
        marginBottom: 16,
    },
    flipBtn: {
        padding: 8,
        backgroundColor: 'rgba(0,0,0,0.3)',
        borderRadius: 20,
    },
    // Product Stack (Top Left)
    productStack: {
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        borderRadius: 16,
        padding: 12,
        maxWidth: 220,
    },
    stackInfo: {
        marginBottom: 8,
    },
    stackLabel: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 10,
        fontWeight: 'bold',
        marginBottom: 2,
    },
    stackTitle: {
        color: '#fff',
        fontSize: 14,
        fontWeight: 'bold',
    },
    stackThumbs: {
        flexDirection: 'column',
        gap: 6,
    },
    miniThumb: {
        width: 32,
        height: 32,
        borderRadius: 6,
        backgroundColor: '#444',
    },
    newThumbBorder: {
        borderWidth: 2,
        borderColor: COLORS.primary,
    },
    addMoreStack: {
        width: 32,
        height: 32,
        borderRadius: 6,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
        borderStyle: 'dashed',
    },

    streakContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        gap: 4,
    },
    streakText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
    bottomControls: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingBottom: Platform.OS === 'ios' ? 50 : 30,
        paddingHorizontal: 20,
    },
    shutterBar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 10,
    },
    shutterBtnOuter: {
        width: 80,
        height: 80,
        borderRadius: 40,
        borderWidth: 4,
        borderColor: '#fff',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.2)',
    },
    shutterBtnInner: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#fff',
    },
    navAction: {
        width: 100,
        justifyContent: 'center',
        alignItems: 'center',
    },
    navBtn: {
        padding: 12,
        backgroundColor: 'rgba(0,0,0,0.3)',
        borderRadius: 30,
    },
    nextBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.2)',
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 20,
    },
    nextText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 12,
        marginRight: 2,
    },
});
