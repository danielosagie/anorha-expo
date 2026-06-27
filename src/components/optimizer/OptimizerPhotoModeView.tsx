import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Image,
    Alert,
    ScrollView,
    Animated,
    ActivityIndicator,
} from 'react-native';
import { CameraView, CameraType, FlashMode } from 'expo-camera';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { ensureSupabaseJwt, supabase } from '../../lib/supabase';
import { OPTIMIZER_THRESHOLDS } from '../../hooks/useOptimizerQueues';
import { uploadProductImage } from '../../utils/uploadProductImage';
import { API_BASE_URL } from '../../config/env';
import { createLogger } from '../../utils/logger';
const log = createLogger('OptimizerPhotoModeView');

// Same camera language as AddProduct: black canvas, a rounded inset viewfinder,
// a horizontal photo strip up top, an 80px shutter. Shared brand green.
const GREEN = '#93C822';
const TOP_BAR_HEIGHT = 116; // label row + 64px photo strip
const CAMERA_BOTTOM_GAP = 184;
const CAMERA_SETTLE_MS = 650; // guard the cold-first-frame (matches AddProduct)
const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

interface OptimizerPhotoModeViewProps {
    onBack: () => void;
    onComplete: (ids: string[]) => void;
    /** When provided, use this list instead of fetching (real queue from useOptimizerQueues) */
    queueProducts?: any[];
}

