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
  Platform
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
  { key: 'etsy', name: 'Etsy', icon: 'etsy' },
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

interface GeneratedPlatformDetails {
  title?: string;
  description?: string;
  price?: number;
  category?: string;
  tags?: string[];
  weight?: number;
  weightUnit?: string;
  bullet_points?: string[]; 
  search_terms?: string[]; 
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
  const [analysisResponse, setAnalysisResponse] = useState<SerpApiLensResponse | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<VisualMatch | null>(null);
  const [generationResponse, setGenerationResponse] = useState<GenerateDetailsResponse | null>(null);
  const [formData, setFormData] = useState<GenerateDetailsResponse['generatedDetails'] | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [uploadedImageUrls, setUploadedImageUrls] = useState<string[]>([]);
  const [activeFormTab, setActiveFormTab] = useState<string | null>(null);

  // --- Camera State (Moved from CameraSection) ---
  const [cameraPermission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [cameraMode, setCameraMode] = useState<"picture" | "video">("picture");
  const [recording, setRecording] = useState(false);
  const [flash, setFlash] = useState<FlashMode>("off");
  const cameraRef = useRef<CameraView>(null);
  // --- End Camera State ---


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
    if (userError || !user) {
        console.error("Error fetching user for analysis API:", userError);
        setError("User session error. Please log out and back in.");
        setIsLoading(false);
        setLoadingMessage('');
        setCurrentStage(ListingStage.ImageInput); // Go back to image input on user error
        return;
    }
    const userId = user.id;
    console.log(`User ID fetched for analysis: ${userId}`);

    const analyzeApiUrl = `https://sssync-bknd-production.up.railway.app/products/analyze?userId=${userId}`;
    // Use the 'urls' variable directly from the upload result
    const requestBodyAnalyze = {
        imageUris: urls, // <-- Use the direct result
        selectedPlatforms: selectedPlatforms,
    };
    console.log(`Attempting to POST to: ${analyzeApiUrl}`);
    console.log("Request Body (Analyze):", JSON.stringify(requestBodyAnalyze, null, 2));

    try {
        const response = await fetch(analyzeApiUrl, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(requestBodyAnalyze),
        });
        console.log(`Analysis API Response Status: ${response.status}`);
        const responseData = await response.json();

        if (!response.ok) {
            console.error("Analysis API Error Response Body:", responseData);
            // Improved Error Message Handling
            let apiErrorMessage = `HTTP error! status: ${response.status}`;
            if (responseData && responseData.message) {
                if (Array.isArray(responseData.message)) {
                     // Join array messages, fallback to generic error if array is empty/invalid
                    apiErrorMessage = responseData.message.join(', ') || `Analysis API Error (Code: ${response.status})`;
                } else if (typeof responseData.message === 'string') {
                    apiErrorMessage = responseData.message;
                }
            }
            // Specific handling for 404 or "no matches" scenarios
            if (response.status === 404 || (typeof apiErrorMessage === 'string' && apiErrorMessage.toLowerCase().includes("no visual matches"))) {
                console.log("Analysis returned no visual matches.");
                setAnalysisResponse({ search_metadata: {}, visual_matches: [] });
                setCurrentStage(ListingStage.VisualMatch);
            } else {
                // Throw for other non-OK responses
                throw new Error(apiErrorMessage);
            }
        } else {
            console.log("Analysis Response Data:", JSON.stringify(responseData, null, 2));
            setAnalysisResponse(responseData);
            setCurrentStage(ListingStage.VisualMatch);
        }
        setError(null); // Clear error on success or handled non-match
    } catch (err: any) {
        console.error("Analysis API fetch/processing failed:", err);
        // Use the message from the caught error (which might be the one constructed above)
        const errorMessage = err.message || (typeof err === 'string' ? err : 'Unknown error during analysis fetch');
        setError(`Analysis Failed: ${errorMessage}`);
        setCurrentStage(ListingStage.ImageInput); // Go back to image input on analysis error
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
};

