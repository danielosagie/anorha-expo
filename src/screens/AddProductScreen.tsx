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
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
import { PanGestureHandler, TapGestureHandler, State } from 'react-native-gesture-handler';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { SvgXml } from 'react-native-svg';
import PhotoStack, { CapturedPhoto } from '../components/camera/PhotoStack';
import CameraControls from '../components/camera/CameraControls';
import BusinessTemplateModal, { BusinessTemplate } from '../components/camera/BusinessTemplateModal';
import { supabase } from '../lib/supabase';
import * as FileSystem from 'expo-file-system';

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
  systemAction: 'show_single_match' | 'show_multiple_matches' | 'fallback_to_manual';
  confidence: 'high' | 'medium' | 'low';
  rankedCandidates: MatchCandidate[];
  totalMatches: number;
}

type AddProductScreenProps = StackScreenProps<AppStackParamList, 'AddProduct'>;

type CameraInstruction = 'ready' | 'move_closer' | 'move_back' | 'add_light' | 'focus' | 'processing' | 'matches_found' | 'no_matches' | 'barcode_scanned';

type CameraMode = 'camera' | 'barcode';

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
  const [cameraMode, setCameraMode] = useState<CameraMode>('camera');
  
  // Barcode state
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [barcodeNotificationCount, setBarcodeNotificationCount] = useState(0);
  
  // UI state
  const [currentInstruction, setCurrentInstruction] = useState<CameraInstruction>('ready');
  const [showMatchSheet, setShowMatchSheet] = useState(false);
  const [showDeepSearchSheet, setShowDeepSearchSheet] = useState(false);
  const [matchData, setMatchData] = useState<MatchResponse | null>(null);
  
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
  
  // Notification and progress state
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [showProgressBar, setShowProgressBar] = useState(false);
  
  // Camera ref
  const cameraRef = useRef<CameraView>(null);
  
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
  
  // Camera state optimization tracking
  useEffect(() => {
    const isCameraActive = !showDeepSearchSheet && !showMatchSheet;
    console.log('[CAMERA OPTIMIZATION] Camera active state changed:', {
      isActive: isCameraActive,
      showDeepSearchSheet,
      showMatchSheet,
      reason: showDeepSearchSheet ? 'Deep search sheet open' : 
              showMatchSheet ? 'Match sheet open' : 
              'All sheets closed'
    });
  }, [showDeepSearchSheet, showMatchSheet]);
  
  // Animation values
  const sheetTranslateY = useSharedValue(SCREEN_HEIGHT);
  
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

  // Instructions mapping
  const getInstructionText = (instruction: CameraInstruction): string => {
    switch (instruction) {
      case 'ready': return cameraMode === 'camera' ? 'Point camera at product' : 'Scan barcode on product';
      case 'move_closer': return 'Move closer to product';
      case 'move_back': return 'Move back from product';
      case 'add_light': return 'Add more light to scene';
      case 'focus': return 'Tap to focus';
      case 'processing': return 'Processing image...';
      case 'matches_found': return `${matchData?.totalMatches || 0} matches found!`;
      case 'no_matches': return 'No matches found';
      case 'barcode_scanned': return scannedBarcode || 'Barcode scanned';
      default: return cameraMode === 'camera' ? 'Point camera at product' : 'Scan barcode on product';
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
          
          setTimeout(() => {
            performQuickScan(newPhoto);
          }, 500);
          
        } else if (activeItemId) {
          // Add to existing active item
          console.log('[ITEM CREATION] Adding photo to existing active item:', activeItemId);
          setBulkItems(prev => prev.map(item => {
            if (item.id === activeItemId) {
              const isFirstPhoto = item.photos.length === 0;
              const updatedItem = { ...item, photos: [...item.photos, newPhoto] };
              
              console.log('[ITEM CREATION] Updated item:', {
                itemId: item.id,
                wasFirstPhoto: isFirstPhoto,
                newPhotoCount: updatedItem.photos.length
              });
              
              // Quick scan first photo of each item
              if (isFirstPhoto) {
                console.log('[ITEM CREATION] Triggering quick scan (first photo of item)');
                setTimeout(() => {
                  performQuickScan(newPhoto);
                }, 500);
              }
              
              return updatedItem;
            }
            return item;
          }));
          
        } else {
          // Items exist but no active item - create new one
          console.log('[ITEM CREATION] Creating new item (items exist but no active item)');
          const newItem = {
            id: `item-${Date.now()}`,
            photos: [newPhoto],
            title: undefined,
            isActive: true
          };
          setBulkItems(prev => [...prev.map(item => ({ ...item, isActive: false })), newItem]);
          setActiveItemId(newItem.id);
          console.log('[ITEM CREATION] Created new item:', newItem.id);
          console.log('[ITEM CREATION] Triggering quick scan (first photo of new item)');
          
          setTimeout(() => {
            performQuickScan(newPhoto);
          }, 500);
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

  // Handle barcode scan
  const handleBarCodeScanned = useCallback((scanningResult: BarcodeScanningResult) => {
    if (cameraMode === 'barcode' && scanningResult.data && scannedBarcode !== scanningResult.data) {
      setScannedBarcode(scanningResult.data);
      setCurrentInstruction('barcode_scanned');
      setBarcodeNotificationCount(prev => prev + 1);
      
      console.log('Barcode scanned:', scanningResult.data);
      
      // Show multiple notifications as requested
      for (let i = 0; i < 30; i++) {
        setTimeout(() => {
          console.log(`Barcode notification ${i + 1}: ${scanningResult.data}`);
        }, i * 100);
      }
      
      // Reset after some time
      setTimeout(() => {
        setCurrentInstruction('ready');
      }, 3000);
    }
  }, [cameraMode, scannedBarcode]);

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

  const handleContinue = useCallback(() => {
    console.log('[CONTINUE] Button pressed, opening search sheet');
    console.log('[CONTINUE] Current state:', {
      capturedPhotosCount: capturedPhotos.length,
      isBulkMode,
      bulkItemsCount: bulkItems.length,
      activeItemId
    });
    
    // Always open sheet - it will show empty state if no photos
    setShowDeepSearchSheet(true);
    sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.4); // Position for 60% height sheet
  }, [sheetTranslateY, capturedPhotos.length, isBulkMode, bulkItems.length, activeItemId]); 

  // Handle image picker - SIMPLIFIED: Always add to bulkItems
  const handleImageUpload = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need camera roll permissions to upload images.');
      return;
    }
    
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
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
        console.log('[IMAGE UPLOAD] Created new item with uploaded photo');
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

  // Toggle camera mode
  const toggleCameraMode = useCallback(() => {
    setCameraMode(prev => prev === 'camera' ? 'barcode' : 'camera');
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
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    const session = await supabase.auth.getSession();
    const token = session?.data.session?.access_token;
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
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    const session = await supabase.auth.getSession();
    const token = session?.data.session?.access_token;
    return token;
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

      // Read the file as base64
      const base64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Create file name
      const fileName = `${user.id}/${photoId}-${Date.now()}.jpg`;
      
      // Convert base64 to proper blob for upload
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      
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
  const performQuickScan = useCallback(async (photo: CapturedPhoto) => {
    if (!isAutoScanning) {
      setIsAutoScanning(true);
      setCurrentInstruction('processing');
      
      try {
        console.log('[QUICK SCAN] Starting quick scan for photo:', photo.id);
        console.log('[QUICK SCAN] Photo URI:', photo.uri);
        console.log('[QUICK SCAN] Timestamp:', new Date().toISOString());

        // Upload image to Supabase Storage first
        console.log('[QUICK SCAN] Uploading image to Supabase...');
        const publicImageUrl = await uploadImageToSupabase(photo.uri, photo.id);
        console.log('[QUICK SCAN] Image uploaded to:', publicImageUrl);

        const token = await getToken();
        
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
            useReranker: true
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const quickScanResult = await response.json();
        
        console.log('[QUICK SCAN] Response received:', JSON.stringify(quickScanResult, null, 2));
        console.log('[QUICK SCAN] Processing time:', quickScanResult.totalProcessingTimeMs + 'ms');
        console.log('[QUICK SCAN] Overall confidence:', quickScanResult.overallConfidence);
        console.log('[QUICK SCAN] Recommended action:', quickScanResult.recommendedAction);
        
        // Extract matches from the results array (proper API response format)
        const allMatches = quickScanResult.results?.flatMap((result: any) => result.matches) || [];
        
        setTimeout(async () => {
          if (quickScanResult.recommendedAction === 'show_single_match' || 
              (quickScanResult.overallConfidence === 'high' && allMatches.length > 0)) {
            console.log('[QUICK SCAN] High confidence match found, showing match sheet');
            setQuickScanResults(allMatches);
            setMatchData({
              systemAction: 'show_single_match',
              confidence: quickScanResult.overallConfidence,
              totalMatches: allMatches.length,
              rankedCandidates: allMatches.map((match: any) => ({
                id: match.variantId || match.productId || `match-${Date.now()}`,
                title: match.title || 'Unknown Product',
                description: match.description || '',
                price: match.price || 0,
                imageUrl: match.imageUrl || '',
                matchPercentage: Math.round((match.combinedScore || 0) * 100),
                sourceUrl: match.link || '',
              }))
            });
            setCurrentInstruction('matches_found');
            stopProgressAnimation();
            setShowMatchSheet(true);
            sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.4);
          } else {
            console.log('[QUICK SCAN] Low confidence or no matches, creating item automatically');
            // NO FALLBACK TO ANALYZE - just create item and show deep search
            setCurrentInstruction('no_matches');
            stopProgressAnimation();
            showNotificationMessage('No matches found. Item created - use search options to find your product.', 4000);
            setTimeout(() => {
              setShowDeepSearchSheet(true);
              sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.4);
            }, 1000);
          }
          setIsAutoScanning(false);
        }, 500);
        
      } catch (error) {
        console.error('[QUICK SCAN] Quick scan failed:', error);
        console.log('[QUICK SCAN] Creating item automatically (no fallback to analyze)');
        // NO FALLBACK TO ANALYZE - just create item
        setCurrentInstruction('no_matches');
        stopProgressAnimation();
        showNotificationMessage('Quick scan failed. Item created - use search options.', 3000);
        setTimeout(() => {
          setShowDeepSearchSheet(true);
          sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.4);
        }, 1000);
        setIsAutoScanning(false);
      }
    }
  }, [isAutoScanning, sheetTranslateY, stopProgressAnimation, uploadImageToSupabase]);

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
        images: [{url}]
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
         headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
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
    const newItemId = `item-${Date.now()}`;
    console.log('[ADD NEW ITEM] Starting to add new item:', newItemId);
    console.log('[ADD NEW ITEM] Current bulk mode:', isBulkMode);
    console.log('[ADD NEW ITEM] Current items count:', bulkItems.length);
    
    // Auto-enable bulk mode when adding items
    if (!isBulkMode) {
      console.log('[ADD NEW ITEM] Enabling bulk mode');
      setIsBulkMode(true);
      if (capturedPhotos.length > 0) {
        // Create first item with existing photos
        const firstItemId = `item-${Date.now()}`;
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
    setBulkItems(prev => prev.map(item => ({
      ...item,
      isActive: item.id === itemId
    })));
    setActiveItemId(itemId);
    
    // Show notification of which item is now active
    const itemIndex = bulkItems.findIndex(item => item.id === itemId) + 1;
    showNotificationMessage(`Switched to Item ${itemIndex}`, 1500);
  }, [bulkItems, showNotificationMessage]);

  // Delete bulk item
  const deleteBulkItem = useCallback((itemId: string) => {
    setBulkItems(prev => prev.filter(item => item.id !== itemId));
  }, []);

  // Move photo between items
  const movePhoto = useCallback((fromItemId: string, toItemId: string, photoId: string) => {
    setBulkItems(prev => {
      const fromItem = prev.find(item => item.id === fromItemId);
      const photoToMove = fromItem?.photos.find(photo => photo.id === photoId);
      
      if (!photoToMove) return prev;
      
      return prev.map(item => {
        if (item.id === fromItemId) {
          return {
            ...item,
            photos: item.photos.filter(photo => photo.id !== photoId)
          };
        }
        if (item.id === toItemId && item.photos.length < 12) {
          return {
            ...item,
            photos: [...item.photos, photoToMove]
          };
        }
        return item;
      });
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
        const remainingPhotos = item.photos.filter(p => p.id !== photoId);
        // If we removed the cover photo, make the first remaining photo the cover
        if (remainingPhotos.length > 0 && !remainingPhotos.some(p => p.isCover)) {
          remainingPhotos[0].isCover = true;
        }
        return {
          ...item,
          photos: remainingPhotos
        };
      }
      return item;
    }));
  }, []);

  // Close sheets - much faster
  const closeSheets = useCallback(() => {
    sheetTranslateY.value = withTiming(SCREEN_HEIGHT, {
      duration: 200, // Fast close
    }, () => {
      runOnJS(setShowMatchSheet)(false);
      runOnJS(setShowDeepSearchSheet)(false);
      runOnJS(setCurrentInstruction)('ready');
    });
  }, [sheetTranslateY]);

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
      
      {/* Camera View */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flash}
        active={!showDeepSearchSheet && !showMatchSheet} // Disable camera when sheets are open
        onBarcodeScanned={handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'],
        }}
      >
      {/* Flash overlay */}
      <Animated.View style={[styles.flashOverlay, flashAnimatedStyle]} />
      
      {/* Camera paused overlay */}
      {(showDeepSearchSheet || showMatchSheet) && (
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
            if (showMatchSheet || showDeepSearchSheet) {
              closeSheets();
              return;
            }
            // Otherwise handle focus
            handleFocusTap(event);
          }}
          onLongPress={() => {
            // Open sheet on long press if not already open
            if (!showDeepSearchSheet && !showMatchSheet) {
              setShowDeepSearchSheet(true);
              sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.4);
            }
          }}
        />
        
        {/* Photo stack (top left) - shows active item's photos in bulk mode */}
        {(() => {
          const displayPhotos = activeItemId 
            ? bulkItems.find(item => item.id === activeItemId)?.photos || []
            : [];
          
          return (
            <View style={styles.photoStackContainer}>
              {/* Active item indicator - always show if there's an active item */}
              {activeItemId && (
                <View style={styles.activeItemIndicator}>
                  <Text style={styles.activeItemIndicatorText}>
                    Item {bulkItems.findIndex(item => item.id === activeItemId) + 1}
                  </Text>
          </View>
              )}
              
              {displayPhotos.length > 0 && (
                <PhotoStack 
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
         
         {/* Photo frame overlay */}
         <View style={styles.photoFrameOverlay} />
         
         {/* Scan line overlay for barcode mode */}
         {cameraMode === 'barcode' && (
           <View style={styles.scanLineContainer}>
             <View style={styles.scanLine} />
          </View>
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
               backgroundColor: (!showDeepSearchSheet && !showMatchSheet) ? '#4CAF50' : '#FF5722',
               borderRadius: 4,
               paddingHorizontal: 4
             }]}>
               📷 Camera: {(!showDeepSearchSheet && !showMatchSheet) ? 'ACTIVE' : 'PAUSED'}
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
         )} */}
        
                 {/* Bottom controls */}
         <BottomControls 
           onCapture={handleCapture}
           isCapturing={isCapturing}
           captureButtonScale={captureButtonScale}
           photosCount={bulkItems.reduce((sum, item) => sum + item.photos.length, 0)}
           cameraMode={cameraMode}
           onToggleCameraMode={toggleCameraMode}
           onImageUpload={handleImageUpload}
           onContinue={handleContinue}
         />
      </CameraView>

      {/* Match results sheet */}
      {showMatchSheet && matchData && (
        <MatchResultsSheet 
          matchData={matchData}
          onClose={closeSheets}
          sheetStyle={sheetAnimatedStyle}
        />
      )}

      {/* Bulk items sheet */}
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
            onClose={closeSheets}
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
          />
        );
      })()}
    </GestureHandlerRootView>
  );
};



