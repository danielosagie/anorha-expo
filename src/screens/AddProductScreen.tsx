import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  SafeAreaView,
  Dimensions,
  Platform,
  Alert,
  StatusBar,
  Pressable,
  Clipboard,
  ScrollView,
  Modal,
  TextInput,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { Camera, CameraView, CameraType, FlashMode, BarcodeScanningResult } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  runOnJS,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  withRepeat,
} from 'react-native-reanimated';
import { PanGestureHandler, TapGestureHandler, State, PanGestureHandlerGestureEvent } from 'react-native-gesture-handler';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { SvgXml } from 'react-native-svg';
import PhotoStack, { CapturedPhoto } from '../components/camera/PhotoStack';
import CameraControls from '../components/camera/CameraControls';
import BusinessTemplateModal, { BusinessTemplate } from '../components/camera/BusinessTemplateModal';
import ItemNavigationBar from '../components/camera/ItemNavigationBar';
import QuickProductDetailSheet from '../components/QuickProductDetailSheet';
import ManifestReviewSheet from '../components/ManifestReviewSheet';
import ReceiptReviewSheet from '../components/ReceiptReviewSheet';
import TierSelectorModal from '../components/TierSelectorModal';
import UsageCounter from '../components/UsageCounter';
import useFreemiumUsage from '../hooks/useFreemiumUsage';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { File, Directory, Paths } from 'expo-file-system';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Types

export interface Analysis {
  jobId: string;
  userId: string;
  status: string;
  currentStage: string;
  progress: {
    totalProducts: number;
    completedProducts: number;
    currentProductIndex: number;
    failedProducts: number;
    stagePercentage: number;
  };
  results: Array<{
    productIndex: number;
    productId: string;
    variantId: string;
    serpApiData: Array<{
      position?: number;
      title?: string;
      link?: string;
      source?: string;
      source_icon?: string;
      thumbnail?: string;
      thumbnail_width?: number;
      thumbnail_height?: number;
      image?: string;
      image_width?: number;
      image_height?: number;
      rating?: number;
      reviews?: number;
      price?: {
        value?: string;
        extracted_value?: number;
        currency?: string;
      };
      condition?: string;
      in_stock?: boolean;
    }>;
    rerankedResults: Array<{
      position?: number;
      title?: string;
      link?: string;
      source?: string;
      source_icon?: string;
      thumbnail?: string;
      thumbnail_width?: number;
      thumbnail_height?: number;
      image?: string;
      image_width?: number;
      image_height?: number;
      rank?: number;
      score?: number;
      rating?: number;
      reviews?: number;
      price?: {
        value?: string;
        extracted_value?: number;
        currency?: string;
      };
      condition?: string;
      in_stock?: boolean;
    }>;
    confidence: string; // Changed from number to string based on the JSON example
    vectorSearchFoundResults: boolean;
    originalTargetImage: string;
    timing: {
      quickScanMs: number;
      serpApiMs: number;
      embeddingMs: number;
      vectorSearchMs: number;
      rerankingMs: number;
      totalMs: number;
    };
  }>;
  startedAt: string;
  updatedAt: string;
  summary: {
    highConfidenceCount: number;
    mediumConfidenceCount: number;
    lowConfidenceCount: number;
    totalEmbeddingsStored: number | null;
    averageProcessingTimeMs: number | null;
  };
  completedAt: string;
}

interface MatchCandidate {
  id: string;
  title: string;
  description: string;
  price: number;
  imageUrl: string;
  matchPercentage: number;
  sourceUrl: string;
}

interface JobResponse {
  jobId: string;
  status: string;
  estimatedTimeMinutes: number,
  totalProducts: number,
  message: string,
}

interface MatchResponse {
  systemAction: 'show_single_match' | 'show_multiple_matches' | 'show_multiple_candidates' | 'fallback_to_manual';
  confidence: 'high' | 'medium' | 'low';
  rankedCandidates: MatchCandidate[];
  totalMatches: number;
  reranker?: {
    type: 'llama4-groq' | 'jina-modal' | 'fast-text' | 'none';
    rankingMethod?: 'exact_match' | 'semantic_similarity' | 'fuzzy_match' | 'vector_fallback';
    confidence?: number;
    reasoning?: string;
    processingTimeMs?: number;
    alternatives?: any[];
  };
}

type AddProductScreenProps = StackScreenProps<AppStackParamList, 'AddProduct'>;

type CameraInstruction = 'ready' | 'move_closer' | 'move_back' | 'add_light' | 'focus' | 'processing' | 'matches_found' | 'no_matches' | 'barcode_scanned';

type CameraMode = 'camera' | 'barcode' | 'manifest' | 'receipt';

