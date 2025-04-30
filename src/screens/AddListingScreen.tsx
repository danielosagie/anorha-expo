import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  Image, 
  TextInput,
  ActivityIndicator,
  Switch,
  Alert,
  SafeAreaView,
  Dimensions,
  Platform,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable
} from 'react-native';
import { CameraView, useCameraPermissions, Camera, CameraType, FlashMode } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Animated, { 
  FadeIn, 
  FadeOut
} from 'react-native-reanimated';
// import { useTheme } from '../context/ThemeContext'; // DEBUG: Commented out
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Button from '../components/Button';
import Card from '../components/Card';
import PlaceholderImage from '../components/PlaceholderImage';
import { supabase } from '../../lib/supabase'; 
import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
// @ts-ignore
import { decode } from 'base64-arraybuffer'; // Keep for potential fallback or other uses, but primary upload will use Buffer
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler'; // Import GestureHandlerRootView

// Define available platforms with icons
const AVAILABLE_PLATFORMS = [
  { key: 'shopify', name: 'Shopify', icon: 'shopify' },
  { key: 'amazon', name: 'Amazon', icon: 'amazon' },
  { key: 'facebook', name: 'Facebook', icon: 'facebook' },
  { key: 'ebay', name: 'eBay', icon: 'ebay' },
  { key: 'clover', name: 'Clover', icon: 'clover' },
  { key: 'square', name: 'Square', icon: 'square' },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Define the stages of the listing process
enum ListingStage {
  PlatformSelection = 'PLATFORM_SELECTION',
  ImageInput = 'IMAGE_INPUT',
  Analyzing = 'ANALYZING', // Loading state for /analyze
  VisualMatch = 'VISUAL_MATCH',
  Generating = 'GENERATING', // Loading state for /generate-details
  FormReview = 'FORM_REVIEW',
  Publishing = 'PUBLISHING', // Loading state for final publish/save
}

// Define types for API responses (based on backend docs)
interface VisualMatch {
  position: number;
  title: string;
  link: string;
  source: string;
  price?: {
    value: string;
    extracted_value: number;
    currency: string;
  };
  in_stock?: boolean;
  thumbnail: string;
  image?: string; 
}

interface SerpApiLensResponse {
  search_metadata: Record<string, any>;
  visual_matches?: VisualMatch[];
  message?: string; 
}

interface BackendAnalysisResponse {
  product: { Id: string; /* other fields */ };
  variant: { Id: string; /* other fields */ };
  analysis: {
    GeneratedText: string;
  };
  message?: string; 
}

interface GeneratedPlatformDetails {
  title?: string;
  description?: string;
  price?: number | { amount?: number; currency?: string }; // Handle both number and object
  category?: string;
  tags?: string[] | string; // Handle array or comma-separated string
  weight?: number;
  weightUnit?: string; // Or weight_unit
  bullet_points?: string[]; 
  search_terms?: string[]; 
  // Add other potential fields from LLM or platform specs
  status?: string; // Shopify
  vendor?: string; // Shopify
  locations?: string; // Square (simple text for now)
  gtin?: string; // Square
  condition?: string; // eBay, Amazon, FB
  listingFormat?: string; // eBay
  duration?: string; // eBay
  dispatchTime?: string; // eBay
  returnPolicy?: string; // eBay
  shippingService?: string; // eBay
  itemLocationPostalCode?: string; // eBay
  productType?: string; // Amazon
  productIdType?: string; // Amazon
  brand?: string; // Amazon, FB
  availability?: string; // FB
  // Add Compare At Price if LLM might return it
  compareAtPrice?: number;
}

interface GenerateDetailsResponse {
  productId: string;
  variantId: string;
  generatedDetails: {
    [platformKey: string]: GeneratedPlatformDetails;
  };
}

interface ImageInfo {
  uri: string;
  type: 'image' | 'video';
}

interface CapturedMediaItem {
  uri: string;
  width?: number;
  height?: number;
  type: 'image' | 'video';
  number: number;
  id: string;
}

interface CameraSectionProps {
  onCapture: (media: CapturedMediaItem[]) => void;
  onClose: () => void;
  styles: Record<string, any>; 
  initialMedia?: CapturedMediaItem[];
}


// --- UN-NESTED CameraSection Component (Using expo-camera) --- //
const CameraSection = ({ onCapture, onClose, styles, initialMedia = [] }: CameraSectionProps) => {
    // State and functions will be moved out
    // const [cameraPermission, setCameraPermission] = useState<boolean | null>(null);
    // const [facing, setFacing] = useState<CameraType>("back");
    // const [capturedMedia, setCapturedMedia] = useState<CapturedMediaItem[]>(
    //     initialMedia.map((item, index) => ({ ...item, id: item.uri + index }))
    // );
    // const [cameraMode, setCameraMode] = useState<"picture" | "video">("picture");
    // const [recording, setRecording] = useState(false);
    // const [flash, setFlash] = useState<FlashMode>("off");
    // const cameraRef = useRef<CameraView>(null);
    // const theme = useTheme(); // DEBUG: Commented out
  
    // useEffect(() => {
    //     (async () => {
    //         const cameraPermissionResponse = await Camera.requestCameraPermissionsAsync();
    //         const microphonePermissionResponse = await Camera.requestMicrophonePermissionsAsync();
    //         setCameraPermission(cameraPermissionResponse.status === "granted" && microphonePermissionResponse.status === "granted");
    //     })();
    // }, []);

    // const takePicture = async () => { ... };
    // const startRecording = async () => { ... };
    // const stopRecording = () => { ... };
    // const pickMedia = async () => { ... };
    // const toggleCameraMode = () => setCameraMode(current => current === "picture" ? "video" : "picture");
    // const toggleFlash = () => setFlash(current => current === 'off' ? 'on' : current === 'on' ? 'auto' : 'off');
    // const toggleCameraFacing = () => setFacing(current => current === "back" ? "front" : "back");
    // const saveAndClose = () => { ... };
    // const deleteMedia = (idToDelete: string) => { ... };
    // const onDragEnd = ({ data }: { data: CapturedMediaItem[] }) => { ... };
    // const renderDraggableItem = ({ item, drag, isActive }: RenderItemParams<CapturedMediaItem>) => { ... };
    // const getFlashIcon = () => flash === 'on' ? 'flash' : flash === 'auto' ? 'flash-auto' : 'flash-off';

    // Keep the render logic for now, it will be adapted later
    // if (cameraPermission === null) return ( ... );
    // if (!cameraPermission) return ( ... );

    return (
        // Keep placeholder return for now
        <View><Text>Camera Section Placeholder</Text></View> 
    );
};


// --- Main Component --- //
const AddListingScreen = () => {
  console.log("[AddListingScreen] Component Mounted"); 
  // const theme = useTheme(); // DEBUG: Commented out
  const [currentStage, setCurrentStage] = useState<ListingStage>(ListingStage.PlatformSelection);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [capturedMedia, setCapturedMedia] = useState<CapturedMediaItem[]>([]);
  const [coverImageIndex, setCoverImageIndex] = useState<number>(-1);
  const [showCameraSection, setShowCameraSection] = useState(false); // Keep this for now
  const [analysisResponse, setAnalysisResponse] = useState<BackendAnalysisResponse | null>(null);
  const [generationResponse, setGenerationResponse] = useState<GenerateDetailsResponse | null>(null);
  const [formData, setFormData] = useState<GenerateDetailsResponse['generatedDetails'] | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [uploadedImageUrls, setUploadedImageUrls] = useState<string[]>([]);
  const [activeFormTab, setActiveFormTab] = useState<string | null>(null);
  const [serpApiResponse, setSerpApiResponse] = useState<SerpApiLensResponse | null>(null);

  // --- NEW State for Visual Match Selection ---
  const [selectedMatchForGeneration, setSelectedMatchForGeneration] = useState<VisualMatch | null>(null);

  // --- Camera State (Moved from CameraSection) ---
  const [cameraPermission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [cameraMode, setCameraMode] = useState<"picture" | "video">("picture");
  const [recording, setRecording] = useState(false);
  const [flash, setFlash] = useState<FlashMode>("off");
  const cameraRef = useRef<CameraView>(null);
  // --- End Camera State ---

  // --- NEW State for Publish Modal ---
  const [isPublishModalVisible, setIsPublishModalVisible] = useState(false);

  // Define the limit in bytes (4MB, as requested)
  const IMAGE_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024; 

  // --- Upload Function --- //
  const uploadImagesToSupabase = async (
    items: CapturedMediaItem[]
  ): Promise<string[]> => {
    console.log(`[uploadImagesToSupabase] Starting upload for ${items.length} items (Limit: ${IMAGE_UPLOAD_LIMIT_BYTES / 1024 / 1024}MB)...`); // Log limit
    const uploadedUrls: string[] = [];

    for (const [index, item] of items.entries()) {
      console.log(`[uploadImagesToSupabase] Processing item ${index + 1}/${items.length}: URI ${item.uri.split('/').pop()}, Type: ${item.type}`);
      let uriToUpload = item.uri;
      let proceedWithUpload = true;
      let fileSize = 0;
      let fileInfo: FileSystem.FileInfo | null = null; // Initialize fileInfo

      try {
        // Step 1: Get File Info
        try {
          fileInfo = await FileSystem.getInfoAsync(item.uri);
          if (!fileInfo.exists || typeof fileInfo.size !== 'number') {
            console.warn(`[uploadImagesToSupabase] Could not get file info for ${item.uri}. Skipping.`);
            proceedWithUpload = false;
          } else {
            fileSize = fileInfo.size;
            console.log(`[uploadImagesToSupabase] File info obtained: Size=${fileSize}`);
          }
        } catch (infoError) {
          console.error(`[uploadImagesToSupabase] Error getting file info for ${item.uri}:`, infoError);
          proceedWithUpload = false;
        }

        // Step 2: Check Size and Compress if needed (only if file info was obtained)
        // Note: Now checks against the 4MB limit
        if (proceedWithUpload && fileSize > IMAGE_UPLOAD_LIMIT_BYTES) {
          if (item.type === 'image') {
            // Technically, if original size is > 4MB, we might fail even after compression.
            // Consider how aggressive compression should be, or skip if original > limit.
            // For now, we still attempt compression if > 4MB.
            console.log(`[uploadImagesToSupabase] Image exceeds limit (${fileSize} > ${IMAGE_UPLOAD_LIMIT_BYTES}). Attempting compression...`);
            try {
              // Keep compression fairly high (0.7) unless quality is a major issue
              const manipulatedImage = await manipulateAsync(
                item.uri, [], { compress: 0.7, format: SaveFormat.JPEG }
              );
              console.log(`[uploadImagesToSupabase] Compression attempted. New URI: ${manipulatedImage.uri.split('/').pop()}`);
              uriToUpload = manipulatedImage.uri;
              // Check compressed size against the 4MB limit
              const compressedInfo = await FileSystem.getInfoAsync(uriToUpload);
              if (compressedInfo.exists && typeof compressedInfo.size === 'number') {
                console.log(`[uploadImagesToSupabase] Compressed size: ${compressedInfo.size}`);
                if (compressedInfo.size > IMAGE_UPLOAD_LIMIT_BYTES) {
                  console.warn(`[uploadImagesToSupabase] Compression still over limit (${compressedInfo.size} > ${IMAGE_UPLOAD_LIMIT_BYTES}). Skipping.`);
                   Alert.alert('Image Too Large', `Image ${item.uri.split('/').pop()} is still too large (${(compressedInfo.size / 1024 / 1024).toFixed(1)}MB) even after compression and was skipped.`);
                  proceedWithUpload = false;
                }
              } else {
                console.warn(`[uploadImagesToSupabase] Could not get info for compressed image. Skipping.`);
                proceedWithUpload = false;
              }
            } catch (manipulationError) {
              console.error(`[uploadImagesToSupabase] Error compressing image ${item.uri}:`, manipulationError);
               Alert.alert('Compression Error', `Could not compress image ${item.uri.split('/').pop()}. It will be skipped.`);
              proceedWithUpload = false;
            }
          } else if (item.type === 'video') {
            // Videos are just skipped if over the 4MB limit
            console.warn(`[uploadImagesToSupabase] Video exceeds limit (${fileSize} > ${IMAGE_UPLOAD_LIMIT_BYTES}). Skipping.`);
            Alert.alert('Video Too Large', `Video ${item.uri.split('/').pop()} (${(fileSize / 1024 / 1024).toFixed(1)}MB) exceeds ${IMAGE_UPLOAD_LIMIT_BYTES / 1024 / 1024}MB limit and was skipped.`);
            proceedWithUpload = false;
          }
        }
        // else: File size is within limit, proceed directly

        if (!proceedWithUpload) {
          console.log(`[uploadImagesToSupabase] Skipping item ${index + 1} due to size/compression issues.`);
          continue; // Skip to the next item
        }
        
        // Step 3: Read File and Prepare Buffer
        console.log(`[uploadImagesToSupabase] Reading file content for: ${uriToUpload.split('/').pop()}`);
        const base64 = await FileSystem.readAsStringAsync(uriToUpload, { encoding: FileSystem.EncodingType.Base64 });
        const buffer = Buffer.from(base64, "base64");
        if (buffer.length === 0) {
             console.error("[uploadImagesToSupabase] Created buffer is empty. Skipping.");
             continue;
        }
        console.log(`[uploadImagesToSupabase] Buffer created, length: ${buffer.length}`);

        // Step 4: Determine Upload Path and Mime Type
        const fileExtension = uriToUpload.split(".").pop()?.toLowerCase() || "jpg";
        let mimeType = "image/jpeg";
         if (item.type === 'video') {
            if (fileExtension === "mov") mimeType = "video/quicktime";
            else if (fileExtension === "mp4") mimeType = "video/mp4";
        } else {
            const sourceExtension = item.uri.split(".").pop()?.toLowerCase();
            if (uriToUpload === item.uri) { // Original file
                 if (sourceExtension === "png") mimeType = "image/png";
                 else if (sourceExtension === "jpg" || sourceExtension === "jpeg") mimeType = "image/jpeg";
                 else if (sourceExtension === "webp") mimeType = "image/webp";
            } // else compressed to JPEG
        }
        const userId = (await supabase.auth.getUser()).data.user?.id;
        if (!userId) {
            console.error("[uploadImagesToSupabase] User became unauthenticated during upload. Skipping item.");
            continue; // Or throw error? For now, skip.
        }
        const filePath = `${userId}/${Date.now()}_${item.number}.${fileExtension}`;
        console.log(`[uploadImagesToSupabase] Determined upload path: ${filePath}, MimeType: ${mimeType}`);

        // Step 5: Upload to Supabase
        console.log(`[uploadImagesToSupabase] Attempting Supabase upload...`);
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from("product-images")
            .upload(filePath, buffer, { contentType: mimeType, upsert: false });

        if (uploadError) {
            console.error(`[uploadImagesToSupabase] Supabase upload error for ${filePath}:`, uploadError);
            throw uploadError; // Re-throw the error to be caught by the outer catch block
        }
        console.log(`[uploadImagesToSupabase] Supabase upload successful for ${filePath}. Path: ${uploadData?.path}`);

        // Step 6: Get Public URL
        if (uploadData?.path) {
            console.log(`[uploadImagesToSupabase] Attempting to get public URL for path: ${uploadData.path}`);
            const { data: publicUrlData } = supabase.storage.from("product-images").getPublicUrl(uploadData.path);
            if (publicUrlData?.publicUrl) {
                uploadedUrls.push(publicUrlData.publicUrl);
                console.log(`[uploadImagesToSupabase] Successfully got public URL: ${publicUrlData.publicUrl}`);
            } else {
                console.warn(`[uploadImagesToSupabase] Could not get public URL for path: ${uploadData.path}`);
                // Still consider upload successful, but log the warning
            }
        } else {
             console.warn(`[uploadImagesToSupabase] Upload data did not contain a path. Cannot get public URL.`);
        }

      } catch (err: any) {
        // Catch errors specific to processing/uploading this single item
        console.error(`[uploadImagesToSupabase] Error processing item ${index + 1} (URI: ${item.uri}):`, err.message || err);
        Alert.alert('Upload Error', `Failed to process or upload ${item.uri.split('/').pop()}. It will be skipped.`);
        // Continue to the next item
      }
    }
    console.log(`[uploadImagesToSupabase] Finished processing all items. Returning ${uploadedUrls.length} URLs:`, uploadedUrls);
    return uploadedUrls;
  };

  // --- Camera Functions (Moved from CameraSection) --- //
  const takePicture = async () => {
      if (cameraRef.current && capturedMedia.length < 10) {
          try {
              const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
              if (photo) {
                  const newItem: CapturedMediaItem = {
                      uri: photo.uri,
                      width: photo.width,
                      height: photo.height,
                      type: 'image',
                      number: capturedMedia.length + 1, // Maintain number if needed elsewhere
                      id: photo.uri + Date.now(),
                  };
                  setCapturedMedia((prev) => [...prev, newItem].slice(0, 10)); // Ensure limit
                  if (capturedMedia.length === 0) setCoverImageIndex(0); // Set cover if first item
              }
          } catch (error) { console.error('Error taking picture', error); Alert.alert("Capture Error", "Could not take picture."); }
      } else if (capturedMedia.length >= 10) {
          Alert.alert("Limit Reached", "You can add a maximum of 10 media items.");
      }
  };

  const startRecording = async () => {
      // Check microphone permission directly using Camera.requestMicrophonePermissionsAsync
      const micPermission = await Camera.requestMicrophonePermissionsAsync();
      if (!micPermission.granted) {
          Alert.alert("Permission Required", "Microphone permission is needed to record video.");
          return;
      }
      
      if (cameraRef.current && capturedMedia.length < 10) {
          setRecording(true);
          try {
              const videoData = await cameraRef.current.recordAsync({ maxDuration: 60 });
              if (videoData) {
                  const newItem: CapturedMediaItem = {
                      uri: videoData.uri, type: 'video', width: undefined, height: undefined,
                      number: capturedMedia.length + 1, id: videoData.uri + Date.now(),
                  };
                  setCapturedMedia((prev) => [...prev, newItem].slice(0, 10)); // Ensure limit
                  if (capturedMedia.length === 0) setCoverImageIndex(0); // Set cover if first item
              }
              setRecording(false);
          } catch (error) { console.error('Error recording video', error); setRecording(false); Alert.alert("Recording Error", "Could not record video."); }
      } else if (capturedMedia.length >= 10) {
          Alert.alert("Limit Reached", "You can add a maximum of 10 media items.");
      }
  };

  const stopRecording = () => { if (cameraRef.current && recording) { cameraRef.current.stopRecording(); } };
  const toggleCameraMode = () => setCameraMode(current => current === "picture" ? "video" : "picture");
  const toggleFlash = () => setFlash(current => current === 'off' ? 'on' : current === 'on' ? 'auto' : 'off');
  const toggleCameraFacing = () => setFacing(current => current === "back" ? "front" : "back");
  const getFlashIcon = () => flash === 'on' ? 'flash' : flash === 'auto' ? 'flash-auto' : 'flash-off';
  // --- End Camera Functions ---


  // --- Handlers --- //
  const handlePlatformsSelected = () => { 
    if (selectedPlatforms.length > 0) {
        // Check/request camera permission when moving to ImageInput stage
        if (!cameraPermission?.granted) {
            requestPermission();
        }
        setCurrentStage(ListingStage.ImageInput);
    }
    else Alert.alert("No Platforms Selected", "Please select at least one platform.");
  };
  const togglePlatformSelection = (platformKey: string) => {
    setSelectedPlatforms(prev => prev.includes(platformKey) ? prev.filter(p => p !== platformKey) : [...prev, platformKey]);
  };
  
  // Update handleMediaCaptured to reflect that it's called from CameraSection modal (for now)
  const handleMediaCaptured = (newMedia: CapturedMediaItem[]) => {
    setCapturedMedia(newMedia.slice(0, 10));
    // Update cover index logic if needed (already done in handleRemoveMedia)
    if (newMedia.length > 0 && (coverImageIndex < 0 || coverImageIndex >= newMedia.length)) {
        setCoverImageIndex(0); 
    } else if (newMedia.length === 0) {
        setCoverImageIndex(-1);
    }
    setShowCameraSection(false); // Close the modal
  };
  
  const pickImagesFromLibrary = async () => {
    if (capturedMedia.length >= 10) {
        Alert.alert("Limit Reached", "You can add a maximum of 10 media items.");
        return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ 
        mediaTypes: ImagePicker.MediaTypeOptions.All, // Allow videos too
        allowsMultipleSelection: true, 
        quality: 0.8, 
        orderedSelection: true 
    });
    if (!result.canceled && result.assets) { 
        const currentCount = capturedMedia.length;
        const spaceAvailable = 10 - currentCount;
        const itemsToAdd = result.assets.slice(0, spaceAvailable);

        if (result.assets.length > spaceAvailable) {
             Alert.alert("Limit Reached", `You can only add ${spaceAvailable} more items.`);
        }

        const newItems: CapturedMediaItem[] = itemsToAdd.map((asset, index) => ({ 
            uri: asset.uri, 
            type: (asset.type === 'video' ? 'video' : 'image') as 'video' | 'image',
            width: asset.width, 
            height: asset.height,
            number: currentCount + index + 1,
            id: asset.uri + Date.now() + index
        })); 
        const combined = [...capturedMedia, ...newItems];
        setCapturedMedia(combined);
        if (currentCount === 0 && combined.length > 0) {
            setCoverImageIndex(0); // Set cover if adding first items
        }
    }
  };

  const handleSetCover = (index: number) => { 
    if (index >= 0 && index < capturedMedia.length) {
        setCoverImageIndex(index); 
    }
  };

  const handleRemoveMedia = (idToRemove: string) => {
      const indexToRemove = capturedMedia.findIndex(item => item.id === idToRemove);
      if (indexToRemove === -1) return;

      const newMedia = capturedMedia.filter(item => item.id !== idToRemove);
      
      // Update cover index logically
      const oldCoverIndex = coverImageIndex;
      let newCoverIndex = -1;
      if (newMedia.length > 0) {
          if (indexToRemove === oldCoverIndex) {
              newCoverIndex = 0; // Reset to first if cover was removed
          } else if (indexToRemove < oldCoverIndex) {
              newCoverIndex = oldCoverIndex - 1; // Adjust if item before cover was removed
          } else {
              newCoverIndex = oldCoverIndex; // Cover index remains the same
          }
      }
      setCoverImageIndex(newCoverIndex);
      setCapturedMedia(newMedia); // Update state after calculating new index
  };
  
  const triggerImageAnalysis = async () => {
    // Keep existing validation
    if (capturedMedia.length === 0) { Alert.alert("No Media", "Please add or capture at least one image/video."); return; }
    if (coverImageIndex < 0 || coverImageIndex >= capturedMedia.length) { Alert.alert("Select Cover", "Please tap an image/video in the preview to select it as the cover image before proceeding."); return;}

    setError(null);
    setLoadingMessage('Preparing & Uploading Media...');
    setCurrentStage(ListingStage.Analyzing);
    setIsLoading(true);

    let mediaToUpload = [...capturedMedia];
    if (coverImageIndex > 0) {
        const coverItem = mediaToUpload.splice(coverImageIndex, 1)[0];
        mediaToUpload.unshift(coverItem);
        console.log("Reordered media for upload with cover first.");
    }
    const coverImageIndexForApi = 0; // Cover is now always first

    let urls: string[] = []; // Define urls variable in the outer scope

    try {
        // Upload images and get the URLs directly
        urls = await uploadImagesToSupabase(mediaToUpload);
        if (urls.length === 0 && mediaToUpload.length > 0) {
             // Check if any items were supposed to be uploaded but failed silently in the loop
             console.error("[triggerImageAnalysis] Upload function returned empty URLs despite having media items. Check upload logs.")
            throw new Error("Media upload failed or all items were skipped. Check logs and file sizes.");
        }
        // Update state (optional here, mainly for other parts of UI if needed)
        setUploadedImageUrls(urls); 
        console.log(`[triggerImageAnalysis] Upload successful. Got ${urls.length} URLs.`);
        setLoadingMessage('Analyzing Media...');

    } catch (uploadErr: any) {
        console.error("[triggerImageAnalysis] Upload phase failed:", uploadErr);
        setError(`Upload Failed: ${uploadErr.message || 'Unknown error during upload'}`);
        setCurrentStage(ListingStage.ImageInput);
        setIsLoading(false);
        setLoadingMessage('');
        return; // Stop execution if upload fails
    }

    // --- Analysis API Call --- 
    console.log("Fetching user for analysis API call...");
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (userError || !user) {
        console.error("Error fetching user for analysis API:", userError);
        setError("User session error. Please log out and back in.");
        setIsLoading(false);
        setLoadingMessage('');
        setCurrentStage(ListingStage.ImageInput);
        return;
    }
    if (sessionError || !sessionData?.session?.access_token) {
        console.error("Error fetching session token:", sessionError);
        setError("Could not retrieve authentication token. Please log out and back in.");
        setIsLoading(false);
        setLoadingMessage('');
        setCurrentStage(ListingStage.ImageInput);
        return;
    }

    const userId = user.id;
    const token = sessionData.session.access_token;
    console.log(`User ID fetched for analysis: ${userId}`);

    const analyzeApiUrl = `https://sssync-bknd-production.up.railway.app/products/analyze?userId=${userId}`;
    const requestBodyAnalyze = { imageUris: urls, selectedPlatforms: selectedPlatforms };
    
    // Define headers including the Authorization token
    const headers = { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
    
    console.log(`Attempting to POST to: ${analyzeApiUrl}`);
    console.log("Request Headers (Analyze):", { ...headers, Authorization: 'Bearer [REDACTED]' }); // Log headers, redact token

    try {
        const response = await fetch(analyzeApiUrl, {
            method: 'POST', 
            headers: headers, // Use the headers object
            body: JSON.stringify(requestBodyAnalyze),
        });
        console.log(`Analysis API Response Status: ${response.status}`);
        // Only attempt to parse JSON if the response is not 204 No Content or similar non-JSON success cases
        let responseData: BackendAnalysisResponse | null = null;
        if (response.status !== 204 && response.headers.get('content-type')?.includes('application/json')) {
            responseData = await response.json(); 
        }

        if (!response.ok) {
            console.error("Analysis API Error Response Body:", responseData);
            let apiErrorMessage = `HTTP error! status: ${response.status}`;
            // Use backend response message if available
            if (responseData && responseData.message) { 
                apiErrorMessage = typeof responseData.message === 'string' ? responseData.message : `Analysis API Error (Code: ${response.status})`;
            } else if (response.status === 401) {
                 apiErrorMessage = "Unauthorized. Please ensure you are logged in.";
            }
            
            // Check specific conditions based on backend response structure if needed
            if (response.status === 404 || (typeof apiErrorMessage === 'string' && apiErrorMessage.toLowerCase().includes("no matches"))) {
                console.log("Analysis indicated no visual matches found (or 404). Setting minimal response.");
                setAnalysisResponse({ product: { Id: 'unknown'}, variant: {Id: 'unknown'}, analysis: { GeneratedText: '{}' } }); 
                setSerpApiResponse(null); // No parsed data
                setProductId(null); // No valid ID
                setVariantId(null); // No valid ID
                setCurrentStage(ListingStage.VisualMatch); // Go to visual match to show "No Matches"
            } else {
                throw new Error(apiErrorMessage);
            }
        } else {
             console.log("Analysis Response Data (Backend):", JSON.stringify(responseData, null, 2));
             // Handle potential null responseData for non-JSON success cases if needed
             if (responseData && 
                 responseData.product && responseData.product.Id && 
                 responseData.variant && responseData.variant.Id && 
                 responseData.analysis && typeof responseData.analysis.GeneratedText === 'string') 
             {
                 // --- Set State on Success --- 
                 setAnalysisResponse(responseData); // Set the full backend response
                 setProductId(responseData.product.Id); // <-- SET PRODUCT ID
                 setVariantId(responseData.variant.Id); // <-- SET VARIANT ID
                 console.log(`Product/Variant IDs set: ${responseData.product.Id} / ${responseData.variant.Id}`);
                 
                 // Attempt to parse SerpApi response from GeneratedText
                 try {
                     const parsedSerp = JSON.parse(responseData.analysis.GeneratedText);
                     setSerpApiResponse(parsedSerp);
                     console.log("[triggerImageAnalysis] Parsed and set serpApiResponse state.");
                 } catch (parseErr) {
                     console.error("[triggerImageAnalysis] Failed to parse GeneratedText JSON:", parseErr);
                     setSerpApiResponse(null); // Ensure it's null if parsing fails
                 }
                 // --- End Set State --- 
                 
                 setCurrentStage(ListingStage.VisualMatch);
             } else {
                 // Handle successful but unexpected response structure 
                 console.error("Analysis API response successful (2xx) but structure is invalid:", responseData);
                 setError("Received invalid data structure from analysis API.");
                 setCurrentStage(ListingStage.ImageInput); // Go back if data is unusable
             }
        }
        // setError(null); // Clear error only if fully successful - moved inside success block
    } catch (err: any) {
        console.error("Analysis API fetch/processing failed:", err);
        setError(`Analysis Failed: ${err.message || 'Unknown error during analysis fetch'}`);
        setProductId(null); // Clear IDs on error
        setVariantId(null);
        setSerpApiResponse(null);
        setCurrentStage(ListingStage.ImageInput); 
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
};

  const handleProceedWithoutMatch = () => { 
      console.log("Proceeding without match."); 
      setSelectedMatchForGeneration(null); // Ensure selection is cleared
      triggerDetailsGeneration(); // Call generate details (will use null context)
  };

  // --- NEW Handler for tapping a visual match card --- 
  const handleSelectMatchForGeneration = (match: VisualMatch) => {
      // If the tapped match is already selected, deselect it
      if (selectedMatchForGeneration?.position === match.position) {
          console.log(`Deselecting match: ${match.title}`);
          setSelectedMatchForGeneration(null);
      } else {
          console.log(`Selecting match for generation: ${match.title}`);
          setSelectedMatchForGeneration(match); // Select the new match
      }
  };

  // UPDATED triggerDetailsGeneration to use selectedMatchForGeneration state and clean the match data
  const triggerDetailsGeneration = async () => { 
    // Check if Product/Variant IDs are available BEFORE proceeding
    if (!productId || !variantId) {
        Alert.alert("Missing Information", "Product or Variant ID is missing. Cannot generate details. Please try analyzing the image again.");
        setError("Internal error: Missing Product/Variant ID.");
        setCurrentStage(ListingStage.ImageInput); 
        return;
    }
    if (uploadedImageUrls.length === 0) { Alert.alert("Internal Error", "Missing uploaded image URLs."); setCurrentStage(ListingStage.ImageInput); return; }
    
    const coverImageIndexForApi = 0; 
    
    setError(null); 
    setCurrentStage(ListingStage.Generating);
    setIsLoading(true); 
    setLoadingMessage('Generating details...');

    // ... (Get User ID and Auth Token) ...
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (userError || !user || sessionError || !sessionData?.session?.access_token) {
         console.error("Auth error during generation trigger:", {userError, sessionError});
         setError("Authentication error. Please log out and back in.");
         setIsLoading(false); setLoadingMessage(''); 
         setCurrentStage(ListingStage.VisualMatch); 
         return;
    }
    const userId = user.id;
    const token = sessionData.session.access_token;

    // --- Clean the selected match (AGAIN) to EXCLUDE price --- 
    let cleanedSelectedMatch: Partial<VisualMatch> | null = null;
    if (selectedMatchForGeneration) {
        cleanedSelectedMatch = {
            position: selectedMatchForGeneration.position,
            title: selectedMatchForGeneration.title,
            link: selectedMatchForGeneration.link,
            source: selectedMatchForGeneration.source,
            // EXCLUDED: price: selectedMatchForGeneration.price
        };
        console.log("Cleaned selected match for API (v2 - no price):", cleanedSelectedMatch);
    }
    // --- End Cleaning ---

    // --- Prepare Request --- 
    const generateApiUrl = `https://sssync-bknd-production.up.railway.app/products/generate-details?userId=${userId}`;
    const requestBodyGenerate = { 
        productId: productId, 
        variantId: variantId, 
        imageUris: uploadedImageUrls, 
        coverImageIndex: coverImageIndexForApi,
        selectedPlatforms: selectedPlatforms, 
        selectedMatch: cleanedSelectedMatch // Use the newly cleaned object
    };
    
     const headers = { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

    console.log(`Attempting to POST to: ${generateApiUrl}`);
    console.log("Request Headers (Generate):", { ...headers, Authorization: 'Bearer [REDACTED]' });
    console.log("Request Body (Generate):", JSON.stringify(requestBodyGenerate));

    try {
      const response = await fetch(generateApiUrl, {
        method: 'POST', 
        headers: headers, 
        body: JSON.stringify(requestBodyGenerate),
      });
      
      let responseData: any; 
      try { 
          if (response.status === 204) {
              responseData = null; 
          } else if (response.headers.get('content-type')?.includes('application/json')) {
             responseData = await response.json(); 
          } else {
             const textResponse = await response.text();
             console.warn(`Generation API returned non-JSON response (Status ${response.status}): ${textResponse}`);
             responseData = null; 
          }
      } 
      catch (jsonError) { 
          console.error("Error parsing JSON response from generation API:", jsonError);
          throw new Error(`Failed to parse response from generation API (Status: ${response.status})`); 
      }

      if (!response.ok) { 
          console.error("Generation API Error Response Body:", responseData);
          let msg = `HTTP error! status: ${response.status}`;
          if (responseData?.message && typeof responseData.message === 'string') { 
              msg = responseData.message; 
          } else if (response.status === 401) {
              msg = "Unauthorized. Please ensure you are logged in.";
          } else if (response.status === 400) {
              if (responseData?.message && Array.isArray(responseData.message)) {
                  msg = `Invalid input: ${responseData.message.join(', ')}`;
              } else {
                   msg = "Invalid input provided to generate details.";
              }
          }
          throw new Error(msg); 
      }

      if (!responseData) {
          // Keep this check for null/empty responses after successful status
          throw new Error("Received no details from generation API.");
      }

      // --- UPDATED Validation Logic --- 
      // Only validate the structure we expect based on docs/actual response
      const generationData = responseData as Partial<GenerateDetailsResponse>; // Use Partial since we don't expect productId/variantId
      console.log("Generation Response:", JSON.stringify(generationData, null, 2));
      
      // Check if generatedDetails exists and is an object (can be empty {} which is valid)
      if (typeof generationData.generatedDetails !== 'object' || generationData.generatedDetails === null) { 
          console.error("Invalid or missing 'generatedDetails' object in generation API response:", generationData);
          throw new Error("Invalid response structure from generation API (missing generatedDetails).");
      }
      // --- End UPDATED Validation Logic --- 
      
      // Cast to the expected type for state update (assuming the structure is now validated)
      setGenerationResponse(generationData as GenerateDetailsResponse); 
      setFormData(generationData.generatedDetails || {}); 
      setActiveFormTab(selectedPlatforms[0] || null);
      console.log("[triggerDetailsGeneration] Successfully processed response. Setting stage to FormReview.");
      setCurrentStage(ListingStage.FormReview); 
      setError(null);

    } catch (err: any) {
        console.error("[triggerDetailsGeneration] Details generation failed:", err);
        setError(`Generation Failed: ${err.message || 'Unknown error'}`);
        // Explicitly log BEFORE setting stage
        console.log("[triggerDetailsGeneration] Error occurred. Setting stage back to VisualMatch.");
        setCurrentStage(ListingStage.VisualMatch); // Fallback to VisualMatch
    } finally {
         setIsLoading(false); 
         setLoadingMessage('');
     } 
  };
  
  // UPDATED handleFormUpdate to handle nested price and potential arrays
  const handleFormUpdate = (platform: string, field: keyof GeneratedPlatformDetails, value: any) => {
    setFormData(prevData => { 
      if (!prevData) return null;
      const platformData = prevData[platform] || {};
      let updatedValue = value;

      // Handle nested Square price
      if (platform === 'square' && field === 'price' && typeof platformData.price === 'object' && platformData.price !== null) {
          // Attempt to parse the input as a number for amount
          const amount = parseFloat(value);
          updatedValue = { 
              ...platformData.price, 
              amount: isNaN(amount) ? undefined : amount // Store number or undefined
          };
      } else if (field === 'price' || field === 'compareAtPrice' || field === 'weight') {
          // Handle regular numeric fields
          const numValue = parseFloat(value);
          updatedValue = isNaN(numValue) ? undefined : numValue;
      } else if (field === 'tags' && typeof value === 'string') {
          // Keep tags as comma-separated string in the input, backend/publish logic will handle splitting
          updatedValue = value;
      }
      // Add handling for other specific field types if necessary

      return { 
          ...prevData, 
          [platform]: { 
              ...(platformData), 
              [field]: updatedValue 
          } 
      };
    });
  };

  const handleSaveDraft = async () => { console.log("Saving Draft...", { productId, variantId, formData }); Alert.alert("Draft Saved (Logged)", "API call not implemented."); };
  const handlePublish = async () => {
      console.log("Attempting to publish...");
      // Add validation here if needed before showing modal
      setIsPublishModalVisible(true); 
  };

  // ADDED handlers for modal buttons
  const handlePublishAction = (publishMode: 'draft' | 'live') => {
    setIsPublishModalVisible(false);
    console.log(`Publishing as ${publishMode}...`, { productId, variantId, formData }); 
    // Replace with actual API call later
    setCurrentStage(ListingStage.Publishing); // Show loading indicator
    setIsLoading(true);
    setLoadingMessage(`Publishing as ${publishMode}...`);

    setTimeout(() => { 
        setIsLoading(false);
        Alert.alert(`Published as ${publishMode} (Simulated)`, "API call not implemented yet."); 
        // Reset state or navigate away after successful publish
        // setCurrentStage(ListingStage.PlatformSelection); // Example reset
    }, 2000); 
  };

  // --- ADDED handleRegenerateConfirm --- 
  const handleRegenerateConfirm = () => {
    Alert.alert(
        "Regenerate Details?",
        "This will use the AI to generate new details based on the current images and selected match (if any). This may incur usage costs. Proceed?",
        [
            { text: "Cancel", style: "cancel" },
            { 
                text: "Regenerate", 
                // Ensure triggerDetailsGeneration exists and is called correctly
                onPress: () => {
                    if(typeof triggerDetailsGeneration === 'function') {
                         triggerDetailsGeneration();
                    } else {
                        console.error("triggerDetailsGeneration function not found!");
                        Alert.alert("Error", "Regeneration function is unavailable.");
                    }
                }
            }
        ]
    );
  };
  // --- End ADDED --- 

  // --- Helper Render Functions ---
  const renderLoading = (message: string) => {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={'#294500'} />
        <Text style={styles.loadingText}>{message}</Text>
      </View>
    );
  };

  // --- Main Stage Render Functions ---
  const renderPlatformSelection = () => {
    console.log("[AddListingScreen] Rendering Platform Selection Stage");
    return (
      <Animated.View style={styles.stageContainer} entering={FadeIn}>
        <Text style={styles.stageTitle}>Select Platforms</Text>
        <Text style={styles.stageSubtitle}>Choose where you want to list this product.</Text>
        <View style={styles.platformGrid}>
          {AVAILABLE_PLATFORMS.map((platform) => {
            const isSelected = selectedPlatforms.includes(platform.key);
            const imageSource = platformImageMap[platform.key]; // Get image source from map
            return (
              <TouchableOpacity 
                 key={platform.key} 
                 style={[styles.platformCard, isSelected && styles.platformCardSelected]} 
                 onPress={() => togglePlatformSelection(platform.key)}
                 activeOpacity={0.7} // Add feedback
              >
                {/* Replace Icon with Image */}
                {imageSource ? (
                    <Image 
                        source={imageSource} 
                        style={[styles.platformImage, !isSelected && styles.platformImageDeselected]} // Apply base and conditional style
                        resizeMode="contain" // Ensure image fits well
                    />
                 ) : (
                    // Fallback if image not found
                    <View style={styles.platformIconPlaceholder} />
                 )}
                <Text style={[styles.platformName, isSelected && styles.platformNameSelected]}>{platform.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Button title={`Next: Add Media (${selectedPlatforms.length})`} onPress={handlePlatformsSelected} style={styles.bottomButton} disabled={selectedPlatforms.length === 0}/>
      </Animated.View>
    );
  };

  // REVISED renderImageInput (Camera Integrated)
  const renderImageInput = () => {
    console.log("[AddListingScreen] Rendering Image Input Stage (Camera Integrated)");
    // --- Permission Handling ---
    if (!cameraPermission) {
      return (
        <View style={styles.centeredMessageContainer}>
          <ActivityIndicator size="large" color={'#294500'} />
          <Text style={styles.centeredMessageText}>Initializing Camera...</Text>
        </View>
      );
    }
    if (!cameraPermission.granted) {
      return (
        <View style={styles.centeredMessageContainer}>
          <Icon name="camera-off-outline" size={50} color="#FF5252" />
          <Text style={styles.centeredMessageText}>Camera permission is required to add media.</Text>
          <Button title="Grant Permission" onPress={requestPermission} style={{marginTop: 20}} />
          <Button title="Back to Platforms" onPress={() => setCurrentStage(ListingStage.PlatformSelection)} outlined style={{marginTop: 10}}/>
        </View>
      );
    }

    // --- Draggable Item Renderer ---
    const renderDraggableMediaItem = ({ item, drag, isActive }: RenderItemParams<CapturedMediaItem>) => {
      const isCover = capturedMedia[coverImageIndex]?.id === item.id;
      return (
        <ScaleDecorator>
          <TouchableOpacity
            style={[
              styles.previewImageContainer, 
              isActive && styles.previewImageContainerActive,
              isCover && styles.previewImageCover 
            ]}
            onPress={() => handleSetCover(capturedMedia.findIndex(m => m.id === item.id))}
            onLongPress={drag}
            disabled={isActive}
            activeOpacity={0.9}
          >
            <Image source={{ uri: item.uri }} style={styles.previewImage} />
            {item.type === 'video' && (
              <View style={styles.videoIndicatorPreview}><Icon name="play-circle" size={18} color={'white'} /></View>
            )}
            <TouchableOpacity style={styles.deleteMediaButton} onPress={() => handleRemoveMedia(item.id)}>
              <Icon name="close-circle" size={20} color="#FF5252" />
            </TouchableOpacity>
          </TouchableOpacity>
        </ScaleDecorator>
      );
    };

    // --- Main Camera View Layout ---
    return (
      <View style={styles.cameraStageContainer}>
        <CameraView ref={cameraRef} style={styles.cameraPreview} facing={facing} flash={flash} mode={cameraMode}>
          <View style={styles.cameraHeader}>
            {/* ... flash/switch buttons ... */}
            <TouchableOpacity onPress={toggleFlash} style={styles.headerButton} disabled={facing === 'front'}>
              <Icon name={getFlashIcon()} size={24} color={facing === 'front' ? 'grey' : 'white'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleCameraFacing} style={styles.headerButton}>
              <Icon name="camera-switch-outline" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </CameraView>
        
        {capturedMedia.length > 0 && (
          <View style={styles.previewListContainer}>
            <DraggableFlatList
              data={capturedMedia}
              onDragEnd={({ data }) => {
                const oldCoverId = capturedMedia[coverImageIndex]?.id;
                const newIndex = data.findIndex(item => item.id === oldCoverId);
                setCoverImageIndex(newIndex >= 0 ? newIndex : (data.length > 0 ? 0 : -1));
                setCapturedMedia(data);
              }}
              keyExtractor={(item) => item.id}
              renderItem={renderDraggableMediaItem}
              horizontal
              contentContainerStyle={styles.previewScroll}
              showsHorizontalScrollIndicator={false}
            />
          </View>
        )}
        
        <View style={styles.bottomControlsContainer}>
          {/* ... Upload, Capture, Barcode buttons ... */}
          <TouchableOpacity style={styles.sideControlButton} onPress={pickImagesFromLibrary} disabled={capturedMedia.length >= 10}>
            <Icon name="image-multiple-outline" size={30} color={capturedMedia.length >= 10 ? "grey" : "white"} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.captureButton} onPress={cameraMode === "picture" ? takePicture : (recording ? stopRecording : startRecording)} disabled={capturedMedia.length >= 10}>
            <View style={[ styles.captureInner, recording && styles.recordingButton, capturedMedia.length >= 10 && styles.captureDisabledInner ]} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.sideControlButton} onPress={() => Alert.alert("Barcode Scanner", "Not implemented yet.")}>
            <Icon name="barcode-scan" size={30} color="white" />
          </TouchableOpacity>
        </View>

        <View style={styles.cameraStageHeader}>
          {/* ... Title/Subtitle overlay ... */}
          <Text style={styles.stageTitleCamera}>Add Product Media</Text> 
          <Text style={styles.stageSubtitleCamera}>
            {capturedMedia.length}/10 items. {capturedMedia.length > 0 ? 'Drag to reorder. Tap preview to set cover.' : 'Use camera or upload.'}
          </Text>
        </View>

        <View style={styles.navigationButtonsCamera}>
          {/* ... Back/Next buttons ... */}
          <Button title="Back" onPress={() => setCurrentStage(ListingStage.PlatformSelection)} outlined style={styles.navButton} />
          <Button
            title={coverImageIndex < 0 && capturedMedia.length > 0 ? "Select Cover" : "Next: Analyze Media"}
            onPress={triggerImageAnalysis}
            disabled={capturedMedia.length === 0 || (coverImageIndex < 0 && capturedMedia.length > 0)}
            style={StyleSheet.flatten([styles.navButton, (capturedMedia.length === 0 || (coverImageIndex < 0 && capturedMedia.length > 0)) ? styles.disabledButton : {}])}
          />
        </View>
      </View>
    );
  };

  // Updated RenderVisualMatch with corrected checks
  const renderVisualMatch = () => {
    console.log("[AddListingScreen] Rendering Visual Match Stage");
    
    let visualMatches: VisualMatch[] = [];
    let parseError: string | null = null;

    // Parse logic (using serpApiResponse state set by triggerImageAnalysis)
    if (serpApiResponse && Array.isArray(serpApiResponse.visual_matches)) {
        visualMatches = serpApiResponse.visual_matches;
    } else if (analysisResponse && analysisResponse.analysis && typeof analysisResponse.analysis.GeneratedText === 'string' && analysisResponse.analysis.GeneratedText !== '{}') {
        // This case handles if parsing failed in triggerImageAnalysis or if serpApiResponse state update hasn't happened yet
        // We might already have an error message to show from the parsing attempt
        // If no prior error, maybe set one now? Or just rely on visualMatches being empty.
        console.warn("[renderVisualMatch] serpApiResponse state is not set or invalid, but analysisResponse seems to have text.");
    }
     // Note: Explicit parsing error handling might be redundant if triggerImageAnalysis handles it,
     // but keeping it for safety might be good.
    
     // Render Loading or Waiting state if analysisResponse is still null
    if (!analysisResponse) {
        return (
            <Animated.View style={styles.stageContainer} entering={FadeIn}>
                <Text style={styles.stageTitle}>Waiting for Analysis</Text>
                <ActivityIndicator size="small" color="#666" />
                <View style={styles.navigationButtons}>
                    <Button title="Back to Media" onPress={() => setCurrentStage(ListingStage.ImageInput)} outlined style={styles.navButton}/>
                </View>
            </Animated.View>
        );
    }

    // Render Error state if parsing previously failed
    if (parseError) { /* ... Error UI ... */ }
    
    const hasMatches = visualMatches.length > 0;

    // --- Render Item for Grid --- 
    const renderMatchItem = ({ item }: { item: VisualMatch }) => {
        const isSelected = selectedMatchForGeneration?.position === item.position;
        return (
            <TouchableOpacity 
                style={[styles.matchGridItem, isSelected && styles.matchCardSelected]} // Apply grid item and selected styles
                onPress={() => handleSelectMatchForGeneration(item)} 
                activeOpacity={0.7}
            >
                <Image source={{ uri: item.thumbnail }} style={styles.matchThumbnailGrid} resizeMode="contain"/>
                <View style={styles.matchDetailsGrid}>
                    <Text style={styles.matchTitleGrid} numberOfLines={2}>{item.title || 'No Title'}</Text>
                    <Text style={styles.matchSourceGrid}>{item.source || 'Unknown Source'}</Text>
                    {item.price?.value && <Text style={styles.matchPriceGrid}>{item.price.value}</Text>}
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <Animated.View style={styles.stageContainer} entering={FadeIn}>
             <Text style={styles.stageTitle}>{hasMatches ? "Select Best Visual Match" : "No Matches Found"}</Text>
             <Text style={styles.stageSubtitle}>
                 {hasMatches 
                     ? "Tap an item below to select it for context." 
                     : "We couldn't find similar products online."}
             </Text>
 
             {/* Render Match Grid or No Matches Found Message */} 
             {hasMatches ? (
                 <FlatList
                    data={visualMatches}
                    renderItem={renderMatchItem}
                    keyExtractor={(item) => `${item.position}-${item.link}`}
                    numColumns={2}
                    style={styles.visualMatchGrid}
                    contentContainerStyle={styles.visualMatchGridContainer}
                    ListEmptyComponent={ // Should not be reached if hasMatches is true, but for safety
                        <View style={styles.centeredInfoContainer}> 
                            <Icon name="image-search-outline" size={60} color="#ccc" />
                            <Text style={styles.noMatchText}>No similar items found.</Text>
                        </View>
                    }
                 />
             ) : (
                  <View style={styles.centeredInfoContainer}> 
                      <Icon name="image-search-outline" size={60} color="#ccc" />
                      <Text style={styles.noMatchText}>No similar items found.</Text>
                  </View>
             )}
             
             {/* --- NEW Navigation Buttons --- */} 
             <View style={styles.navigationButtons}>
                 {/* Back Button - Always Visible */} 
                 <Button 
                      title="Back to Media" 
                      onPress={() => setCurrentStage(ListingStage.ImageInput)} 
                      outlined 
                      style={styles.navButton}
                 />
                 
                 {/* Conditional Buttons based on matches and selection */}
                 {hasMatches ? (
                    <> 
                        <Button 
                            title="No Matches / Use Images" 
                            onPress={handleProceedWithoutMatch} 
                            disabled={!!selectedMatchForGeneration} // Disabled if something IS selected
                            outlined 
                            style={StyleSheet.flatten([styles.navButton, !!selectedMatchForGeneration && styles.disabledButton])}
                        />
                        <Button 
                            title={`Generate w/ Selection${selectedMatchForGeneration ? ' (1)' : ''}`}
                            onPress={triggerDetailsGeneration} 
                            disabled={!selectedMatchForGeneration} // Disabled if nothing IS selected
                            style={StyleSheet.flatten([styles.navButton, !selectedMatchForGeneration && styles.disabledButton])}
                         />
                    </> 
                 ) : ( 
                    // Only show Generate button if NO matches were found initially
                    <Button 
                         title="Generate Details from Images" 
                         onPress={handleProceedWithoutMatch} // Still calls proceed without match
                         style={styles.navButton} 
                    />
                 )}
             </View>
         </Animated.View>
     );
};

  // --- UPDATED renderFormReview --- 
  const renderFormReview = () => {
    console.log(`[AddListingScreen] Rendering Form Review Stage for tab: ${activeFormTab}`);
    
    if (!formData || !activeFormTab || !formData[activeFormTab]) {
        // ... loading/error state ...
        return (
             <Animated.View style={styles.stageContainer} entering={FadeIn}>
                 <Text style={styles.stageTitle}>Loading Details...</Text>
                 <ActivityIndicator size="small" color="#666" />
                  <View style={styles.navigationButtons}>
                      <Button title="Back to Matches" onPress={() => setCurrentStage(ListingStage.VisualMatch)} outlined style={styles.navButton}/>
                  </View>
             </Animated.View>
         );
    }

    const currentPlatformData = formData[activeFormTab] || {}; 
    
    // Define field structure
    const coreFields: (keyof GeneratedPlatformDetails)[] = ['title', 'description', 'price', 'compareAtPrice', 'weight', 'weightUnit']; // Removed SKU/Barcode for now, add back if needed via variant data
    const platformSpecificFields: { [key: string]: (keyof GeneratedPlatformDetails)[] } = {
        shopify: ['status', 'vendor', 'category', 'tags'], 
        square: ['category', 'locations', 'gtin'],
        ebay: ['condition', 'category', 'listingFormat', 'duration', 'dispatchTime', 'returnPolicy', 'shippingService', 'itemLocationPostalCode'],
        amazon: ['productType', 'condition', 'brand', 'productIdType'], // productId is complex (ASIN match)
        facebook: ['category', 'brand', 'condition', 'availability'],
    };

    const fieldsToShow = [ ...coreFields, ...(platformSpecificFields[activeFormTab!] || []) ];

    // --- RESTORED getKeyboardType --- 
    const getKeyboardType = (field: string): 'default' | 'numeric' | 'email-address' | 'phone-pad' => {
        const lowerField = field.toLowerCase();
        if (lowerField === 'price' || lowerField.includes('quantity') || lowerField.includes('weight') || lowerField === 'compareatprice') {
            return 'numeric';
        }
        return 'default';
    }; // Ensure this closing brace is here
    // --- End RESTORED ---

    // --- REFINED getFieldValue --- 
    const getFieldValue = (field: keyof GeneratedPlatformDetails): string => {
        const value = currentPlatformData[field];
        
        // Handle Square Price object specifically and safely
        if (activeFormTab === 'square' && field === 'price' && typeof value === 'object' && value !== null && 'amount' in value) {
             // Ensure value.amount is not undefined before String()
             return String(value.amount ?? ''); 
        }
        
        // Handle Tags array
        if (field === 'tags' && Array.isArray(value)) {
            return value.join(', ');
        }
        
         // Handle other numbers
         if (typeof value === 'number') {
             return String(value);
         }
         
        // Handle strings
        if (typeof value === 'string') {
            return value;
        }
        
        // Fallback for null, undefined, or other unexpected types
        return ''; 
    };
    // --- End REFINED --- 
    
    const getCurrencySymbol = () => {
       if (activeFormTab === 'square' && typeof currentPlatformData.price === 'object' && currentPlatformData.price !== null) {
           return currentPlatformData.price.currency === 'USD' ? '$' : (currentPlatformData.price.currency || '');
       }
       return ''; // Or determine currency based on user settings?
    };

    // --- Draggable Media Preview Renderer --- 
    const renderDraggableMediaItem = ({ item, drag, isActive }: RenderItemParams<CapturedMediaItem>) => {
        const isCover = capturedMedia[coverImageIndex]?.id === item.id;
          return (
          <ScaleDecorator>
                        <TouchableOpacity 
                          style={[styles.mediaPreviewItemContainer, isActive && styles.previewImageContainerActive, isCover && styles.previewImageCover ]}
                          onPress={() => handleSetCover(capturedMedia.findIndex(m => m.id === item.id))}
                          onLongPress={drag}
                          disabled={isActive}
                          activeOpacity={0.9}
            >
              <Image source={{ uri: item.uri }} style={styles.mediaPreviewImage} />
              {item.type === 'video' && (
                <View style={styles.videoIndicatorPreview}><Icon name="play-circle" size={18} color={'white'} /></View>
              )}
              {/* Delete button maybe not needed here? Or smaller? */} 
               <TouchableOpacity style={styles.deleteMediaButtonSmall} onPress={() => handleRemoveMedia(item.id)}>
                 <Icon name="close-circle" size={18} color="#FF5252" />
               </TouchableOpacity>
               {isCover && <View style={styles.coverLabelSmall}><Text style={styles.coverLabelText}>Cover</Text></View>}
            </TouchableOpacity>
          </ScaleDecorator>
        );
      };

    return (
        <GestureHandlerRootView style={{ flex: 1 }}> 
            <KeyboardAvoidingView 
                behavior={Platform.OS === "ios" ? "padding" : "height"} 
                style={styles.stageContainer} 
                keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0} // Adjust offset
            >
                <Animated.View style={{flex: 1}} entering={FadeIn}>
                    <Text style={styles.stageTitle}>Review & Edit Details</Text>
                    
                    {/* --- Media Management Section --- */}
                    <View style={styles.mediaSectionContainer}>
                        <Text style={styles.sectionTitle}>Media ({capturedMedia.length}/10)</Text>
                        {capturedMedia.length > 0 ? (
                            <DraggableFlatList
                                data={capturedMedia}
                                onDragEnd={({ data }) => {
                                    const oldCoverId = capturedMedia[coverImageIndex]?.id;
                                    const newIndex = data.findIndex(item => item.id === oldCoverId);
                                    setCoverImageIndex(newIndex >= 0 ? newIndex : (data.length > 0 ? 0 : -1));
                                    setCapturedMedia(data);
                                }}
                                keyExtractor={(item) => item.id}
                                renderItem={renderDraggableMediaItem}
                                horizontal
                                contentContainerStyle={styles.mediaPreviewScrollContent}
                                showsHorizontalScrollIndicator={false}
                            />
                        ) : (
                             <Text style={styles.noMediaText}>No media added yet.</Text>
                        )}
                         <View style={styles.mediaButtonsContainer}>
                            <Button title="Add from Library" onPress={pickImagesFromLibrary} icon="image-multiple-outline" outlined disabled={capturedMedia.length >= 10} style={styles.mediaButton} />
                             <Button title="Open Camera" onPress={() => setShowCameraSection(true)} icon="camera-outline" outlined disabled={capturedMedia.length >= 10} style={styles.mediaButton} /> 
                         </View>
                    </View>
                    {/* --- End Media Management --- */}

                    {/* --- Platform Tabs --- */ }
                    <View style={styles.tabContainer}>
                         {/* ... tab rendering logic ... */} 
                         {selectedPlatforms.map(platform => (
                            <TouchableOpacity 
                                key={platform} 
                                style={[styles.tabButton, activeFormTab === platform && styles.tabButtonActive]} 
                                onPress={() => setActiveFormTab(platform)}
                            >
                                <Text style={[styles.tabButtonText, activeFormTab === platform && styles.tabButtonTextActive]}>
                                    {AVAILABLE_PLATFORMS.find(p => p.key === platform)?.name || platform} 
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    
                    {/* --- Form Fields --- */}
                    <ScrollView style={styles.formScrollView} keyboardShouldPersistTaps="handled">
                         <Text style={styles.sectionTitle}>Details for {AVAILABLE_PLATFORMS.find(p => p.key === activeFormTab)?.name || activeFormTab}</Text>
                        {fieldsToShow.map(field => (
                            <View key={field} style={styles.formInputContainer}>
                                <Text style={styles.formLabel}>{field.replace(/([A-Z])/g, ' $1')}</Text> {/* Add spaces for camelCase */} 
                                 {/* Special handling for price to show currency */}
                                 {field === 'price' && activeFormTab === 'square' && 
                                     <Text style={styles.currencyLabel}>{getCurrencySymbol()}</Text>
                                 }
                                <TextInput
                                    style={[styles.formInput, field === 'description' && styles.formInputMultiline, field === 'price' && activeFormTab === 'square' && styles.priceInputWithCurrency]}
                                    value={getFieldValue(field)}
                                    onChangeText={(text) => handleFormUpdate(activeFormTab, field, text)}
                                    placeholder={field.replace(/([A-Z])/g, ' $1')} // Basic placeholder
                                    placeholderTextColor="#aaa"
                                    multiline={field === 'description'}
                                    keyboardType={getKeyboardType(field)}
                                    autoCapitalize="none"
                                />
                            </View>
                        ))}
                         {/* Regenerate Button */} 
                         <Button 
                            title="Regenerate Details with AI" 
                            onPress={handleRegenerateConfirm} 
                            icon="brain" 
                            outlined 
                            style={{marginTop: 15, marginBottom: 10}}
                         /> 
                    </ScrollView>
                    
                    {/* --- Bottom Navigation Buttons --- */} 
                    <View style={styles.navigationButtons}>
                         <Button title="Back" onPress={() => setCurrentStage(ListingStage.VisualMatch)} outlined style={styles.navButton}/> 
                        <Button title="Save Draft" onPress={handleSaveDraft} outlined style={styles.navButton}/>
                        <Button title="Publish..." onPress={handlePublish} style={styles.navButton}/>
                    </View>
                </Animated.View>
            </KeyboardAvoidingView>

            {/* --- Publish Modal --- */} 
             <Modal
                animationType="fade"
                transparent={true}
                visible={isPublishModalVisible}
                onRequestClose={() => setIsPublishModalVisible(false)}
             >
                <Pressable style={styles.modalOverlay} onPress={() => setIsPublishModalVisible(false)}> 
                    <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}> 
                        <Text style={styles.modalTitle}>Publish Options</Text>
                        <Text style={styles.modalSubtitle}>How would you like to publish to the selected platforms?</Text>
                        <View style={styles.modalButtonContainer}>
                            <Button title="Publish as DRAFT" onPress={() => handlePublishAction('draft')} style={styles.modalButton} outlined/>
                            <Button title="Publish LIVE" onPress={() => handlePublishAction('live')} style={styles.modalButton}/>
                        </View>
                        <Button title="Cancel" onPress={() => setIsPublishModalVisible(false)} style={styles.modalCancelButton}/>
                    </Pressable>
                 </Pressable>
             </Modal>
        </GestureHandlerRootView>
    );
  };

  // --- Current Stage Logic --- //
  const renderCurrentStage = () => {
    // Added logging here
    console.log(`[renderCurrentStage] Rendering stage: ${currentStage}`);

    if (error) return (<View style={styles.errorContainer}><Icon name="alert-circle-outline" size={40} color="#D8000C" /><Text style={styles.errorText}>{error}</Text><Button title="Try Again" onPress={() => { setError(null); setCurrentStage(ListingStage.ImageInput); }} /></View>);
    
    // Handle Loading states explicitly
    if (isLoading) {
        if (currentStage === ListingStage.Analyzing) return renderLoading('Analyzing Media...');
        if (currentStage === ListingStage.Generating) return renderLoading('Generating Details...');
        if (currentStage === ListingStage.Publishing) return renderLoading('Publishing...');
        // Generic loading for other transitions if needed, or could be handled by the loading overlay
        return renderLoading(loadingMessage || 'Loading...'); 
    }

    switch (currentStage) {
        case ListingStage.PlatformSelection: return renderPlatformSelection();
        case ListingStage.ImageInput: return renderImageInput();
        case ListingStage.VisualMatch: return renderVisualMatch();
        case ListingStage.FormReview: return renderFormReview();
        // Analyzing, Generating, Publishing are handled by the isLoading check above
        default:
            console.warn("[renderCurrentStage] Unhandled stage:", currentStage);
            return <Text>Unknown Stage: {currentStage}</Text>;
    }
  };
  
  // If camera section is active, render it fullscreen
  if (showCameraSection) {
    return (<CameraSection 
        onCapture={handleMediaCaptured} 
        onClose={() => setShowCameraSection(false)} 
        styles={styles} // Pass styles down
        initialMedia={capturedMedia} // Pass current media down
    />);
  }

  // Otherwise, render the normal screen content
  console.log("[AddListingScreen] Rendering main SafeAreaView");
  return (<SafeAreaView style={styles.container}>{renderCurrentStage()}</SafeAreaView>);
}; 

export default AddListingScreen;

// --- Styles --- //
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FB' },
  stageContainer: { flex: 1, paddingHorizontal: 15, paddingBottom: 15 },
  loadingContainer: { 
      position: 'absolute',
      left: 0, right: 0, top: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      justifyContent: 'center', 
      alignItems: 'center',
      zIndex: 10 // Ensure it's on top
  },
  loadingText: { marginTop: 15, fontSize: 16, color: '#FFFFFF', fontWeight: '500' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#FFF0F0' },
  errorText: { color: '#D8000C', padding: 10, borderRadius: 5, marginVertical: 15, textAlign: 'center', width: '90%', fontSize: 16, fontWeight: '500'},
  stageTitle: { fontSize: 24, fontWeight: '700', marginBottom: 8, color: '#333', textAlign: 'center', paddingTop: 10 },
  stageSubtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20 },
  bottomButton: { marginHorizontal: 15, marginBottom: 10 },
  platformGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 20, },
  platformCard: { 
      width: '40%', 
      aspectRatio: 1, 
      justifyContent: 'center', // Center content vertically
      alignItems: 'center', 
      margin: 10, 
      borderRadius: 12, 
      borderWidth: 1.5, // Slightly thicker border
      borderColor: '#ddd', 
      backgroundColor: '#fff', 
      padding: 10, 
  },
  platformCardSelected: { 
      borderColor: '#4CAF50', 
      backgroundColor: '#E8F5E9', 
      borderWidth: 2, // Even thicker border when selected
  },
  platformIcon: { marginBottom: 10, },
  platformName: { fontSize: 14, fontWeight: '500', color: '#555', textAlign: 'center', },
  platformNameSelected: { color: '#2E7D32', fontWeight: '600', },

  // Styles FOR Camera Input Stage 
  cameraStageContainer: {
      flex: 1,
      backgroundColor: 'black',
  },
  cameraPreview: {
      flex: 1, // Takes space between header and preview/controls
  },
  cameraHeader: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      paddingHorizontal: 15,
      paddingTop: Platform.OS === 'android' ? 35 : 50,
      position: 'absolute',
      top: 0, left: 0, right: 0,
      zIndex: 3, // Above title overlay
  },
  headerButton: {
      padding: 10,
      marginLeft: 15,
      backgroundColor: 'rgba(0,0,0,0.3)', // Make buttons slightly visible
      borderRadius: 20,
  },
  previewListContainer: {
      height: 100,
      backgroundColor: 'rgba(0,0,0,0.4)',
      paddingVertical: 10,
      zIndex: 1, // Above camera view
  },
  previewScroll: {
      paddingHorizontal: 10,
      alignItems: 'center'
  },
  previewImageContainer: {
      width: 80,
      height: 80,
      borderRadius: 6,
      marginHorizontal: 5,
      position: 'relative',
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: 'transparent',
  },
  previewImageContainerActive: {
      borderColor: 'rgba(255, 255, 255, 0.7)',
      transform: [{ scale: 1.05 }],
  },
  previewImageCover: {
      borderColor: '#4CAF50', // Highlight cover image
  },
  previewImage: {
      width: '100%',
      height: '100%'
  },
  videoIndicatorPreview: {
      position: 'absolute', bottom: 3, right: 3,
      backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, padding: 3
  },
  deleteMediaButton: {
      position: 'absolute',
      top: 0, right: 0,
      backgroundColor: 'rgba(255, 82, 82, 0.8)', // Red background
      borderRadius: 10,
      width: 20,
      height: 20,
      justifyContent: 'center',
      alignItems: 'center'
  },
  bottomControlsContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      paddingBottom: Platform.OS === 'ios' ? 10 : 5, // Reduced bottom padding
      paddingTop: 10,
      backgroundColor: 'black',
      zIndex: 2,
  },
  captureButton: {
      width: 70, height: 70, borderRadius: 35,
      backgroundColor: 'rgba(255, 255, 255, 0.3)',
      justifyContent: 'center', alignItems: 'center',
      marginHorizontal: 20,
      borderWidth: 2,
      borderColor: 'white',
  },
  captureInner: {
      width: 58, height: 58, borderRadius: 29,
      backgroundColor: 'white',
  },
  recordingButton: {
      backgroundColor: 'red'
  },
  captureDisabledInner: {
      backgroundColor: '#555',
  },
  sideControlButton: {
      padding: 15,
      justifyContent: 'center',
      alignItems: 'center'
  },
  centeredMessageContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'black',
      padding: 20,
  },
  centeredMessageText: {
      color: 'white',
      marginTop: 15,
      textAlign: 'center',
      fontSize: 16,
  },
  cameraStageHeader: {
      position: 'absolute',
      top: Platform.OS === 'android' ? 80 : 100, // Position below header controls
      left: 15, right: 15, // Add padding
      alignItems: 'center',
      zIndex: 2, // Above camera view/preview
      backgroundColor: 'rgba(0,0,0,0.3)', // Semi-transparent background
      borderRadius: 8,
      paddingVertical: 5,
  },
  stageTitleCamera: {
      fontSize: 18, // Smaller title
      fontWeight: '600',
      color: '#FFFFFF',
      textAlign: 'center',
  },
  stageSubtitleCamera: {
      fontSize: 12,
      color: '#E0E0E0',
      textAlign: 'center',
      marginTop: 3,
  },
  navigationButtonsCamera: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 10,
      paddingBottom: Platform.OS === 'ios' ? 25 : 15, // More padding at bottom
      paddingHorizontal: 15,
      backgroundColor: 'black',
      zIndex: 3, // Above controls
  },

  // --- Styles for Visual Match GRID ---
  visualMatchGrid: { 
      flex: 1, 
      marginHorizontal: -5, // Counteract item margin
  },
  visualMatchGridContainer: {
      paddingBottom: 15, // Add padding at the bottom of the grid
  },
  matchGridItem: { // Style for each item in the grid
    flex: 1, // Take up equal space
    maxWidth: '50%', // Ensure two columns
    margin: 5, 
    backgroundColor: 'white', 
    borderRadius: 8, 
    borderWidth: 1, 
    borderColor: '#eee', 
    overflow: 'hidden', // Ensure content stays within border radius
    shadowColor: "#000", 
    shadowOffset: { width: 0, height: 1 }, 
    shadowOpacity: 0.18, 
    shadowRadius: 1.00, 
    elevation: 1,
  },
  matchCardSelected: { // Style for the selected item
    borderColor: '#4CAF50', 
    borderWidth: 2.5,
    elevation: 3, // Slightly more shadow when selected
  },
  matchThumbnailGrid: {
    width: '100%', 
    height: 130, // Adjust height as needed for grid
    borderTopLeftRadius: 7, // Match card radius
    borderTopRightRadius: 7,
    backgroundColor: '#f0f0f0',
  },
  matchDetailsGrid: {
    padding: 8, 
  },
  matchTitleGrid: {
    fontWeight: '600', 
    fontSize: 13, // Slightly smaller for grid?
    color: '#333', 
    marginBottom: 3, 
    minHeight: 34, // Reserve space for 2 lines
  },
  matchSourceGrid: { 
    fontSize: 11, 
    color: '#666', 
    marginBottom: 4 
  },
  matchPriceGrid: { 
    fontSize: 12, 
    color: '#2E7D32', 
    fontWeight: '500'
  },
  
  // --- General Navigation Buttons --- 
  navigationButtons: { 
      flexDirection: 'row', 
      justifyContent: 'space-between', 
      borderTopWidth: 1, 
      borderTopColor: '#eee', 
      paddingTop: 15, 
      paddingBottom: Platform.OS === 'ios' ? 15 : 10,
      paddingHorizontal: 15,
      backgroundColor: '#F8F9FB' // Match stage background
  },
  navButton: { flex: 1, marginHorizontal: 5 },
  disabledButton: { backgroundColor: '#ccc', borderColor: '#bbb' },
  
  // Add previously missing styles (if needed by restored logic or camera preview)
  imageGridScrollView: { flex: 1, marginBottom: 15, },
  imageGridContainer: { 
    paddingBottom: 20,
    // Example: If needed for a grid layout somewhere else
    // flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', paddingHorizontal: '1.66%' 
  },
  imageThumbnailWrapper: {
    position: 'relative', 
    width: (SCREEN_WIDTH - 30) / 3 - 10, // Example grid sizing
    aspectRatio: 1, 
    margin: 5,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#eee',
  },
  imageThumbnail: { width: '100%', height: '100%' },
  coverIndicator: { position: 'absolute', top: 5, left: 5, backgroundColor: 'rgba(255, 255, 255, 0.9)', borderRadius: 12, paddingVertical: 2, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', },
  coverIndicatorText: { marginLeft: 4, fontSize: 10, fontWeight: 'bold', color: '#2E7D32' },
  videoIndicator: { position: 'absolute', bottom: 5, right: 5, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, padding: 2 },
  removeIcon: { 
    position: 'absolute', 
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 11, 
    width: 22, 
    height: 22, 
    justifyContent: 'center', 
    alignItems: 'center', 
  },
  addButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 10,
    paddingHorizontal: 5,
  },
  addButton: {
    width: (SCREEN_WIDTH - 30) / 3 - 10,
    aspectRatio: 1,
    borderRadius: 8, 
    borderWidth: 1.5, 
    borderColor: '#ccc', 
    borderStyle: 'dashed', 
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9f9f9', 
    marginHorizontal: 5,
  },
  addButtonText: { marginTop: 4, fontSize: 11, color: '#aaa' },

  // --- RESTORED Styles for No Match/Empty State ---
  centeredInfoContainer: {
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    paddingBottom: 50,
    marginTop: 20, // Add some margin if it's inside the grid area
  },
  noMatchText: {
    fontSize: 16,
    color: '#666',
    marginTop: 15,
    textAlign: 'center',
  },

  // --- RESTORED Styles for Form Review --- 
  formImageScrollContainer: {
    height: 90, 
    marginBottom: 15, 
  },
  formImageScrollContent: {
    paddingHorizontal: 5, 
    alignItems: 'center'
  },
  formImageThumbnail: { 
      width: 70, 
      height: 70, 
      borderRadius: 6, 
      marginHorizontal: 5, 
      backgroundColor: '#eee'
  },
  tabContainer: { flexDirection: 'row', marginBottom: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  tabButton: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabButtonActive: { borderBottomColor: '#4CAF50'},
  tabButtonText: { color: '#666', fontWeight: '500'},
  tabButtonTextActive: { color: '#2E7D32'},
  formScrollView: { flex: 1, marginBottom: 10, paddingHorizontal: 5 },
  formInputContainer: { marginBottom: 18, position: 'relative' }, // Added relative positioning for currency
  formLabel: { fontSize: 14, color: '#333', fontWeight: '500', marginBottom: 6, textTransform: 'capitalize' }, 
  formInput: { borderWidth: 1, borderColor: '#DDE2E7', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, fontSize: 15, color: '#333', },
  formInputMultiline: { minHeight: 100, textAlignVertical: 'top', borderWidth: 1, borderColor: '#DDE2E7', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, fontSize: 15, color: '#333', }, 
  priceInputWithCurrency: {
      paddingLeft: 25, // Add padding for currency symbol
  },
  currencyLabel: {
      position: 'absolute',
      left: 12,
      top: 39, // Adjust based on label height and input padding/border
      fontSize: 15,
      color: '#666', 
      fontWeight: '500'
  },
  
  // --- Styles for Publish Modal ---
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 25,
    width: '85%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    color: '#333',
  },
   modalSubtitle: {
     fontSize: 14,
     color: '#666',
     textAlign: 'center',
     marginBottom: 25,
   },
  modalButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 15,
  },
  modalButton: {
    flex: 1,
    marginHorizontal: 5,
  },
  modalCancelButton: {
      marginTop: 10,
  },
  
  // --- Media Management Section Styles (in FormReview) ---
  mediaSectionContainer: {
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#444',
    marginBottom: 10,
    paddingHorizontal: 5, // Match form padding
  },
   mediaPreviewScrollContent: {
        paddingVertical: 5, 
        paddingHorizontal: 5, 
        alignItems: 'center'
   },
   mediaPreviewItemContainer: {
        width: 80, 
        height: 80, 
        borderRadius: 6, 
        marginHorizontal: 4,
        position: 'relative', 
        overflow: 'hidden', // Keep overflow hidden
        borderWidth: 1.5,
        borderColor: 'transparent', 
   },
    mediaPreviewImage: {
        width: '100%', 
        height: '100%'
    },
    deleteMediaButtonSmall: {
        position: 'absolute',
        top: -2, right: -2,
        backgroundColor: 'rgba(255, 255, 255, 0.8)', 
        borderRadius: 10,
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center'
    },
    coverLabelSmall: {
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        backgroundColor: 'rgba(76, 175, 80, 0.85)', // Green background for cover
        paddingVertical: 2,
    },
    coverLabelText: {
        color: 'white',
        fontSize: 10,
        fontWeight: 'bold',
        textAlign: 'center'
    },
    noMediaText: {
        fontSize: 14,
        color: '#888',
        textAlign: 'center',
        paddingVertical: 20,
        paddingHorizontal: 5,
    },
    mediaButtonsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginTop: 10,
        paddingHorizontal: 5,
    },
    mediaButton: {
        flex: 1,
        marginHorizontal: 5,
    },
   // --- Style for Platform Image (Added by previous edit, keep this) --- 
  platformImage: {
      width: '60%', // Adjust size as needed
      height: '60%', // Adjust size as needed
      marginBottom: 10, 
  },
  platformImageDeselected: {
      opacity: 1, // Make deselected images slightly faded
  },
  platformIconPlaceholder: { // Placeholder style if image fails to load
      width: 40,
      height: 40,
      backgroundColor: '#eee',
      borderRadius: 5,
      marginBottom: 10,
  },
  // --- End Platform Image Style ---
});

// --- Platform Images Map --- 
// Adjust paths based on your actual asset location
const platformImageMap: { [key: string]: any } = {
    shopify: require('../../src/assets/shopify.png'),
    amazon: require('../../src/assets/amazon.png'),
    facebook: require('../../src/assets/facebook.png'),
    ebay: require('../../src/assets/ebay.png'),
    clover: require('../../src/assets/clover.png'),
    square: require('../../src/assets/square.png'),
};
// --- End Platform Images Map ---