// Progress Bar Overlay Component
const ProgressBarOverlay: React.FC<{
  progressWidth: Animated.SharedValue<number>;
  spinRotation: Animated.SharedValue<number>;
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
  opacity: Animated.SharedValue<number>;
  translateY: Animated.SharedValue<number>;
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
  captureButtonScale: Animated.SharedValue<number>;
  photosCount: number;
  cameraMode: CameraMode;
  onToggleCameraMode: () => void;
  onImageUpload: () => void;
  onContinue: () => void;
}> = ({ 
  onCapture, 
  isCapturing, 
  captureButtonScale, 
  photosCount, 
  cameraMode, 
  onToggleCameraMode, 
  onImageUpload,
  onContinue 
}) => {
  const captureButtonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: captureButtonScale.value }],
  }));

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
          
        <TouchableOpacity style={styles.focusButton} onPress={onToggleCameraMode}>
          <Icon 
            name={cameraMode === 'camera' ? 'camera' : 'barcode-scan'} 
            size={24} 
            color="white" 
          />
          </TouchableOpacity>
        </Animated.View>

      <Animated.View entering={SlideInDown.delay(700)} style={styles.continueButtonContainer}>
        <TouchableOpacity style={styles.continueButton} onPress={onContinue}>
          <Text style={styles.continueButtonText}>
            {photosCount > 0 
              ? `Continue with ${photosCount} photo${photosCount > 1 ? 's' : ''}`
              : 'Take a photo to get started'
            }
          </Text>
          </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