const AddProductScreen: React.FC<AddProductScreenProps | {}> = () => {
  const navigation = useNavigation();
  const theme = useTheme();


  console.log('[RENDER] AddProductScreen rendered');

  // Camera state
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraMode, setCameraMode] = useState<'camera' | 'barcode' | 'manifest' | 'receipt'>('camera');

  // Barcode state
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [barcodeNotificationCount, setBarcodeNotificationCount] = useState(0);
  const [barcodeSearchResult, setBarcodeSearchResult] = useState<any | null>(null);
  const [barcodeSearching, setBarcodeSearching] = useState(false);
  const [showBarcodeResultModal, setShowBarcodeResultModal] = useState(false);
  const [platformLocations, setPlatformLocations] = useState<{ id: string; name: string; platformType?: string; connectionId: string }[]>([]);

  // Manifest state
  const [showManifestSheet, setShowManifestSheet] = useState(false);
  const [manifestJobId, setManifestJobId] = useState<string | null>(null);

  // Receipt state
  const [showReceiptSheet, setShowReceiptSheet] = useState(false);
  const [receiptJobId, setReceiptJobId] = useState<string | null>(null);

  // Fetch platform locations on mount (with platformType from connections)
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        // Fetch locations with their connection's platformType
        const { data, error } = await supabase
          .from('PlatformLocations')
          .select('Id, Name, PlatformLocationId, PlatformConnectionId, PlatformConnections!inner(PlatformType)');
        if (data) {
          setPlatformLocations(data.map((l: any) => ({
            id: l.PlatformLocationId || l.Id,
            name: l.Name,
            platformType: l.PlatformConnections?.PlatformType,
            connectionId: l.PlatformConnectionId,
          })));
        }
      } catch (e) {
        console.error('[AddProduct] Error fetching locations:', e);
      }
    };
    fetchLocations();
  }, []);

  // UI state
  const [currentInstruction, setCurrentInstruction] = useState<CameraInstruction>('ready');
  const [showMatchSheet, setShowMatchSheet] = useState(false);
  const [showDeepSearchSheet, setShowDeepSearchSheet] = useState(false);
  const [matchData, setMatchData] = useState<MatchResponse | null>(null);
  // Quick scan storage per item and current sheet context
  const [quickScanStore, setQuickScanStore] = useState<Record<string, { matchData: MatchResponse; serpApiData: any[] }>>({});
  const [currentMatchItemId, setCurrentMatchItemId] = useState<string | null>(null);

  // Loading state tracking per item
  const [itemLoadingStates, setItemLoadingStates] = useState<Record<string, { isLoading: boolean; stage: string; }>>({});

  // Bulk mode state
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkItems, setBulkItems] = useState<Array<{
    id: string;
    photos: CapturedPhoto[];
    title?: string;
    isActive?: boolean;
  }>>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Auto-scan state
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [quickScanResults, setQuickScanResults] = useState<any[]>([]);

  // Job response state
  const [jobResponse, setJobResponse] = useState<JobResponse | null>(null);
  const quickScanCancelledRef = useRef(false);

  // Notification and progress state
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [showProgressBar, setShowProgressBar] = useState(false);

  // Freemium / Paywall state
  const { status: freemiumStatus, refresh: refreshFreemiumStatus, incrementLocalUsage } = useFreemiumUsage();
  const [showTierSelector, setShowTierSelector] = useState(false);

  // Experimental Text Search


  // Camera ref
  const cameraRef = useRef<CameraView>(null);
  const isFocused = useIsFocused();

  // Stable item ID generator to prevent key collisions
  const itemIdCounterRef = useRef(0);
  const generateItemId = useCallback(() => {
    itemIdCounterRef.current += 1;
    return `item-${Date.now()}-${itemIdCounterRef.current}`;
  }, []);

  // Debug useEffects to track state changes
  useEffect(() => {
    console.log('[EFFECT] bulkItems changed! New value:', {
      length: bulkItems.length,
      items: bulkItems.map(item => ({
        id: item.id,
        photosCount: item.photos.length,
        isActive: item.isActive
      }))
    });
  }, [bulkItems]);

  useEffect(() => {
    console.log('[EFFECT] activeItemId changed! New value:', activeItemId);
  }, [activeItemId]);


  // Animation values - separate for each modal
  const sheetTranslateY = useSharedValue(SCREEN_HEIGHT);
  const matchSheetTranslateY = useSharedValue(SCREEN_HEIGHT);

  // Force re-render counter for debugging
  const [forceRenderCount, setForceRenderCount] = useState(0);
  const forceRerender = useCallback(() => {
    console.log('[FORCE RENDER] Forcing component re-render');
    setForceRenderCount(prev => prev + 1);
  }, []);
  const captureButtonScale = useSharedValue(1);
  const flashOpacity = useSharedValue(0);
  const overlayOpacity = useSharedValue(0.3);

  // Progress and notification animations
  const progressWidth = useSharedValue(0);
  const spinRotation = useSharedValue(0);
  const notificationOpacity = useSharedValue(0);
  const notificationTranslateY = useSharedValue(-100);

  // Request camera permission on mount
  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  // Show notification function
  const showNotificationMessage = useCallback((message: string, duration: number = 3000) => {
    setNotificationMessage(message);
    setShowNotification(true);

    // Animate in
    notificationOpacity.value = withTiming(1, { duration: 300 });
    notificationTranslateY.value = withTiming(0, { duration: 300 });

    // Auto hide
    setTimeout(() => {
      notificationOpacity.value = withTiming(0, { duration: 300 });
      notificationTranslateY.value = withTiming(-100, { duration: 300 }, () => {
        runOnJS(setShowNotification)(false);
      });
    }, duration);
  }, [notificationOpacity, notificationTranslateY]);

  // Start progress bar animation
  const startProgressAnimation = useCallback(() => {
    setShowProgressBar(true);
    progressWidth.value = 0;

    // Spinning circle animation
    spinRotation.value = withRepeat(
      withTiming(360, { duration: 1000 }),
      -1,
      false
    );

    // Progress bar fill animation
    progressWidth.value = withTiming(100, { duration: 2000 });
  }, [progressWidth, spinRotation]);

  // Stop progress bar animation
  const stopProgressAnimation = useCallback(() => {
    setShowProgressBar(false);
    progressWidth.value = 0;
    spinRotation.value = 0;
  }, [progressWidth, spinRotation]);

  // Transform quick-scan ranked candidates to serpApiData for MatchSelection overrides
  const candidatesToSerpApiData = useCallback((candidates: Array<{
    id: string;
    title?: string;
    description?: string;
    price?: number;
    imageUrl?: string;
    sourceUrl?: string;
  }>): any[] => {
    const out: any[] = [];
    candidates.forEach((c, idx) => {
      out.push({
        position: idx + 1,
        title: c.title || 'Unknown Product',
        link: c.sourceUrl || '',
        source: 'quickscan',
        source_icon: '',
        thumbnail: c.imageUrl || '',
        image: c.imageUrl || '',
        price: typeof c.price === 'number' ? { value: `$${c.price}`, extracted_value: c.price, currency: 'USD' } : undefined,
      });
    });
    return out;
  }, []);

  // Instructions mapping
  const getInstructionText = (instruction: CameraInstruction): string => {
    switch (instruction) {
      case 'ready': cameraMode === 'receipt' ? 'Upload/take picture of receipt' : 'Upload/take picture of receipt';
      case 'ready': cameraMode === 'manifest' ? 'Upload/take picture of manifest' : 'Upload/take picture of manifest';
      case 'ready': return cameraMode === 'camera' ? 'Point camera at product' : 'Scan barcode on product';
      case 'move_closer': return 'Move closer to product';
      case 'move_back': return 'Move back from product';
      case 'add_light': return 'Add more light to scene';
      case 'focus': return 'Tap to focus';
      case 'processing': return 'Analyzing image...';
      case 'matches_found': return `${matchData?.totalMatches || 0} match${(matchData?.totalMatches || 0) > 1 ? 'es' : ''} found!`;
      case 'no_matches': return 'No matches yet - try another angle';
      case 'barcode_scanned': return scannedBarcode || 'Barcode scanned';
      default: return cameraMode === 'camera' ? 'Point camera at product' : 'lol';
    }
  };

  // Handle focus tap
  const handleFocusTap = useCallback((event: any) => {
    const { locationX, locationY } = event.nativeEvent;
    setCurrentInstruction('focus');

    // TODO: Implement actual focus at coordinates
    console.log('Focus at:', locationX, locationY);

    setTimeout(() => {
      setCurrentInstruction('ready');
    }, 1000);
  }, []);

  // Handle photo capture
  const handleCapture = useCallback(async () => {
    // BARCODE MODE: Open results sheet if we have a result
    if (cameraMode === 'barcode') {
      if (barcodeSearchResult) {
        setShowBarcodeResultModal(true);
      } else {
        Alert.alert('No Result', 'Point the camera at a barcode to scan.');
      }
      return;
    }

    if (!cameraRef.current || isCapturing) return;

    try {
      setIsCapturing(true);
      setCurrentInstruction('processing');

      // Start progress animation
      startProgressAnimation();

      // Animate capture button
      captureButtonScale.value = withSpring(0.8, { duration: 100 }, () => {
        captureButtonScale.value = withSpring(1, { duration: 200 });
      });

      // Flash effect
      if (flash === 'on') {
        flashOpacity.value = withTiming(1, { duration: 100 }, () => {
          flashOpacity.value = withTiming(0, { duration: 200 });
        });
      }

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: false,
      });

      if (photo) {
        const newPhoto: CapturedPhoto = {
          id: `photo-${Date.now()}`,
          uri: photo.uri,
          width: photo.width || SCREEN_WIDTH,
          height: photo.height || SCREEN_HEIGHT,
          timestamp: Date.now(),
          isCover: capturedPhotos.length === 0, // First photo is cover by default
        };

        setCapturedPhotos(prev => {
          const updated = [...prev, newPhoto];
          console.log('[PHOTO CAPTURE] Photos updated:', {
            previousCount: prev.length,
            newCount: updated.length,
            newPhotoId: newPhoto.id,
            allPhotoIds: updated.map(p => p.id)
          });
          return updated;
        });

        // SIMPLIFIED: Always create real items, regardless of mode
        console.log('[ITEM CREATION] ==================');
        console.log('[ITEM CREATION] Photo added to capturedPhotos:', newPhoto.id);
        console.log('[ITEM CREATION] Current bulkItems count:', bulkItems.length);
        console.log('[ITEM CREATION] Current activeItemId:', activeItemId);

        // Always create items in bulkItems (much simpler logic)
        if (bulkItems.length === 0) {
          // Very first photo ever - create first item
          console.log('[ITEM CREATION] Creating FIRST ITEM (no items exist yet)');
          const firstItem = {
            id: `item-${Date.now()}`,
            photos: [newPhoto],
            title: undefined,
            isActive: true
          };
          setBulkItems([firstItem]);
          setActiveItemId(firstItem.id);
          console.log('[ITEM CREATION] Created first item:', firstItem.id);
          console.log('[ITEM CREATION] Triggering quick scan (first photo of first item)');

          console.log('[FIRST ITEM] Created first item with ID:', firstItem.id);
          setTimeout(() => {
            console.log('[FIRST ITEM] About to call performQuickScan for first item:', firstItem.id);
            performQuickScan(newPhoto, firstItem.id);
          }, 500);

        } else {
          // Use current state (prev) to avoid stale closures. Prefer active item by isActive flag.
          setBulkItems(prev => {
            if (prev.length === 0) {
              // First item
              const firstId = `item-${Date.now()}`;
              setActiveItemId(firstId);
              setTimeout(() => performQuickScan(newPhoto, firstId), 500);
              return [{ id: firstId, photos: [newPhoto], title: undefined, isActive: true }];
            }

            const activeIndex = prev.findIndex(it => it.isActive);
            if (activeIndex >= 0) {
              const activeItemIdLocal = prev[activeIndex].id;
              const next = prev.map((it, idx) => {
                if (idx !== activeIndex) return it;
                const wasFirstPhoto = it.photos.length === 0;
                const updated = { ...it, photos: [...it.photos, newPhoto] };
                if (wasFirstPhoto) setTimeout(() => performQuickScan(newPhoto, activeItemIdLocal), 500);
                return updated;
              });
              return next;
            }

            // No active item flagged; create a new active item
            const newId = `item-${Date.now()}`;
            setActiveItemId(newId);
            setTimeout(() => performQuickScan(newPhoto, newId), 500);
            return [...prev.map(it => ({ ...it, isActive: false })), { id: newId, photos: [newPhoto], title: undefined, isActive: true }];
          });
        }

        setCurrentInstruction('ready');
        stopProgressAnimation();
        console.log('[ITEM CREATION] ==================');

        // FIXED: Use refs to get current state values, not closure-captured ones
        setTimeout(() => {
          console.log('[ITEM CREATION] State after timeout - bulkItems.length:', bulkItems.length);
          console.log('[ITEM CREATION] State after timeout - activeItemId:', activeItemId);
          console.log('[ITEM CREATION] 🚨 NOTE: These values are closure-captured and may be stale!');
        }, 100);
      }

    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
      setCurrentInstruction('ready');
      stopProgressAnimation();
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, capturedPhotos.length, flash, captureButtonScale, flashOpacity]);

  // Handle barcode scan - with debouncing to prevent duplicates
  const barcodeLastScannedRef = useRef<string | null>(null);
  const barcodeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBarCodeScanned = useCallback((scanningResult: BarcodeScanningResult) => {
    if (cameraMode !== 'barcode' || !scanningResult.data) return;

    // Debounce: Ignore if same barcode scanned within last 2 seconds
    if (barcodeLastScannedRef.current === scanningResult.data) {
      return; // Same barcode, ignore duplicate
    }

    // Clear any existing debounce timer
    if (barcodeDebounceRef.current) {
      clearTimeout(barcodeDebounceRef.current);
    }

    // Set the barcode and lock it for 2 seconds
    barcodeLastScannedRef.current = scanningResult.data;
    setScannedBarcode(scanningResult.data);
    setCurrentInstruction('barcode_scanned');
    setBarcodeNotificationCount(prev => prev + 1);

    console.log('Barcode scanned:', scanningResult.data);

    // Search backend for this barcode (once only)
    searchBarcodeOnBackend(scanningResult.data);

    // Reset the lock after 2 seconds to allow same barcode to be scanned again
    barcodeDebounceRef.current = setTimeout(() => {
      barcodeLastScannedRef.current = null;
      setCurrentInstruction('ready');
    }, 2000);
  }, [cameraMode]);

  // Search backend for product by barcode
  const searchBarcodeOnBackend = useCallback(async (barcode: string) => {
    try {
      setBarcodeSearching(true);
      setCurrentInstruction('processing');
      console.log(`[BARCODE] Searching backend for barcode: ${barcode}`);

      const token = await ensureSupabaseJwt();
      if (!token) {
        Alert.alert('Authentication Error', 'Please log in again.');
        setBarcodeSearching(false);
        setCurrentInstruction('ready');
        return;
      }

      const response = await fetch(
        `https://api.sssync.app/api/products/search-by-barcode?barcode=${encodeURIComponent(barcode)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.log(`[BARCODE] Search returned status ${response.status}`);
        setBarcodeSearching(false);
        setCurrentInstruction('ready');
        return;
      }

      const data = await response.json();

      if (data.error) {
        console.log(`[BARCODE] Product not found: ${data.error}`);
        Alert.alert('Product Not Found', data.error);
        setBarcodeSearching(false);
        setCurrentInstruction('ready');
        return;
      }

      console.log(`[BARCODE] Found product:`, data.variant.Title);
      setBarcodeSearchResult(data);
      setShowBarcodeResultModal(true);
      setBarcodeSearching(false);
      setCurrentInstruction('ready');
    } catch (error) {
      console.error(`[BARCODE] Search error:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      Alert.alert('Search Error', `Failed to search: ${errorMessage}`);
      setBarcodeSearching(false);
      setCurrentInstruction('ready');
    }
  }, []);

  // Toggle flash mode
  const toggleFlash = useCallback(() => {
    setFlash(current => {
      switch (current) {
        case 'off': return 'on';
        case 'on': return 'auto';
        case 'auto': return 'off';
        default: return 'off';
      }
    });
  }, []);

  // Toggle camera facing
  const toggleFacing = useCallback(() => {
    setFacing(current => current === 'back' ? 'front' : 'back');
  }, []);

  // Get flash icon
  const getFlashIcon = useCallback(() => {
    switch (flash) {
      case 'on': return 'flash';
      case 'auto': return 'flash-auto';
      case 'off': return 'flash-off';
      default: return 'flash-off';
    }
  }, [flash]);

  const handleContinue = useCallback(async () => {
    console.log('[CONTINUE] Button pressed, opening search sheet');
    console.log('[CONTINUE] Current state:', {
      capturedPhotosCount: capturedPhotos.length,
      isBulkMode,
      bulkItemsCount: bulkItems.length,
      activeItemId,
      cameraMode,
      hasBarcodeResult: !!barcodeSearchResult
    });

    // BARCODE MODE: Open barcode result modal if we have a result
    if (cameraMode === 'barcode' && barcodeSearchResult) {
      console.log('[CONTINUE] Barcode mode - opening barcode result modal');
      setShowBarcodeResultModal(true);
      return;
    }

    // MANIFEST MODE: Parse manifest pages
    if (cameraMode === 'manifest') {
      const allPhotos = bulkItems.flatMap(item => item.photos);
      if (allPhotos.length === 0) {
        Alert.alert('No Pages', 'Please capture at least one manifest page first.');
        return;
      }

      console.log('[CONTINUE] Manifest mode - parsing', allPhotos.length, 'pages');
      showNotificationMessage('Parsing manifest...', 10000);

      try {
        // Convert photos to base64 using fetch
        const images = await Promise.all(
          allPhotos.map(async (photo, index) => {
            try {
              // Use fetch to get the image as blob, then convert to base64
              const response = await fetch(photo.uri);
              const blob = await response.blob();
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const result = reader.result as string;
                  // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
                  const base64Data = result.split(',')[1] || result;
                  resolve(base64Data);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
              return { base64, filename: `page_${index + 1}.jpg` };
            } catch (e) {
              console.error('[MANIFEST] Failed to read photo:', e);
              return null;
            }
          })
        );

        const validImages = images.filter(Boolean);
        if (validImages.length === 0) {
          throw new Error('Failed to process any images');
        }

        // Call the manifest parsing API
        const jwt = await ensureSupabaseJwt();
        const API_URL = process.env.EXPO_PUBLIC_SSSYNC_BACKEND_URL || 'https://sssync-bknd.onrender.com';

        const response = await fetch(`${API_URL}/products/manifests/parse`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwt}`,
          },
          body: JSON.stringify({ images: validImages }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        console.log('[MANIFEST] Job started:', data.jobId);

        // Show the ManifestReviewSheet with the job ID
        setManifestJobId(data.jobId);
        setShowManifestSheet(true);

        // Clear photos after successful submission
        setBulkItems([]);
        setActiveItemId(null);

      } catch (error: any) {
        console.error('[MANIFEST] Error:', error);
        Alert.alert('Error', error.message || 'Failed to parse manifest');
      }

      return;
    }

    // RECEIPT MODE: Process receipt for inventory intake
    if (cameraMode === 'receipt') {
      const allPhotos = bulkItems.flatMap(item => item.photos);
      if (allPhotos.length === 0) {
        Alert.alert('No Receipts', 'Please capture at least one receipt first.');
        return;
      }

      console.log('[CONTINUE] Receipt mode - processing', allPhotos.length, 'receipts');
      showNotificationMessage('Processing receipt...', 10000);

      try {
        // Convert photos to base64 using fetch
        const images = await Promise.all(
          allPhotos.map(async (photo, index) => {
            try {
              const response = await fetch(photo.uri);
              const blob = await response.blob();
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const result = reader.result as string;
                  const base64Data = result.split(',')[1] || result;
                  resolve(base64Data);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
              return { base64, filename: `receipt_${index + 1}.jpg` };
            } catch (e) {
              console.error('[RECEIPT] Failed to read photo:', e);
              return null;
            }
          })
        );

        const validImages = images.filter(Boolean);
        if (validImages.length === 0) {
          throw new Error('Failed to process any images');
        }

        // Call the receipt parsing API
        const jwt = await ensureSupabaseJwt();
        const API_URL = process.env.EXPO_PUBLIC_SSSYNC_BACKEND_URL || 'https://sssync-bknd.onrender.com';

        const response = await fetch(`${API_URL}/products/receipts/parse`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwt}`,
          },
          body: JSON.stringify({ images: validImages }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        console.log('[RECEIPT] Job started:', data.jobId);

        // Show the ReceiptReviewSheet with the job ID
        setReceiptJobId(data.jobId);
        setShowReceiptSheet(true);

        // Clear photos after successful submission
        setBulkItems([]);
        setActiveItemId(null);

      } catch (error: any) {
        console.error('[RECEIPT] Error:', error);
        Alert.alert('Error', error.message || 'Failed to process receipt');
      }

      return;
    }

    // Always open sheet - it will show empty state if no photos
    setShowMatchSheet(false);
    matchSheetTranslateY.value = withTiming(SCREEN_HEIGHT, { duration: 150 });
    setShowDeepSearchSheet(true);
    sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.4); // Position for 60% height sheet
  }, [sheetTranslateY, capturedPhotos.length, isBulkMode, bulkItems, activeItemId, cameraMode, barcodeSearchResult, showNotificationMessage]);

  // Handle image picker - SIMPLIFIED: Always add to bulkItems
  const handleImageUpload = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need camera roll permissions to upload images.');
      return;
    }

    const crop_window_shape: ImagePicker.CropShape = 'rectangle';

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [9, 16],
      shape: crop_window_shape,
      allowsMultipleSelection: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const newPhoto: CapturedPhoto = {
        id: `upload-${Date.now()}`,
        uri: asset.uri,
        width: asset.width || SCREEN_WIDTH,
        height: asset.height || SCREEN_HEIGHT,
        timestamp: Date.now(),
        isCover: false, // Will be set based on item logic
      };

      console.log('[IMAGE UPLOAD] Adding uploaded image to bulkItems system');

      // Use the same logic as camera capture - add to bulkItems
      if (bulkItems.length === 0) {
        // Create first item with uploaded photo
        const firstItem = {
          id: `item-${Date.now()}`,
          photos: [{ ...newPhoto, isCover: true }],
          title: undefined,
          isActive: true
        };
        setBulkItems([firstItem]);
        setActiveItemId(firstItem.id);
        console.log('[IMAGE UPLOAD] Created first item with uploaded photo');
        console.log('[IMAGE UPLOAD] Created first item with uploaded photo, ID:', firstItem.id);
        setTimeout(() => {
          console.log('[IMAGE UPLOAD] About to call performQuickScan for first item:', firstItem.id);
          performQuickScan(newPhoto, firstItem.id);
        }, 500);
      } else if (activeItemId) {
        // Add to existing active item
        setBulkItems(prev => prev.map(item => {
          if (item.id === activeItemId) {
            const isFirstPhoto = item.photos.length === 0;
            return {
              ...item,
              photos: [...item.photos, { ...newPhoto, isCover: isFirstPhoto }]
            };
          }
          return item;
        }));
        console.log('[IMAGE UPLOAD] Added to active item:', activeItemId);
        // Trigger quick scan only if it was the first photo in this item
        const activeItem = bulkItems.find(i => i.id === activeItemId);
        if (activeItem && activeItem.photos.length === 0) {
          console.log('[IMAGE UPLOAD] First photo for existing active item:', activeItemId);
          setTimeout(() => {
            console.log('[IMAGE UPLOAD] About to call performQuickScan for existing active item:', activeItemId);
            performQuickScan(newPhoto, activeItemId);
          }, 500);
        }
      } else {
        // Create new item
        const newItem = {
          id: `item-${Date.now()}`,
          photos: [{ ...newPhoto, isCover: true }],
          title: undefined,
          isActive: true
        };
        setBulkItems(prev => [...prev.map(item => ({ ...item, isActive: false })), newItem]);
        setActiveItemId(newItem.id);
        console.log('[IMAGE UPLOAD] Created new item with uploaded photo, ID:', newItem.id);
        setTimeout(() => {
          console.log('[IMAGE UPLOAD] About to call performQuickScan for new item:', newItem.id);
          performQuickScan(newPhoto, newItem.id);
        }, 500);
      }

      // Also keep legacy array for backward compatibility during transition
      setCapturedPhotos(prev => [...prev, newPhoto]);
    }
  }, [bulkItems.length, activeItemId]);

  // Copy barcode to clipboard
  const copyBarcodeToClipboard = useCallback(() => {
    if (scannedBarcode) {
      Clipboard.setString(scannedBarcode);
      Alert.alert('Copied', 'Barcode copied to clipboard');
    }
  }, [scannedBarcode]);

  // Toggle camera mode (cycles: camera → barcode → manifest → camera)
  const toggleCameraMode = useCallback(() => {
    setCameraMode(prev => {
      if (prev === 'camera') return 'barcode';
      if (prev === 'barcode') return 'manifest';
      return 'camera';
    });
    setScannedBarcode(null);
    setCurrentInstruction('ready');
  }, []);

  // Legacy photo management functions - no longer needed with simplified bulkItems system
  // (All photo management now happens through bulkItems functions)

  // Drag handlers for photo reordering (still needed for UI feedback)
  const [draggedPhotoId, setDraggedPhotoId] = useState<string | null>(null);

  const handleDragStart = useCallback((photoId: string) => {
    setDraggedPhotoId(photoId);
    console.log('Drag started for photo:', photoId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedPhotoId(null);
    console.log('Drag ended');
  }, []);

  // Reorder photos within active item (simplified)
  const reorderPhotos = useCallback((fromIndex: number, toIndex: number) => {
    if (activeItemId) {
      setBulkItems(prev => prev.map(item => {
        if (item.id === activeItemId) {
          const newPhotos = [...item.photos];
          const [movedPhoto] = newPhotos.splice(fromIndex, 1);
          newPhotos.splice(toIndex, 0, movedPhoto);
          return { ...item, photos: newPhotos };
        }
        return item;
      }));
    }
  }, [activeItemId]);

  // Get auth headers
  async function getAuthHeaders() {
    try {
      const token = await ensureSupabaseJwt();
      return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
    } catch (error) {
      console.error('Error getting auth headers:', error);
      return {
        'Content-Type': 'application/json',
        // 'Authorization': `Bearer ${token}`, // Uncomment when you have auth
      };
    }
  }

  async function getToken() {
    return await ensureSupabaseJwt();
  }

  // Upload image to Supabase Storage and get public URL
  const uploadImageToSupabase = useCallback(async (localUri: string, photoId: string): Promise<string> => {
    try {
      console.log('[UPLOAD] Starting upload for:', photoId);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Read bytes using the new File API (Expo SDK 54+)
      const parsedPath = Paths.parse(localUri);
      const srcFile = new File(new Directory(parsedPath.dir), parsedPath.base);
      const bytes = await srcFile.bytes();

      // Create file name
      const fileName = `${user.id}/${photoId}-${Date.now()}.jpg`;

      // Convert base64 to proper blob for upload
      // Use bytes directly
      const byteArray = bytes;

      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(fileName, byteArray, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
        });

      if (error) {
        console.error('[UPLOAD] Supabase upload error:', error);
        throw error;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('product-images')
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl;
      console.log('[UPLOAD] Successfully uploaded to:', publicUrl);

      return publicUrl;
    } catch (error) {
      console.error('[UPLOAD] Failed to upload image:', error);
      throw error;
    }
  }, []);

  // Auto-quick scan when photo is captured
  const performQuickScan = useCallback(async (photo: CapturedPhoto, itemId: string) => {
    if (isAutoScanning) {
      console.log('[QUICK SCAN] Another quick scan is already running, skipping');
      return;
    }

    // New scan starts – clear any previous cancellation
    quickScanCancelledRef.current = false;

    setIsAutoScanning(true);
    setCurrentInstruction('processing');

    // Set loading state for this item
    setItemLoadingStates(prev => ({
      ...prev,
      [itemId]: { isLoading: true, stage: 'Quick Scanning...' }
    }));

    try {
      // Ensure auth bridge is ready and we have a Supabase JWT before any network calls
      const tokenMaybe = await ensureSupabaseJwt();
      if (!tokenMaybe) {
        console.warn('[QUICK SCAN] No Supabase JWT available. Are you signed in and the Clerk bridge configured?');
        showNotificationMessage('Sign in required to scan. Please log in and try again.', 3000);
        setItemLoadingStates(prev => {
          const { [itemId]: removed, ...rest } = prev;
          return rest;
        });
        setIsAutoScanning(false);
        return;
      }
      console.log('[QUICK SCAN] Starting quick scan for photo:', photo.id);
      console.log('[QUICK SCAN] Photo URI:', photo.uri);
      console.log('[QUICK SCAN] Timestamp:', new Date().toISOString());

      // Upload image to Supabase Storage first
      console.log('[QUICK SCAN] Uploading image to Supabase...');
      const publicImageUrl = await uploadImageToSupabase(photo.uri, photo.id);
      console.log('[QUICK SCAN] Image uploaded to:', publicImageUrl);

      const token = tokenMaybe;

      // Call the actual backend /orchestrate/quick-scan endpoint
      const response = await fetch('https://api.sssync.app/api/products/orchestrate/quick-scan', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: [{
            url: publicImageUrl, // Use Supabase public URL instead of local file path
            metadata: {
              id: photo.id,
              timestamp: photo.timestamp,
              width: photo.width,
              height: photo.height
            }
          }],
          targetSites: ['general'],

          reranker: "llama4-groq", //"reranker": "llama4-groq"  // or "jina-modal" or "fast-text" or "none" 
          mode: "ocr-vlm-search"
        })
      });

      // 🎯 FREEMIUM: Handle 402 Payment Required (free tier exhausted)
      if (response.status === 402) {
        const errorData = await response.json();
        console.log('[QUICK SCAN] Free tier exhausted:', errorData);
        if (errorData.error === 'FREE_TIER_EXHAUSTED') {
          setShowTierSelector(true);
          showNotificationMessage(`Free scans used (${errorData.usageCount}/${errorData.freeLimit}). Upgrade to continue!`, 4000);
          return;
        }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Increment local usage count on successful scan
      incrementLocalUsage();

      const result = await response.json();

      if (quickScanCancelledRef.current) return;

      console.log('[QUICK SCAN] Received result for item:', itemId);
      console.log('[QUICK SCAN] Full result:', JSON.stringify(result, null, 2));

      // Parse backend response - backend returns results array with matches
      const allMatches = result.results?.flatMap((r: any) => r.matches) || result.quickScanMatches || [];
      const rerankerMeta = result.results?.[0]?.rerankerAnalysis;
      const quickScanResult = {
        recommendedAction: result.recommendedAction || 'show_multiple_matches',
        overallConfidence: result.overallConfidence || 'medium'
      };

      if (allMatches.length > 0) {
        const nextMatchData: MatchResponse = {
          systemAction: quickScanResult?.recommendedAction || 'show_multiple_matches',
          confidence: quickScanResult?.overallConfidence || 0,
          totalMatches: allMatches.length,
          rankedCandidates: allMatches.map((match: any) => ({
            id: match.ProductVariantId || match.productId || `match-${Date.now()}`,
            title: match.title || 'Unknown Product',
            description: match.description || '',
            price: match.price || 0,
            imageUrl: match.imageUrl || '',
            sourceUrl: match.productUrl || match.link || '',
          }))
        };

        if (rerankerMeta) {
          nextMatchData.reranker = rerankerMeta;
        }

        // Update store
        setQuickScanStore(prev => {
          const updated = {
            ...prev,
            [itemId]: { matchData: nextMatchData, serpApiData: candidatesToSerpApiData(nextMatchData.rankedCandidates as any) }
          };
          return updated;
        });

        // Notify user (silent update, no sheet)
        const isFirstItemScanned = Object.keys(quickScanStore).length === 0;
        if (isFirstItemScanned) {
          showNotificationMessage(`✓ Match found! Tap to review.`, 3000);
        } else {
          showNotificationMessage(`✓ Match found!`, 2000);
        }
        // Update instruction to show match count in center box
        setCurrentInstruction('matches_found');

      } else {
        console.log('[QUICK SCAN] No matches found');
        showNotificationMessage('No quick matches found. Added to review.', 3000);
        // Update instruction to show no matches in center box
        setCurrentInstruction('no_matches');
      }

    } catch (error) {
      console.error('[QUICK SCAN] scan failed:', error);
      showNotificationMessage('Quick scan failed. Retrying in background...', 3000);
    } finally {
      setIsAutoScanning(false);
      // Clear loading state
      setItemLoadingStates(prev => {
        const { [itemId]: removed, ...rest } = prev;
        return rest;
      });
    }

  }, [uploadImageToSupabase, candidatesToSerpApiData, quickScanStore, showNotificationMessage]);

  // Open Match Selection screen using quick scan results for a given item
  const openMatchSelectionForItem = useCallback((itemId?: string | null) => {
    const id = itemId || currentMatchItemId;
    if (!id) {
      showNotificationMessage('No item selected for quick matches.', 2000);
      return;
    }
    const store = quickScanStore[id];
    if (!store || !Array.isArray(store.serpApiData) || store.serpApiData.length === 0) {
      showNotificationMessage('No quick matches available for this item.', 2000);
      return;
    }
    (navigation as any).navigate('MatchSelectionScreen', {
      overrideResults: [
        { productIndex: 0, serpApiData: store.serpApiData }
      ],
      overrideFocusIndex: 0,
      isNewScan: true
    });
    setShowMatchSheet(false);
    setCurrentInstruction('ready');
  }, [quickScanStore, currentMatchItemId, navigation, showNotificationMessage]);

  // Reopen quick matches sheet for an item from the bulk items list
  const openQuickMatchesForItem = useCallback((itemId: string) => {
    const store = quickScanStore[itemId];
    if (!store) {
      showNotificationMessage('No quick matches for this item yet.', 2000);
      return;
    }
    setMatchData(store.matchData);
    setCurrentMatchItemId(itemId);
    // Close bulk sheet before opening match sheet
    setShowDeepSearchSheet(false);
    sheetTranslateY.value = withTiming(SCREEN_HEIGHT, { duration: 150 });
    setShowMatchSheet(true);
    matchSheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.2);
  }, [quickScanStore, matchSheetTranslateY, sheetTranslateY, showNotificationMessage]);

  // Send payload of first photos for analysis/matching
  const performAnalyze = useCallback(async (firstPhotos: CapturedPhoto[]) => {
    try {
      console.log('[ANALYZE] Sending payload of ' + firstPhotos.length + ' first photos to backend for analysis, matching, and item creation');

      // Upload images to Supabase Storage first
      console.log('[ANALYZE] Uploading images to Supabase...');

      const publicImageUrls = await Promise.all(
        firstPhotos.map(photo => uploadImageToSupabase(photo.uri, photo.id))
      );

      const products = publicImageUrls.map((url, index) => ({
        productIndex: index,
        images: [{ url }]
      }));

      console.log('[ANALYZE] Images uploaded to:', publicImageUrls);

      const finalPayload = {
        products,
        options: {
          useReranking: true,
          vectorSearchLimit: 10,
        }
      };

      const token = await getToken();
      const response = await fetch('https://api.sssync.app/api/products/orchestrate/match', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(finalPayload)
      });

      console.log('[ANALYZE] Response received:', response);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const analyzeResult = await response.json();
      console.log('[ANALYZE] Response received:', analyzeResult);
      return analyzeResult;

    } catch (error) {
      console.error('[ANALYZE] Analyze failed:', error);
      showNotificationMessage('Analysis failed. Please try again in a second or two.', 3000);
    }
  }, []);

  // Toggle bulk mode
  const toggleBulkMode = useCallback(() => {
    // If we are trying to TURN OFF bulk mode...
    if (isBulkMode) {
      // ...and there are multiple items, prevent it.
      if (bulkItems.length > 1) {
        showNotificationMessage("Can't disable bulk mode with multiple items. Delete items until only one remains.", 4000);
        return;
      }
      // Otherwise, it's safe to turn off.
      setIsBulkMode(false);
    } else {
      // If the user is trying to TURN ON bulk mode...
      setIsBulkMode(true);

      // If there are existing photos that haven't been put into an item yet,
      // create the first item with them. This handles the transition from non-bulk to bulk.
      if (capturedPhotos.length > 0 && bulkItems.length === 0) {
        const firstItem = {
          id: `item-${Date.now()}`,
          photos: capturedPhotos,
          title: undefined,
          isActive: true
        };
        setBulkItems([firstItem]);
        setActiveItemId(firstItem.id);
      }
    }
  }, [isBulkMode, bulkItems.length, capturedPhotos, showNotificationMessage]);

  // Add new bulk item
  const addNewBulkItem = useCallback(() => {
    const newItemId = generateItemId();
    console.log('[ADD NEW ITEM] Starting to add new item:', newItemId);
    console.log('[ADD NEW ITEM] Current bulk mode:', isBulkMode);
    console.log('[ADD NEW ITEM] Current items count:', bulkItems.length);

    // Auto-enable bulk mode when adding items
    if (!isBulkMode) {
      console.log('[ADD NEW ITEM] Enabling bulk mode');
      setIsBulkMode(true);
      if (capturedPhotos.length > 0) {
        // Create first item with existing photos
        const firstItemId = generateItemId();
        const newItems = [
          {
            id: firstItemId,
            photos: capturedPhotos,
            title: undefined,
            isActive: false
          },
          {
            id: newItemId,
            photos: [],
            title: undefined,
            isActive: true
          }
        ];
        console.log('[ADD NEW ITEM] Creating items with existing photos:', newItems);
        setBulkItems(newItems);
        setActiveItemId(newItemId);

        // Migrate quick scan store from single-item session to firstItemId if present
        setQuickScanStore(prev => {
          const keys = Object.keys(prev);
          if (keys.length === 1 && !prev[firstItemId]) {
            const oldKey = keys[0];
            const entry = prev[oldKey];
            const { [oldKey]: _removed, ...rest } = prev;
            return { ...rest, [firstItemId]: entry };
          }
          return prev;
        });
      } else {
        const newItems = [{
          id: newItemId,
          photos: [],
          title: undefined,
          isActive: true
        }];
        console.log('[ADD NEW ITEM] Creating first item:', newItems);
        setBulkItems(newItems);
        setActiveItemId(newItemId);
      }
    } else {
      // Deactivate all items and add new active one
      console.log('[ADD NEW ITEM] Adding to existing bulk items');
      setBulkItems(prev => {
        const newItems = [
          ...prev.map(item => ({ ...item, isActive: false })),
          {
            id: newItemId,
            photos: [],
            title: undefined,
            isActive: true
          }
        ];
        console.log('[ADD NEW ITEM] New items array:', newItems);
        return newItems;
      });
      setActiveItemId(newItemId);
    }

    if (isBulkMode && bulkItems.length > 0) {
      console.log("You can't disable bulk mode when there are items in the list");
      showNotificationMessage('You can\'t disable bulk mode when there are items in the list', 3000);
      setIsBulkMode(true);
    }
  }, [isBulkMode, capturedPhotos, bulkItems.length]);

  // Select item as active
  const selectActiveItem = useCallback((itemId: string) => {
    console.log('[SELECT ITEM] Setting active item to:', itemId);
    console.log('[SELECT ITEM] quickScanStore keys:', Object.keys(quickScanStore));
    console.log('[SELECT ITEM] quickScanStore for itemId:', quickScanStore[itemId] ? 'EXISTS' : 'MISSING');
    setBulkItems(prev => {
      // Normalize isActive flags to exactly one active item
      const next = prev.map(item => ({ ...item, isActive: item.id === itemId }));
      return next;
    });
    setActiveItemId(itemId);

    // Show notification of which item is now active
    const itemIndex = bulkItems.findIndex(item => item.id === itemId) + 1;
    showNotificationMessage(`Switched to Item ${itemIndex}`, 1500);
  }, [bulkItems, showNotificationMessage, quickScanStore]);

  // Delete bulk item
  const deleteBulkItem = useCallback((itemId: string) => {
    setBulkItems(prev => {
      const next = prev.filter(item => item.id !== itemId);
      // If we deleted the active item, move focus to the nearest item (previous, else first, else null)
      if (activeItemId === itemId) {
        const deletedIndex = prev.findIndex(i => i.id === itemId);
        const fallback = next[Math.max(0, deletedIndex - 1)] || next[0] || null;
        setActiveItemId(fallback ? fallback.id : null);
        if (fallback) {
          // Ensure only fallback is active
          return next.map(i => ({ ...i, isActive: i.id === fallback.id }));
        }
      }
      return next;
    });
    // Clean up quickScanStore for deleted item
    setQuickScanStore(prev => {
      const { [itemId]: removed, ...rest } = prev;
      console.log('[DELETE ITEM] Cleaned up quickScanStore for item:', itemId);
      return rest;
    });
  }, [activeItemId]);

  // Move photo between items
  const movePhoto = useCallback((fromItemId: string, toItemId: string, photoId: string) => {
    setBulkItems(prev => {
      const next = prev.map(i => ({ ...i, photos: [...i.photos] }));
      const from = next.find(i => i.id === fromItemId);
      const to = next.find(i => i.id === toItemId);
      if (!from || !to) return prev;
      const idx = from.photos.findIndex(p => p.id === photoId);
      if (idx === -1) return prev;
      const [moved] = from.photos.splice(idx, 1);
      if (!moved) return prev;
      if (to.photos.length >= 12) return prev;
      to.photos.push(moved);
      // Ensure cover photo invariant: each item should have a cover if it has photos
      if (from.photos.length > 0 && !from.photos.some(p => p.isCover)) {
        from.photos[0].isCover = true;
      }
      if (to.photos.length === 1) {
        to.photos[0].isCover = true;
      }
      return next;
    });
  }, []);

  // Set cover photo in bulk item
  const setBulkItemCoverPhoto = useCallback((itemId: string, photoId: string) => {
    setBulkItems(prev => prev.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          photos: item.photos.map(photo => ({
            ...photo,
            isCover: photo.id === photoId
          }))
        };
      }
      return item;
    }));
  }, []);

  // Remove photo from bulk item
  const removeBulkItemPhoto = useCallback((itemId: string, photoId: string) => {
    setBulkItems(prev => prev.map(item => {
      if (item.id === itemId) {
        const remainingPhotos = item.photos.filter(p => p.id !== photoId).map(p => ({ ...p }));
        // Maintain a single cover photo per item if any photos remain
        if (remainingPhotos.length > 0) {
          if (!remainingPhotos.some(p => p.isCover)) {
            remainingPhotos[0].isCover = true;
          } else {
            let coverFound = false;
            for (const p of remainingPhotos) {
              if (!coverFound && p.isCover) {
                coverFound = true;
              } else {
                p.isCover = false;
              }
            }
            if (!coverFound) remainingPhotos[0].isCover = true;
          }
        }
        return {
          ...item,
          photos: remainingPhotos
        };
      }
      return item;
    }));
  }, []);

  // Close bulk items sheet
  const closeBulkItemsSheet = useCallback(() => {
    sheetTranslateY.value = withTiming(SCREEN_HEIGHT, {
      duration: 200,
    }, () => {
      runOnJS(setShowDeepSearchSheet)(false);
      runOnJS(setCurrentInstruction)('ready');
    });
  }, [sheetTranslateY]);

  // Close match results sheet
  const closeMatchSheet = useCallback(() => {
    matchSheetTranslateY.value = withTiming(SCREEN_HEIGHT, {
      duration: 200,
    }, () => {
      runOnJS(setShowMatchSheet)(false);
      runOnJS(setCurrentInstruction)('ready');
    });
  }, [matchSheetTranslateY]);

  // Close barcode sheet
  const closeBarcodeSheet = useCallback(() => {
    matchSheetTranslateY.value = withTiming(SCREEN_HEIGHT, {
      duration: 200,
    }, () => {
      runOnJS(setShowBarcodeResultModal)(false);
      runOnJS(setScannedBarcode)(null); // Resume scanning
      runOnJS(setCurrentInstruction)('ready');
    });
  }, [matchSheetTranslateY]);

  // Animate barcode sheet open
  useEffect(() => {
    if (showBarcodeResultModal) {
      // Use same height as MatchSheet (taller sheet)
      matchSheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.12, { damping: 70 });
    }
  }, [showBarcodeResultModal, matchSheetTranslateY]);

  // Close all sheets (for tap-to-focus)
  const closeAllSheets = useCallback(() => {
    if (showMatchSheet) {
      closeMatchSheet();
    }
    if (showDeepSearchSheet) {
      closeBulkItemsSheet();
    }
    if (showBarcodeResultModal) {
      closeBarcodeSheet();
    }
  }, [showMatchSheet, showDeepSearchSheet, showBarcodeResultModal, closeMatchSheet, closeBulkItemsSheet, closeBarcodeSheet]);

  // When starting a broad search, close any open sheets and cancel quick scan
  const handleStartBroadSearch = useCallback(() => {
    console.log('[BROAD SEARCH] Starting broad search: closing sheets and cancelling quick scan');
    // Cancel any in-progress quick scan so it doesn't reopen sheets
    quickScanCancelledRef.current = true;
    setIsAutoScanning(false);
    stopProgressAnimation();
    setShowProgressBar(false);
    setCurrentInstruction('ready');

    if (showMatchSheet) {
      closeMatchSheet();
    }
    if (showDeepSearchSheet) {
      closeBulkItemsSheet();
    }
  }, [
    closeBulkItemsSheet,
    closeMatchSheet,
    showDeepSearchSheet,
    showMatchSheet,
    stopProgressAnimation,
    setCurrentInstruction,
    setIsAutoScanning,
    setShowProgressBar,
    quickScanCancelledRef,
  ]);

  // Animated styles
  const captureButtonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: captureButtonScale.value }],
  }));

  const flashAnimatedStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
  }));

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  const matchSheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: matchSheetTranslateY.value }],
  }));

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  // Permission check
  if (hasPermission === null) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="black" />
        <View style={styles.permissionContainer}>
          <MaterialIcons name="camera-alt" size={80} color="#666" />
          <Text style={styles.permissionTitle}>Requesting Camera Permission...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (hasPermission === false) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="black" />

        <View style={styles.permissionContainer}>
          <MaterialIcons name="camera-alt" size={80} color="#666" />
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>
            We need camera access to help you scan and identify products
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={() => Camera.requestCameraPermissionsAsync()}
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="black" />

      {/* Freemium usage counter */}
      {freemiumStatus && !freemiumStatus.hasSubscription && (
        <View style={{ position: 'absolute', top: Platform.OS === 'ios' ? 50 : 10, left: 0, right: 0, zIndex: 100 }}>
          <UsageCounter
            usageCount={freemiumStatus.usageCount}
            freeLimit={freemiumStatus.freeLimit}
            onUpgradePress={() => setShowTierSelector(true)}
            isSubscriber={freemiumStatus.hasSubscription}
          />
        </View>
      )}

      {/* Camera View */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flash}
        active={isFocused && !showDeepSearchSheet && !showMatchSheet && !showBarcodeResultModal} // Disable camera when sheets are open
        onBarcodeScanned={handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'],
        }}
      >
        {/* Flash overlay */}
        <Animated.View style={[styles.flashOverlay, flashAnimatedStyle]} />

        {/* Camera paused overlay */}
        {(showDeepSearchSheet || showMatchSheet || showBarcodeResultModal) && (
          <View style={styles.cameraPausedOverlay}>
            <View style={styles.cameraPausedIndicator}>
              <MaterialIcons name="pause-circle-filled" size={48} color="rgba(255,255,255,0.8)" />
              <Text style={styles.cameraPausedText}>Camera Paused</Text>
              <Text style={styles.cameraPausedSubtext}>Saving battery while sheet is open</Text>
            </View>
          </View>
        )}

        {/* Tap to focus overlay */}
        <Pressable
          style={styles.tapToFocusOverlay}
          onPress={(event) => {
            // Close sheets if open - instant close
            if (showMatchSheet || showDeepSearchSheet || showBarcodeResultModal) {
              closeAllSheets();
              return;
            }
            // Otherwise handle focus
            handleFocusTap(event);
          }}
          onLongPress={() => {
            // Open sheet on long press if not already open
            if (!showDeepSearchSheet && !showMatchSheet && !showBarcodeResultModal) {
              setShowDeepSearchSheet(true);
              sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.4);
            }
          }}
        />

        {/* Photo stack (top left) - shows active item's photos in bulk mode */}
        {(() => {
          const activeItem = activeItemId ? bulkItems.find(item => item.id === activeItemId) : null;
          const displayPhotos = activeItem?.photos || [];
          const itemIndex = activeItem ? bulkItems.findIndex(item => item.id === activeItemId) + 1 : 0;

          console.log('[PHOTO STACK] Rendering for activeItemId:', activeItemId);
          console.log('[PHOTO STACK] Found activeItem:', activeItem ? 'YES' : 'NO');
          console.log('[PHOTO STACK] displayPhotos count:', displayPhotos.length);
          console.log('[PHOTO STACK] displayPhotos IDs:', displayPhotos.map(p => p.id));

          return (
            <View style={styles.photoStackContainer} key={`photo-stack-${activeItemId || 'none'}`}>
              {/* Active item indicator - always show if there's an active item */}
              {activeItemId && itemIndex > 0 && (
                <View style={styles.activeItemIndicator}>
                  <Text style={styles.activeItemIndicatorText}>
                    Item {itemIndex}
                  </Text>
                </View>
              )}

              {displayPhotos.length > 0 && (
                <PhotoStack
                  key={`photos-${activeItemId}-${displayPhotos.length}`}
                  photos={displayPhotos}
                  onSetCover={activeItemId
                    ? (photoId: string) => setBulkItemCoverPhoto(activeItemId, photoId)
                    : () => console.log('No active item for cover photo')
                  }
                  onRemovePhoto={activeItemId
                    ? (photoId: string) => removeBulkItemPhoto(activeItemId, photoId)
                    : () => console.log('No active item for photo removal')
                  }
                  onDoubleTap={activeItemId
                    ? (photoId: string) => setBulkItemCoverPhoto(activeItemId, photoId)
                    : () => console.log('No active item for double tap')
                  }
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onReorder={reorderPhotos}
                  draggedPhotoId={draggedPhotoId}
                />
              )}
            </View>
          );
        })()}

        {/* Camera controls (top right) */}
        <CameraControls
          flash={flash}
          onToggleFlash={toggleFlash}
          onToggleFacing={toggleFacing}
          onPastScans={() => navigation.navigate('PastScans' as never)}
          isBulkMode={isBulkMode}
          onToggleBulkMode={toggleBulkMode}
        />

        {/* Center overlay with instructions */}
        <CenterOverlay
          instruction={getInstructionText(currentInstruction)}
          isProcessing={currentInstruction === 'processing'}
          cameraMode={cameraMode}
          scannedBarcode={scannedBarcode}
          onCopyBarcode={copyBarcodeToClipboard}
        />


        {cameraMode === 'camera' && (
          <View style={styles.photoFrameOverlay} />
        )}

        {cameraMode === 'barcode' && (
          <View style={styles.photoFrameOverlay}>
            <View style={styles.scanLineContainer}>
              <View style={styles.scanLine} />
            </View>
          </View>
        )}

        {cameraMode === 'manifest' && (
          <View style={[styles.photoFrameOverlay, { top: "10%", bottom: "20%", }]} />
        )}

        {cameraMode === 'receipt' && (
          <View style={[styles.photoFrameOverlay, { top: "10%", bottom: "20%", }]} />
        )}




        {/* Progress Bar */}
        {showProgressBar && (
          <ProgressBarOverlay
            progressWidth={progressWidth}
            spinRotation={spinRotation}
          />
        )}

        {/* Notification Bar */}
        {showNotification && (
          <NotificationBar
            message={notificationMessage}
            opacity={notificationOpacity}
            translateY={notificationTranslateY}
          />
        )}

        {/* DEBUG: Visual State Indicator 
         {__DEV__ && (
           <View style={styles.debugOverlay}>
             <Text style={styles.debugText}>
               Items: {bulkItems.length} | 
               Total Photos: {bulkItems.reduce((sum, item) => sum + item.photos.length, 0)} | 
               Active: {activeItemId ? bulkItems.findIndex(i => i.id === activeItemId) + 1 : 'none'} |
               Legacy Photos: {capturedPhotos.length} |
               Renders: {forceRenderCount}
             </Text>
             <Text style={[styles.debugText, { 
               backgroundColor: (!showDeepSearchSheet && !showMatchSheet && !showBarcodeResultModal) ? '#4CAF50' : '#FF5722',
               borderRadius: 4,
               paddingHorizontal: 4
             }]}>
               📷 Camera: {(!showDeepSearchSheet && !showMatchSheet && !showBarcodeResultModal) ? 'ACTIVE' : 'PAUSED'}
             </Text>
             <View style={styles.debugButtons}>
               <TouchableOpacity 
                 style={styles.debugButton} 
                 onPress={() => {
                   console.log('[DEBUG] Manual item creation test');
                   const testItem = {
                     id: `test-item-${Date.now()}`,
                     photos: [{
                       id: `test-photo-${Date.now()}`,
                       uri: 'https://via.placeholder.com/300x300.png?text=Test',
                       width: 300,
                       height: 300,
                       timestamp: Date.now(),
                       isCover: true
                     }],
                     title: undefined,
                     isActive: true
                   };
                   setBulkItems(prev => [...prev, testItem]);
                   setActiveItemId(testItem.id);
                 }}
               >
                 <Text style={styles.debugButtonText}>Add Test Item</Text>
            </TouchableOpacity>
               <TouchableOpacity style={styles.debugButton} onPress={forceRerender}>
                 <Text style={styles.debugButtonText}>Force Render</Text>
            </TouchableOpacity>
          </View>
           </View>
         )} 
        */}

        {/* Bottom controls */}
        <BottomControls
          onCapture={handleCapture}
          isCapturing={isCapturing}
          captureButtonScale={captureButtonScale}
          photosCount={bulkItems.reduce((sum, item) => sum + item.photos.length, 0)}
          cameraMode={cameraMode}
          onSetCameraMode={(mode) => {
            setCameraMode(mode);
            setScannedBarcode(null);
            setCurrentInstruction('ready');
          }}
          onImageUpload={handleImageUpload}
          onContinue={handleContinue}
          hasBarcodeResult={!!barcodeSearchResult}
          productName={barcodeSearchResult?.variant?.Title}
          items={bulkItems}
          activeItemId={activeItemId}
          onSelectItem={(id) => setActiveItemId(id)}
          onNewItem={() => {
            const newItemId = `item-${Date.now()}`;
            setBulkItems(prev => [...prev.map(i => ({ ...i, isActive: false })), {
              id: newItemId,
              photos: [],
              isActive: true
            }]);
            setActiveItemId(newItemId);
          }}
        />
      </CameraView>

      {/* Match results sheet (rendered above TabBar via Modal) */}
      <Modal
        visible={!!showMatchSheet && !!matchData}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeMatchSheet}
        presentationStyle="overFullScreen"
      >
        {showMatchSheet && matchData ? (
          <MatchResultsSheet
            matchData={matchData}
            onClose={closeMatchSheet}
            onUseForSelection={() => openMatchSelectionForItem(currentMatchItemId)}
            sheetStyle={matchSheetAnimatedStyle}
            navigation={navigation}
            onStartBroadSearch={() => {
              // Close match sheet and open bulk items sheet
              setShowMatchSheet(false);
              matchSheetTranslateY.value = withTiming(SCREEN_HEIGHT, { duration: 150 });
              setShowDeepSearchSheet(true);
              sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.4);
            }}
          />
        ) : null}
      </Modal>

      {/* Bulk items sheet (rendered above TabBar via Modal) */}
      <Modal
        visible={!!showDeepSearchSheet}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeBulkItemsSheet}
        presentationStyle="overFullScreen"
      >
        {showDeepSearchSheet && (() => {
          console.log('[SHEET CONDITIONAL] Sheet IS showing - showDeepSearchSheet is true');
          console.log('[SHEET PROPS] ==================');
          console.log('[SHEET PROPS] Passing to BulkItemsSheet:');
          console.log('[SHEET PROPS] - photos (capturedPhotos):', capturedPhotos.length, 'items');
          capturedPhotos.forEach((photo, index) => {
            console.log(`[SHEET PROPS]   Photo ${index + 1}:`, {
              id: photo.id,
              uri: photo.uri.substring(0, 30) + '...',
              isCover: photo.isCover
            });
          });
          console.log('[SHEET PROPS] - isBulkMode:', isBulkMode);
          console.log('[SHEET PROPS] - bulkItems:', bulkItems.length, 'items');
          bulkItems.forEach((item, index) => {
            console.log(`[SHEET PROPS]   BulkItem ${index + 1}:`, {
              id: item.id,
              photosCount: item.photos.length,
              isActive: item.isActive
            });
          });
          console.log('[SHEET PROPS] - activeItemId:', activeItemId);
          console.log('[SHEET PROPS] ==================');

          return (
            <BulkItemsSheet
              onClose={closeBulkItemsSheet}
              onStartBroadSearch={handleStartBroadSearch}
              sheetStyle={sheetAnimatedStyle}
              photos={capturedPhotos}
              isBulkMode={isBulkMode}
              bulkItems={bulkItems}
              activeItemId={activeItemId}
              onAddNewItem={addNewBulkItem}
              onImageUpload={handleImageUpload}
              onDeleteItem={deleteBulkItem}
              onMovePhoto={movePhoto}
              onSelectItem={selectActiveItem}
              onSetCoverPhoto={setBulkItemCoverPhoto}
              onRemovePhoto={removeBulkItemPhoto}
              performAnalyze={performAnalyze}
              sheetTranslateY={sheetTranslateY}
              navigation={navigation}
              jobResponse={jobResponse}
              setJobResponse={setJobResponse}
              quickScanStore={quickScanStore}
              onOpenQuickMatches={openQuickMatchesForItem}
              itemLoadingStates={itemLoadingStates}
              setItemLoadingStates={setItemLoadingStates}
            />
          );
        })()}
      </Modal>

      {/* Barcode Quick Inventory Editor Modal (Reused MatchSheet Style) */}
      <Modal
        visible={showBarcodeResultModal}
        transparent={true}
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeBarcodeSheet}
        presentationStyle="overFullScreen"
      >
        {showBarcodeResultModal && barcodeSearchResult ? (
          <Animated.View style={[styles.matchSheet, matchSheetAnimatedStyle]}>
            <QuickProductDetailSheet
              product={barcodeSearchResult}
              platformLocations={platformLocations}
              onClose={closeBarcodeSheet}
              onOpenDetail={() => {
                // ProductDetail expects a ProductVariant Id, not the parent Product Id
                const variantId = barcodeSearchResult?.variant?.Id;
                if (variantId) {
                  closeBarcodeSheet();
                  (navigation as any).navigate('ProductDetail', {
                    productId: variantId,  // This is the ProductVariant.Id that ProductDetail expects
                  });
                } else {
                  console.error('[QUICK DETAIL] No variant Id found for navigation');
                }
              }}
              onSave={async (updates) => {
                console.log('[BARCODE SAVE] Saving updates via API:', updates);
                try {
                  const token = await ensureSupabaseJwt();
                  if (!token) throw new Error('No auth token');

                  // Group updates by variantId
                  const updatesByVariant: Record<string, typeof updates> = {};
                  updates.forEach(u => {
                    if (!updatesByVariant[u.variantId]) updatesByVariant[u.variantId] = [];
                    updatesByVariant[u.variantId].push(u);
                  });

                  const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';

                  // Process per variant
                  for (const [variantId, variantUpdates] of Object.entries(updatesByVariant)) {
                    // Map to API payload structure
                    const payloadUpdates = variantUpdates.map(u => {
                      // Find connectionId for the location
                      const locInfo = platformLocations.find(l => l.id === u.location);
                      if (!locInfo?.connectionId) {
                        console.warn(`[BARCODE SAVE] No connectionId found for location ${u.location}`);
                        return null;
                      }
                      return {
                        platformConnectionId: locInfo.connectionId,
                        locationId: u.location,
                        quantity: u.quantity,
                        price: u.price // API now supports price
                      };
                    }).filter(Boolean); // Remove nulls

                    if (payloadUpdates.length === 0) continue;

                    const response = await fetch(`${API_BASE}/api/products/${variantId}/inventory`, {
                      method: 'PUT',
                      headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({ updates: payloadUpdates }),
                    });

                    if (!response.ok) {
                      throw new Error(`API failed: ${response.status}`);
                    }
                  }

                  Alert.alert('Success', 'Inventory updated successfully');

                  // Close sheet after save? Or keep open?
                  // User might want to scan next.
                  // Let's keep open for verification or manual close.
                } catch (e) {
                  console.error('[BARCODE SAVE] Error:', e);
                  Alert.alert('Error', 'Failed to save updates');
                }
              }}
            />
          </Animated.View>
        ) : null}
      </Modal>

      {/* Manifest Review Sheet Modal */}
      <Modal
        visible={showManifestSheet && !!manifestJobId}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => {
          setShowManifestSheet(false);
          setManifestJobId(null);
        }}
        presentationStyle="overFullScreen"
      >
        {showManifestSheet && manifestJobId ? (
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ height: SCREEN_HEIGHT * 0.85 }}>
              <ManifestReviewSheet
                jobId={manifestJobId}
                onClose={() => {
                  setShowManifestSheet(false);
                  setManifestJobId(null);
                }}
                onAddToInventory={(items) => {
                  console.log('[MANIFEST] Adding items to inventory:', items.length);
                  Alert.alert(
                    'Coming Soon',
                    `${items.length} items will be added to inventory in a future update.`,
                    [{
                      text: 'OK', onPress: () => {
                        setShowManifestSheet(false);
                        setManifestJobId(null);
                      }
                    }]
                  );
                }}
              />
            </View>
          </View>
        ) : null}
      </Modal>

      {/* Receipt Review Sheet Modal */}
      <Modal
        visible={showReceiptSheet && !!receiptJobId}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => {
          setShowReceiptSheet(false);
          setReceiptJobId(null);
        }}
        presentationStyle="overFullScreen"
      >
        {showReceiptSheet && receiptJobId ? (
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ height: SCREEN_HEIGHT * 0.85 }}>
              <ReceiptReviewSheet
                jobId={receiptJobId}
                onClose={() => {
                  setShowReceiptSheet(false);
                  setReceiptJobId(null);
                }}
                onApplyUpdates={(updates) => {
                  console.log('[RECEIPT] Applied updates:', updates.length);
                }}
                onCreateNew={(itemName) => {
                  // Switch to camera mode with the item name pre-filled
                  setShowReceiptSheet(false);
                  setReceiptJobId(null);
                  setCameraMode('camera');
                  Alert.alert('Add New Item', `Switch to camera mode to add: ${itemName}`);
                }}
              />
            </View>
          </View>
        ) : null}
      </Modal>

      {/* Tier Selector Modal (Paywall) */}
      <TierSelectorModal
        visible={showTierSelector}
        onClose={() => setShowTierSelector(false)}
        onSuccess={() => {
          refreshFreemiumStatus();
          setShowTierSelector(false);
        }}
        usageInfo={freemiumStatus ? {
          usageCount: freemiumStatus.usageCount,
          freeLimit: freemiumStatus.freeLimit,
          remaining: freemiumStatus.remaining,
        } : undefined}
        hasSubscription={freemiumStatus?.hasSubscription || false}
      />
    </GestureHandlerRootView>
  );
};



