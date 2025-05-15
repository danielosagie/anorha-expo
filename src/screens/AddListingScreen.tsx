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
  Pressable,
  Keyboard
} from 'react-native';
import { CameraView, useCameraPermissions, Camera, CameraType, FlashMode } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Animated, { 
  FadeIn, 
  FadeOut
} from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Button from '../components/Button';
import Card from '../components/Card';
import PlaceholderImage from '../components/PlaceholderImage';
import { supabase } from '../../lib/supabase'; 
import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import { Checkbox } from 'react-native-paper';
import { useAuth } from '../contexts/AuthContext';

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

// UPDATED Frontend interface to match Backend's GeneratedPlatformSpecificDetails
interface GeneratedPlatformDetails { // Keep frontend name consistent for now, map backend structure here
  title?: string;
  description?: string; // Should be detailed, potentially HTML or Markdown if requested
  price?: number; // Primary price suggestion in USD
  compareAtPrice?: number; // Optional compare-at price in USD
  categorySuggestion?: string; // Text suggestion (e.g., "Men's T-shirts", "Home Decor > Vases") - Not an ID
  tags?: string[] | string; // Array preferred, but handle string
  weight?: number;
  weightUnit?: string; // e.g., "kg", "lb"
  // Common fields expanded
  brand?: string;
  condition?: string; // e.g., "New", "Used - Like New" (Suggest based on image/context)
  // Platform-specific suggestions
  // Shopify
  status?: 'active' | 'draft' | 'archived'; // Suggest 'active' or 'draft'
  vendor?: string;
  productType?: string; // Shopify's own categorization (matches backend name for Shopify)
  // Square
  locations?: string; // Suggest "All Available Locations" or similar placeholder
  gtin?: string; // Suggest extracting from visual match barcode if possible
  // eBay
  listingFormat?: 'FixedPrice' | 'Auction'; // Suggest 'FixedPrice' generally
  duration?: string; // Suggest 'GTC' (Good 'Til Canceled) for FixedPrice
  dispatchTime?: string; // Suggest a reasonable default like "1 business day"
  returnPolicy?: string; // Suggest a basic return policy text
  shippingService?: string; // Suggest a common domestic service like "USPS Ground Advantage"
  itemLocationPostalCode?: string; // Try to infer if possible, otherwise leave null
  itemSpecifics?: { [key: string]: string }; // Suggest common specifics like Size, Color, Material based on image/context
  // Amazon
  bullet_points?: string[]; // Suggest 3-5 key feature bullet points
  search_terms?: string[]; // Suggest relevant keywords
  amazonProductType?: string; // Renamed on frontend (maps to backend's productType for Amazon)
  productIdType?: 'UPC' | 'EAN' | 'GTIN' | 'ASIN'; // Suggest based on visual match barcode or if it looks like an existing product
  // Facebook Marketplace
  availability?: 'in stock' | 'limited stock' | 'out of stock'; // Suggest 'in stock'
  // Allow for other potential fields
  [key: string]: any;
  // Add Shopify-specific fields
  productOptions?: ShopifyOption[];
  variants?: ShopifyVariant[];
  inventoryItem?: ShopifyInventoryItem;
}