  const handleMatchSelected = (match: VisualMatch) => { 
      console.log("Selected Match:", match.title); 
      setSelectedMatch(match);
      triggerDetailsGeneration(analysisResponse);
  };
  const handleProceedWithoutMatch = () => { 
      console.log("Proceeding without match."); 
      setSelectedMatch(null);
      triggerDetailsGeneration(null);
  };

  const triggerDetailsGeneration = async (lensResponseContext: SerpApiLensResponse | null) => { 
    if (uploadedImageUrls.length === 0) { Alert.alert("Internal Error", "Missing uploaded image URLs."); setCurrentStage(ListingStage.ImageInput); return; }
    // Cover index is now implicitly 0 for the API call based on uploadedImageUrls
    const coverImageIndexForApi = 0; 
    
    setError(null); setCurrentStage(ListingStage.Generating); setIsLoading(true); setLoadingMessage('Generating details...'); // Use setLoadingMessage

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
        console.error("Error fetching user for generation API:", userError); setError("User session error."); setIsLoading(false); setCurrentStage(ListingStage.ImageInput); return;
    }
    const userId = user.id;

    const generateApiUrl = `https://sssync-bknd-production.up.railway.app/products/generate-details?userId=${userId}`;
    const requestBodyGenerate = { 
        imageUris: uploadedImageUrls, // Already has cover first
        coverImageIndex: coverImageIndexForApi,
        selectedPlatforms: selectedPlatforms, 
        lensResponse: lensResponseContext
    };
    console.log(`Attempting to POST to: ${generateApiUrl}`);
    console.log("Request Body (Generate):", JSON.stringify(requestBodyGenerate, null, 2));

    try {
      const response = await fetch(generateApiUrl, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(requestBodyGenerate),
      });
      
      let responseData: any; 
      try { responseData = await response.json(); } 
      catch (jsonError) { throw new Error(response.statusText || `HTTP error! status: ${response.status}`); }

      if (!response.ok) { 
          let msg = `HTTP error! status: ${response.status}`;
          if (responseData?.message) msg = Array.isArray(responseData.message) ? responseData.message.join(', ') : String(responseData.message);
          throw new Error(msg); 
      }

      const generationData = responseData as GenerateDetailsResponse;
      console.log("Generation Response:", JSON.stringify(generationData, null, 2));
      if (!generationData.productId || !generationData.variantId || !generationData.generatedDetails) throw new Error("Incomplete response from generation API.");
      