export function OptimizerPhotoModeView({ onBack, onComplete, queueProducts }: OptimizerPhotoModeViewProps) {
    const insets = useSafeAreaInsets();
    const cameraRef = useRef<CameraView>(null);
    const cameraReadyAtRef = useRef(0);
    const [flash, setFlash] = useState<FlashMode>('off');
    const [cameraActive, setCameraActive] = useState(true);

    const [products, setProducts] = useState<any[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    // Photos captured for the CURRENT item this session (uris); first one = cover.
    const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
    const [persisting, setPersisting] = useState(false);
    // Items whose photos actually SAVED — a ref so onComplete reads it without a
    // stale closure right after an async persist. Only saved items leave the queue.
    const touchedRef = useRef<Set<string>>(new Set());

    const shutterScale = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (queueProducts && queueProducts.length > 0) {
            setProducts(queueProducts);
            setLoading(false);
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
                (p) => !p.ProductImages || (Array.isArray(p.ProductImages) ? p.ProductImages.length : 0) < OPTIMIZER_THRESHOLDS.minImages,
            );
            setProducts(needingPhotos);
        } catch (err) {
            log.error('[OptimizerPhoto] Error loading products', err);
            Alert.alert('Error', 'Failed to load products.');
        } finally {
            setLoading(false);
        }
    };

    const handleBack = async () => {
        if (persisting) return;
        await saveCurrent();
        setCameraActive(false);
        setTimeout(() => onBack(), 100);
    };

    const toggleFlash = () => setFlash((f) => (f === 'off' ? 'on' : f === 'on' ? 'auto' : 'off'));
    const flashIcon = flash === 'on' ? 'flash' : flash === 'auto' ? 'flash-auto' : 'flash-off';

    const markTouched = (id: string) => { touchedRef.current.add(id); };

    // Upload this item's captured photos and append them to the variant's images
    // via the same path the Photos sheet uses (PUT /api/products/:id ImageUrls).
    // Returns false on failure so the caller can keep the photos and warn.
    const persistItem = async (product: any, uris: string[]): Promise<boolean> => {
        if (!uris.length) return true;
        try {
            const uploaded = (
                await Promise.all(
                    uris.map((u, i) =>
                        uploadProductImage(u, `opt-${product.Id}-${i}-${Date.now()}`).catch((e) => {
                            log.error('[OptimizerPhoto] upload failed', e);
                            return null;
                        }),
                    ),
                )
            ).filter(Boolean) as string[];
            if (!uploaded.length) return false;

            const existing = (product.ProductImages || []).map((im: any) => im.ImageUrl).filter(Boolean);
            const token = await ensureSupabaseJwt();
            if (token) {
                const res = await fetch(`${API_BASE_URL}/api/products/${product.Id}`, {
                    method: 'PUT',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ImageUrls: [...existing, ...uploaded] }),
                });
                if (!res.ok) throw new Error(`Save failed (${res.status})`);
            }
            // Keep local state fresh so re-visiting the item appends instead of clobbering.
            setProducts((prev) =>
                prev.map((p) =>
                    p.Id === product.Id
                        ? { ...p, ProductImages: [...(p.ProductImages || []), ...uploaded.map((url) => ({ ImageUrl: url }))] }
                        : p,
                ),
            );
            markTouched(product.Id);
            return true;
        } catch (e) {
            log.error('[OptimizerPhoto] persist failed', e);
            return false;
        }
    };

    const handleCapture = async () => {
        if (!cameraRef.current) return;
        // Settle: the first frame after the preview attaches is dark/blurry.
        const since = Date.now() - cameraReadyAtRef.current;
        if (cameraReadyAtRef.current === 0 || since < CAMERA_SETTLE_MS) {
            await new Promise((r) => setTimeout(r, Math.max(120, CAMERA_SETTLE_MS - since)));
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        Animated.sequence([
            Animated.timing(shutterScale, { toValue: 0.82, duration: 60, useNativeDriver: true }),
            Animated.spring(shutterScale, { toValue: 1, useNativeDriver: true, tension: 60, friction: 6 }),
        ]).start();
        try {
            const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
            if (photo) {
                setCapturedPhotos((prev) => [...prev, photo.uri]);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
        } catch (error) {
            log.error('[OptimizerPhoto] Capture failed', error);
        }
    };

    const handleImport = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsMultipleSelection: true,
                quality: 0.7,
            });
            if (!result.canceled && result.assets?.length) {
                setCapturedPhotos((prev) => [...prev, ...result.assets.map((a) => a.uri)]);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
        } catch (error) {
            log.error('[OptimizerPhoto] Import failed', error);
        }
    };

    const removePhoto = (uri: string) => setCapturedPhotos((prev) => prev.filter((u) => u !== uri));

    // Save the current item's captures before leaving it. Blocks the move on a
    // failed save so the photos aren't silently lost.
    const saveCurrent = async (): Promise<boolean> => {
        if (!capturedPhotos.length) return true;
        setPersisting(true);
        const ok = await persistItem(products[currentIndex], capturedPhotos);
        setPersisting(false);
        if (!ok) Alert.alert("Couldn't save", 'Check your connection and try again.');
        return ok;
    };

    const nextProduct = async () => {
        if (persisting) return;
        if (!(await saveCurrent())) return;
        if (currentIndex < products.length - 1) {
            setCurrentIndex((i) => i + 1);
            setCapturedPhotos([]);
        } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onComplete(Array.from(touchedRef.current));
        }
    };

    const prevProduct = async () => {
        if (persisting || currentIndex === 0) return;
        if (!(await saveCurrent())) return;
        setCurrentIndex((i) => i - 1);
        setCapturedPhotos([]);
    };

    if (loading) {
        return (
            <View style={styles.center}>
                <Text style={styles.centerText}>Loading…</Text>
            </View>
        );
    }

    if (products.length === 0) {
        return (
            <View style={styles.center}>
                <Text style={styles.centerText}>No items need photos.</Text>
                <TouchableOpacity onPress={handleBack} style={{ marginTop: 16 }}>
                    <Text style={{ color: GREEN, fontWeight: '700' }}>Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const currentProduct = products[currentIndex];
    const existing = (currentProduct.ProductImages || []) as any[];
    const isLast = currentIndex >= products.length - 1;

    return (
        <View style={styles.container}>
            {/* Zone 1 — black top bar: item label + horizontal photo strip */}
            <View style={[styles.topBar, { height: insets.top + TOP_BAR_HEIGHT }]}>
                <View style={[styles.itemLabel, { marginTop: insets.top + 6 }]}>
                    <Text style={styles.itemCount}>{currentIndex + 1} / {products.length}</Text>
                    <Text style={styles.itemTitle} numberOfLines={1}>{currentProduct.Title}</Text>
                </View>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.stripContent}
                    keyboardShouldPersistTaps="handled"
                >
                    <TouchableOpacity style={styles.addTile} onPress={handleImport} activeOpacity={0.8}>
                        <MaterialIcons name="add" size={26} color="rgba(255,255,255,0.85)" />
                    </TouchableOpacity>
                    {existing.map((img, i) => (
                        <Image key={`e-${i}`} source={{ uri: img.ImageUrl }} style={styles.tile} />
                    ))}
                    {capturedPhotos.map((uri, i) => (
                        <View key={`c-${i}`} style={styles.tileWrap}>
                            <Image
                                source={{ uri }}
                                style={[styles.tile, i === 0 && existing.length === 0 && styles.tileCover]}
                            />
                            <TouchableOpacity style={styles.tileRemove} hitSlop={HIT} onPress={() => removePhoto(uri)}>
                                <MaterialIcons name="remove" size={13} color="#FFF" />
                            </TouchableOpacity>
                        </View>
                    ))}
                </ScrollView>
            </View>

            {/* Zone 2 — rounded inset viewfinder. CameraView has NO children (Fabric
                unmount-crash class); back + flash overlays are siblings inside the card. */}
            <View style={[styles.viewfinder, { top: insets.top + TOP_BAR_HEIGHT, bottom: CAMERA_BOTTOM_GAP }]}>
                <CameraView
                    ref={cameraRef}
                    style={StyleSheet.absoluteFill}
                    facing="back"
                    flash={flash}
                    active={cameraActive}
                    onCameraReady={() => { cameraReadyAtRef.current = Date.now(); }}
                />
                <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.8} hitSlop={HIT}>
                    <MaterialIcons name="arrow-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.flashBtn} onPress={toggleFlash} activeOpacity={0.8} hitSlop={HIT}>
                    <MaterialCommunityIcons name={flashIcon} size={22} color="#FFF" />
                </TouchableOpacity>
            </View>

            {/* Zone 3 — bottom controls: prev · 80px shutter · next/done */}
            <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 18 }]}>
                <View style={styles.side}>
                    {currentIndex > 0 && (
                        <TouchableOpacity onPress={prevProduct} style={styles.navBtn} hitSlop={HIT} activeOpacity={0.85}>
                            <MaterialCommunityIcons name="chevron-left" size={28} color="#FFF" />
                        </TouchableOpacity>
                    )}
                </View>

                <TouchableOpacity onPress={handleCapture} activeOpacity={0.9} disabled={persisting}>
                    <Animated.View style={[styles.shutterOuter, { transform: [{ scale: shutterScale }], opacity: persisting ? 0.5 : 1 }]}>
                        <View style={styles.shutterInner} />
                    </Animated.View>
                </TouchableOpacity>

                <View style={styles.side}>
                    <TouchableOpacity onPress={nextProduct} style={styles.continueBtn} activeOpacity={0.9} disabled={persisting}>
                        {persisting ? (
                            <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                            <>
                                <Text style={styles.continueText}>{isLast ? 'Done' : 'Next'}</Text>
                                <MaterialCommunityIcons name="chevron-right" size={20} color="#FFF" />
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
    centerText: { color: '#fff', fontSize: 15, fontWeight: '600' },

    // Zone 1 — top bar + strip
    topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30, backgroundColor: '#000', justifyContent: 'flex-end', paddingBottom: 10 },
    itemLabel: { paddingHorizontal: 16, marginBottom: 8 },
    itemCount: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
    itemTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 1 },
    stripContent: { paddingHorizontal: 16, alignItems: 'center', gap: 10, flexDirection: 'row' },
    addTile: { width: 64, height: 64, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
    tileWrap: { width: 64, height: 64 },
    tile: { width: 64, height: 64, borderRadius: 14, backgroundColor: '#1C1C1E' },
    tileCover: { borderWidth: 2, borderColor: GREEN },
    tileRemove: { position: 'absolute', top: -6, left: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FF6B4A', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#000' },

    // Zone 2 — viewfinder
    viewfinder: { position: 'absolute', left: 12, right: 12, borderRadius: 28, overflow: 'hidden', backgroundColor: '#101012' },
    backBtn: { position: 'absolute', top: 16, left: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', zIndex: 25 },
    flashBtn: { position: 'absolute', top: 16, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', zIndex: 25 },

    // Zone 3 — bottom controls
    bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 12 },
    side: { width: 100, alignItems: 'center', justifyContent: 'center' },
    navBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
    shutterOuter: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
    shutterInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
    continueBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: GREEN, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 24 },
    continueText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
});