// Match Results Sheet Component
const MatchResultsSheet: React.FC<{
  matchData: MatchResponse;
  onClose: () => void;
  sheetStyle: any;
}> = ({ matchData, onClose, sheetStyle }) => {
  return (
    <Animated.View style={[styles.matchSheet, sheetStyle]}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>
          {matchData.totalMatches} Match{matchData.totalMatches > 1 ? 'es' : ''} Found
        </Text>
        <TouchableOpacity onPress={onClose}>
          <Icon name="close" size={24} color="#333" />
          </TouchableOpacity>
      </View>
      
      <View style={styles.matchResults}>
        {matchData.rankedCandidates.map((candidate, index) => (
          <View key={candidate.id} style={styles.matchCard}>
            <Image source={{ uri: candidate.imageUrl }} style={styles.matchImage} />
            <View style={styles.matchInfo}>
              <Text style={styles.matchTitle}>{candidate.title}</Text>
              <Text style={styles.matchDescription}>{candidate.description}</Text>
              <Text style={styles.matchPrice}>${candidate.price}</Text>
              <Text style={styles.matchPercentage}>{candidate.matchPercentage}% match</Text>
            </View>
          </View>
        ))}
      </View>
      
      <View style={styles.sheetActions}>
        <TouchableOpacity style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>List Product</Text>
        </TouchableOpacity>
        
        <View style={styles.secondaryActions}>
          <TouchableOpacity style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Show More</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Not My Product</Text>
          </TouchableOpacity>
        </View>
      </View>
        </Animated.View>
  );
};