      setGenerationResponse(generationData); 
      setProductId(generationData.productId); 
      setVariantId(generationData.variantId); 
      setFormData(generationData.generatedDetails);
      setActiveFormTab(selectedPlatforms[0] || null);
      setCurrentStage(ListingStage.FormReview); 
      setError(null);

    } catch (err: any) {
      console.error("Details generation failed:", err); setError(`Generation Failed: ${err.message || 'Unknown error'}`);
      // Go back to visual match if it exists, otherwise image input
      setCurrentStage(analysisResponse && analysisResponse.visual_matches && analysisResponse.visual_matches.length > 0 ? ListingStage.VisualMatch : ListingStage.ImageInput); 
    } finally { setIsLoading(false); setLoadingMessage(''); } // Clear loading message
  };
  
  const handleFormUpdate = (platform: string, field: keyof GeneratedPlatformDetails, value: any) => {
    setFormData(prevData => { if (!prevData) return null;
      let processedValue = value;
      processedValue = value;
      return { ...prevData, [platform]: { ...(prevData[platform] || {}), [field]: processedValue } };
    });
  };

  const handleSaveDraft = async () => { console.log("Saving Draft...", { productId, variantId, formData }); Alert.alert("Draft Saved (Logged)", "API call not implemented."); };
  const handlePublish = async () => {
    console.log("Publishing...", { productId, variantId, formData }); 
    
    const finalDataForApi = JSON.parse(JSON.stringify(formData));
    for (const platform in finalDataForApi) {
        const platformData = finalDataForApi[platform];
        if (platformData.price) platformData.price = parseFloat(platformData.price) || 0;
        if (platformData.weight) platformData.weight = parseFloat(platformData.weight) || 0;
        const arrayFields = ['tags', 'bullet_points', 'search_terms'];
        arrayFields.forEach(field => {
           if (typeof platformData[field] === 'string') {
                platformData[field] = platformData[field].split(',').map((s: string) => s.trim()).filter((s: string) => s);
           } else if (!Array.isArray(platformData[field])) {
               platformData[field] = [];
           }
        });
    }
     console.log("Converted Data for Publish API:", finalDataForApi);
    
    setCurrentStage(ListingStage.Publishing);
    setIsLoading(true);

    setTimeout(() => { 
        setIsLoading(false);
        Alert.alert("Published (Simulated)", "API call not implemented yet."); 
    }, 2000); 
  };

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
            return (
              <TouchableOpacity key={platform.key} style={[styles.platformCard, isSelected && styles.platformCardSelected]} onPress={() => togglePlatformSelection(platform.key)}>
                <Icon name={platform.icon} size={40} color={isSelected ? '#294500' : '#888'} style={styles.platformIcon} /> {/* DEBUG: Hardcoded colors */}
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

  // Restore Skeleton RenderVisualMatch
  const renderVisualMatch = () => {
    console.log("[AddListingScreen] Rendering Visual Match Stage");
    if (isLoading && currentStage === ListingStage.Analyzing) return renderLoading('Analyzing Media...'); // Show loading specific to analysis
    // Basic skeleton - show loading or a placeholder if analysisResponse is null
    if (!analysisResponse) {
      return (
        <Animated.View style={styles.stageContainer} entering={FadeIn}>
          <Text style={styles.stageTitle}>Waiting for Analysis</Text>
          {/* Optionally show a spinner here too */}
          <View style={styles.navigationButtons}>
            <Button title="Back to Media" onPress={() => setCurrentStage(ListingStage.ImageInput)} outlined style={styles.navButton}/>
          </View>
        </Animated.View>
      );
    }
    
    const hasMatches = analysisResponse.visual_matches && analysisResponse.visual_matches.length > 0;

    return (
      <Animated.View style={styles.stageContainer} entering={FadeIn}>
        <Text style={styles.stageTitle}>{hasMatches ? "Select Best Visual Match" : "No Matches Found"}</Text>
        <Text style={styles.stageSubtitle}>
          {hasMatches 
            ? "Tap the item that looks most like yours, or proceed without a match." 
            : "We couldn't find similar products online. Proceed to generate details from your images."}
        </Text>

        {/* Skeleton/Placeholder for match list or no-match message */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          {hasMatches ? (
            <Text style={{ color: '#999' }}>[Visual Match List Placeholder]</Text>
            // <ScrollView style={styles.visualMatchScrollView}> ... map matches ... </ScrollView>
          ) : (
            <Text style={{ color: '#999' }}>[No Matches Found Placeholder]</Text>
          )}
        </View>
        
        <View style={styles.navigationButtons}>
          <Button title="Back to Media" onPress={() => setCurrentStage(ListingStage.ImageInput)} outlined style={styles.navButton}/>
          <Button 
            title={hasMatches ? "No Match / Use My Images" : "Generate Details"} 
            onPress={handleProceedWithoutMatch} 
            style={styles.navButton} 
          />
        </View>
      </Animated.View>
    );
  };

  // Restore Skeleton RenderFormReview
  const renderFormReview = () => {
    console.log("[AddListingScreen] Rendering Form Review Stage");
    if (isLoading && currentStage === ListingStage.Generating) return renderLoading('Generating Details...'); // Show loading specific to generation
    
    // Basic skeleton - show loading or placeholder if formData is null
    if (!formData || !activeFormTab) {
      return (
        <Animated.View style={styles.stageContainer} entering={FadeIn}>
          <Text style={styles.stageTitle}>Waiting for Details</Text>
           {/* Optionally show a spinner here too */}
          <View style={styles.navigationButtons}>
            {/* Allow going back if generation failed or is slow */}
            <Button title="Back to Matches" onPress={() => setCurrentStage(ListingStage.VisualMatch)} outlined style={styles.navButton}/>
          </View>
        </Animated.View>
      );
    }

    // Skeleton structure for form
    return (
      <Animated.View style={styles.stageContainer} entering={FadeIn}>
        <Text style={styles.stageTitle}>Review & Edit Details</Text>
        <Text style={styles.stageSubtitle}>Review AI generated details for {activeFormTab}.</Text>
        
        {/* Placeholder for image scroll */}
         <View style={{ height: 90, marginBottom: 15, alignItems: 'center', justifyContent: 'center' }}>
             <Text style={{ color: '#999' }}>[Image Thumbnails Placeholder]</Text>
         </View>

        {/* Placeholder for tabs */}
        <View style={styles.tabContainer}>
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
        
        {/* Placeholder for form fields */}
        <ScrollView style={styles.formScrollView}>
          <Text style={{ color: '#999', textAlign: 'center', padding: 20 }}>[Form Fields Placeholder for {activeFormTab}]</Text>
          {/* Later: Map Object.entries(formData[activeFormTab])... */}
        </ScrollView>
        
        <View style={styles.navigationButtons}>
          <Button title="Save Draft" onPress={handleSaveDraft} outlined style={styles.navButton}/>
          <Button title="Publish" onPress={handlePublish} style={styles.navButton}/>
        </View>
      </Animated.View>
    );
  };

  // --- Current Stage Logic --- //
  const renderCurrentStage = () => {
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
            console.warn("Unhandled stage:", currentStage);
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
  platformCard: { width: '40%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center', margin: 10, borderRadius: 12, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#fff', padding: 10, },
  platformCardSelected: { borderColor: '#4CAF50', backgroundColor: '#E8F5E9', borderWidth: 2},
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

  // --- Styles for Visual Match --- 
  visualMatchScrollView: { flex: 1, marginBottom: 15, },
  matchCard: { flexDirection: 'row', padding: 12, marginBottom: 12, backgroundColor: 'white', borderRadius: 8, borderWidth: 1, borderColor: '#eee', alignItems: 'center', shadowColor: "#000", shadowOffset: { width: 0, height: 1, }, shadowOpacity: 0.18, shadowRadius: 1.00, elevation: 1, },
  matchThumbnail: { width: 70, height: 70, borderRadius: 4, marginRight: 12, backgroundColor: '#f0f0f0' },
  matchDetails: { flex: 1, marginRight: 5 },
  matchTitle: { fontWeight: '600', fontSize: 14, color: '#333', marginBottom: 3 },
  matchSource: { fontSize: 12, color: '#666', marginBottom: 4 },
  matchPrice: { fontSize: 13, color: '#2E7D32', fontWeight: '500'},
  centeredButtonContainer: { paddingVertical: 20, alignItems: 'center'},
  noMatchText: {
      fontSize: 16,
      color: '#666',
      marginTop: 15,
      textAlign: 'center',
  },
  centeredInfoContainer: {
      flex: 1, 
      justifyContent: 'center', 
      alignItems: 'center', 
      paddingBottom: 50
  },

  // --- Styles for Form Review --- 
  formImageScroll: { height: 90, marginBottom: 15, paddingLeft: 5 },
  formImageThumbnail: { width: 70, height: 70, borderRadius: 6, marginRight: 10, backgroundColor: '#eee'},
  tabContainer: { flexDirection: 'row', marginBottom: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  tabButton: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabButtonActive: { borderBottomColor: '#4CAF50'},
  tabButtonText: { color: '#666', fontWeight: '500'},
  tabButtonTextActive: { color: '#2E7D32'},
  formScrollView: { flex: 1, marginBottom: 10, paddingHorizontal: 5 },
  formInputContainer: { marginBottom: 18, },
  formLabel: { fontSize: 14, color: '#333', fontWeight: '500', marginBottom: 6, },
  formInput: { borderWidth: 1, borderColor: '#DDE2E7', backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, fontSize: 15, color: '#333', },
  formInputMultiline: { minHeight: 100, textAlignVertical: 'top', },
  aiGeneratedText: { color: '#800080', }, 
  noDataText: { color: '#666', fontStyle: 'italic', textAlign: 'center', paddingVertical: 20, },

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
});