// Progress Bar Overlay Component
const ProgressBarOverlay: React.FC<{
  progressWidth: any;
  spinRotation: any;
}> = ({ progressWidth, spinRotation }) => {
  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinRotation.value}deg` }],
  }));

  return (
    <View style={styles.progressBarContainer}>
      <View style={styles.progressBarBackground}>
        <Animated.View style={[styles.progressBarFill, progressBarStyle]} />
      </View>
      <Animated.View style={[styles.progressSpinner, spinnerStyle]}>
        <Icon name="loading" size={20} color="#4CAF50" />
      </Animated.View>
    </View>
  );
};

// Notification Bar Component  
const NotificationBar: React.FC<{
  message: string;
  opacity: any;
  translateY: any;
}> = ({ message, opacity, translateY }) => {
  const notificationStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.notificationBar, notificationStyle]}>
      <Icon name="information-outline" size={20} color="white" />
      <Text style={styles.notificationText}>{message}</Text>
    </Animated.View>
  );
};

// Center Overlay Component
const CenterOverlay: React.FC<{
  instruction: string;
  isProcessing: boolean;
  cameraMode: CameraMode;
  scannedBarcode: string | null;
  onCopyBarcode: () => void;
}> = ({ instruction, isProcessing, cameraMode, scannedBarcode, onCopyBarcode }) => {
  // Barcode overlay at top middle
  if (cameraMode === 'barcode' && scannedBarcode) {
    return (
      <View style={styles.barcodeOverlayContainer}>
        <Animated.View style={styles.barcodeOverlay} entering={FadeIn}>
          <Text style={styles.barcodeText}>{scannedBarcode}</Text>
          <TouchableOpacity style={styles.copyButton} onPress={onCopyBarcode}>
            <Icon name="content-copy" size={16} color="white" />
            <Text style={styles.copyButtonText}>Copy</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  // Regular instruction overlay - moved to top-middle like barcode
  return (
    <View style={styles.barcodeOverlayContainer}>
      <Animated.View style={styles.centerOverlay}>
        <Text style={styles.centerOverlayText}>{instruction}</Text>
        {isProcessing && (
          <View style={styles.processingIndicator}>
            <MaterialIcons name="sync" size={16} color="white" />
          </View>
        )}
      </Animated.View>
    </View>
  );
};


// Bottom Controls Component
const BottomControls: React.FC<{
  onCapture: () => void;
  isCapturing: boolean;
  captureButtonScale: any;
  photosCount: number;
  cameraMode: CameraMode;
  onSetCameraMode: (mode: CameraMode) => void;
  onImageUpload: () => void;
  onContinue: () => void;
  hasBarcodeResult?: boolean;
  productName?: string;
  // Item navigation props
  items: Array<{ id: string; photos: any[] }>;
  activeItemId: string | null;
  onSelectItem: (id: string) => void;
  onNewItem: () => void;
}> = ({
  onCapture,
  isCapturing,
  captureButtonScale,
  photosCount,
  cameraMode,
  onSetCameraMode,
  onImageUpload,
  onContinue,
  hasBarcodeResult,
  productName,
  items,
  activeItemId,
  onSelectItem,
  onNewItem
}) => {
    const activeIndex = items.findIndex(i => i.id === activeItemId);
    const totalItems = items.length;
    // Drag-to-select logic using simple state
    const [hoveredMode, setHoveredMode] = useState<CameraMode | null>(null);
    const [showModePopup, setShowModePopup] = useState(false);
    const popupScale = useSharedValue(0);
    const popupOpacity = useSharedValue(0);

    const captureButtonAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: captureButtonScale.value }],
    }));

    const popupAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: popupScale.value }],
      opacity: popupOpacity.value,
    }));

    const toggleModePopup = useCallback(() => {
      if (showModePopup) {
        // Close smoothly
        popupScale.value = withTiming(0, { duration: 150 });
        popupOpacity.value = withTiming(0, { duration: 150 }, () => {
          runOnJS(setShowModePopup)(false);
        });
      } else {
        setShowModePopup(true);
        popupScale.value = withTiming(1, { duration: 200 });
        popupOpacity.value = withTiming(1, { duration: 150 });
      }
    }, [showModePopup, popupScale, popupOpacity]);

    const selectMode = useCallback((mode: CameraMode) => {
      onSetCameraMode(mode);
      // Smooth close
      popupScale.value = withTiming(0, { duration: 150 });
      popupOpacity.value = withTiming(0, { duration: 150 }, () => {
        runOnJS(setShowModePopup)(false);
      });
      setHoveredMode(null);
    }, [onSetCameraMode, popupScale, popupOpacity]);

    const POPUP_WIDTH = 350;
    const ITEM_WIDTH = POPUP_WIDTH / 4;

    // EXPERIMENTAL: Long press on mode button to toggle text search
    const onLongPressMode = () => {
      // Toggle text search from parent? We need a callback prop for this
      // For now, we'll just log it. In real usage, pass onTextSearchToggle prop.
      console.log('Long press mode button');
    };

    // Pan gesture handler callback (non-deprecated approach)
    const onPanGestureEvent = useCallback((event: PanGestureHandlerGestureEvent) => {
      const x = event.nativeEvent.x;
      let newMode: CameraMode | null = null;

      if (x >= 0 && x < ITEM_WIDTH) newMode = 'camera';
      else if (x >= ITEM_WIDTH && x < ITEM_WIDTH * 2) newMode = 'barcode';
      else if (x >= ITEM_WIDTH * 2 && x < ITEM_WIDTH * 3) newMode = 'manifest';
      else if (x >= ITEM_WIDTH * 3 && x <= ITEM_WIDTH * 4) newMode = 'receipt';

      if (newMode && newMode !== hoveredMode) {
        setHoveredMode(newMode);
        Haptics.selectionAsync();
      }
    }, [hoveredMode, ITEM_WIDTH, POPUP_WIDTH]);

    const onPanHandlerStateChange = useCallback((event: PanGestureHandlerGestureEvent) => {
      if (event.nativeEvent.state === State.END) {
        if (hoveredMode) {
          selectMode(hoveredMode);
        }
      }
    }, [hoveredMode, selectMode]);

    const getModeIcon = (mode: CameraMode): string => {
      switch (mode) {
        case 'camera': return 'camera';
        case 'barcode': return 'barcode-scan';
        case 'manifest': return 'file-document-outline';
        case 'receipt': return 'receipt';
      }
    };

    const getModeLabel = (mode: CameraMode): string => {
      switch (mode) {
        case 'camera': return 'Camera';
        case 'barcode': return 'Barcode';
        case 'manifest': return 'Manifest';
        case 'receipt': return 'Receipt';
      }
    };

    const getContinueText = () => {
      if (cameraMode === 'barcode' && hasBarcodeResult) {
        return productName
          ? `Update: ${productName.slice(0, 25)}${productName.length > 25 ? '...' : ''}`
          : 'Open Update Product';
      }
      if (cameraMode === 'manifest') {
        return photosCount > 0
          ? `Parse ${photosCount} page${photosCount > 1 ? 's' : ''}`
          : 'Capture manifest pages';
      }
      if (cameraMode === 'receipt') {
        return photosCount > 0
          ? `Process ${photosCount} receipt${photosCount > 1 ? 's' : ''}`
          : 'Capture receipt';
      }
      return photosCount > 0
        ? `Continue with ${photosCount} photo${photosCount > 1 ? 's' : ''}`
        : 'Take a photo to get started';
    };

    const modes: CameraMode[] = ['camera', 'barcode', 'manifest', 'receipt'];
    const activeMode = hoveredMode || cameraMode;

    return (
      <View style={styles.bottomControls}>
        <Animated.View entering={FadeIn.delay(500)} style={styles.controlsRow}>
          <TouchableOpacity style={styles.galleryButton} onPress={onImageUpload}>
            <Icon name="image-multiple-outline" size={24} color="white" />
          </TouchableOpacity>

          <Animated.View style={captureButtonAnimatedStyle}>
            <TouchableOpacity
              style={styles.captureButton}
              onPress={onCapture}
              disabled={isCapturing}
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>
          </Animated.View>

          {/* Mode selector with popup */}
          <View style={styles.modeSelectorWrapper}>
            {/* Popup bubble */}
            {showModePopup && (
              <Animated.View style={[styles.modePopup, popupAnimatedStyle]}>
                <PanGestureHandler
                  onGestureEvent={onPanGestureEvent}
                  onHandlerStateChange={onPanHandlerStateChange}
                >
                  <Animated.View style={styles.modePopupContent}>
                    {modes.map((mode, index) => (
                      <TouchableOpacity
                        key={mode}
                        style={[
                          styles.modePopupItem,
                          activeMode === mode && styles.modePopupItemActive,
                        ]}
                        onPress={() => selectMode(mode)}
                        activeOpacity={1}
                      >
                        <Text style={[
                          styles.modePopupLabel,
                          activeMode === mode && styles.modePopupLabelActive,
                        ]}>
                          {getModeLabel(mode)}
                        </Text>
                        <View style={[
                          styles.modePopupIconContainer,
                          activeMode === mode && styles.modePopupIconContainerActive,
                        ]}>
                          <Icon
                            name={getModeIcon(mode)}
                            size={28}
                            color={activeMode === mode ? '#fff' : 'rgba(255,255,255,0.7)'}
                          />
                        </View>
                      </TouchableOpacity>
                    ))}
                  </Animated.View>
                </PanGestureHandler>
                <View style={{ flex: 1, paddingRight: 25 }}>
                  {/* Speech bubble arrow - Positioned relative to button center */}
                  <View style={styles.modePopupArrow} />
                </View>

              </Animated.View>
            )}

            {/* Current mode button (collapsed state) */}
            <TouchableOpacity
              style={styles.modeButton}
              onPress={toggleModePopup}
            >
              <Icon
                name={getModeIcon(cameraMode)}
                size={24}
                color="white"
              />
            </TouchableOpacity>
          </View>
        </Animated.View>

        <Animated.View entering={SlideInDown.delay(700)} style={styles.continueButtonContainer}>
          <View style={styles.itemNavRow}>
            {/* Left Arrow - Previous Item */}
            <TouchableOpacity
              style={[styles.itemNavArrow, (photosCount === 0 || activeIndex <= 0) && styles.itemNavArrowDisabled]}
              onPress={() => {
                if (activeIndex > 0) onSelectItem(items[activeIndex - 1].id);
              }}
              disabled={photosCount === 0 || activeIndex <= 0}
            >
              <Icon name="chevron-left" size={24} color={photosCount > 0 && activeIndex > 0 ? "#FFF" : "rgba(255,255,255,0.3)"} />
            </TouchableOpacity>

            {/* Center - Continue Button with item counter */}
            <TouchableOpacity
              style={[styles.continueButton, photosCount === 0 && styles.continueButtonDisabled]}
              onPress={onContinue}
              disabled={photosCount === 0}
            >
              {totalItems > 1 && (
                <View style={styles.itemCountBadge}>
                  <Text style={styles.itemCountBadgeText}>{activeIndex + 1}/{totalItems}</Text>
                </View>
              )}
              <Text style={styles.continueButtonText} numberOfLines={1}>
                {getContinueText()}
              </Text>
            </TouchableOpacity>

            {/* Right Arrow/New Item */}
            {activeIndex < totalItems - 1 ? (
              <TouchableOpacity
                style={styles.itemNavArrow}
                onPress={() => onSelectItem(items[activeIndex + 1].id)}
              >
                <Icon name="chevron-right" size={24} color="#FFF" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.itemNavArrow, styles.itemNavNewButton, photosCount === 0 && styles.itemNavArrowDisabled]}
                onPress={onNewItem}
                disabled={photosCount === 0}
              >
                <Icon name="plus" size={24} color={photosCount > 0 ? "#000" : "rgba(255,255,255,0.3)"} />
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </View>
    );
  };

// Helper to clean up match text
const cleanMatchText = (text: string) => {
  if (!text) return '';
  return text
    .replace(/^(scanned product|scanned item|product scan)[:\s-]*/i, '')
    .replace(/\s*\((quick_scan|.*dataset|custom_.*)\)/gi, '')
    .trim();
};

// Match Results Sheet Component
const MatchResultsSheet: React.FC<{
  matchData: MatchResponse;
  onClose: () => void;
  sheetStyle: any;
  onUseForSelection?: () => void;
  onStartBroadSearch?: () => void;
  navigation?: any;
}> = ({ matchData, onClose, sheetStyle, onUseForSelection, onStartBroadSearch, navigation }) => {
  // Use index-based selection to avoid duplicate id issues
  const [selectedMatchIndices, setSelectedMatchIndices] = React.useState<Set<number>>(new Set());

  const toggleMatchSelection = (index: number) => {
    setSelectedMatchIndices(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const handleGenerateWithSelected = () => {
    if (selectedMatchIndices.size > 0 && navigation) {
      // Convert matchData.rankedCandidates to serpApiData format for MatchSelectionScreen
      const serpApiData = matchData.rankedCandidates.map((c, idx) => ({
        position: idx + 1,
        title: c.title || 'Unknown Product',
        link: c.sourceUrl || '',
        source: 'quickscan',
        source_icon: '',
        thumbnail: c.imageUrl || '',
        image: c.imageUrl || '',
        price: typeof c.price === 'number' ? { value: `$${c.price}`, extracted_value: c.price, currency: 'USD' } : undefined,
      }));

      // Navigate with pre-selected indices
      navigation.navigate('MatchSelectionScreen', {
        overrideResults: [{ productIndex: 0, serpApiData }],
        overrideFocusIndex: 0,
        preSelectedIndices: Array.from(selectedMatchIndices),
        isNewScan: true
      });
      onClose();
    } else if (selectedMatchIndices.size > 0) {
      // Fallback to old behavior if no navigation
      onUseForSelection?.();
    }
  };

  return (
    <Animated.View style={[styles.matchSheet, sheetStyle]}>
      <ScrollView
        style={[
          styles.itemsScrollContainer,
        ]}
        showsVerticalScrollIndicator={true}
        contentContainerStyle={[
          styles.scrollContent,
          {
            flexGrow: 1
          }
        ]}
      >
        <View style={styles.sheetHeader}>
          <TouchableOpacity>
            <Icon name="close" size={24} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.sheetTitle}>
            {matchData.totalMatches} Match{matchData.totalMatches > 1 ? 'es' : ''} Found
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Icon name="close" size={24} color="#333" />
          </TouchableOpacity>
        </View>

        <Text style={styles.selectionHint}>
          Tap to select matches for creating this listing
        </Text>

        <View style={styles.matchResults}>
          {matchData.rankedCandidates.map((candidate, index) => {
            const isSelected = selectedMatchIndices.has(index);

            return (
              <TouchableOpacity
                key={`match-${index}`}
                style={[
                  styles.matchCard,
                  isSelected && styles.matchCardSelected
                ]}
                onPress={() => toggleMatchSelection(index)}
                activeOpacity={0.7}
              >
                <Image source={{ uri: candidate.imageUrl }} style={styles.matchImage} />
                <View style={styles.matchInfo}>
                  <Text style={styles.matchTitle} numberOfLines={2}>{cleanMatchText(candidate.title) || 'Unknown Product'}</Text>
                  {/*
                  <Text style={styles.matchDescription} numberOfLines={2}>
                    {cleanMatchText(candidate.description)}
                  </Text>
                  */}
                  <Text style={styles.matchPrice}>${candidate.price}</Text>
                  {/*
                  {candidate.sourceUrl && (
                    <Text style={styles.matchSource} numberOfLines={1}>
                      {new URL(candidate.sourceUrl).hostname.replace('www.', '')}
                    </Text>
                  )}
                    */}
                </View>

                {/* Selection indicator overlay */}
                {isSelected && (
                  <View style={styles.matchSelectionOverlay}>
                    <View style={styles.matchCheckmark}>
                      <Icon name="check" size={20} color="#FFFFFF" />
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.sheetActions}>
          {/* Side by side buttons like the design */}
          <View style={styles.matchActionsRow}>
            <TouchableOpacity
              style={styles.reviewDetailsButton}
              onPress={onStartBroadSearch}
            >
              <Icon name="magnify" size={18} color="#666" />
              <Text style={styles.reviewDetailsButtonText}>Review Items</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.listProductButton,
                selectedMatchIndices.size === 0 && styles.listProductButtonDisabled
              ]}
              onPress={handleGenerateWithSelected}
              disabled={selectedMatchIndices.size === 0}
            >
              <Icon name="package-variant" size={18} color={selectedMatchIndices.size > 0 ? "#FFF" : "#999"} />
              <Text style={[
                styles.listProductButtonText,
                selectedMatchIndices.size === 0 && { color: '#999' }
              ]}>List Product</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </Animated.View>
  );
};

// Bulk Items Sheet Component
const BulkItemsSheet: React.FC<{
  onClose: () => void;
  onStartBroadSearch: () => void;
  sheetStyle: any;
  photos: CapturedPhoto[];
  isBulkMode: boolean;
  bulkItems: Array<{ id: string; photos: CapturedPhoto[]; title?: string; isActive?: boolean; }>;
  activeItemId: string | null;
  onAddNewItem: () => void;
  onImageUpload: () => void;
  setJobResponse: (jobResponse: JobResponse | null) => void;
  onDeleteItem: (itemId: string) => void;
  onMovePhoto: (fromItemId: string, toItemId: string, photoId: string) => void;
  onSelectItem: (itemId: string) => void;
  onSetCoverPhoto: (itemId: string, photoId: string) => void;
  onRemovePhoto: (itemId: string, photoId: string) => void;
  performAnalyze: (firstPhotos: CapturedPhoto[]) => Promise<any>;
  sheetTranslateY: any;
  jobResponse: JobResponse | null;
  navigation: any;
  quickScanStore?: Record<string, { matchData: MatchResponse; serpApiData: any[] }>;
  onOpenQuickMatches?: (itemId: string) => void;
  itemLoadingStates: Record<string, { isLoading: boolean; stage: string; }>;
  setItemLoadingStates: React.Dispatch<React.SetStateAction<Record<string, { isLoading: boolean; stage: string; }>>>;
}> = ({ onClose, onStartBroadSearch, sheetStyle, photos, isBulkMode, bulkItems, activeItemId, onAddNewItem, onImageUpload, performAnalyze, onDeleteItem, onMovePhoto, onSelectItem, onSetCoverPhoto, onRemovePhoto, sheetTranslateY, navigation, setJobResponse, jobResponse, quickScanStore, onOpenQuickMatches, itemLoadingStates, setItemLoadingStates }) => {

  console.log('[SHEET RENDER] ==================');
  console.log('[SHEET RENDER] BulkItemsSheet RE-RENDERED at:', new Date().toISOString());
  console.log('[SHEET RENDER] Props received:');
  console.log('[SHEET RENDER] - photos.length:', photos.length);
  console.log('[SHEET RENDER] - bulkItems.length:', bulkItems.length);
  console.log('[SHEET RENDER] - bulkItems array:', JSON.stringify(bulkItems, null, 2));
  console.log('[SHEET RENDER] - activeItemId:', activeItemId);
  console.log('[SHEET RENDER] ==================');

  // SIMPLIFIED: Always use bulkItems (no more virtual items)
  let displayItems: Array<{ id: string; photos: CapturedPhoto[]; title?: string; isActive?: boolean; }>;

  console.log('[DISPLAY LOGIC] ==================');
  console.log('[DISPLAY LOGIC] Using simplified logic - always show bulkItems');
  console.log('[DISPLAY LOGIC] bulkItems.length:', bulkItems.length);
  console.log('[DISPLAY LOGIC] photos (capturedPhotos) length:', photos.length, '(legacy - should be same as total photos in bulkItems)');

  // Always use bulkItems - much simpler!
  displayItems = bulkItems;

  console.log('[DISPLAY LOGIC] Final displayItems (same as bulkItems):');
  displayItems.forEach((item, index) => {
    console.log(`[DISPLAY LOGIC] Item ${index + 1}:`, {
      id: item.id,
      photosCount: item.photos.length,
      photoIds: item.photos.map(p => p.id),
      isActive: item.isActive
    });
  });
  console.log('[DISPLAY LOGIC] ==================');

  const totalItems = displayItems.length;

  console.log('[SHEET DEBUG] ==================');
  console.log('[SHEET DEBUG] isBulkMode:', isBulkMode);
  console.log('[SHEET DEBUG] bulkItems length:', bulkItems.length);
  console.log('[SHEET DEBUG] photos length:', photos.length);
  console.log('[SHEET DEBUG] photos array:', photos.map(p => ({ id: p.id, uri: p.uri.substring(0, 30) + '...' })));
  console.log('[SHEET DEBUG] displayItems COUNT:', displayItems.length);
  console.log('[SHEET DEBUG] totalItems:', totalItems);
  console.log('[SHEET DEBUG] Sheet State:', totalItems === 0 ? 'EMPTY' : 'HAS_ITEMS');
  console.log('[SHEET DEBUG] ==================');

  // Fixed height at 60% of screen
  const sheetMaxHeight = SCREEN_HEIGHT * 0.7;
  const headerHeight = 160; // Increased for debug sections
  const footerHeight = 120; // Height for fixed bottom actions
  const scrollableHeight = Math.max(200, sheetMaxHeight - headerHeight - footerHeight);

  console.log('[SHEET LAYOUT] Heights calculated:', {
    screenHeight: SCREEN_HEIGHT,
    sheetMaxHeight,
    headerHeight,
    footerHeight,
    scrollableHeight
  });

  const dynamicSheetStyle = useAnimatedStyle(() => ({
    transform: sheetStyle.transform,
    height: sheetMaxHeight,
  }));

  return (
    <Animated.View style={[styles.bulkItemsSheet, dynamicSheetStyle]}>
      {/* Drag Handle */}
      <PanGestureHandler
        onGestureEvent={(event) => {
          const { translationY } = event.nativeEvent;
          const minY = SCREEN_HEIGHT * 0.1; // Maximum expanded (80% height)
          const maxY = SCREEN_HEIGHT * 0.6; // Minimum height (40% height)
          const currentY = SCREEN_HEIGHT * 0.6; // Current position (60% height)

          // Calculate new position based on drag
          const newY = Math.max(minY, Math.min(maxY, currentY + translationY * 0.5));
          sheetTranslateY.value = newY;
        }}
        onHandlerStateChange={(event) => {
          if (event.nativeEvent.state === State.END) {
            const { velocityY } = event.nativeEvent;

            // Snap to positions based on velocity
            if (velocityY > 500) {
              // Fast downward swipe - close completely
              onClose();
            } else if (velocityY < -500) {
              // Fast upward swipe - expand to max
              sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.2);
            } else {
              // Snap to nearest position
              const currentY = sheetTranslateY.value;
              const midPoint = SCREEN_HEIGHT * 0.4;

              if (currentY < midPoint) {
                // Closer to top - expand
                sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.2);
              } else {
                // Closer to middle - default
                sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.4);
              }
            }
          }
        }}
      >
        <Animated.View style={styles.dragHandle}>
          <TouchableOpacity onPress={onClose} style={styles.dragHandleButton}>
            <View style={styles.dragHandleBar} />
          </TouchableOpacity>
        </Animated.View>
      </PanGestureHandler>

      <View style={styles.sheetHeader}>
        <TouchableOpacity onPress={onClose}>
          <Icon name="close" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.sheetTitle}>
          {totalItems === 0
            ? 'Ready to Create Items'
            : `Creating ${totalItems} New Item${totalItems > 1 ? 's' : ''}`
          }
        </Text>
        {/* New Item button */}
        <TouchableOpacity style={styles.headerNewItemButton} onPress={onAddNewItem}>
          <Icon name="plus" size={20} color="#93C822" />
        </TouchableOpacity>
      </View>


      {/* Main Camera View */}
      <View style={styles.sheetContent}>


        <Text style={styles.sheetSubtitle}>
          {totalItems === 0
            ? 'Take a photo to automatically create your first item'
            : 'Drag Photos & Create New Items'
          }
        </Text>

        {/* Scrollable Items Container */}
        <ScrollView
          style={[
            styles.itemsScrollContainer,
            {
              height: scrollableHeight,
            }
          ]}
          showsVerticalScrollIndicator={true}
          contentContainerStyle={[
            styles.scrollContent,
            {
              flexGrow: 1
            }
          ]}
        >
          {displayItems.length === 0 ? (
            (() => {
              console.log('[RENDER] Showing EMPTY STATE (no items to display)');
              return (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Icon name="camera-plus-outline" size={48} color="#ccc" />
                  <Text style={{ marginTop: 12, fontSize: 16, color: '#666', textAlign: 'center' }}>
                    Take your first photo to get started
                  </Text>
                  <Text style={{ marginTop: 4, fontSize: 14, color: '#999', textAlign: 'center' }}>
                    The first photo of each item gets automatically scanned
                  </Text>
                </View>
              );
            })()
          ) : (
            (() => {
              console.log('[RENDER] Showing', displayItems.length, 'ITEMS');
              return displayItems.map((item, id) => {
                const loadingState = itemLoadingStates[item.id];
                console.log(`[RENDER] Rendering Item ${id + 1}:`, {
                  id: item.id,
                  photosCount: item.photos.length,
                  isActive: item.isActive,
                  hasQuickMatches: quickScanStore?.[item.id] ? 'YES' : 'NO',
                  quickMatchCount: quickScanStore?.[item.id]?.matchData?.totalMatches || 0,
                  isLoading: loadingState?.isLoading || false,
                  loadingStage: loadingState?.stage
                });
                return (
                  <TouchableOpacity
                    key={`bulk-item-${item.id}`}
                    style={[
                      styles.bulkItemContainer,
                      item.isActive && styles.activeItemContainer,

                      { backgroundColor: item.isActive ? '#e8f5e8' : '#ffffff' }
                    ]}
                    onPress={() => onSelectItem(item.id)}
                  >
                    <View style={styles.itemHeader}>
                      <View style={styles.itemLabelContainer}>
                        <Text style={[
                          styles.itemLabel,
                          item.isActive && styles.activeItemLabel
                        ]}>
                          Item {id + 1}
                        </Text>
                        {item.isActive && (
                          <View style={styles.activeItemBadge}>
                            <Text style={styles.activeItemBadgeText}>ACTIVE</Text>
                          </View>
                        )}
                        {loadingState?.isLoading && (
                          <View style={styles.loadingBadge}>
                            <Icon name="loading" size={12} color="#93C822" />
                            <Text style={styles.loadingBadgeText}>{loadingState.stage}</Text>
                          </View>
                        )}
                      </View>
                      {/* Show delete button if there are items */}
                      {bulkItems.length > 0 && (
                        <TouchableOpacity
                          style={styles.deleteItemButton}
                          onPress={(e) => { e.stopPropagation?.(); onDeleteItem(item.id); }}
                        >
                          <Icon name="delete-outline" size={18} color="#ff6b6b" />
                        </TouchableOpacity>
                      )}
                    </View>


                    <View style={styles.photoSlotsContainer}>
                      {item.photos.map((photo: CapturedPhoto, photoIndex: number) => (
                        <TapGestureHandler
                          key={`photo-${item.id}-${photo.id}`}
                          numberOfTaps={2}
                          onHandlerStateChange={(event) => {
                            if (event.nativeEvent.state === State.ACTIVE) {
                              onSetCoverPhoto(item.id, photo.id);
                            }
                          }}
                        >
                          <Animated.View
                            style={[
                              styles.photoSlot,
                              photo.isCover && styles.coverPhotoSlot // Green border for cover photo
                            ]}
                          >
                            <TouchableOpacity
                              onPress={() => {
                                // Single tap just selects photo (no action for now)
                                console.log('Selected photo:', photo.id);
                              }}
                              onLongPress={() => {
                                // Long press options
                                Alert.alert(
                                  'Photo Options',
                                  `Photo ${photoIndex + 1}${photo.isCover ? ' (Cover)' : ''}`,
                                  [
                                    { text: 'Set as Cover', onPress: () => onSetCoverPhoto(item.id, photo.id) },
                                    { text: 'Remove from Item', onPress: () => onRemovePhoto(item.id, photo.id) },
                                    { text: 'Cancel', style: 'cancel' },
                                  ]
                                );
                              }}
                            >
                              <Image source={{ uri: photo.uri }} style={styles.photoSlotImage} />
                              <View style={[
                                styles.photoSlotLabel,
                                photo.isCover && styles.coverPhotoLabel
                              ]}>
                                <Text style={styles.photoSlotLabelText}>
                                  {photo.isCover ? 'COVER' : `pic ${photoIndex + 1}`}
                                </Text>
                              </View>
                              {/* Delete button for bulk item photos */}
                              <TouchableOpacity
                                style={styles.bulkPhotoDeleteButton}
                                onPress={() => onRemovePhoto(item.id, photo.id)}
                                hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                              >
                                <Icon name="close-circle" size={14} color="#ff4444" />
                              </TouchableOpacity>
                            </TouchableOpacity>
                          </Animated.View>
                        </TapGestureHandler>
                      ))}

                      {/* Add Photo Button - Only show if less than 12 photos */}
                      {item.photos.length < 12 && (
                        <TouchableOpacity style={styles.addPhotoButton} onPress={onImageUpload}>
                          <Icon name="camera-plus-outline" size={20} color="#999" />
                          <Text style={styles.addPhotoText}>Add Photo</Text>
                        </TouchableOpacity>
                      )}
                    </View>


                    {item.photos.length >= 12 && (
                      <Text style={styles.maxPhotosText}>Maximum 12 photos per item</Text>
                    )}

                    {/* Optional quick matches reopen button if present */}
                    {(() => {
                      const hasQuickMatches = quickScanStore?.[item.id];
                      const matchCount = hasQuickMatches?.matchData?.totalMatches || 0;
                      console.log(`[RENDER QUICK BUTTON] Item ${id + 1} (${item.id}): hasQuickMatches = ${hasQuickMatches ? 'YES' : 'NO'}`);
                      if (hasQuickMatches) {
                        console.log(`[RENDER QUICK BUTTON] Item ${id + 1} match count:`, matchCount);
                      }
                      return matchCount > 0 && (
                        <TouchableOpacity
                          style={styles.quickMatchesButton}
                          onPress={() => onOpenQuickMatches?.(item.id)}
                        >
                          <View style={styles.matchNotificationDot} />
                          <Text style={styles.quickMatchesButtonText}>
                            View Quick Matches ({matchCount})
                          </Text>
                        </TouchableOpacity>
                      );
                    })()}

                  </TouchableOpacity>

                );
              });
            })()
          )}
        </ScrollView>

        {/* Fixed Bottom Actions */}
        <View style={styles.bottomActions}>
          {/* New Item Button */}
          <TouchableOpacity
            style={styles.newItemButton}
            onPress={() => {
              console.log('[NEW ITEM] Button pressed');
              onAddNewItem();
            }}
          >
            <Icon name="plus" size={16} color="#999" />
            <Text style={styles.newItemButtonText}>New Item</Text>
          </TouchableOpacity>

          {/* Search Button */}
          <TouchableOpacity
            style={[
              styles.searchForProductButton,
              totalItems === 0 && styles.disabledButton
            ]}
            disabled={totalItems === 0}
            onPress={async () => {
              console.log('[SEARCH] Starting broad search for all items');

              // Get all photos from bulkItems (simplified - no more dual system)
              const firstPhotos = bulkItems.map(item => item.photos[0]).filter(Boolean);

              if (firstPhotos.length === 0) {
                Alert.alert('No Photos', 'Please take some photos first before searching.');
                return;
              }

              // Tell parent to close existing sheets and stop any quick scan
              onStartBroadSearch();

              // Set loading state for all items
              const loadingStates: Record<string, { isLoading: boolean; stage: string; }> = {};
              bulkItems.forEach(item => {
                if (item.photos.length > 0) {
                  loadingStates[item.id] = { isLoading: true, stage: 'Processing...' };
                }
              });
              setItemLoadingStates(loadingStates);

              try {

                // Call performAnalyze to get the job ID
                const jobResponseData: JobResponse = await performAnalyze(firstPhotos);
                console.log('[SEARCH] Job Response:', jobResponseData);
                setJobResponse(jobResponseData); // Store in state
                const jobId = jobResponseData?.jobId;
                console.log('[SEARCH] Job ID:', jobId);

                if (jobId) {
                  // Navigate to loading screen with job ID for polling
                  navigation.navigate("LoadingScreen", {
                    processType: 'match',
                    payload: {
                      jobId: jobId,
                      bulkItems: bulkItems,
                      firstPhotos: firstPhotos,
                    },
                    onCompleteRoute: {
                      screen: 'MatchSelectionScreen',
                      params: {
                        jobResponse: jobResponseData,
                        response: {
                          jobId: jobId,
                          bulkItems: bulkItems,
                          firstPhotos: firstPhotos,
                        }
                      },
                    }
                  });

                  console.log('[SEARCH] Navigating to LoadingScreen with jobId:', jobId);
                } else {
                  Alert.alert('Error', 'Failed to start analysis. Please try again.');
                }
              } catch (error) {
                console.error('[SEARCH] Error starting analysis:', error);
                Alert.alert('Error', 'Failed to start analysis. Please try again.');
              }
            }
            }>
            <Icon name="magnify" size={16} color={totalItems === 0 ? "#999" : "white"} />
            <Text style={[
              styles.searchForProductButtonText,
              totalItems === 0 && { color: '#999' }
            ]}>
              Search For Product (Broad)
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
};

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  flashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'white',
    opacity: 0,
  },
  tapToFocusOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  // Photo Stack Styles
  photoStackContainer: {
    position: 'absolute',
    top: 100,
    left: 20,
    zIndex: 10,
  },
  activeItemIndicator: {
    backgroundColor: '93C822',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  activeItemIndicatorText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  photoStackItem: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  photoStackImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  photoStackNumber: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoStackNumberText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  coverBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Camera Controls Styles
  cameraControlsContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 100,
  },
  cameraControlsContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },


  centerOverlay: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerOverlayText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  processingIndicator: {
    marginLeft: 8,
  },

  // Barcode Overlay Styles
  barcodeOverlayContainer: {
    position: 'absolute',
    top: 140, // Below nav bar
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },

  textSearchOverlay: {
    position: 'absolute',
    top: 120,
    left: 20,
    right: 20,
    zIndex: 200,
  },
  textSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  textSearchInput: {
    flex: 1,
    height: 36,
    fontSize: 16,
    color: '#000',
  },
  textSearchClose: {
    padding: 4,
    marginLeft: 8,
  },
  barcodeOverlay: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  barcodeText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    maxWidth: 200,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  copyButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },

  // Photo Frame & Scan Line Styles
  photoFrameOverlay: {
    position: 'absolute',
    top: '25%',
    left: '10%',
    right: '10%',
    bottom: '35%',
    borderWidth: 2,
    borderColor: 'rgba(200, 200, 200, 0.5)',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  scanLineContainer: {
    position: 'absolute',
    top: '25%',
    left: '10%',
    right: '10%',
    bottom: '35%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanLine: {
    width: '100%',
    height: 3,
    backgroundColor: '#4CAF50',
    opacity: 0.8,
  },

  // Bottom Controls Styles
  bottomControls: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    zIndex: 10,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 40,
    marginBottom: 20,
  },
  galleryButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'white',
  },
  focusButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Mode Selector Styles
  modeSelectorWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100, // Ensure popup is above other elements
  },
  modeButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  modePopup: {
    position: 'absolute',
    right: -40,
    bottom: 65, // Position above the button
    alignItems: 'flex-end',
    width: 350, // Wide enough for 3 items
    // Center the popup (280px) over the button (50px).
    // Button is right aligned in wrapper. Wrapper is 50px.
    // To center 280 over 50: right = -(280-50)/2 = -115
    paddingRight: 30,
  },
  modePopupContent: {
    flexDirection: 'row',
    backgroundColor: '#000',
    borderRadius: 24,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'space-between',
    width: '100%',
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.30,
    shadowRadius: 4.65,
    elevation: 8,
  },
  modePopupItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 8,
    flex: 1,
  },
  modePopupItemActive: {
    backgroundColor: 'rgba(76, 175, 80, 0.2)', // Green tint for active
  },
  modePopupLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  modePopupLabelActive: {
    color: '#fff',
  },
  modePopupIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  modePopupIconContainerActive: {
    borderColor: '#fff',
    backgroundColor: '#4CAF50', // Green background for active icon
  },
  modePopupArrow: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 0,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    borderTopColor: '#000', // Match content background
    marginTop: -1,
    // Arrow should be centered on the button. 
    // Popup is centered on the button.
    // So arrow should be centered on the popup.
    // Since alignItems is center on modePopup, just remove margins.
  },
  continueButtonContainer: {
    paddingHorizontal: 20,
  },
  itemNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemNavArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemNavArrowDisabled: {
    opacity: 0.4,
  },
  itemNavNewButton: {
    backgroundColor: '#93C822',
  },
  continueButton: {
    flex: 1,
    marginHorizontal: 12,
    backgroundColor: '#93C822',
    borderRadius: 22,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  continueButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  itemCountBadge: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 8,
  },
  itemCountBadgeText: {
    color: 'rgba(0,0,0,0.7)',
    fontSize: 12,
    fontWeight: '600',
  },

  // Sheet Styles
  matchSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 60,
    marginBottom: 30,
    minHeight: SCREEN_HEIGHT * 0.9,
    maxHeight: SCREEN_HEIGHT * 0.9,
  },
  bulkItemsSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 120, // Increased bottom padding
    marginBottom: 0, // Added bottom margin
    height: SCREEN_HEIGHT * 0.7,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  headerNewItemButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(147, 200, 34, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  matchActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  reviewDetailsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 25,
    backgroundColor: '#f5f5f5',
    gap: 8,
  },
  reviewDetailsButtonText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },
  listProductButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 25,
    backgroundColor: '#93C822',
    gap: 8,
  },
  listProductButtonDisabled: {
    backgroundColor: '#e0e0e0',
  },
  listProductButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  sheetContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },

  // Match Results Styles
  matchResults: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  matchCard: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
    minHeight: 120,
  },
  matchCardSelected: {
    borderColor: '#93C822',
    backgroundColor: 'rgba(147, 200, 34, 0.08)',
  },
  matchImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  matchInfo: {
    flex: 1,
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  matchDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  matchPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#93C822',
    marginBottom: 4,
  },
  matchSource: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
  },
  matchSelectionOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
  },
  matchCheckmark: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#93C822',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 4,
  },
  selectionHint: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  primaryButtonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  sheetActions: {
    paddingHorizontal: 20,
  },
  primaryButton: {
    backgroundColor: '#93C822',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },

  // Deep Search Styles
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: 16,
    color: '#666',
  },
  searchSubmitButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 20,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  templateOptions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  templateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  templateButtonText: {
    fontSize: 14,
    color: '#666',
  },
  broadSearchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingVertical: 12,
    gap: 8,
    marginBottom: 20,
  },
  broadSearchText: {
    fontSize: 16,
    color: '#666',
  },
  broadSearchButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2196F3',
  },
  // Green notification indicator styles for quick matches button
  quickMatchesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderWidth: 2,
    borderColor: '#e1e1e1ff',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 10,
    gap: 6,
  },
  quickMatchesButtonText: {
    color: '#93C822',
    fontSize: 13,
    fontWeight: '600',
  },
  matchNotificationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#93C822',
  },
  photoAttachments: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 16,
    marginBottom: 100,
  },
  attachmentTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  attachmentPhotos: {
    flexDirection: 'row',
    gap: 8,
  },
  attachmentPhoto: {
    position: 'relative',
    width: 50,
    height: 50,
    borderRadius: 8,
    overflow: 'hidden',
  },
  attachmentPhotoImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  attachmentPhotoNumber: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.7)',
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 8,
  },

  // Bulk Items Sheet Styles
  sheetSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  bulkItemContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#D9D9D9',
    minHeight: 100,
  },
  photoSlotsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  photoSlot: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
    position: 'relative',
  },
  photoSlotImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  emptyPhotoSlot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  photoSlotLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 2,
  },
  photoSlotLabelText: {
    color: 'white',
    fontSize: 10,
    textAlign: 'center',
    fontWeight: '500',
  },
  addPhotoButton: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#f5f5f5ff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'column',
  },
  deleteItemButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ff6b6b',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  newItemButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingVertical: 16,
    marginBottom: 10,
    gap: 8,
  },
  newItemButtonText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  searchForProductButton: {
    backgroundColor: '#93C822',
    borderRadius: 12,
    paddingVertical: 16,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  disabledButton: {
    backgroundColor: '#e0e0e0',
    opacity: 0.6,
  },
  searchForProductButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },

  // New Bulk Sheet Styles
  dragHandle: {
    alignItems: 'center',
    marginBottom: 10,
  },
  dragHandleButton: {
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 15,
  },
  dragHandleBar: {
    width: 60,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
  },
  itemsScrollContainer: {
    flexGrow: 1,
  },
  scrollContent: {
    paddingBottom: 20,

    paddingHorizontal: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  itemLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
  },
  itemLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  activeItemContainer: {
    borderColor: '#93C822',
    borderWidth: 2,
    backgroundColor: '#f8fff8',
  },
  activeItemLabel: {
    color: '#93C822',
    fontWeight: '700',
  },
  activeItemBadge: {
    backgroundColor: '#93C822',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  activeItemBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
  loadingBadge: {
    backgroundColor: '#f0f8ff',
    borderColor: '#93C822',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingBadgeText: {
    color: '#93C822',
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 4,
  },
  bulkPhotoDeleteButton: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  coverPhotoSlot: {
    borderColor: '#93C822',
    borderWidth: 2,
  },
  coverPhotoLabel: {
    backgroundColor: '#93C822',
  },
  addPhotoText: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
  },
  maxPhotosText: {
    fontSize: 12,
    color: '#ff6b6b',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
  },
  bottomActions: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 16,
    marginTop: 16,
    marginBottom: 16,
  },

  // Progress Bar Styles
  progressBarContainer: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 20,
  },
  progressBarBackground: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#93C822',
    borderRadius: 2,
  },
  progressSpinner: {
    marginLeft: 12,
    width: 20,
    height: 20,
  },

  // Notification Bar Styles
  notificationBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 25,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 30,
  },
  notificationText: {
    color: 'white',
    fontSize: 14,
    marginLeft: 10,
    flex: 1,
    fontWeight: '500',
  },

  // Permission Styles
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  permissionButton: {
    backgroundColor: '#93C822',
    borderRadius: 25,
    paddingHorizontal: 30,
    paddingVertical: 15,
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },

  // Debug styles
  debugOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 40 : 20,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 6,
    padding: 8,
    zIndex: 100,
  },
  debugText: {
    color: 'white',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    textAlign: 'center',
  },
  debugButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
    gap: 10,
  },
  debugButton: {
    backgroundColor: 'rgba(76, 175, 80, 0.8)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  debugButtonText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },

  // Camera paused overlay styles
  cameraPausedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  cameraPausedIndicator: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 12,
    padding: 20,
  },
  cameraPausedText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
  cameraPausedSubtext: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
  },
  sheetHeaderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#93C822',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 10,
  },
  barcodeResultContainer: {
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    marginHorizontal: 20,
    marginBottom: 20,
  },
  barcodeProductImage: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    marginBottom: 20,
  },
  barcodeProductDetails: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  barcodeProductTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  barcodeProductDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  barcodeProductMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  barcodeMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  barcodeMetaLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  barcodeMetaValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  barcodePlatformIndicators: {
    flexDirection: 'row',
    gap: 10,
  },
  barcodePlatformChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  barcodePlatformChipText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  barcodeActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
});

export default AddProductScreen;   