// UPDATED Frontend interface to match Backend's GeneratedDetails
interface GenerateDetailsResponse {
  // The backend response structure might not include productId/variantId at the top level
  // The core part is the mapping of platforms to their details.
  generatedDetails: {
      [platformKey: string]: GeneratedPlatformDetails; // Use updated details interface
  };
  // Include productId/variantId if the backend still sends them, otherwise remove
  productId?: string; // Optional: Check if backend still includes this
  variantId?: string; // Optional: Check if backend still includes this
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


// --- UN-NESTED CameraSection Component (Placeholder) --- //
const CameraSection = ({ onCapture, onClose, styles, initialMedia = [] }: CameraSectionProps) => {
  const [cameraPermission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [cameraMode, setCameraMode] = useState<"picture" | "video">("picture");
  const [recording, setRecording] = useState(false);
  const [flash, setFlash] = useState<FlashMode>("off");
  const [localMedia, setLocalMedia] = useState<CapturedMediaItem[]>(initialMedia);
  const [coverImageIndex, setCoverImageIndex] = useState<number>(-1);
  const cameraRef = useRef<CameraView>(null);

  // Camera control functions
  const takePicture = async () => {
    if (cameraRef.current && localMedia.length < 10) {
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
        if (photo) {
          const newItem: CapturedMediaItem = {
            uri: photo.uri,
            width: photo.width,
            height: photo.height,
            type: 'image',
            number: localMedia.length + 1,
            id: photo.uri + Date.now(),
          };
          const newMedia = [...localMedia, newItem].slice(0, 10);
          setLocalMedia(newMedia);
          if (localMedia.length === 0) setCoverImageIndex(0);
        }
      } catch (error) {
        console.error('Error taking picture', error);
        Alert.alert("Capture Error", "Could not take picture.");
      }
    } else if (localMedia.length >= 10) {
      Alert.alert("Limit Reached", "You can add a maximum of 10 media items.");
    }
  };

  const startRecording = async () => {
    const micPermission = await Camera.requestMicrophonePermissionsAsync();
    if (!micPermission.granted) {
      Alert.alert("Permission Required", "Microphone permission is needed to record video.");
      return;
    }
    
    if (cameraRef.current && localMedia.length < 10) {
      setRecording(true);
      try {
        const videoData = await cameraRef.current.recordAsync({ maxDuration: 60 });
        if (videoData) {
          const newItem: CapturedMediaItem = {
            uri: videoData.uri,
            type: 'video',
            width: undefined,
            height: undefined,
            number: localMedia.length + 1,
            id: videoData.uri + Date.now(),
          };
          const newMedia = [...localMedia, newItem].slice(0, 10);
          setLocalMedia(newMedia);
          if (localMedia.length === 0) setCoverImageIndex(0);
        }
        setRecording(false);
      } catch (error) {
        console.error('Error recording video', error);
        setRecording(false);
        Alert.alert("Recording Error", "Could not record video.");
      }
    } else if (localMedia.length >= 10) {
      Alert.alert("Limit Reached", "You can add a maximum of 10 media items.");
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && recording) {
      cameraRef.current.stopRecording();
    }
  };

  const toggleCameraMode = () => setCameraMode(current => current === "picture" ? "video" : "picture");
  const toggleFlash = () => setFlash(current => current === 'off' ? 'on' : current === 'on' ? 'auto' : 'off');
  const toggleCameraFacing = () => setFacing(current => current === "back" ? "front" : "back");
  const getFlashIcon = () => flash === 'on' ? 'flash' : flash === 'auto' ? 'flash-auto' : 'flash-off';

  const pickImagesFromLibrary = async () => {
    if (localMedia.length >= 10) {
      Alert.alert("Limit Reached", "You can add a maximum of 10 media items.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      quality: 0.8,
      orderedSelection: true
    });
    if (!result.canceled && result.assets) {
      const currentCount = localMedia.length;
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
      const combined = [...localMedia, ...newItems];
      setLocalMedia(combined);
      if (currentCount === 0 && combined.length > 0) {
        setCoverImageIndex(0);
      }
    }
  };

  const handleSetCover = (index: number) => {
    if (index >= 0 && index < localMedia.length) {
      setCoverImageIndex(index);
    }
  };

  const handleRemoveMedia = (idToRemove: string) => {
    const indexToRemove = localMedia.findIndex(item => item.id === idToRemove);
    if (indexToRemove === -1) return;

    const newMedia = localMedia.filter(item => item.id !== idToRemove);
    
    const oldCoverIndex = coverImageIndex;
    let newCoverIndex = -1;
    if (newMedia.length > 0) {
      if (indexToRemove === oldCoverIndex) {
        newCoverIndex = 0;
      } else if (indexToRemove < oldCoverIndex) {
        newCoverIndex = oldCoverIndex - 1;
      } else {
        newCoverIndex = oldCoverIndex;
      }
    }
    setCoverImageIndex(newCoverIndex);
    setLocalMedia(newMedia);
  };

  const handleSave = () => {
    onCapture(localMedia);
  };

  // Permission handling
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
        <Button title="Close" onPress={onClose} outlined style={{marginTop: 10}} />
      </View>
    );
  }

  // Render draggable media item
  const renderDraggableMediaItem = ({ item, drag, isActive }: RenderItemParams<CapturedMediaItem>) => {
    const isCover = localMedia[coverImageIndex]?.id === item.id;
    return (
      <ScaleDecorator>
        <TouchableOpacity
          style={[
            styles.previewImageContainer,
            isActive && styles.previewImageContainerActive,
            isCover && styles.previewImageCover
          ]}
          onPress={() => handleSetCover(localMedia.findIndex(m => m.id === item.id))}
          onLongPress={drag}
          disabled={isActive}
          activeOpacity={0.9}
        >
          <Image source={{ uri: item.uri }} style={styles.previewImage} />
          {item.type === 'video' && (
            <View style={styles.videoIndicatorPreview}>
              <Icon name="play-circle" size={18} color={'white'} />
            </View>
          )}
          <TouchableOpacity style={styles.deleteMediaButton} onPress={() => handleRemoveMedia(item.id)}>
            <Icon name="close-circle" size={20} color="#FF5252" />
          </TouchableOpacity>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  };

  return (
    <View style={styles.cameraStageContainer}>
      <CameraView ref={cameraRef} style={styles.cameraPreview} facing={facing} flash={flash} mode={cameraMode}>
        <View style={styles.cameraHeader}>
          <TouchableOpacity onPress={toggleFlash} style={styles.headerButton} disabled={facing === 'front'}>
            <Icon name={getFlashIcon()} size={24} color={facing === 'front' ? 'grey' : 'white'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleCameraFacing} style={styles.headerButton}>
            <Icon name="camera-switch-outline" size={24} color="white" />
          </TouchableOpacity>
        </View>
      </CameraView>

      {localMedia.length > 0 && (
        <View style={styles.previewListContainer}>
          <DraggableFlatList
            data={localMedia}
            onDragEnd={({ data }) => {
              const oldCoverId = localMedia[coverImageIndex]?.id;
              const newIndex = data.findIndex(item => item.id === oldCoverId);
              setCoverImageIndex(newIndex >= 0 ? newIndex : (data.length > 0 ? 0 : -1));
              setLocalMedia(data);
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
        <TouchableOpacity style={styles.sideControlButton} onPress={pickImagesFromLibrary} disabled={localMedia.length >= 10}>
          <Icon name="image-multiple-outline" size={30} color={localMedia.length >= 10 ? "grey" : "white"} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.captureButton} onPress={cameraMode === "picture" ? takePicture : (recording ? stopRecording : startRecording)} disabled={localMedia.length >= 10}>
          <View style={[styles.captureInner, recording && styles.recordingButton, localMedia.length >= 10 && styles.captureDisabledInner]} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sideControlButton} onPress={toggleCameraMode}>
          <Icon name={cameraMode === "picture" ? "video-outline" : "camera-outline"} size={30} color="white" />
        </TouchableOpacity>
      </View>

      <View style={styles.cameraStageHeader}>
        <Text style={styles.stageTitleCamera}>Add More Media</Text>
        <Text style={styles.stageSubtitleCamera}>
          {localMedia.length}/10 items. {localMedia.length > 0 ? 'Drag to reorder. Tap preview to set cover.' : 'Use camera or upload.'}
        </Text>
      </View>

      <View style={styles.navigationButtonsCamera}>
        <Button title="Cancel" onPress={onClose} outlined style={styles.navButton} />
        <Button
          title="Save"
          onPress={handleSave}
          style={styles.navButton}
        />
      </View>
    </View>
  );
};

// --- Sample Data for Debugging ---
const DEBUG_SAMPLE_FORM_DATA = {
    shopify: {
        title: "DEBUG Sample T-Shirt",
        description: "This is a debug description for a sample Shopify product. 100% Cotton.",
        price: 25.99,
        compareAtPrice: 29.99,
        categorySuggestion: "Apparel & Accessories > Clothing > Shirts & Tops",
        tags: ["debug", "sample", "cotton"],
        weight: 0.2,
        weightUnit: "kg",
        brand: "DebugBrand",
        condition: "New",
        status: "active" as const, // Use 'as const' to help TS infer literal type
        vendor: "DebugBrand",
        productType: "T-Shirt"
      },
    amazon: {
        title: "DEBUG Brand Sample Cotton T-Shirt (Amazon)",
        description: "Debug description for Amazon. High quality sample.",
        price: 24.99,
        compareAtPrice: undefined, // FIXED: Changed null to undefined
        categorySuggestion: "Clothing, Shoes & Jewelry > Men > Clothing > Shirts > T-Shirts",
        weight: 0.2,
        weightUnit: "kg",
        brand: "DebugBrand",
        condition: "New",
        bullet_points: ["100% Sample Cotton", "Debug Feature 1", "Debug Feature 2"],
        search_terms: ["debug tee", "sample t-shirt", "cotton shirt"],
        amazonProductType: "SHIRT",
        productIdType: undefined // Also ensure this matches (undefined is fine if optional)
      }
};
// --- End Sample Data ---

// --- NEW Interfaces for Shopify Integration ---
interface ShopifyLocation {
  id: string;
  name: string;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  country: string;
  zip: string;
  phone: string | null;
  provinceCode: string;
  countryCode: string;
  countryName: string;
  legacy: boolean;
  active: boolean;
  adminGraphqlApiId: string;
  localizedCountryName: string;
  localizedProvinceName: string;
}

interface ShopifyLocationWithQuantity extends ShopifyLocation {
  quantity: number;
}

interface ShopifyPublishResponse {
  success: boolean;
  productId: string;
  operationId: string;
}
// --- End NEW Interfaces ---

// Add new interfaces for Shopify schema
interface ShopifyOption {
  name: string;
  values: { name: string }[];
}

interface ShopifyInventoryItem {
  cost?: number;
  tracked: boolean;
  measurement?: {
    weight?: {
      value: number;
      unit: 'POUNDS' | 'KILOGRAMS' | 'GRAMS' | 'OUNCES';
    };
  };
}

interface ShopifyInventoryQuantity {
  locationId: string;
  name: string;
  quantity: number;
}

interface ShopifyVariant {
  optionValues: { optionName: string; name: string }[];
  price: string;
  sku: string;
  inventoryItem: ShopifyInventoryItem;
  inventoryQuantities: ShopifyInventoryQuantity[];
  taxable?: boolean;
  barcode?: string;
  file?: {
    originalSource: string;
    alt: string;
    filename: string;
    contentType: string;
  };
}

interface ShopifyProductInput {
  title: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  tags?: string[];
  productOptions?: ShopifyOption[];
  files?: {
    originalSource: string;
    alt: string;
    filename: string;
    contentType: string;
  }[];
  variants: ShopifyVariant[];
}

// Add to the interface for route params
interface AddListingScreenProps {
  route: {
    params?: {
      initialData?: {
        title: string;
        description: string;
        price: number;
        sku: string;
        barcode: string;
        images: string[];
        platformDetails: any;
        status: 'draft' | 'active' | 'archived';
        initialStage?: ListingStage; // Add this
        productId?: string; // Add this
        variantId?: string; // Add this
        uploadedImageUrls?: string[]; // Add this
      };
    };
  };
}

// --- Main Component --- //
const AddListingScreen: React.FC<AddListingScreenProps> = ({ route }) => {
  console.log("[AddListingScreen] Component Mounted");
  const theme = useTheme();
  const [currentStage, setCurrentStage] = useState<ListingStage>(ListingStage.PlatformSelection);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [capturedMedia, setCapturedMedia] = useState<CapturedMediaItem[]>([]);
  const [coverImageIndex, setCoverImageIndex] = useState<number>(-1);
  const [showCameraSection, setShowCameraSection] = useState(false);
  const [analysisResponse, setAnalysisResponse] = useState<BackendAnalysisResponse | null>(null);
  const [generationResponse, setGenerationResponse] = useState<GenerateDetailsResponse['generatedDetails'] | null>(null); // Store only the details part
  const [formData, setFormData] = useState<GenerateDetailsResponse['generatedDetails'] | null>(null); // Holds the editable form data based on the new structure
  const [productId, setProductId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [uploadedImageUrls, setUploadedImageUrls] = useState<string[]>([]);
  const [activeFormTab, setActiveFormTab] = useState<string | null>(null);
  const [serpApiResponse, setSerpApiResponse] = useState<SerpApiLensResponse | null>(null);

  // --- NEW State for Visual Match Selection ---
  const [selectedMatchForGeneration, setSelectedMatchForGeneration] = useState<VisualMatch | null>(null);

  // --- State for platformConnectionId ---
  const [platformConnectionId, setPlatformConnectionId] = useState<string | null>(null);

  // --- NEW: State for all platform connections ---
  const [userPlatformConnections, setUserPlatformConnections] = useState<any[]>([]); // Using any[] for now, replace with actual PlatformConnection type

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

  // --- NEW State for Shopify Integration ---
  const [shopifyLocations, setShopifyLocations] = useState<ShopifyLocation[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<ShopifyLocationWithQuantity[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  // --- End NEW State ---

  const IMAGE_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

  // Add navigation
  const navigation = useNavigation();

  // Add useEffect to handle initial data and stage
  useEffect(() => {
    if (route.params?.initialData) {
      const { initialData } = route.params;
      console.log("[AddListingScreen] Received initial data:", JSON.stringify(initialData, null, 2));
      
      // Set initial stage if provided
      if (initialData.initialStage) {
        console.log("[AddListingScreen] Setting initial stage to:", initialData.initialStage);
        setCurrentStage(initialData.initialStage as ListingStage);
      }

      // Set product and variant IDs if provided
      if (initialData.productId) {
        console.log("[AddListingScreen] Setting product ID:", initialData.productId);
        setProductId(initialData.productId);
      }
      if (initialData.variantId) {
        console.log("[AddListingScreen] Setting variant ID:", initialData.variantId);
        setVariantId(initialData.variantId);
      }

      // Set uploaded image URLs if provided
      if (initialData.uploadedImageUrls && initialData.uploadedImageUrls.length > 0) {
        console.log("[AddListingScreen] Setting uploaded image URLs:", initialData.uploadedImageUrls.length);
        setUploadedImageUrls(initialData.uploadedImageUrls);
        
        // Also set captured media from the images
        const mediaItems: CapturedMediaItem[] = initialData.uploadedImageUrls.map((uri, index) => ({
          uri,
          type: 'image',
          number: index + 1,
          id: uri + Date.now() + index,
        }));
        setCapturedMedia(mediaItems);
        setCoverImageIndex(0); // Set first image as cover
      }

      // Initialize form data with at least basic product information
      const basicFormData = {
        shopify: { // Default to shopify as the first platform
          title: initialData.title || '',
          description: initialData.description || '',
          price: initialData.price || 0,
          sku: initialData.sku || '',
          barcode: initialData.barcode || '',
          status: initialData.status || 'draft',
          // Add any other basic fields that should be initialized
        }
      };

      // Merge with any existing platform details
      const mergedFormData = {
        ...basicFormData,
        ...(initialData.platformDetails || {})
      };

      console.log("[AddListingScreen] Setting form data:", JSON.stringify(mergedFormData, null, 2));
      setFormData(mergedFormData);
      
      // Set the first platform as active tab (default to shopify if no platforms in details)
      const firstPlatform = Object.keys(mergedFormData)[0];
      console.log("[AddListingScreen] Setting active tab to:", firstPlatform);
      setActiveFormTab(firstPlatform);
      
      // Set selected platforms based on available data
      const platforms = Object.keys(mergedFormData);
      console.log("[AddListingScreen] Setting selected platforms:", platforms);
      setSelectedPlatforms(platforms);

      // Clear any existing loading states
      setIsLoading(false);
      setLoadingMessage('');
      setError(null);
    } else {
      console.log("[AddListingScreen] No initial data provided in route params");
    }
  }, [route.params?.initialData]);

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

  // --- Camera Functions --- //
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

    // Corrected API URL: Removed userId query parameter
    const analyzeApiUrl = `https://sssync-bknd-production.up.railway.app/api/products/analyze`;
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
                 
                 // --- NEW: Save images to ProductImages table ---
                 if (responseData.variant.Id && uploadedImageUrls.length > 0) {
                   const imagesToInsert = uploadedImageUrls.map((url, index) => ({
                     ProductVariantId: responseData.variant.Id,
                     ImageUrl: url,
                     Position: index,
                     // AltText: null, // Optional: Add logic for AltText if available
                     // PlatformMappingId: null, // Optional: Add logic if needed
                   }));

                   try {
                     const { error: imageInsertError } = await supabase
                       .from('ProductImages')
                       .insert(imagesToInsert);

                     if (imageInsertError) {
                       console.error('[triggerImageAnalysis] Error inserting product images:', imageInsertError);
                       // Non-critical error, so we might not want to throw and stop the flow
                       // Alert.alert("Image Save Error", "Could not save all product images to the database.");
                     } else {
                       console.log('[triggerImageAnalysis] Successfully inserted product images to database.');
                     }
                   } catch (dbError) {
                     console.error('[triggerImageAnalysis] Unexpected error inserting product images:', dbError);
                   }
                 }
                 // --- END NEW ---
                 
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

  // UPDATED triggerDetailsGeneration - Response handling adjusted
  const triggerDetailsGeneration = async () => {
    // ... (Initial checks for productId, variantId, auth etc. remain the same) ...
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

    // ... (Get User ID and Auth Token - same as before) ...
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

    // ... (Clean selected match - same as before) ...
     let cleanedSelectedMatch: Partial<VisualMatch> | null = null;
     if (selectedMatchForGeneration) {
         cleanedSelectedMatch = {
             position: selectedMatchForGeneration.position,
             title: selectedMatchForGeneration.title,
             link: selectedMatchForGeneration.link,
             source: selectedMatchForGeneration.source,
         };
         console.log("Cleaned selected match for API:", cleanedSelectedMatch);
     }

    // ... (Prepare Request Body - same as before) ...
     const generateApiUrl = `https://sssync-bknd-production.up.railway.app/api/products/generate-details`;
     const requestBodyGenerate = {
         productId: productId,
         variantId: variantId,
         imageUris: uploadedImageUrls,
         coverImageIndex: coverImageIndexForApi,
         selectedPlatforms: selectedPlatforms,
         selectedMatch: cleanedSelectedMatch
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

      // ... (Response parsing - same as before, but expect new structure inside responseData) ...
      let responseData: any;
      try {
          if (response.status === 204) { responseData = null; }
          else if (response.headers.get('content-type')?.includes('application/json')) { responseData = await response.json(); }
          else {
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
          // ... (Error handling - same as before) ...
           console.error("Generation API Error Response Body:", responseData);
           let msg = `HTTP error! status: ${response.status}`;
           if (responseData?.message && typeof responseData.message === 'string') { msg = responseData.message; }
           // ... other status code checks ...
           throw new Error(msg);
      }

      if (!responseData) {
          // Keep this check for null/empty responses after successful status
          throw new Error("Received no details from generation API.");
      }

       // --- Validation Logic ---
       // Backend now directly returns the details object { platform: GeneratedPlatformSpecificDetails }
       // FIXED: Access the nested generatedDetails object from the response
       const generatedData = responseData?.generatedDetails as GenerateDetailsResponse['generatedDetails'];
       console.log("Generation Response (Details Map):", JSON.stringify(generatedData, null, 2));

       // Check if generatedDetails is an object (can be empty {} which is valid)
       if (typeof generatedData !== 'object' || generatedData === null) {
           // Add check for the outer key as well
           console.error("Invalid response structure from generation API (expected { generatedDetails: { ... } } ). Raw response:", responseData);
           throw new Error("Invalid response structure from generation API.");
       }

       // Basic validation: Check if all requested platforms have a key
       let allPlatformsPresent = true;
       for (const platform of selectedPlatforms) {
           const platformKey = platform.toLowerCase(); // Ensure lowercase comparison
           if (!generatedData[platformKey]) {
               console.warn(`Generation response missing expected top-level key for platform: ${platformKey}`);
               allPlatformsPresent = false;
               // Optionally create an empty object for robustness downstream
               generatedData[platformKey] = {};
           }
       }
       // --- End Validation Logic ---

      // Update state with the received details map
      setGenerationResponse(generatedData); // Set the map directly
      setFormData(generatedData); // Initialize form data with the received map
      // FIXED: Set active tab based on the actual keys received
      const firstReceivedPlatformKey = Object.keys(generatedData)[0];
      setActiveFormTab(firstReceivedPlatformKey || null); // Ensure tab key matches received data
      console.log(`[triggerDetailsGeneration] Successfully processed response. Setting active tab to: ${firstReceivedPlatformKey}. Setting stage to FormReview.`);
      setCurrentStage(ListingStage.FormReview);
      setError(null);

    } catch (err: any) {
        console.error("[triggerDetailsGeneration] Details generation failed:", err);
        setError(`Generation Failed: ${err.message || 'Unknown error'}`);
        console.log("[triggerDetailsGeneration] Error occurred. Setting stage back to VisualMatch.");
        setCurrentStage(ListingStage.VisualMatch); // Fallback to VisualMatch
    } finally {
         setIsLoading(false);
         setLoadingMessage('');
     }
  };


  // UPDATED handleFormUpdate to handle new structure and types
  const handleFormUpdate = (platform: string, field: keyof GeneratedPlatformDetails, value: any) => {
      setFormData(prevData => {
          if (!prevData) return null;
          const platformData = prevData[platform] || {};
          let updatedValue = value;

          // --- Handle Specific Field Types ---
          // Numeric fields
          if (field === 'price' || field === 'compareAtPrice' || field === 'weight') {
              const numValue = parseFloat(value);
              updatedValue = isNaN(numValue) ? undefined : numValue;
          }
          // Array fields (from comma-separated string input)
          else if (field === 'tags' || field === 'bullet_points' || field === 'search_terms') {
              if (typeof value === 'string') {
                  // Split by comma, trim whitespace, filter empty strings
                  updatedValue = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
              } else {
                  updatedValue = Array.isArray(value) ? value : []; // Keep as array if already is, else empty array
              }
          }
          // Object field (itemSpecifics) - Handle as JSON string for now
          else if (field === 'itemSpecifics') {
              if (typeof value === 'string') {
                   try {
                        // Try to parse to ensure it's valid JSON, but store the string
                        JSON.parse(value);
                        updatedValue = value; // Store the string if it's valid JSON
                    } catch (e) {
                        // If invalid JSON string, maybe keep the invalid string or clear it?
                        // Keeping the string allows user to fix it.
                         updatedValue = value;
                         console.warn("Invalid JSON entered for itemSpecifics:", value);
                   }
              } else if (typeof value === 'object' && value !== null) {
                    updatedValue = JSON.stringify(value, null, 2); // Convert object back to string for input display
              } else {
                  updatedValue = '{}'; // Default to empty object string if invalid type
              }
          }
          // --- End Handle Specific Field Types ---

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

  // --- NEW Function to Fetch Shopify Locations ---
  const fetchShopifyLocations = async () => {
    if (!platformConnectionId) {
      console.error("[fetchShopifyLocations] No platform connection ID available");
      return;
    }

    setIsLoadingLocations(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (userError || !user || sessionError || !sessionData?.session?.access_token) {
        throw new Error("Authentication error. Please log out and back in.");
      }

      const token = sessionData.session.access_token;
      const response = await fetch(
        `https://sssync-bknd-production.up.railway.app/products/shopify/locations?platformConnectionId=${platformConnectionId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setShopifyLocations(data.locations || []);
      
      // Initialize selected locations with quantity 0
      setSelectedLocations((data.locations || []).map((loc: ShopifyLocation) => ({ ...loc, quantity: 0 })));
    } catch (err: any) {
      console.error("[fetchShopifyLocations] Error:", err);
      Alert.alert("Error", `Failed to fetch Shopify locations: ${err.message}`);
    } finally {
      setIsLoadingLocations(false);
    }
  };

  // --- NEW Function to Update Location Quantity ---
  const updateLocationQuantity = (locationId: string, quantity: number) => {
    setSelectedLocations(prev => 
      prev.map((loc: ShopifyLocationWithQuantity) => 
        loc.id === locationId 
          ? { ...loc, quantity: Math.max(0, quantity) } // Ensure non-negative
          : loc
      )
    );
  };

  // --- UPDATED handlePublish to Fetch Locations ---
  const handlePublish = async () => {
    if (selectedPlatforms.includes('shopify')) {
      // --- NEW: Fetch connections and find Shopify connection ID ---
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        const session = await supabase.auth.getSession();
        const token = session?.data.session?.access_token;

        if (userError || !user || !token) {
          Alert.alert("Authentication Error", "Could not fetch connections. Please ensure you are logged in.");
          return;
        }

        console.log("[handlePublish] Fetching platform connections for user:", user.id);
        const response = await fetch('https://api.sssync.app/platform-connections', { // Ensure this is your correct API endpoint
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
          throw new Error(errorData.message || `Failed to fetch connections. Status: ${response.status}`);
        }

        const connections: any[] = await response.json(); // Use your PlatformConnection type here
        setUserPlatformConnections(connections); // Store all connections if needed elsewhere

        const shopifyConnection = connections.find(
          (conn: any) => conn.PlatformType === 'shopify' && conn.IsEnabled // Assuming these fields exist
        );

        if (shopifyConnection && shopifyConnection.Id) {
          console.log("[handlePublish] Found Shopify connection ID:", shopifyConnection.Id);
          setPlatformConnectionId(shopifyConnection.Id);
          // Now that platformConnectionId is set, call fetchShopifyLocations
          // await fetchShopifyLocations(); // This will be called after platformConnectionId is set and modal opens
        } else {
          Alert.alert("Shopify Not Connected", "No active Shopify connection found. Please connect Shopify in your profile to publish.");
          return; // Stop if no Shopify connection
        }
      } catch (err: any) {
        console.error("[handlePublish] Error fetching or finding Shopify connection:", err);
        Alert.alert("Connection Error", `Could not prepare for Shopify publishing: ${err.message}`);
        return;
      }
      // --- END NEW ---

      // Original logic to fetch locations will now use the fetched platformConnectionId
      // We need to ensure fetchShopifyLocations is called *after* platformConnectionId is set.
      // One way is to await the setPlatformConnectionId, but state updates can be tricky.
      // A better approach might be to trigger fetchShopifyLocations if platformConnectionId becomes available and modal is about to be shown.
      // For now, let's assume fetchShopifyLocations in the modal opening logic will pick up the new ID.
      // OR, we can call it directly here IF setPlatformConnectionId was synchronous (which it isn't always)
      // The most robust way is to call fetchShopifyLocations from a useEffect that watches platformConnectionId,
      // or directly if we pass the found ID to it.

      // Let's try calling it directly here for now, but be mindful of state update timing.
      // This relies on setPlatformConnectionId having an effect before fetchShopifyLocations uses it.
      // This might require fetchShopifyLocations to accept an ID as a parameter.
      // For simplicity now, we set the state and fetchShopifyLocations will use the state.
      // The fetchShopifyLocations function already checks if platformConnectionId is available.
      
      // We will call fetchShopifyLocations when the modal becomes visible and platformConnectionId is set.
    }
    setIsPublishModalVisible(true); // Show modal, locations will load if Shopify is selected and ID is found
  };

  // --- useEffect to fetch locations when publish modal becomes visible and shopify is selected ---
  useEffect(() => {
    if (isPublishModalVisible && selectedPlatforms.includes('shopify') && platformConnectionId) {
      fetchShopifyLocations();
    }
  }, [isPublishModalVisible, platformConnectionId, selectedPlatforms]);
  

  // --- UPDATED handlePublishAction with Actual API Call ---
  const handlePublishAction = async (status: 'draft' | 'active' | 'archived') => {
    setCurrentStage(ListingStage.Publishing);
    setIsLoading(true);
    setLoadingMessage(`Publishing as ${status}...`);

    try {
      // Get auth token
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (userError || !user || sessionError || !sessionData?.session?.access_token) {
        throw new Error("Authentication error. Please log out and back in.");
      }

      const token = sessionData.session.access_token;

      // Handle Shopify publish if selected
      if (selectedPlatforms.includes('shopify') && productId && platformConnectionId) {
        // Validate locations
        const locations = selectedLocations
          .filter(loc => loc.quantity > 0)
          .map(loc => ({
            locationId: loc.id,
            quantity: loc.quantity
          }));

        if (locations.length === 0) {
          throw new Error("Please set inventory quantity for at least one location");
        }

        // Get Shopify-specific data from form
        const shopifyData = formData?.shopify || {};
        
        // Make the API call
        const response = await fetch(
          `https://sssync-bknd-production.up.railway.app/products/${productId}/publish/shopify`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              platformConnectionId,
              locations,
              options: {
                status: status.toUpperCase(),
                vendor: shopifyData.vendor || undefined,
                productType: shopifyData.productType || undefined,
                tags: Array.isArray(shopifyData.tags) ? shopifyData.tags : []
              }
            })
          }
        );

        // Handle response
        if (!response.ok) {
          const errorData = await response.json();
          if (response.status === 403) {
            throw new Error("Shopify publishing is not enabled for your subscription");
          } else if (response.status === 400) {
            throw new Error(errorData.message || "Invalid request data");
          } else {
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
          }
        }

        const publishResponse: ShopifyPublishResponse = await response.json();
        if (!publishResponse.success) {
          throw new Error("Publish operation failed");
        }

        Alert.alert(
          "Success", 
          `Product published to Shopify as ${status}.\nOperation ID: ${publishResponse.operationId}`
        );

        // Reset state and navigate back
        setCurrentStage(ListingStage.PlatformSelection);
        setSelectedPlatforms([]);
        setFormData(null);
        setCapturedMedia([]);
        setCoverImageIndex(-1);
        setProductId(null);
        setVariantId(null);
      } else {
        // Handle other platforms or fallback
        console.log(`Publishing as ${status} for other platforms...`);
        Alert.alert("Not Implemented", "Publishing to other platforms is not implemented yet.");
      }
    } catch (err: any) {
      console.error("[handlePublishAction] Error:", err);
      Alert.alert("Publish Error", err.message);
      setCurrentStage(ListingStage.FormReview);
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
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
      // Restore original loading component
      return (
          <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={'#294500'} />
              <Text style={styles.loadingText}>{message}</Text>
          </View>
      );
  };

  // --- Temporary Debug Skip Function ---
  const debugSkipToFormReview = () => {
    console.log("[DEBUG] Skipping to Form Review with sample data...");
    // FIXED: Explicitly cast sample data to the expected type
    // NOTE: Casting might hide other subtle type issues, but needed here for state setter.
    setFormData(DEBUG_SAMPLE_FORM_DATA as unknown as GenerateDetailsResponse['generatedDetails']);
    // Set platforms that exist in sample data
    setSelectedPlatforms(Object.keys(DEBUG_SAMPLE_FORM_DATA));
    setActiveFormTab('shopify'); // Set initial tab to shopify from sample
    setCurrentStage(ListingStage.FormReview);
    setIsLoading(false); // Ensure loading is off
    setError(null); // Clear any previous errors
  };
  // --- End Debug Skip Function ---

  // --- Main Stage Render Functions ---
  const renderPlatformSelection = () => {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Select Platform</Text>
          <TouchableOpacity 
            style={styles.pastScansButton}
            onPress={() => {
              // @ts-ignore - Navigation type will be fixed when navigation types are properly set up
              navigation.navigate('PastScans');
            }}
          >
            <Icon name="history" size={24} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>
        
        <Animated.View style={styles.stageContainer} entering={FadeIn}>
          <Text style={styles.stageTitle}>Select Platforms</Text>
          <Text style={styles.stageSubtitle}>Choose where you want to list this product.</Text>
          <View style={styles.platformGrid}>
            {AVAILABLE_PLATFORMS.map((platform) => {
              const isSelected = selectedPlatforms.includes(platform.key);
              const imageSource = platformImageMap[platform.key];
              return (
                <TouchableOpacity
                  key={platform.key}
                  style={[styles.platformCard, isSelected && styles.platformCardSelected]}
                  onPress={() => togglePlatformSelection(platform.key)}
                  activeOpacity={0.7}
                >
                  {imageSource ? (
                    <Image
                      source={imageSource}
                      style={[styles.platformImage, !isSelected && styles.platformImageDeselected]}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={styles.platformIconPlaceholder} />
                  )}
                  <Text style={[styles.platformName, isSelected && styles.platformNameSelected]}>
                    {platform.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Button 
            title={`Next: Add Media (${selectedPlatforms.length})`} 
            onPress={handlePlatformsSelected} 
            style={styles.bottomButton} 
            disabled={selectedPlatforms.length === 0}
          />
        </Animated.View>
      </View>
    );
  };

  const renderImageInput = () => {
       // Restore original ImageInput rendering logic (Camera Integrated)
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
            <TouchableOpacity style={styles.sideControlButton} onPress={pickImagesFromLibrary} disabled={capturedMedia.length >= 10}>
              <Icon name="image-multiple-outline" size={30} color={capturedMedia.length >= 10 ? "grey" : "white"} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.captureButton} onPress={cameraMode === "picture" ? takePicture : (recording ? stopRecording : startRecording)} disabled={capturedMedia.length >= 10}>
              <View style={[ styles.captureInner, recording && styles.recordingButton, capturedMedia.length >= 10 && styles.captureDisabledInner]} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.sideControlButton} onPress={() => Alert.alert("Barcode Scanner", "Not implemented yet.")}>
              <Icon name="barcode-scan" size={30} color="white" />
                          </TouchableOpacity>
                </View>
                
          <View style={styles.cameraStageHeader}>
            <Text style={styles.stageTitleCamera}>Add Product Media</Text>
            <Text style={styles.stageSubtitleCamera}>
              {capturedMedia.length}/10 items. {capturedMedia.length > 0 ? 'Drag to reorder. Tap preview to set cover.' : 'Use camera or upload.'}
                          </Text>
                </View>
                
          <View style={styles.navigationButtonsCamera}>
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

  const renderVisualMatch = () => {
      // Restore original VisualMatch rendering logic
      console.log("[AddListingScreen] Rendering Visual Match Stage");

      let visualMatches: VisualMatch[] = [];
      let parseError: string | null = null; // Keep for potential explicit parse error message

      if (serpApiResponse && Array.isArray(serpApiResponse.visual_matches)) {
          visualMatches = serpApiResponse.visual_matches;
      } else if (analysisResponse && analysisResponse.analysis && typeof analysisResponse.analysis.GeneratedText === 'string' && analysisResponse.analysis.GeneratedText !== '{}') {
          console.warn("[renderVisualMatch] serpApiResponse state is not set or invalid, but analysisResponse seems to have text.");
      }

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

      if (parseError) { /* ... Optional Explicit Error UI ... */ }

      const hasMatches = visualMatches.length > 0;

      const renderMatchItem = ({ item }: { item: VisualMatch }) => {
          const isSelected = selectedMatchForGeneration?.position === item.position;
          return (
                <TouchableOpacity 
                  style={[styles.matchGridItem, isSelected && styles.matchCardSelected]}
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

               {hasMatches ? (
                   <FlatList
                      data={visualMatches}
                      renderItem={renderMatchItem}
                      keyExtractor={(item) => `${item.position}-${item.link}`}
                      numColumns={2}
                      style={styles.visualMatchGrid}
                      contentContainerStyle={styles.visualMatchGridContainer}
                      ListEmptyComponent={ (
                          <View style={styles.centeredInfoContainer}>
                              <Icon name="image-search-outline" size={60} color="#ccc" />
                              <Text style={styles.noMatchText}>No similar items found.</Text>
                          </View>
                      )}
                   />
               ) : (
                    <View style={styles.centeredInfoContainer}>
                        <Icon name="image-search-outline" size={60} color="#ccc" />
                        <Text style={styles.noMatchText}>No similar items found.</Text>
                  </View>
               )}

               <View style={styles.navigationButtons}>
                   <Button
                        title="Back to Media"
                        onPress={() => setCurrentStage(ListingStage.ImageInput)}
                        outlined
                        style={styles.navButton}
                   />

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

  // --- UPDATED renderFormReview --- (Keep updated version)
  const renderFormReview = () => {
    console.log(`[renderFormReview] Starting render with active tab: ${activeFormTab}`);
    console.log("[renderFormReview] Current form data:", JSON.stringify(formData, null, 2));
    console.log("[renderFormReview] Selected platforms:", selectedPlatforms);
    console.log("[renderFormReview] Route params:", JSON.stringify(route.params, null, 2));

    const currentPlatformKey = activeFormTab?.toLowerCase();

    // Only show loading if we're actually waiting for data
    if (!formData || !currentPlatformKey || !formData[currentPlatformKey]) {
      console.warn("[renderFormReview] Missing form data:", {
        hasFormData: !!formData,
        currentPlatformKey,
        hasPlatformData: currentPlatformKey ? !!formData?.[currentPlatformKey] : false,
        initialData: route.params?.initialData
      });

      // If we have initial data but no form data, something went wrong
      if (route.params?.initialData?.platformDetails) {
        console.error("[renderFormReview] Form data not set despite having initial data. Initial data:", 
          JSON.stringify(route.params.initialData.platformDetails, null, 2));
        setError("Failed to load product data. Please try again.");
        return (
          <View style={styles.errorContainer}>
            <Icon name="alert-circle-outline" size={40} color="#D8000C" />
            <Text style={styles.errorText}>{error || "Failed to load product data"}</Text>
            <Button 
              title="Back to Past Scans" 
              onPress={() => navigation.goBack()} 
              style={styles.retryButton}
            />
          </View>
        );
      }

      return (
        <Animated.View style={styles.stageContainer} entering={FadeIn}>
          <Text style={styles.stageTitle}>Loading Details...</Text>
          <ActivityIndicator size="small" color="#666" />
          <View style={styles.navigationButtons}>
            <Button 
              title="Back to Past Scans" 
              onPress={() => navigation.goBack()} 
              outlined 
              style={styles.navButton}
            />
          </View>
        </Animated.View>
      );
    }

    const currentPlatformData = formData[currentPlatformKey] || {};

    // Add after the fetchShopifyLocations function
    const handleLocationToggle = (location: ShopifyLocation) => {
      setSelectedLocations(prev => {
        const isSelected = prev.some(l => l.id === location.id);
        if (isSelected) {
          return prev.filter(l => l.id !== location.id);
        } else {
          return [...prev, { ...location, quantity: 0 }];
        }
      });
    };

    const handleLocationQuantityChange = (locationId: string, quantity: string) => {
      setSelectedLocations(prev => 
        prev.map(loc => 
          loc.id === locationId 
            ? { ...loc, quantity: parseInt(quantity) || 0 }
            : loc
        )
      );
    };

    const renderLocationsSection = () => {
      if (currentPlatformKey !== 'shopify') return null;

      // Removed nested fetchShopifyLocations.
      // This section now relies on the main fetchShopifyLocations function (called by handlePublish)
      // and the state variables: shopifyLocations, isLoadingLocations, selectedLocations.

      console.log("[renderLocationsSection] Rendering locations section");
      console.log("[renderLocationsSection] Current platform key:", currentPlatformKey);
      console.log("[renderLocationsSection] Shopify locations from state:", shopifyLocations);
      console.log("[renderLocationsSection] Selected locations from state:", selectedLocations);
      console.log("[renderLocationsSection] Is loading locations:", isLoadingLocations);


      return (
        <View style={styles.formSection}>
          <Text style={styles.sectionTitle}>Inventory Locations</Text>
          {isLoadingLocations ? (
            <ActivityIndicator size="small" color="#666" style={{ marginVertical: 10 }} />
          ) : shopifyLocations.length === 0 ? (
            <Text style={styles.noLocationsText}>No locations available for the selected connection.</Text>
          ) : (
            <View style={styles.locationsDropdown}>
              {shopifyLocations.map((location: ShopifyLocation) => {
                const isSelected = selectedLocations.some(l => l.id === location.id);
                const selectedLocation = selectedLocations.find(l => l.id === location.id) as ShopifyLocationWithQuantity | undefined;
                
                return (
                  <View key={location.id} style={styles.locationItem}>
                    <View style={styles.locationHeader}>
                      <Checkbox
                        status={isSelected ? 'checked' : 'unchecked'}
                        onPress={() => handleLocationToggle(location)}
                        color="#4CAF50"
                      />
                      <View style={styles.locationInfo}>
                        <Text style={styles.locationName}>{location.name}</Text>
                        <Text style={styles.locationAddress}>
                          {[location.address1, location.city, location.province, location.zip].filter(Boolean).join(', ')}
                        </Text>
                      </View>
                    </View>
                    {isSelected && selectedLocation && (
                      <View style={styles.quantityInputContainer}>
                        <Text style={styles.quantityLabel}>Quantity:</Text>
                        <TextInput
                          style={styles.quantityInput}
                          keyboardType="numeric"
                          value={selectedLocation.quantity.toString()}
                          onChangeText={(value) => handleLocationQuantityChange(location.id, value)}
                          placeholder="0"
                        />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      );
    };

    return (
      <View style={styles.formReviewContainer}>
        {/* Media Preview Section */}
        <View style={styles.mediaPreviewContainer}>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false} 
            contentContainerStyle={styles.mediaPreviewScrollContent}
          >
            {uploadedImageUrls.map((uri, index) => (
              <TouchableOpacity 
                key={uri} 
                style={[styles.mediaPreviewItem, coverImageIndex === index && styles.mediaPreviewItemCover]}
                onPress={() => handleSetCover(index)}
                activeOpacity={0.8}
              >
                <Image source={{ uri }} style={styles.mediaPreviewImage} />
                {coverImageIndex === index && (
                  <View style={styles.coverBadge}>
                    <Icon name="star" size={12} color="white" />
                  </View>
                )}
              </TouchableOpacity>
            ))}
            {uploadedImageUrls.length < 10 && (
              <TouchableOpacity 
                style={styles.addMediaButton}
                onPress={() => {
                  Alert.alert(
                    "Add Media",
                    "Choose how to add media",
                    [
                      { text: "Camera", onPress: () => setShowCameraSection(true) },
                      { text: "Library", onPress: pickImagesFromLibrary },
                      { text: "Cancel", style: "cancel" }
                    ]
                  );
                }}
              >
                <Icon name="plus" size={24} color="#666" />
              </TouchableOpacity>
            )}
          </ScrollView>
          <Text style={styles.mediaHint}>Tap to set cover image</Text>
        </View>

        {/* Platform Selection Tabs */}
        <View style={styles.platformTabsContainer}>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.platformTabsScroll}
          >
            {selectedPlatforms.map(platformKey => (
              <TouchableOpacity
                key={platformKey}
                style={[styles.platformTab, activeFormTab === platformKey && styles.platformTabActive]}
                onPress={() => setActiveFormTab(platformKey)}
              >
                <Image 
                  source={platformImageMap[platformKey]} 
                  style={styles.platformTabIcon} 
                />
                <Text style={[styles.platformTabText, activeFormTab === platformKey && styles.platformTabTextActive]}>
                  {AVAILABLE_PLATFORMS.find(p => p.key === platformKey)?.name || platformKey}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.addPlatformButton}
              onPress={() => setCurrentStage(ListingStage.PlatformSelection)}
            >
              <Icon name="plus" size={20} color="#666" />
              <Text style={styles.addPlatformText}>Add Platform</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Form Content */}
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.formKeyboardAvoid}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
        >
          <ScrollView 
            style={styles.formScrollView}
            contentContainerStyle={styles.formScrollContent}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.formFieldsContainer}>
              {/* Add locations field first - This remains if needed for Shopify */}
              {currentPlatformKey === 'shopify' && renderLocationsSection()}
              
              {/* --- NEW: Explicit Form Fields --- */}
              {currentPlatformData && (
                <>
                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Title</Text>
                    <TextInput
                      style={styles.formInput}
                      value={String(currentPlatformData.title || '')}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'title', text)}
                      placeholder="Enter product title"
                    />
                  </View>

                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Description</Text>
                    <TextInput
                      style={styles.formInputMultiline}
                      value={String(currentPlatformData.description || '')}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'description', text)}
                      multiline
                      numberOfLines={4}
                      placeholder="Enter product description"
                    />
                  </View>

                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Price</Text>
                    <TextInput
                      style={styles.formInput}
                      value={String(currentPlatformData.price === undefined ? '' : currentPlatformData.price)}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'price', text)}
                      placeholder="0.00"
                      keyboardType="numeric"
                    />
                  </View>

                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Compare At Price</Text>
                    <TextInput
                      style={styles.formInput}
                      value={String(currentPlatformData.compareAtPrice === undefined ? '' : currentPlatformData.compareAtPrice)}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'compareAtPrice', text)}
                      placeholder="0.00"
                      keyboardType="numeric"
                    />
                  </View>

                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>SKU (Stock Keeping Unit)</Text>
                    <TextInput
                      style={styles.formInput}
                      value={String(currentPlatformData.sku || '')}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'sku', text)}
                      placeholder="Enter SKU"
                    />
                  </View>

                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Barcode (GTIN, UPC, EAN, ISBN)</Text>
                    <TextInput
                      style={styles.formInput}
                      value={String(currentPlatformData.barcode || '')}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'barcode', text)}
                      placeholder="Enter barcode"
                    />
                  </View>
                  
                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Status</Text>
                    {/* TODO: Consider a Picker/Switch for status: active, draft, archived */}
                    <TextInput
                      style={styles.formInput}
                      value={String(currentPlatformData.status || '')}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'status', text)}
                      placeholder="e.g., active, draft"
                    />
                  </View>

                  {currentPlatformKey === 'shopify' && (
                    <>
                      <View style={styles.formField}>
                        <Text style={styles.formLabel}>Vendor (Shopify)</Text>
                        <TextInput
                          style={styles.formInput}
                          value={String(currentPlatformData.vendor || '')}
                          onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'vendor', text)}
                          placeholder="Enter vendor"
                        />
                      </View>

                      <View style={styles.formField}>
                        <Text style={styles.formLabel}>Product Type (Shopify)</Text>
                        <TextInput
                          style={styles.formInput}
                          value={String(currentPlatformData.productType || '')}
                          onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'productType', text)}
                          placeholder="Enter product type"
                        />
                      </View>

                      <View style={styles.formField}>
                        <Text style={styles.formLabel}>Tags (Shopify, comma-separated)</Text>
                        <TextInput
                          style={styles.formInput}
                          value={Array.isArray(currentPlatformData.tags) ? currentPlatformData.tags.join(', ') : String(currentPlatformData.tags || '')}
                          onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'tags', text)}
                          placeholder="e.g., vintage, cotton, summer"
                        />
                      </View>
                    </>
                  )}

                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Category Suggestion</Text>
                    <TextInput
                      style={styles.formInput}
                      value={String(currentPlatformData.categorySuggestion || '')}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'categorySuggestion', text)}
                      placeholder="e.g., Electronics > TV"
                    />
                  </View>

                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Brand</Text>
                    <TextInput
                      style={styles.formInput}
                      value={String(currentPlatformData.brand || '')}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'brand', text)}
                      placeholder="Enter brand name"
                    />
                  </View>

                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Condition</Text>
                     {/* TODO: Consider a Picker for condition */}
                    <TextInput
                      style={styles.formInput}
                      value={String(currentPlatformData.condition || '')}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'condition', text)}
                      placeholder="e.g., New, Used - Like New"
                    />
                  </View>

                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Weight</Text>
                    <TextInput
                      style={styles.formInput}
                      value={String(currentPlatformData.weight === undefined ? '' : currentPlatformData.weight)}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'weight', text)}
                      placeholder="e.g., 0.5"
                      keyboardType="numeric"
                    />
                  </View>

                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Weight Unit</Text>
                     {/* TODO: Consider a Picker for weightUnit: kg, lb, oz, g */}
                    <TextInput
                      style={styles.formInput}
                      value={String(currentPlatformData.weightUnit || '')}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'weightUnit', text)}
                      placeholder="e.g., kg, lb, oz, g"
                    />
                  </View>
                </>
              )}
              {/* --- END NEW: Explicit Form Fields --- */}

              {/* Fallback for any other fields, or remove if all fields are explicit now */}
              {/* 
              {Object.entries(currentPlatformData).map(([field, value]) => (
                // This old loop might render fields already explicitly handled above
                // Or it might render fields not yet explicitly handled, review carefully.
                // Consider removing if all desired fields are now explicitly laid out.
                <View key={field} style={styles.formField}>
                  <Text style={styles.formLabel}>
                    {field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                  </Text>
                  
                  {field.toLowerCase().includes('quantity') ? (
                    // ... quantity input ... (already handled by locations section if this refers to inventory quantity)
                  ) : field === 'description' || field === 'returnPolicy' ? (
                    <TextInput
                      style={styles.formInputMultiline}
                      value={String(value || '')}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, field as keyof GeneratedPlatformDetails, text)}
                      multiline
                      numberOfLines={4}
                      placeholder={`Enter ${field.replace(/_/g, ' ')}`}
                    />
                  ) : typeof value === 'boolean' ? (
                    <Switch
                      value={value}
                      onValueChange={(newValue) => handleFormUpdate(currentPlatformKey!, field as keyof GeneratedPlatformDetails, newValue)}
                      trackColor={{ false: "#767577", true: "#81b0ff" }}
                      thumbColor={value ? "#4CAF50" : "#f4f3f4"}
                    />
                  ) : Array.isArray(value) ? (
                    <TextInput
                      style={styles.formInput}
                      value={value.join(', ')}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, field as keyof GeneratedPlatformDetails, text)}
                      placeholder={`Enter ${field.replace(/_/g, ' ')} (comma-separated)`}
                    />
                  ) : (
                    <TextInput
                      style={styles.formInput}
                      value={String(value || '')}
                      onChangeText={(text) => handleFormUpdate(currentPlatformKey!, field as keyof GeneratedPlatformDetails, text)}
                      placeholder={`Enter ${field.replace(/_/g, ' ')}`}
                    />
                  )}
                </View>
              ))}
              */}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  };

  // --- Current Stage Logic (Unchanged) --- //
  const renderCurrentStage = () => {
    console.log(`[renderCurrentStage] Rendering stage: ${currentStage}`);

    if (error) return (<View style={styles.errorContainer}><Icon name="alert-circle-outline" size={40} color="#D8000C" /><Text style={styles.errorText}>{error}</Text><Button title="Try Again" onPress={() => { setError(null); setCurrentStage(ListingStage.ImageInput); }} /></View>);

    // Handle Loading states explicitly
    if (isLoading) {
        // Use the restored renderLoading function
        if (currentStage === ListingStage.Analyzing) return renderLoading('Analyzing Media...');
        if (currentStage === ListingStage.Generating) return renderLoading('Generating Details...');
        if (currentStage === ListingStage.Publishing) return renderLoading('Publishing...');
        return renderLoading(loadingMessage || 'Loading...');
    }

    // Restore original switch statement
    switch (currentStage) {
        case ListingStage.PlatformSelection: return renderPlatformSelection();
        case ListingStage.ImageInput: return renderImageInput();
        case ListingStage.VisualMatch: return renderVisualMatch();
        case ListingStage.FormReview: return renderFormReview(); // Still points to the simplified debug version
        // Analyzing, Generating, Publishing are handled by the isLoading check above
        default:
            console.warn("[renderCurrentStage] Unhandled stage:", currentStage);
            return <Text>Unknown Stage: {currentStage}</Text>;
    }
  };

  // --- Camera Section Show Logic (Unchanged - Render CameraSection if showCameraSection is true) --- //
  if (showCameraSection) {
       console.log("[AddListingScreen] Rendering CameraSection");
       // This assumes CameraSection is defined correctly elsewhere or imported
       // If it was previously defined inline and removed, it needs to be restored/imported.
       // For now, assuming it exists:
       return (<CameraSection
            onCapture={handleMediaCaptured}
            onClose={() => setShowCameraSection(false)}
            styles={styles} // Pass styles down
            initialMedia={capturedMedia} // Pass current media down
         />);
   }

  // --- Main Render (Ensure this is the final return) --- //
  // Restore original return statement
  console.log("[AddListingScreen] Rendering main SafeAreaView with renderCurrentStage");
  return (<SafeAreaView style={styles.container}>{renderCurrentStage()}</SafeAreaView>);
  // REMOVE any return null placeholders below this point

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
      backgroundColor: '#F8F9FB' 
  },
  navButton: { flex: 1, marginHorizontal: 5 },

  
  imageGridScrollView: { flex: 1, marginBottom: 15, },
  imageGridContainer: { 
    paddingBottom: 20,
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
  formInputContainer: { marginBottom: 18, position: 'relative' }, 
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
  readOnlyHint: {
      fontSize: 10,
      color: '#888',
      marginTop: 2,
      marginLeft: 5,
  },
   arrayHint: {
      fontSize: 10,
      color: '#888',
      marginTop: 2,
      marginLeft: 5,
  },

  // --- NEW Styles for Location Selection ---
  locationsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  locationsList: {
    maxHeight: 250,
  },
  /*
  locationAddress: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  */
  quantityInputField: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    textAlign: 'center',
    fontSize: 14,
  },
  // --- End NEW Styles ---

  modalScrollView: {
    maxHeight: '80%',
  },
  shopifyFormContainer: {
    width: '100%',
    marginBottom: 20,
  },
  formSection: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  subsectionTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#444',
    marginBottom: 10,
  },
  variantsContainer: {
    marginTop: 15,
  },
  addVariantButton: {
    marginTop: 10,
  },
  publishOptionsContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },

  formReviewContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  stickyHeader: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 10,
  },
  mediaPreviewContainer: {
    paddingVertical: 15,
  },
  mediaPreviewItem: {
    width: 80,
    height: 80,
    borderRadius: 8,
    marginRight: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  mediaPreviewItemCover: {
    borderColor: '#4CAF50',
  },
  videoIndicator: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    padding: 2,
  },
  coverBadge: {
    position: 'absolute',
    top: 5,
    left: 5,
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    padding: 4,
  },
  addMediaButton: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#ddd',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  mediaHint: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
  },
  platformTabsContainer: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 10,
  },
  platformTabsScroll: {
    paddingHorizontal: 15,
  },
  platformTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 10,
    borderRadius: 20,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#eee',
  },
  platformTabActive: {
    backgroundColor: '#E8F5E9',
    borderColor: '#4CAF50',
  },
  platformTabIcon: {
    width: 20,
    height: 20,
    marginRight: 6,
  },
  platformTabText: {
    fontSize: 14,
    color: '#666',
  },
  platformTabTextActive: {
    color: '#2E7D32',
    fontWeight: '500',
  },
  addPlatformButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#ddd',
    borderStyle: 'dashed',
  },
  addPlatformText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },

  quantityControls: {
    flexDirection: 'row',
  },
  quantityButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 5,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 120,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
    color: '#666',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  pastScansButton: {
    padding: 8,
  },
  formKeyboardAvoid: {
    flex: 1,
  },
  formScrollContent: {
    paddingBottom: 100, 
  },
  formFieldsContainer: {
    padding: 15,
  },
  formField: {
    marginBottom: 20, 
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    textTransform: 'capitalize',
  },
  formInput: {
    borderWidth: 1,
    borderColor: '#DDE2E7',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    fontSize: 15,
    color: '#333',
    minHeight: 44, // Ensure minimum height for touch targets
  },
  formInputMultiline: {
    minHeight: 100,
    textAlignVertical: 'top',
    paddingTop: 10,
    paddingBottom: 10,
  },
  formActions: {
    flexDirection: 'row',
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#fff',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  retryButton: {
    marginTop: 10,
    marginHorizontal: 15,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#f8f9fa',
  },
  locationsContainer: {
    marginTop: 10,
  },
  /*
  locationItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#eee',
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  
  locationInfo: {
    marginLeft: 8,
    flex: 1,
  },
  locationName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
    marginBottom: 2,
  },
  quantityInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginLeft: 36, // Align with location name
  },
  quantityLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 8,
  },
  quantityInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    padding: 8,
    width: 80,
    textAlign: 'center',
    fontSize: 14,
  },
  */
  emptyStateText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginVertical: 10,
  },
  formActionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#fff',
  },
  backButton: {
    backgroundColor: '#fff',
    borderColor: '#ddd',
  },
  generateButton: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  draftButton: {
    backgroundColor: '#fff',
    borderColor: '#ddd',
  },
  publishButton: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  modalActionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#fff',
  },
  nextButton: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  
  disabledButton: {
    backgroundColor: '#ccc',
    borderColor: '#bbb',
  },
  locationsDropdown: {
    borderWidth: 1,
    borderColor: '#DDE2E7',
    borderRadius: 8,
    backgroundColor: '#fff',
    maxHeight: 300,
  },
  locationItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationInfo: {
    flex: 1,
    marginLeft: 10,
  },
  locationName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  locationAddress: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  quantityInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginLeft: 34,
  },
  quantityLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 8,
  },
  quantityInput: {
    borderWidth: 1,
    borderColor: '#DDE2E7',
    borderRadius: 4,
    padding: 8,
    width: 80,
    textAlign: 'center',
  },
  noLocationsText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 10,
  },
});

// --- Platform Images Map (Unchanged, Ensure it's defined) --- //
const platformImageMap: { [key: string]: any } = {
    shopify: require('../../src/assets/shopify.png'),
    amazon: require('../../src/assets/amazon.png'),
    facebook: require('../../src/assets/facebook.png'),
    ebay: require('../../src/assets/ebay.png'),
    clover: require('../../src/assets/clover.png'),
    square: require('../../src/assets/square.png'),
};