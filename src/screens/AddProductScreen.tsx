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

// Import components
import PhotoStack, { CapturedPhoto } from '../components/camera/PhotoStack';
import CameraControls from '../components/camera/CameraControls';
import BusinessTemplateModal, { BusinessTemplate } from '../components/camera/BusinessTemplateModal';
import { supabase } from '../lib/supabase';
import * as FileSystem from 'expo-file-system';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Types

interface MatchCandidate {
  id: string;
  title: string;
  description: string;
  price: number;
  imageUrl: string;
  matchPercentage: number;
  sourceUrl: string;
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
  
  // Notification and progress state
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [showProgressBar, setShowProgressBar] = useState(false);
  
  // Camera ref
  const cameraRef = useRef<CameraView>(null);
  
  // Animation values
  const sheetTranslateY = useSharedValue(SCREEN_HEIGHT);
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
        quality: 0.8,
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
      
        // Handle bulk mode vs single mode
        if (isBulkMode) {
          if (activeItemId) {
            // Add photo to active bulk item
            setBulkItems(prev => prev.map(item => {
              if (item.id === activeItemId) {
                const isFirstPhoto = item.photos.length === 0;
                const updatedItem = { ...item, photos: [...item.photos, newPhoto] };
                
                // Quick scan EVERY item's first photo
                if (isFirstPhoto) {
                  setTimeout(() => {
                    performQuickScan(newPhoto);
                  }, 500);
                }
                
                return updatedItem;
              }
              return item;
            }));
          } else {
            // No active item - create new one and quick-scan first photo
            const newItem = {
              id: `item-${Date.now()}`,
              photos: [newPhoto],
              title: undefined,
              isActive: true
            };
            setBulkItems([newItem]);
            setActiveItemId(newItem.id);
            console.log('[BULK MODE] Created new item:', newItem.id);
            
            // Quick scan the first photo of new item
            setTimeout(() => {
              performQuickScan(newPhoto);
            }, 500);
          }
          setCurrentInstruction('ready');
          stopProgressAnimation();
        } else {
          // Single mode - quick scan the FIRST photo
          const isFirstPhoto = capturedPhotos.length === 0;
          if (isFirstPhoto) {
            setTimeout(() => {
              performQuickScan(newPhoto);
            }, 500);
          } else {
            setCurrentInstruction('ready');
            stopProgressAnimation();
          }
        }
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