// Bulk Items Sheet Component
const BulkItemsSheet: React.FC<{
  onClose: () => void;
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
  sheetTranslateY: Animated.SharedValue<number>;
  jobResponse: JobResponse | null;
  navigation: any;
}> = ({ onClose, sheetStyle, photos, isBulkMode, bulkItems, activeItemId, onAddNewItem, onImageUpload, performAnalyze, onDeleteItem, onMovePhoto, onSelectItem, onSetCoverPhoto, onRemovePhoto, sheetTranslateY, navigation, setJobResponse, jobResponse }) => {
  
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
  const sheetMaxHeight = SCREEN_HEIGHT * 0.6;
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
          const minY = SCREEN_HEIGHT * 0.2; // Maximum expanded (80% height)
          const maxY = SCREEN_HEIGHT * 0.6; // Minimum height (40% height)
          const currentY = SCREEN_HEIGHT * 0.4; // Current position (60% height)
          
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
        <View style={{ width: 24 }} />
          </View>
          
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
                console.log(`[RENDER] Rendering Item ${id + 1}:`, {
                  id: item.id,
                  photosCount: item.photos.length,
                  isActive: item.isActive
                });
                return (
            <TouchableOpacity 
              key={item.id} 
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
                </View>
                {/* Show delete button if there are multiple items OR if in bulk mode */}
                {(isBulkMode && bulkItems.length > 0) && (
                  <TouchableOpacity 
                    style={styles.deleteItemButton}
                    onPress={() => onDeleteItem(item.id)}
                  >
                    <Icon name="delete-outline" size={18} color="#ff6b6b" />
              </TouchableOpacity>
                )}
            </View>
            
              <View style={styles.photoSlotsContainer}>
                {item.photos.map((photo: CapturedPhoto, photoIndex: number) => (
                  <TapGestureHandler
                    key={photo.id}
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
                              { text: 'Remove from Item', onPress: () => {
                                // TODO: Implement remove from bulk item
                                console.log('Remove photo from item');
                              }},
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
    top: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 15,
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
    height: 2,
    backgroundColor: '#4CAF50',
    opacity: 0.8,
  },
  
  // Bottom Controls Styles
  bottomControls: {
    position: 'absolute',
    bottom: 0,
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
  continueButtonContainer: {
    paddingHorizontal: 20,
  },
  continueButton: {
    backgroundColor: '#93C822',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  continueButtonText: {
    color: 'white',
    fontSize: 16,
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
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    minHeight: SCREEN_HEIGHT * 0.5,
    maxHeight: SCREEN_HEIGHT * 0.8,
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
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    height: SCREEN_HEIGHT * 0.6, // Fixed 60% height
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
    color: '#4CAF50',
    marginBottom: 4,
  },
  matchPercentage: {
    fontSize: 12,
    color: '#888',
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
    backgroundColor: '#f5f5f5',
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
});

export default AddProductScreen;   