  // Simulate AI processing and matching
  const processImageForMatches = async (photo: CapturedPhoto) => {
    // Mock API response - replace with actual API call
    const mockResponse: MatchResponse = Math.random() > 0.5 ? {
      systemAction: 'show_single_match',
      confidence: 'high',
      totalMatches: 3,
      rankedCandidates: [
        {
          id: '1',
          title: 'iPhone 15 Pro Max',
          description: 'Latest iPhone with titanium design',
          price: 1199,
          imageUrl: 'https://example.com/iphone.jpg',
          matchPercentage: 95,
          sourceUrl: 'https://apple.com/iphone-15-pro',
        },
        {
          id: '2',
          title: 'iPhone 15 Pro',
          description: 'Pro iPhone with advanced features',
          price: 999,
          imageUrl: 'https://example.com/iphone-pro.jpg',
          matchPercentage: 87,
          sourceUrl: 'https://apple.com/iphone-15-pro',
        },
      ],
    } : {
      systemAction: 'fallback_to_manual',
      confidence: 'low',
      totalMatches: 0,
      rankedCandidates: [],
    };

    setMatchData(mockResponse);
    
    if (mockResponse.systemAction === 'show_single_match' || mockResponse.systemAction === 'show_multiple_matches') {
      setCurrentInstruction('matches_found');
      setShowMatchSheet(true);
      sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.5);
    } else {
      setCurrentInstruction('no_matches');
      setShowDeepSearchSheet(true);
      sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.5);
    }
  };

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

  // Handle image picker
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
        isCover: capturedPhotos.length === 0,
      };
      
      setCapturedPhotos(prev => [...prev, newPhoto]);
    }
  }, [capturedPhotos.length]);

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

  // Set cover photo
  const setCoverPhoto = useCallback((photoId: string) => {
    setCapturedPhotos(prev => prev.map(photo => ({
      ...photo,
      isCover: photo.id === photoId,
    })));
  }, []);

  // Handle double tap on photo (main photo stack)
  const handleDoubleTap = useCallback((photoId: string) => {
    setCoverPhoto(photoId);
    // Visual feedback
    console.log('Set cover photo:', photoId);
  }, [setCoverPhoto]);

  // Drag handlers for photo reordering
  const [draggedPhotoId, setDraggedPhotoId] = useState<string | null>(null);
  
  const handleDragStart = useCallback((photoId: string) => {
    setDraggedPhotoId(photoId);
    console.log('Drag started for photo:', photoId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedPhotoId(null);
    console.log('Drag ended');
  }, []);

  // Reorder photos in main stack
  const reorderPhotos = useCallback((fromIndex: number, toIndex: number) => {
    setCapturedPhotos(prev => {
      const newPhotos = [...prev];
      const [movedPhoto] = newPhotos.splice(fromIndex, 1);
      newPhotos.splice(toIndex, 0, movedPhoto);
      return newPhotos;
    });
  }, []);

  // Remove photo
  const removePhoto = useCallback((photoId: string) => {
    setCapturedPhotos(prev => {
      const filtered = prev.filter(photo => photo.id !== photoId);
      // If we removed the cover photo, make the first remaining photo the cover
      if (filtered.length > 0 && !filtered.some(photo => photo.isCover)) {
        filtered[0].isCover = true;
      }
      return filtered;
    });
  }, []);

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
      
      // For React Native, we can upload the base64 string directly
      // Supabase expects either a File, Blob, or ArrayBuffer
      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(fileName, `data:image/jpeg;base64,${base64}`, {
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

  // Analyze with SerpAPI (Manual trigger)
  const performAnalyze = useCallback(async (photo: CapturedPhoto) => {
    try {
      console.log('[ANALYZE] Starting SerpAPI analyze for photo:', photo.id);
      
      // Upload image to Supabase Storage first
      console.log('[ANALYZE] Uploading image to Supabase...');
      const publicImageUrl = await uploadImageToSupabase(photo.uri, photo.id);
      console.log('[ANALYZE] Image uploaded to:', publicImageUrl);
      
      const token = await getToken();
      const response = await fetch('https://api.sssync.app/api/products/analyze', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUris: [publicImageUrl] // Use Supabase public URL instead of local file path
        })
      });

      console.log('[ANALYZE] Response received:', response);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const analyzeResult = await response.json();
      console.log('[ANALYZE] Response received:', analyzeResult);
      
      // Parse SerpAPI data from analysis
      let serpData = null;
      if (analyzeResult.analysis?.GeneratedText) {
        try {
          serpData = JSON.parse(analyzeResult.analysis.GeneratedText);
          console.log('[ANALYZE] Parsed SerpAPI data:', serpData);
        } catch (parseError) {
          console.error('[ANALYZE] Failed to parse SerpAPI data:', parseError);
        }
      }
      
      if (serpData?.visual_matches && serpData.visual_matches.length > 0) {
        // Convert SerpAPI results to our match format
        const serpMatches = serpData.visual_matches.slice(0, 5).map((match: any, index: number) => ({
          id: `serp-${index}`,
          title: match.title || 'Unknown Product',
          description: match.snippet || '',
          price: match.price?.extracted_value || 0,
          imageUrl: match.thumbnail || '',
          matchPercentage: Math.max(90 - (index * 10), 50), // Simulated confidence based on position
          sourceUrl: match.link || '',
        }));
        
        setMatchData({
          systemAction: 'show_multiple_matches',
          confidence: 'medium',
          totalMatches: serpMatches.length,
          rankedCandidates: serpMatches
        });
                 setCurrentInstruction('matches_found');
         stopProgressAnimation();
         setShowMatchSheet(true);
         sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.4);
      } else {
        console.log('[ANALYZE] No SerpAPI matches found, showing deep search');
        setCurrentInstruction('no_matches');
        stopProgressAnimation();
        showNotificationMessage('No matches found. Use the search options to find your product.', 4000);
        setTimeout(() => {
          setShowDeepSearchSheet(true);
          sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.4);
        }, 1000);
      }
      
    } catch (error) {
      console.error('[ANALYZE] Analyze failed:', error);
      setCurrentInstruction('no_matches');
      stopProgressAnimation();
      showNotificationMessage('Analysis failed. Please try taking another photo.', 3000);
      setTimeout(() => {
        setShowDeepSearchSheet(true);
        sheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.4);
      }, 1000);
    }
  }, [uploadImageToSupabase, sheetTranslateY, stopProgressAnimation, showNotificationMessage]);

  // Toggle bulk mode
  const toggleBulkMode = useCallback(() => {
    setIsBulkMode(prev => !prev);
    if (!isBulkMode && capturedPhotos.length > 0) {
      // Create first bulk item from existing photos
      setBulkItems([{
        id: `item-${Date.now()}`,
        photos: capturedPhotos,
        title: undefined
      }]);
    }
  }, [isBulkMode, capturedPhotos]);

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
        onBarcodeScanned={handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'],
        }}
      >
      {/* Flash overlay */}
      <Animated.View style={[styles.flashOverlay, flashAnimatedStyle]} />
      
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
          const displayPhotos = isBulkMode && activeItemId 
            ? bulkItems.find(item => item.id === activeItemId)?.photos || []
            : capturedPhotos;
          
          return (
            <View style={styles.photoStackContainer}>
              {/* Active item indicator */}
              {isBulkMode && activeItemId && (
                <View style={styles.activeItemIndicator}>
                  <Text style={styles.activeItemIndicatorText}>
                    Item {bulkItems.findIndex(item => item.id === activeItemId) + 1}
                  </Text>
                </View>
              )}
              
              {displayPhotos.length > 0 && (
                <PhotoStack 
                  photos={displayPhotos}
                  onSetCover={isBulkMode && activeItemId 
                    ? (photoId: string) => setBulkItemCoverPhoto(activeItemId, photoId)
                    : setCoverPhoto
                  }
                  onRemovePhoto={isBulkMode && activeItemId
                    ? (photoId: string) => removeBulkItemPhoto(activeItemId, photoId) 
                    : removePhoto
                  }
                  onDoubleTap={isBulkMode && activeItemId
                    ? (photoId: string) => setBulkItemCoverPhoto(activeItemId, photoId)
                    : handleDoubleTap
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
           onPastScans={() => console.log('Past scans')}
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
        
                 {/* Bottom controls */}
         <BottomControls 
           onCapture={handleCapture}
           isCapturing={isCapturing}
           captureButtonScale={captureButtonScale}
           photosCount={isBulkMode 
             ? bulkItems.reduce((sum, item) => sum + item.photos.length, 0)
             : capturedPhotos.length
           }
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
      {showDeepSearchSheet && (
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
          onSearch={performAnalyze}
          sheetTranslateY={sheetTranslateY}
        />
      )}
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
              : 'Get Started'
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
  onDeleteItem: (itemId: string) => void;
  onMovePhoto: (fromItemId: string, toItemId: string, photoId: string) => void;
  onSelectItem: (itemId: string) => void;
  onSetCoverPhoto: (itemId: string, photoId: string) => void;
  onRemovePhoto: (itemId: string, photoId: string) => void;
  onSearch: (photo: CapturedPhoto) => Promise<void>;
  sheetTranslateY: Animated.SharedValue<number>;
}> = ({ onClose, sheetStyle, photos, isBulkMode, bulkItems, activeItemId, onAddNewItem, onImageUpload, onDeleteItem, onMovePhoto, onSelectItem, onSetCoverPhoto, onRemovePhoto, onSearch, sheetTranslateY }) => {
  
  console.log('[SHEET RENDER] BulkItemsSheet rendered with props:', { photosLength: photos.length, isBulkMode, bulkItemsLength: bulkItems.length });
  
  // Show items based on actual photos taken
  let displayItems: Array<{ id: string; photos: CapturedPhoto[]; title?: string; isActive?: boolean; }>;
  if (isBulkMode && bulkItems.length > 0) {
    displayItems = bulkItems;
  } else if (photos.length > 0) {
    // Single mode with photos - show single item
    displayItems = [{ 
      id: 'single', 
      photos: photos, 
      title: undefined, 
      isActive: true 
    }];
  } else {
    // No photos yet - show empty state
    displayItems = [];
  }
  
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
  const headerHeight = 120; // Height for header, title, and subtitle
  const footerHeight = 120; // Height for fixed bottom actions
  const scrollableHeight = sheetMaxHeight - headerHeight - footerHeight + 20;
  
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
          style={[styles.itemsScrollContainer, { height: scrollableHeight }]}
          showsVerticalScrollIndicator={true}
          contentContainerStyle={styles.scrollContent}
        >
          {displayItems.length === 0 ? (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <Icon name="camera-plus-outline" size={48} color="#ccc" />
              <Text style={{ marginTop: 12, fontSize: 16, color: '#666', textAlign: 'center' }}>
                Take your first photo to get started
              </Text>
              <Text style={{ marginTop: 4, fontSize: 14, color: '#999', textAlign: 'center' }}>
                The first photo of each item gets automatically scanned
              </Text>
            </View>
          ) : (
            displayItems.map((item, itemIndex) => (
            <TouchableOpacity 
              key={item.id} 
              style={[
                styles.bulkItemContainer,
                item.isActive && styles.activeItemContainer
              ]}
              onPress={() => onSelectItem(item.id)}
            >
              <View style={styles.itemHeader}>
                <View style={styles.itemLabelContainer}>
                  <Text style={[
                    styles.itemLabel,
                    item.isActive && styles.activeItemLabel
                  ]}>
                    Item {itemIndex + 1}
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
            ))
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
              
              // Get all photos from all items
              const allPhotos = isBulkMode 
                ? bulkItems.flatMap(item => item.photos)
                : photos;
              
              if (allPhotos.length === 0) {
                Alert.alert('No Photos', 'Please take some photos first before searching.');
                return;
              }
              
              // Start with analyze on the first photo
              if (allPhotos[0]) {
                await onSearch(allPhotos[0]);
              }
            }}
          >
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
    backgroundColor: 'rgba(76, 175, 80, 0.9)',
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
    backgroundColor: '#4CAF50',
    borderRadius: 25,
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
    marginBottom: 20,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  sheetContent: {
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
    backgroundColor: '#4CAF50',
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
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
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
    marginBottom: 20,
    gap: 8,
  },
  newItemButtonText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  searchForProductButton: {
    backgroundColor: '#4CAF50',
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
    paddingVertical: 10,
  },
  dragHandleButton: {
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 20,
  },
  dragHandleBar: {
    width: 40,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
  },
  itemsScrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
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
    color: '#333',
  },
  itemLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  activeItemContainer: {
    borderColor: '#4CAF50',
    borderWidth: 2,
    backgroundColor: '#f8fff8',
  },
  activeItemLabel: {
    color: '#4CAF50',
    fontWeight: '700',
  },
  activeItemBadge: {
    backgroundColor: '#4CAF50',
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
    borderColor: '#4CAF50',
    borderWidth: 2,
  },
  coverPhotoLabel: {
    backgroundColor: '#4CAF50',
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
    backgroundColor: '#4CAF50',
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
    backgroundColor: '#4CAF50',
    borderRadius: 25,
    paddingHorizontal: 30,
    paddingVertical: 15,
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default AddProductScreen;   