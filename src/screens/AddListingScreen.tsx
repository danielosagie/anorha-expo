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
  Keyboard,
  ViewStyle,
  GestureResponderEvent
} from 'react-native';
import { CameraView, useCameraPermissions, Camera, CameraType, FlashMode, BarcodeScanningResult } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Animated, { 
  FadeIn, 
  FadeOut
} from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { MaterialIcons } from '@expo/vector-icons';
import Button from '../components/Button';
import Card from '../components/Card';
import PlaceholderImage from '../components/PlaceholderImage';
import { supabase } from '../../lib/supabase'; 
import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Checkbox } from 'react-native-paper';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { useNavigation } from '@react-navigation/native';

// Import SVG files from assets
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';

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
  EnhancedSearch = 'ENHANCED_SEARCH', // NEW: Enhanced search stage
  PlatformSelection = 'PLATFORM_SELECTION',
  ImageInput = 'IMAGE_INPUT',
  Analyzing = 'ANALYZING', // Loading state for /analyze
  VisualMatch = 'VISUAL_MATCH',
  EnhancingData = 'ENHANCING_DATA', // NEW: Loading state for web scraping
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

// --- NEW: AI Recognition Interfaces ---
interface ProductRecognitionRequest {
  imageUrl: string;
  textQuery?: string;
  businessTemplate?: string;
  userId: string;
}

interface RecognitionResult {
  confidence: 'high' | 'medium' | 'low';
  systemAction: 'show_single_match' | 'show_multiple_candidates' | 'fallback_to_external' | 'fallback_to_manual';
  rankedCandidates: ProductCandidate[];
  imageEmbedding?: number[];
  textEmbedding?: number[];
  webSearchResults?: any[];
  processingSteps: string[];
  matchId?: string;
  metadata: {
    processingTimeMs: number;
    modelsUsed: string[];
    embeddingDimensions: {
      image?: number;
      text?: number;
    };
  };
}

interface ProductCandidate {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  price?: number;
  brand?: string;
  category?: string;
  businessTemplate?: string;
  similarity: number;
  source: 'internal' | 'web' | 'marketplace';
  url?: string;
  visualSimilarity?: number;
  textSimilarity?: number;
  rank?: number;
  score?: number;
}

interface BackfillResponse {
  success: boolean;
  message: string;
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

interface DetectedBarcode extends BarcodeScanningResult {
    isSelected?: boolean;
    boundingBox?: {
        origin: { x: number, y: number };
        size: { width: number, height: number };
    };
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
  // Removed cameraMode as we're using picture mode only
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

  // Permission handling - moved to conditional rendering within return
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

  return (
    <View style={styles.cameraStageContainer}>
      <CameraView ref={cameraRef} style={styles.cameraPreview} facing={facing} flash={flash}>
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
        <TouchableOpacity style={styles.captureButton} onPress={takePicture} disabled={localMedia.length >= 10}>
          <View style={[styles.captureInner, localMedia.length >= 10 && styles.captureDisabledInner]} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.sideControlButton} >
            {/* Placeholder for potential future button */}
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
  const [currentStage, setCurrentStage] = useState<ListingStage>(ListingStage.EnhancedSearch);
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

  // --- NEW: AI Recognition State ---
  const [recognitionResult, setRecognitionResult] = useState<RecognitionResult | null>(null);
  const [selectedBusinessTemplate, setSelectedBusinessTemplate] = useState<string>('electronics');
  const [aiProcessingSteps, setAiProcessingSteps] = useState<string[]>([]);
  const [showAiDebugInfo, setShowAiDebugInfo] = useState(false);

  // --- NEW: Ref for debounce timer ---
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inventoryDebounceTimerRef = useRef<NodeJS.Timeout | null>(null); // For inventory specific debouncing

  // --- NEW: State to track if editing an existing draft ---
  const [isEditingExistingDraft, setIsEditingExistingDraft] = useState(false);

  // --- NEW: Handler for selecting a platform in the AddPlatformModal ---
  const handleAddPlatformFromModal = (platformKey: string) => {
    if (!selectedPlatforms.includes(platformKey)) {
      // Add to selected platforms
      const newSelectedPlatforms = [...selectedPlatforms, platformKey];
      setSelectedPlatforms(newSelectedPlatforms);

      // Add to formData with a default structure
      setFormData(prevData => {
        const existingFormData = prevData || {};
        let title = 'New Product';
        let description = '';
        let price = 0;
        let status: 'draft' | 'active' | 'archived' = 'draft';

        const firstExistingPlatformKey = Object.keys(existingFormData).find(key => existingFormData[key]);
        if (firstExistingPlatformKey && existingFormData[firstExistingPlatformKey]) {
            const firstPlatformData = existingFormData[firstExistingPlatformKey];
            title = firstPlatformData.title || title;
            description = firstPlatformData.description || description;
            price = firstPlatformData.price === undefined ? price : firstPlatformData.price;
            // status = firstPlatformData.status || status; // Let new platforms default to draft
        }

        return {
          ...existingFormData,
          [platformKey]: {
            title,
            description,
            price,
            status,
            // Add other common/default fields if necessary for a new platform entry
          }
        };
      });

      // Set the new platform as the active tab
      setActiveFormTab(platformKey);
      console.log(`[handleAddPlatformFromModal] Added platform: ${platformKey} and set as active tab.`);
    } else {
      console.warn(`[handleAddPlatformFromModal] Platform ${platformKey} already selected.`);
      // Optionally, still switch to it if it was already selected but not active
      setActiveFormTab(platformKey);
    }
    setIsAddPlatformModalVisible(false); // Close modal
  };

  // --- NEW State for Visual Match Selection ---
  const [selectedMatchForGeneration, setSelectedMatchForGeneration] = useState<VisualMatch | null>(null);
  // NEW: Enhanced web data from Firecrawl scraping
  const [enhancedWebData, setEnhancedWebData] = useState<{ url: string; scrapedData: any; analysis?: string } | null>(null);

  // --- State for platformConnectionId ---
  const [platformConnectionId, setPlatformConnectionId] = useState<string | null>(null);

  // --- NEW: State for all platform connections ---
  const [userPlatformConnections, setUserPlatformConnections] = useState<any[]>([]); // Using any[] for now, replace with actual PlatformConnection type

  // --- Camera State (Moved from CameraSection) ---
  const [cameraPermission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [recording, setRecording] = useState(false);
  const [flash, setFlash] = useState<FlashMode>("off");
  const cameraRef = useRef<CameraView>(null);
  
  // --- NEW State for Barcode Scanner and Focus ---
  const [isBarcodeScanningActive, setIsBarcodeScanningActive] = useState(false);
  const [detectedBarcodes, setDetectedBarcodes] = useState<DetectedBarcode[]>([]);
  const [selectedBarcode, setSelectedBarcode] = useState<string | null>(null);
  const lastTapRef = useRef<{ itemId: string | null; time: number }>({ itemId: null, time: 0 });
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [showFocusIndicator, setShowFocusIndicator] = useState(false);
  
  // --- Ref for barcode caching ---
  const barcodeCache = useRef<{ [key: string]: BarcodeScanningResult & { lastSeen?: number } }>({});
  const barcodeDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // --- End Camera State ---

  // Cleanup effect for barcode cache
  useEffect(() => {
    const intervalId = setInterval(() => {
        barcodeCache.current = {};
        if(isBarcodeScanningActive) {
            setDetectedBarcodes([]);
        }
    }, 5000); // Clear cache every 5 seconds

    return () => {
        clearInterval(intervalId);
        if (barcodeDebounceTimerRef.current) {
            clearTimeout(barcodeDebounceTimerRef.current);
        }
    };
  }, [isBarcodeScanningActive]);

  // --- NEW State for Publish Modal ---
  const [isPublishModalVisible, setIsPublishModalVisible] = useState(false);

  // --- NEW State for Shopify Integration ---
  const [shopifyLocations, setShopifyLocations] = useState<ShopifyLocation[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<ShopifyLocationWithQuantity[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  // --- End NEW State ---

  // --- NEW: useEffect to initialize/update selectedLocations based on shopifyLocations and preserve quantities ---
  useEffect(() => {
    if (shopifyLocations.length > 0) {
      setSelectedLocations(prevSelectedLocations => {
        const newSelectedLocations = shopifyLocations.map(fetchedLocation => {
          const existingSelection = prevSelectedLocations.find(sl => sl.id === fetchedLocation.id);
          return {
            ...fetchedLocation,
            quantity: existingSelection ? existingSelection.quantity : 0, // Preserve existing quantity or default to 0
          };
        });
        // If there were locations in prevSelectedLocations that are no longer in shopifyLocations,
        // they will be implicitly removed here. This is generally desired if shopifyLocations is the source of truth for *available* locations.
        return newSelectedLocations;
      });
    } else {
      // If shopifyLocations is empty, clear selectedLocations too, unless you have a reason to keep them (e.g. offline mode)
      // setSelectedLocations([]);
    }
  }, [shopifyLocations]); // Re-run when the list of available shopifyLocations changes

  // --- NEW: State for Add Platform Modal from Form Review ---
  const [isAddPlatformModalVisible, setIsAddPlatformModalVisible] = useState(false);

  // --- NEW: Debug toggle for ignoring Shopify ID errors ---
  const [ignoreShopifyIdErrors, setIgnoreShopifyIdErrors] = useState(false);

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
        setIsEditingExistingDraft(true); // Mark that we are editing an item loaded from params
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

      // --- Refined logic for setting formData ---
      let newFormData: GenerateDetailsResponse['generatedDetails'] = {};
      const platformDetails = initialData.platformDetails;
      const knownPlatformKeysInDetails = platformDetails && typeof platformDetails === 'object'
        ? Object.keys(platformDetails).filter(key => AVAILABLE_PLATFORMS.some(p => p.key === key))
        : [];

      if (knownPlatformKeysInDetails.length > 0) {
        // Case 1: platformDetails is already platform-keyed (e.g., { shopify: {...}, amazon: {...} })
        newFormData = { ...platformDetails };
        // Ensure essential fields are present for each platform derived from platformDetails
        knownPlatformKeysInDetails.forEach(pk => {
          newFormData[pk] = {
            title: initialData.title || '', // Fallback to root initialData.title if not in platformDetails[pk].title
            description: initialData.description || '',
            price: initialData.price === undefined ? 0 : initialData.price,
            sku: initialData.sku || '',
            barcode: initialData.barcode || '',
            status: initialData.status || 'draft',
            ...(newFormData[pk] || {}) // Spread existing platform-specific details from platformDetails
          };
        });
        console.log("[AddListingScreen] Initialized formData from platform-keyed platformDetails:", newFormData);
      } else {
        // Case 2: platformDetails is flat, or not present, or not platform-keyed.
        // Default to 'shopify' and merge flat details if they exist.
        const defaultPlatformKey = AVAILABLE_PLATFORMS[0]?.key || 'shopify'; // Use first available or fallback
        newFormData[defaultPlatformKey] = {
          title: initialData.title || '',
          description: initialData.description || '',
          price: initialData.price === undefined ? 0 : initialData.price,
          sku: initialData.sku || '',
          barcode: initialData.barcode || '',
          status: initialData.status || 'draft',
          ...(platformDetails && typeof platformDetails === 'object' ? platformDetails : {}) // Spread flat details
        };
        console.log(`[AddListingScreen] Initialized formData for default platform ('${defaultPlatformKey}') merging flat platformDetails:`, newFormData);
      }
      // --- End of Refined logic ---

      console.log("[AddListingScreen] Setting form data:", JSON.stringify(newFormData, null, 2));
      setFormData(newFormData);
      
      const validPlatformKeysInForm = Object.keys(newFormData).filter(key => 
        AVAILABLE_PLATFORMS.some(p => p.key === key)
      );

      setSelectedPlatforms(validPlatformKeysInForm);
      console.log("[AddListingScreen] Setting selected platforms:", validPlatformKeysInForm);

      if (validPlatformKeysInForm.length > 0) {
        setActiveFormTab(validPlatformKeysInForm[0]);
        console.log("[AddListingScreen] Setting active tab to:", validPlatformKeysInForm[0]);
      } else if (AVAILABLE_PLATFORMS.length > 0) {
        // Fallback if somehow no valid platforms ended up in formData but we have available ones
        setActiveFormTab(AVAILABLE_PLATFORMS[0].key);
        console.log("[AddListingScreen] Fallback: Setting active tab to first available platform:", AVAILABLE_PLATFORMS[0].key);
        if (!newFormData[AVAILABLE_PLATFORMS[0].key]) { // Ensure tab has data
            newFormData[AVAILABLE_PLATFORMS[0].key] = {
                title: initialData.title || '',
                description: initialData.description || '',
                price: initialData.price === undefined ? 0 : initialData.price,
                sku: initialData.sku || '',
                barcode: initialData.barcode || '',
                status: initialData.status || 'draft',
            };
            setFormData(newFormData);
        }

      }

      // Clear any existing loading states
      setIsLoading(false);
      setLoadingMessage('');
      setError(null);
      setIsEditingExistingDraft(false); // Reset for the next potential flow
    } else {
      console.log("[AddListingScreen] No initial data provided in route params");
    }
  }, [route.params?.initialData]);

  // --- NEW: useEffect to fetch connections and set platformConnectionId for FormReview stage ---
  useEffect(() => {
    const fetchConnectionsForFormReview = async () => {
      // Only attempt if we are in FormReview, Shopify is selected, and we don't have an ID yet.
      if (currentStage === ListingStage.FormReview && selectedPlatforms.includes('shopify') && !platformConnectionId) {
        console.log('[FormReview Effect] Shopify selected, attempting to set platformConnectionId.');
        try {
          const { data: { user }, error: userError } = await supabase.auth.getUser();
          const session = await supabase.auth.getSession();
          const token = session?.data.session?.access_token;

          if (userError || !user || !token) {
            console.warn('[FormReview Effect] Auth error, cannot fetch connections.');
            // Potentially set an error state here to inform the user
            return;
          }

          const response = await fetch('https://api.sssync.app/api/platform-connections', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
            console.error('[FormReview Effect] Failed to fetch platform connections:', errorData.message);
            // Potentially set an error state here
            return;
          }

          const connections: any[] = await response.json();
          console.log('[FormReview Effect] Shopify connections:', connections);
          // Ensure you have your PlatformConnection type defined for better type safety
          // For example: const connections: PlatformConnection[] = await response.json();

          const validShopifyStatuses = ['connected', 'active', 'needs_review', 'syncing', 'active_sync', 'ready'];
          const shopifyConnection = connections.find(
            (conn: any) => conn.PlatformType === 'shopify' &&
                           validShopifyStatuses.includes(conn.Status) &&
                           conn.IsEnabled === true
          );

          if (shopifyConnection && shopifyConnection.Id) {
            console.log(`[FormReview Effect] Found Shopify connection ID: ${shopifyConnection.Id}, Status: ${shopifyConnection.Status}, Enabled: ${shopifyConnection.IsEnabled}`);
            setPlatformConnectionId(shopifyConnection.Id);
            setUserPlatformConnections(connections); // Store all connections
          } else {
            console.warn('[FormReview Effect] No suitable Shopify connection found. Locations might not load.');
            // Alert the user or show an indicator in the UI that Shopify locations couldn't be pre-fetched.
            // Alert.alert("Shopify Connection Issue", "Could not find an active and enabled Shopify connection to pre-fetch locations. Please check your profile settings.");
          }
        } catch (err: any) {
          console.error('[FormReview Effect] Error processing Shopify connection for FormReview:', err);
          // Potentially set an error state here
        }
      }
    };
    fetchConnectionsForFormReview();
  }, [currentStage, selectedPlatforms, platformConnectionId, supabase.auth]); // Add supabase.auth to deps if using it directly for user/session.

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
  const toggleFlash = () => setFlash((current: FlashMode) => current === 'off' ? 'on' : current === 'on' ? 'auto' : 'off');
  const toggleCameraFacing = () => setFacing((current: CameraType) => current === "back" ? "front" : "back");
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
    setLoadingMessage('🚀 Preparing & Uploading Media...');
    setCurrentStage(ListingStage.Analyzing);
    setIsLoading(true);
    setAiProcessingSteps([]); // Reset processing steps

    let mediaToUpload = [...capturedMedia];
    if (coverImageIndex > 0) {
        const coverItem = mediaToUpload.splice(coverImageIndex, 1)[0];
        mediaToUpload.unshift(coverItem);
        console.log("Reordered media for upload with cover first.");
    }

    let urls: string[] = [];

    try {
        // Upload images and get the URLs directly
        let rawUrls = await uploadImagesToSupabase(mediaToUpload);
        console.log('[triggerImageAnalysis] URLs received from uploadImagesToSupabase:', JSON.stringify(rawUrls, null, 2));

        // Clean the URLs: ensure no trailing semicolons if they are strings
        urls = rawUrls.map(url => {
          if (typeof url === 'string') {
            const trimmedUrl = url.trim();
            if (trimmedUrl.endsWith(';')) {
              console.warn('[triggerImageAnalysis] Cleaning trailing semicolon from URL:', url);
              return trimmedUrl.slice(0, -1);
            }
            return trimmedUrl;
          }
          return url;
        });
        console.log('[triggerImageAnalysis] Cleaned URLs:', JSON.stringify(urls, null, 2));

        if (urls.length === 0 && mediaToUpload.length > 0) {
            console.error("[triggerImageAnalysis] Upload function returned empty URLs");
            throw new Error("Media upload failed or all items were skipped. Check logs and file sizes.");
        }
        setUploadedImageUrls(urls); 
        console.log(`[triggerImageAnalysis] Upload successful. Set uploadedImageUrls with ${urls.length} URLs.`);
        setLoadingMessage('🤖 Running AI Product Recognition...');

    } catch (uploadErr: any) {
        console.error("[triggerImageAnalysis] Upload phase failed:", uploadErr);
        setError(`Upload Failed: ${uploadErr.message || 'Unknown error during upload'}`);
        setCurrentStage(ListingStage.ImageInput);
        setIsLoading(false);
        setLoadingMessage('');
        return;
    }

    // --- NEW: AI Recognition API Call ---
    console.log("Fetching user for AI recognition API call...");
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (userError || !user) {
        console.error("Error fetching user for AI recognition API:", userError);
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
    console.log(`User ID fetched for AI recognition: ${userId}`);

    // Use the new AI recognition endpoint
    const recognizeApiUrl = `https://sssync-bknd-production.up.railway.app/api/products/recognize`;
    const recognitionRequest: ProductRecognitionRequest = {
      imageUrl: urls[0], // Use the first (cover) image
      businessTemplate: selectedBusinessTemplate,
      userId: userId
    };
    
    const headers = { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
    
    console.log(`Attempting to POST to: ${recognizeApiUrl}`);
    console.log("Recognition Request:", { ...recognitionRequest, userId: '[REDACTED]' });

    try {
        const response = await fetch(recognizeApiUrl, {
            method: 'POST', 
            headers: headers,
            body: JSON.stringify(recognitionRequest),
        });
        console.log(`AI Recognition API Response Status: ${response.status}`);
        let responseData: RecognitionResult | null = null;
        if (response.status !== 204 && response.headers.get('content-type')?.includes('application/json')) {
            responseData = await response.json(); 
        }

        if (!response.ok) {
            console.error("AI Recognition API Error Response Body:", responseData);
            let apiErrorMessage = `HTTP error! status: ${response.status}`;
            if (response.status === 401) {
                apiErrorMessage = "Unauthorized. Please ensure you are logged in.";
            }
            throw new Error(apiErrorMessage);
        }

        if (!responseData) {
            console.error("AI Recognition API returned no data");
            setError("No recognition data returned from AI service.");
            setCurrentStage(ListingStage.ImageInput);
            setIsLoading(false);
            setLoadingMessage('');
            return;
        }

        console.log("AI Recognition Response:", JSON.stringify(responseData, null, 2));
        
        // Store the full recognition result
        setRecognitionResult(responseData);
        setAiProcessingSteps(responseData.processingSteps || []);
        
        // Handle different system actions based on AI confidence
        switch (responseData.systemAction) {
            case 'show_single_match':
                // High confidence - proceed directly to generation
                if (responseData.rankedCandidates.length > 0) {
                    const bestMatch = responseData.rankedCandidates[0];
                    console.log(`🎯 High confidence match found: ${bestMatch.title} (confidence: ${responseData.confidence})`);
                    
                    // Convert to old format for compatibility
                    const visualMatch: VisualMatch = {
                        position: 1,
                        title: bestMatch.title,
                        link: bestMatch.url || '',
                        source: bestMatch.source,
                        price: bestMatch.price ? {
                            value: `$${bestMatch.price}`,
                            extracted_value: bestMatch.price,
                            currency: 'USD'
                        } : undefined,
                        thumbnail: bestMatch.imageUrl || '',
                        image: bestMatch.imageUrl
                    };
                    
                    setSelectedMatchForGeneration(visualMatch);
                    setCurrentStage(ListingStage.Generating);
                    
                    // Automatically proceed to generate details
                    setTimeout(() => triggerDetailsGeneration(), 500);
                }
                break;
                
            case 'show_multiple_candidates':
                // Medium confidence - show candidates for user selection
                console.log(`🤔 Multiple candidates found (confidence: ${responseData.confidence})`);
                
                // Convert candidates to VisualMatch format for compatibility
                const visualMatches: VisualMatch[] = responseData.rankedCandidates.map((candidate, index) => ({
                    position: index + 1,
                    title: candidate.title,
                    link: candidate.url || '',
                    source: candidate.source,
                    price: candidate.price ? {
                        value: `$${candidate.price}`,
                        extracted_value: candidate.price,
                        currency: 'USD'
                    } : undefined,
                    thumbnail: candidate.imageUrl || '',
                    image: candidate.imageUrl
                }));
                
                setSerpApiResponse({
                    search_metadata: {},
                    visual_matches: visualMatches
                });
                
                setCurrentStage(ListingStage.VisualMatch);
                break;
                
            case 'fallback_to_external':
            case 'fallback_to_manual':
                // Low confidence or no matches - show enhanced search
                console.log(`❓ Low confidence or no matches (confidence: ${responseData.confidence})`);
                setSerpApiResponse({
                    search_metadata: {},
                    visual_matches: [],
                    message: 'No confident matches found. Try the enhanced search below.'
                });
                setCurrentStage(ListingStage.VisualMatch);
                break;
                
                         default:
                 console.warn('Unknown system action:', responseData.systemAction);
                 setCurrentStage(ListingStage.VisualMatch);
         }

    } catch (error: any) {
        console.error("[triggerImageAnalysis] AI Recognition failed:", error);
        setError(`AI Recognition Failed: ${error.message || 'Unknown error during recognition'}`);
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
          // NEW: Automatically start enhancing data from the selected match
          if (match.link) {
              setCurrentStage(ListingStage.EnhancingData);
              enhanceDataFromMatch(match);
          } else {
              // If no link, proceed directly to generation
              setCurrentStage(ListingStage.Generating);
              triggerDetailsGeneration();
          }
      }
  };

  // NEW: Enhance data by scraping the selected match URL
  const enhanceDataFromMatch = async (match: VisualMatch) => {
    if (!match.link) {
      console.log("No link available for match, proceeding without enhancement");
      setCurrentStage(ListingStage.Generating);
      triggerDetailsGeneration();
      return;
    }

    setIsLoading(true);
    setLoadingMessage('Gathering detailed product information...');
    setError(null);

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (userError || !user || sessionError || !sessionData?.session?.access_token) {
        console.error("Auth error during data enhancement:", { userError, sessionError });
        setError("Authentication error. Please log out and back in.");
        setCurrentStage(ListingStage.VisualMatch);
        return;
      }

      const token = sessionData.session.access_token;
      const extractUrl = `https://api.sssync.app/api/products/extract-from-urls`;

      // Use general products template for now - can be enhanced later
      const templateId = 'general_products';
      
      const requestBody = {
        urls: [match.link],
        businessTemplate: templateId,
        customPrompt: `Extract detailed product information from this page. Focus on: title, price, description, specifications, brand, model, features, dimensions, weight, materials, and any other relevant product details.`
      };

      console.log(`Extracting data from: ${match.link}`);
      const response = await fetch(extractUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`Failed to extract data: ${response.status}`);
      }

      const enhancementData = await response.json();
      console.log("Enhanced data received:", enhancementData);

      // NEW: Enhanced web data from Firecrawl scraping
      setEnhancedWebData({
        url: match.link,
        scrapedData: enhancementData.results?.[0]?.data || {},
        analysis: enhancementData.results?.[0]?.title || match.title
      });

      // Store enhanced data in database for future reference
      const { error: storageError } = await supabase
        .from('ProductEmbeddings')
        .insert({
          ProductId: productId,
          VariantId: variantId,
          SourceUrl: match.link,
          ScrapedData: enhancementData.results?.[0]?.data || {},
          CreatedAt: new Date().toISOString(),
          UpdatedAt: new Date().toISOString()
        });

      if (storageError) {
        console.error("Error storing enhanced data:", storageError);
        // Continue anyway - this is not critical for the flow
      } else {
        console.log("Enhanced data stored in database for future searches");
      }

      // Proceed to generation with enhanced data
      setCurrentStage(ListingStage.Generating);
      triggerDetailsGeneration();

    } catch (error: any) {
      console.error("Error enhancing data from match:", error);
      setError(`Data enhancement failed: ${error.message}. Proceeding with basic information.`);
      
      // Proceed without enhanced data after 3 seconds
      setTimeout(() => {
        setCurrentStage(ListingStage.Generating);
        triggerDetailsGeneration();
      }, 3000);
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
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
     const generateApiUrl = `https://api.sssync.app/api/products/generate-details`;
     const requestBodyGenerate = {
         productId: productId,
         variantId: variantId,
         imageUris: uploadedImageUrls,
         coverImageIndex: coverImageIndexForApi,
         selectedPlatforms: selectedPlatforms,
         selectedMatch: cleanedSelectedMatch,
         enhancedWebData: enhancedWebData // NEW: Include enhanced web data
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

      // --- NEW: Update ProductVariant in Database ---
      if (variantId) {
        const updateObject: any = {
          Options: generatedData, // Store all generated platform details
          UpdatedAt: new Date().toISOString(),
        };

        // Try to get some primary details from Shopify if it exists in generatedData
        const shopifyDetails = generatedData?.shopify;
        if (shopifyDetails) {
          if (shopifyDetails.title) updateObject.Title = shopifyDetails.title;
          if (shopifyDetails.description) updateObject.Description = shopifyDetails.description;
          if (shopifyDetails.price !== undefined) updateObject.Price = shopifyDetails.price;
          if (shopifyDetails.sku) updateObject.Sku = shopifyDetails.sku;
          if (shopifyDetails.barcode) updateObject.Barcode = shopifyDetails.barcode;
          if (shopifyDetails.status) updateObject.Status = shopifyDetails.status;
          if (shopifyDetails.inventoryQuantity) updateObject.InventoryQuantity = shopifyDetails.inventoryQuantity;
          if (shopifyDetails.inventoryUnit) updateObject.InventoryUnit = shopifyDetails.inventoryUnit;
          // Add other primary fields if needed, e.g., Sku, Barcode, if AI can change them
        }

        console.log(`[triggerDetailsGeneration] Attempting to update ProductVariant ${variantId} with:`, updateObject);
        const { error: variantUpdateError } = await supabase
          .from('ProductVariants')
          .update(updateObject)
          .eq('Id', variantId);

        if (variantUpdateError) {
          console.error(`[triggerDetailsGeneration] Error updating ProductVariant ${variantId}:`, variantUpdateError);
          // Decide if this is a critical error. For now, we'll log and continue to update UI state.
          // Alert.alert("Save Error", "Could not save all generated details to the database.");
        } else {
          console.log(`[triggerDetailsGeneration] Successfully updated ProductVariant ${variantId} in database.`);
        }
      } else {
        console.warn("[triggerDetailsGeneration] variantId is null, skipping database update for ProductVariant.");
      }
      // --- END NEW --- 

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

    // --- Barcode Scanning Handler ---
  const handleBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    console.log('[handleBarcodeScanned] Full result object:', JSON.stringify(result, null, 2));
    console.log('[handleBarcodeScanned] Result keys:', Object.keys(result));
    console.log('[handleBarcodeScanned] Bounding box:', (result as any).boundingBox);
    console.log('[handleBarcodeScanned] Corner points:', (result as any).cornerPoints);
    console.log('[handleBarcodeScanned] isBarcodeScanningActive:', isBarcodeScanningActive);
    
    if (!isBarcodeScanningActive) {
      console.log('[handleBarcodeScanned] Barcode scanning is not active, ignoring');
      return;
    }
    
    if (result.data) {
      console.log('[handleBarcodeScanned] Updating barcode in cache with live data:', result.data);
      // Store the latest result with real-time bounding box and timestamp
      barcodeCache.current[result.data] = {
        ...result,
        lastSeen: Date.now()
      };
    }
    
    // Clear previous timer for immediate update (live tracking)
    if (barcodeDebounceTimerRef.current) {
      clearTimeout(barcodeDebounceTimerRef.current);
    }
    
    // Reduced debounce time for more responsive live tracking
    barcodeDebounceTimerRef.current = setTimeout(() => {
      const now = Date.now();
      const maxAge = 2000; // Remove barcodes not seen for 2 seconds
      
      // Clean up old barcodes
      Object.keys(barcodeCache.current).forEach(key => {
        const barcode = barcodeCache.current[key];
        if (barcode.lastSeen && (now - barcode.lastSeen) > maxAge) {
          console.log('[handleBarcodeScanned] Removing old barcode:', key);
          delete barcodeCache.current[key];
        }
      });
      
      const allBarcodes = Object.values(barcodeCache.current);
      console.log('[handleBarcodeScanned] Processing cached barcodes for live update:', allBarcodes.length);
      
      const newDetectedBarcodes = allBarcodes.map(b => {
        const rawBoundingBox = (b as any).boundingBox;
        const cornerPoints = (b as any).cornerPoints;
        console.log('[handleBarcodeScanned] Raw bounding box for', b.data, ':', rawBoundingBox);
        console.log('[handleBarcodeScanned] Corner points for', b.data, ':', cornerPoints);
        
        // Try to extract bounding box from different possible formats
        let boundingBox = null;
        
        if (rawBoundingBox && rawBoundingBox.origin && rawBoundingBox.size) {
          // Standard format: { origin: { x, y }, size: { width, height } }
          boundingBox = rawBoundingBox;
        } else if (cornerPoints && Array.isArray(cornerPoints) && cornerPoints.length >= 4) {
          // Calculate bounding box from corner points
          const xs = cornerPoints.map(p => p.x);
          const ys = cornerPoints.map(p => p.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          
          boundingBox = {
            origin: { x: minX, y: minY },
            size: { width: maxX - minX, height: maxY - minY }
          };
          console.log('[handleBarcodeScanned] Calculated bounding box from corner points:', boundingBox);
        } else if (rawBoundingBox && typeof rawBoundingBox === 'object') {
          // Try other possible formats
          const keys = Object.keys(rawBoundingBox);
          console.log('[handleBarcodeScanned] Unknown bounding box format, keys:', keys);
        }
        
        // Fallback to default position if no valid bounding box found
        if (!boundingBox) {
          const index = allBarcodes.indexOf(b);
          const spacing = 250; // Horizontal spacing between barcodes
          boundingBox = {
            origin: { x: 50 + (index * spacing), y: 100 },
            size: { width: 220, height: 60 }
          };
          console.log('[handleBarcodeScanned] Using fallback bounding box for', b.data, 'at position', index);
        }
        
        return {
          ...b,
          isSelected: selectedBarcode === b.data,
          boundingBox
        };
      });
      
      // Auto-select first barcode if none selected and we have barcodes
      // Or if the currently selected barcode is no longer detected
      const currentlySelectedExists = newDetectedBarcodes.some(b => b.data === selectedBarcode);
      
      if ((!selectedBarcode || !currentlySelectedExists) && newDetectedBarcodes.length > 0) {
        const firstBarcode = newDetectedBarcodes[0];
        console.log('[handleBarcodeScanned] Auto-selecting barcode:', firstBarcode.data, 
                   !selectedBarcode ? '(no selection)' : '(previous selection lost)');
        setSelectedBarcode(firstBarcode.data);
        newDetectedBarcodes[0].isSelected = true;
      }
      
      console.log('[handleBarcodeScanned] Setting detected barcodes with live positions:', newDetectedBarcodes);
      setDetectedBarcodes(newDetectedBarcodes);
    }, 50); // Reduced from 200ms to 50ms for more responsive tracking
  }, [isBarcodeScanningActive, selectedBarcode]);


  // --- NEW: Debounced function to save form data to DB ---
  const debouncedSaveToDB = useCallback(async (currentFormData: GenerateDetailsResponse['generatedDetails'] | null) => {
    if (!variantId || !activeFormTab || !currentFormData) {
      console.log("[debouncedSaveToDB] Missing variantId, activeFormTab, or formData. Skipping auto-save.");
      return;
    }

    const platformKey = activeFormTab; // activeFormTab is the current platform key
    const platformDataToSave = currentFormData[platformKey];

    if (!platformDataToSave) {
      console.warn(`[debouncedSaveToDB] No data found for platform ${platformKey} in formData. Skipping auto-save.`);
      return;
    }

    const updateObject: any = {
      Options: currentFormData, // Save the whole formData (all platforms) to Options
      UpdatedAt: new Date().toISOString(),
    };

    // Map relevant fields from the current platform's data to direct ProductVariants columns
    if (platformDataToSave.title !== undefined) updateObject.Title = platformDataToSave.title;
    if (platformDataToSave.description !== undefined) updateObject.Description = platformDataToSave.description;
    if (platformDataToSave.price !== undefined) updateObject.Price = platformDataToSave.price;
    if (platformDataToSave.sku !== undefined) updateObject.Sku = platformDataToSave.sku;
    if (platformDataToSave.barcode !== undefined) updateObject.Barcode = platformDataToSave.barcode;
    if (platformDataToSave.compareAtPrice !== undefined) updateObject.CompareAtPrice = platformDataToSave.compareAtPrice;
    if (platformDataToSave.weight !== undefined) updateObject.Weight = platformDataToSave.weight;
    if (platformDataToSave.weightUnit !== undefined) updateObject.WeightUnit = platformDataToSave.weightUnit;
    // Note: 'status' is not a direct column in ProductVariants, it will be saved within Options.

    console.log(`[debouncedSaveToDB] Auto-saving ProductVariant ${variantId} with:`, updateObject);
    try {
      const { error: variantUpdateError } = await supabase
        .from('ProductVariants')
        .update(updateObject)
        .eq('Id', variantId);

      if (variantUpdateError) {
        console.error(`[debouncedSaveToDB] Error auto-saving ProductVariant ${variantId}:`, variantUpdateError);
        // Optional: Add a subtle error indicator to the UI
      } else {
        console.log(`[debouncedSaveToDB] Successfully auto-saved ProductVariant ${variantId}.`);
        // Optional: Add a subtle success indicator (e.g., "Saved")
      }

      // --- NEW: Sync ProductImages with uploadedImageUrls state ---
      if (uploadedImageUrls && uploadedImageUrls.length > 0) {
        console.log(`[debouncedSaveToDB] Syncing ${uploadedImageUrls.length} ProductImages for Variant ${variantId}...`);
        try {
          // 1. Delete existing images for this variant
          const { error: deleteError } = await supabase
            .from('ProductImages')
            .delete()
            .eq('ProductVariantId', variantId);
          
          if (deleteError) {
            console.error(`[debouncedSaveToDB] Error deleting existing product images for Variant ${variantId}:`, deleteError);
            // Optionally alert or handle, but proceed to insert new ones if any
          }

          // 2. Insert current images
          const imagesToInsert = uploadedImageUrls.map((url, index) => ({
            ProductVariantId: variantId, // Ensure variantId is not null here
            ImageUrl: url,
            Position: index,
          }));

          const { error: insertError } = await supabase
            .from('ProductImages')
            .insert(imagesToInsert);

          if (insertError) {
            console.error(`[debouncedSaveToDB] Error inserting new product images for Variant ${variantId}:`, insertError);
            Alert.alert("Image Sync Warning", `Could not fully sync product images: ${insertError.message}`);
          } else {
            console.log(`[debouncedSaveToDB] Successfully synced ProductImages for Variant ${variantId}.`);
          }
        } catch (syncError) {
          console.error(`[debouncedSaveToDB] Exception during ProductImages sync for Variant ${variantId}:`, syncError);
          Alert.alert("Image Sync Error", "An unexpected error occurred while syncing images.");
        }
      } else if (variantId) { // If there are no uploadedImageUrls, but we have a variantId, ensure no images are associated
        console.log(`[debouncedSaveToDB] No images in uploadedImageUrls, ensuring no ProductImages for Variant ${variantId}.`);
        try {
            const { error: deleteError } = await supabase
            .from('ProductImages')
            .delete()
            .eq('ProductVariantId', variantId);
            if (deleteError) {
                console.error(`[debouncedSaveToDB] Error clearing product images for Variant ${variantId}:`, deleteError);
            }
        } catch (clearError) {
            console.error(`[debouncedSaveToDB] Exception clearing product images for Variant ${variantId}:`, clearError);
        }
      }
      // --- END NEW --- 

    } catch (e) {
      console.error(`[debouncedSaveToDB] Exception during auto-save for ProductVariant ${variantId}:`, e);
    }
  }, [variantId, activeFormTab, uploadedImageUrls]); // Dependencies for useCallback // Added uploadedImageUrls

  // --- NEW: Debounced function to save INVENTORY LEVELS to DB ---
  const debouncedSaveInventoryLevelsToDB = useCallback(async (
    currentSelectedLocations: ShopifyLocationWithQuantity[], 
    currentVariantId: string | null,
    shopifyConnectionId: string | null // Specifically the Shopify connection ID
  ) => {
    if (!currentVariantId || !shopifyConnectionId || currentSelectedLocations.length === 0) {
      console.log("[debouncedSaveInventoryLevelsToDB] Missing IDs or no locations to save. Skipping.");
      return;
    }

    console.log(`[debouncedSaveInventoryLevelsToDB] Auto-saving InventoryLevels for Variant ${currentVariantId}, Connection ${shopifyConnectionId}`);

    for (const location of currentSelectedLocations) {
      if (location.id && typeof location.quantity === 'number') { // Ensure locationId and quantity are valid
        const inventoryRecord = {
          ProductVariantId: currentVariantId,
          PlatformConnectionId: shopifyConnectionId,
          PlatformLocationId: location.id, // This is the Shopify Location GID
          Quantity: location.quantity,
          UpdatedAt: new Date().toISOString(),
        };

        console.log("[debouncedSaveInventoryLevelsToDB] Upserting: ", inventoryRecord);
        try {
          const { error } = await supabase
            .from('InventoryLevels')
            .upsert(inventoryRecord, {
              onConflict: 'ProductVariantId,PlatformConnectionId,PlatformLocationId', // Specify conflict target
            });

          if (error) {
            console.error(`[debouncedSaveInventoryLevelsToDB] Error upserting inventory for location ${location.id}:`, error);
            // Optionally, collect errors and show a single alert
          } else {
            console.log(`[debouncedSaveInventoryLevelsToDB] Successfully upserted inventory for location ${location.id}.`);
          }
        } catch (e) {
          console.error(`[debouncedSaveInventoryLevelsToDB] Exception during upsert for location ${location.id}:`, e);
        }
      }
    }
  }, [supabase]); // Dependency: supabase client

  // UPDATED handleFormUpdate to handle new structure and types
  const handleFormUpdate = (platform: string, field: keyof GeneratedPlatformDetails, value: any) => {
      let newFormDataState: GenerateDetailsResponse['generatedDetails'] | null = null;
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

          const newPlatformData = {
              ...(platformData),
              [field]: updatedValue
          };
          newFormDataState = {
              ...prevData,
              [platform]: newPlatformData
          };
          return newFormDataState;
      });

      // --- Auto-save with debounce ---
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        // We need to pass the latest formData state to the debounced function.
        // The 'newFormDataState' captured in the outer scope of setFormData's callback
        // will be the most up-to-date version.
        if (newFormDataState) { // Check if it was set
            debouncedSaveToDB(newFormDataState);
        }
      }, 1500); // 1.5-second debounce
  };

  const handleSaveDraft = async () => {
    console.log("[handleSaveDraft] Initiated. Saving current form data...");
    const wasExistingEntity = !!variantId; // Check before clearing variantId

    // 1. Attempt to save data to backend or acknowledge local state for new items
    let proceedWithResetAndNav = false;
    if (formData && activeFormTab) {
      if (variantId) { // Existing entity with a variantId
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        await debouncedSaveToDB(formData); // This function handles its own console logs/errors
        Alert.alert("Draft Saved", "Your changes have been persisted to the server.");
        proceedWithResetAndNav = true;
      } else { // New entity, formData exists, but no variantId yet.
        // "Save Draft" for a new, unpersisted item means clearing the form to start over.
        // The data in `formData` is not saved to the backend as there's no ID.
        Alert.alert("Draft Cleared", "Current entries cleared. You can start a new listing.");
        proceedWithResetAndNav = true;
      }
    } else {
      Alert.alert("Save Incomplete", "No data to save or missing critical information (e.g., active tab or form data).");
      console.warn("[handleSaveDraft] Save incomplete due to missing formData or activeFormTab.");
      // Do not reset state or navigate if save was effectively a no-op or error
      proceedWithResetAndNav = false; 
    }

    if (!proceedWithResetAndNav) {
      return; // Stop if save was incomplete or no action taken
    }

    // --- Log navigation decision variables ---
    const canGoBack = navigation.canGoBack();
    console.log(`[handleSaveDraft] Navigation decision: isEditingExistingDraft = ${isEditingExistingDraft}, navigation.canGoBack() = ${canGoBack}`);
    // ---

    // 2. Reset state comprehensively
    console.log("[handleSaveDraft] Resetting state comprehensively.");
    
    setCapturedMedia([]);
    setCoverImageIndex(-1);
    setUploadedImageUrls([]);
    setAnalysisResponse(null);
    setGenerationResponse(null);
    setSerpApiResponse(null);
    setFormData(null);
    setProductId(null);
    setVariantId(null);
    setSelectedPlatforms([]); // Clear selected platforms for a truly fresh start
    setActiveFormTab(null);   // Clear active tab as well
    setPlatformConnectionId(null);
    setUserPlatformConnections([]);
    setShopifyLocations([]);
    setSelectedLocations([]);
    setError(null); 
    setIsLoading(false);
    setLoadingMessage('');

    // 3. Navigate based on context
    if (isEditingExistingDraft) { // Use the new state here
      console.log("[handleSaveDraft] Navigating back as it was an existing entity from Past Scans.");
      if (canGoBack) { // Use the logged variable
        navigation.goBack();
        
      } else {
        // This case should be rare if isEditingExistingDraft is true
        console.warn("[handleSaveDraft] Was editing existing draft but cannot go back. Resetting to PlatformSelection.");
        setCurrentStage(ListingStage.PlatformSelection);
        // isEditingExistingDraft is already set to false in the comprehensive reset
      }
    } else {
      // For new entities created in this session, or if route.params didn't mark it as existing
      console.log("[handleSaveDraft] Resetting to PlatformSelection for a new/current entity draft.");
      setCurrentStage(ListingStage.PlatformSelection);
      // isEditingExistingDraft is already set to false in the comprehensive reset
    }
  };

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
        `https://api.sssync.app/api/products/shopify/locations?platformConnectionId=${platformConnectionId}`,
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
      
      // Initialization of selectedLocations will be handled by a new useEffect hook watching shopifyLocations
    } catch (err: any) {
      console.error("[fetchShopifyLocations] Error:", err);
      Alert.alert("Error", `Failed to fetch Shopify locations: ${err.message}`);
    } finally {
      setIsLoadingLocations(false);
    }
  };

  // --- NEW Function to Update Location Quantity ---
  const updateLocationQuantity = (locationId: string, quantityText: string) => {
    const newQuantity = parseInt(quantityText);
    const actualQuantity = isNaN(newQuantity) ? 0 : Math.max(0, newQuantity);
    let updatedSelectedLocations: ShopifyLocationWithQuantity[] = []; // To capture the updated state

    setSelectedLocations(prev => {
      updatedSelectedLocations = prev.map((loc: ShopifyLocationWithQuantity) => 
        loc.id === locationId 
          ? { ...loc, quantity: actualQuantity } 
          : loc
      );
      return updatedSelectedLocations;
    });

    // --- Auto-save inventory levels with debounce ---
    if (inventoryDebounceTimerRef.current) {
      clearTimeout(inventoryDebounceTimerRef.current);
    }
    inventoryDebounceTimerRef.current = setTimeout(() => {
      // Ensure platformConnectionId is the Shopify-specific one for this context
      // We assume that when this form section is active, platformConnectionId holds the Shopify connection ID.
      if (variantId && platformConnectionId && updatedSelectedLocations.length > 0) {
         debouncedSaveInventoryLevelsToDB(updatedSelectedLocations, variantId, platformConnectionId);
        } else {
        console.warn("[updateLocationQuantity] Could not call debouncedSaveInventoryLevelsToDB due to missing IDs or empty locations state.", 
          { variantId, platformConnectionId, count: updatedSelectedLocations.length }
        );
      }
    }, 1500); // 1.5-second debounce, same as other form fields
  };

  // --- UPDATED handlePublish to Fetch Locations ---
  const handlePublish = async () => {
    // REMOVED: The block that fetched connections and set platformConnectionId.
    // This function will now only be responsible for showing the modal.
    // The useEffect hooks listening to currentStage === ListingStage.FormReview 
    // and platformConnectionId are responsible for loading connections and locations.
    
    // If Shopify is selected, the modal will show loading/location states 
    // based on what the useEffects have populated.
    setIsPublishModalVisible(true); 
  };

  // --- useEffect to fetch locations when publish modal becomes visible and shopify is selected ---
  useEffect(() => {
    if (platformConnectionId && selectedPlatforms.includes('shopify') && 
        (isPublishModalVisible || currentStage === ListingStage.FormReview)) {
      console.log('[useEffect fetchShopifyLocations] Conditions met, calling fetchShopifyLocations. Modal visible:', isPublishModalVisible, 'Stage:', currentStage);
      fetchShopifyLocations();
    }
  }, [isPublishModalVisible, currentStage, platformConnectionId, selectedPlatforms]);
  

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

      // Ensure essential IDs are present
      if (!productId || !variantId) {
        throw new Error("Product or Variant ID is missing. Cannot publish.");
      }
      if (!activeFormTab || !formData || !formData[activeFormTab]) {
        throw new Error("Active form tab or form data is missing. Cannot publish.");
      }

      // --- Step 1: Save/Update Canonical Product Details via generic /products/publish ---
      console.log("[handlePublishAction] Step 1: Saving canonical product details...");
      
      // --- NEW: Log the state of uploadedImageUrls before using it ---
      console.log("[handlePublishAction] Current state of uploadedImageUrls before cleaning for payload:", JSON.stringify(uploadedImageUrls, null, 2));
      // --- END NEW LOG ---

      // --- NEW: Defensive cleaning of image URLs for the payload ---
      const cleanedImageUrisForPayload = uploadedImageUrls.map((url, index) => {
        console.log(`[handlePublishAction] Cleaning URL ${index} - Original: '${url}' (Type: ${typeof url})`);
        if (typeof url === 'string') {
          let currentUrl = url.trim();
          if (currentUrl.endsWith(';')) {
            console.log(`[handlePublishAction] URL ${index} ('${currentUrl}') ends with semicolon. Slicing.`);
            currentUrl = currentUrl.slice(0, -1);
          }
          console.log(`[handlePublishAction] URL ${index} - After cleaning attempt: '${currentUrl}'`);
          return currentUrl;
        }
        console.log(`[handlePublishAction] URL ${index} - Not a string or encountered issue, returning original: '${url}'`);
        return url; // Pass through if not a string or if logic failed.
      }).filter(urlOutputFromMap => {
        // Now filter based on the result from the map
        const isValid = typeof urlOutputFromMap === 'string' && urlOutputFromMap.length > 0 && !urlOutputFromMap.includes(';');
        if (!isValid) {
            console.warn(`[handlePublishAction] Filtering out URL after map: '${urlOutputFromMap}' (Type: ${typeof urlOutputFromMap}, Length: ${typeof urlOutputFromMap === 'string' ? urlOutputFromMap.length : 'N/A'}, Includes Semicolon: ${typeof urlOutputFromMap === 'string' ? urlOutputFromMap.includes(';') : 'N/A'})`);
        }
        return isValid;
      });

      console.log("[handlePublishAction] Cleaned image URIs for canonical payload (after map and filter):", JSON.stringify(cleanedImageUrisForPayload, null, 2));

      let finalCoverImageIndex = 0;
      if (cleanedImageUrisForPayload.length > 0) {
        if (coverImageIndex >= 0 && coverImageIndex < cleanedImageUrisForPayload.length) {
          finalCoverImageIndex = coverImageIndex;
        } else {
          // If original coverImageIndex is out of bounds for the cleaned list, default to 0
          // This also handles the case where coverImageIndex might have been -1
          finalCoverImageIndex = 0; 
        }
      }
      // --- END NEW: Defensive cleaning --- 

      // --- Correcting the weightUnit key ---
      let correctedFormDataForCanonical = { ...formData[activeFormTab] };
      if (correctedFormDataForCanonical.hasOwnProperty(' weightUnit')) {
        correctedFormDataForCanonical.weightUnit = correctedFormDataForCanonical[' weightUnit'];
        delete correctedFormDataForCanonical[' weightUnit'];
      }
      // --- End correction ---

      const canonicalDetailsPayload = {
        productId: productId,
        variantId: variantId,
        publishIntent: "SAVE_SSSYNC_DRAFT", 
        platformDetails: {
          canonical: {
            // ...correctedFormDataForCanonical, // Use the corrected form data
            // Ensure all required fields are present, even if not in correctedFormDataForCanonical
            title: correctedFormDataForCanonical?.title || 'Untitled Product',
            description: correctedFormDataForCanonical?.description || '',
            price: correctedFormDataForCanonical?.price === undefined ? 0 : correctedFormDataForCanonical.price,
            sku: correctedFormDataForCanonical?.sku || ('DRAFT-' + (productId?.substring(0, 8) || 'temp')),
            barcode: correctedFormDataForCanonical?.barcode || '',
            status: correctedFormDataForCanonical?.status || 'draft',
            tags: correctedFormDataForCanonical?.tags || [],
            brand: correctedFormDataForCanonical?.brand || '',
            vendor: correctedFormDataForCanonical?.vendor || '',
            weight: correctedFormDataForCanonical?.weight === undefined ? null : correctedFormDataForCanonical.weight,
            condition: correctedFormDataForCanonical?.condition || '',
            weightUnit: correctedFormDataForCanonical?.weightUnit || null, // Ensure this is the corrected key
            productType: correctedFormDataForCanonical?.productType || '',
            compareAtPrice: correctedFormDataForCanonical?.compareAtPrice === undefined ? null : correctedFormDataForCanonical.compareAtPrice,
            categorySuggestion: correctedFormDataForCanonical?.categorySuggestion || '',
            // Add any other specific fields from formData[activeFormTab] that should be in canonical, ensuring correct keys
          }
        },
        media: {
          imageUris: cleanedImageUrisForPayload, // Use the cleaned version
          coverImageIndex: finalCoverImageIndex, // Use the adjusted cover index
        },
        selectedPlatformsToPublish: null, 
      };

      // --- AGGRESSIVE LAST-MINUTE CLEANING ---
      if (canonicalDetailsPayload.media && Array.isArray(canonicalDetailsPayload.media.imageUris)) {
        console.log("[handlePublishAction] About to perform AGGRESSIVE last-minute cleaning on payload's imageUris. Current value:", JSON.stringify(canonicalDetailsPayload.media.imageUris));
        
        const aggressivelyCleanedUris: string[] = [];
        for (const url of canonicalDetailsPayload.media.imageUris) {
          if (typeof url === 'string') {
            let cleanedUrl = url.trim();
            if (cleanedUrl.endsWith(';')) {
              console.warn(`[handlePublishAction] AGGRESSIVE CLEAN: Removing trailing semicolon from URL: ${cleanedUrl}`);
              cleanedUrl = cleanedUrl.slice(0, -1);
            }
            if (cleanedUrl.length > 0) { // Ensure non-empty string after cleaning
              aggressivelyCleanedUris.push(cleanedUrl);
            }
          } else {
            // If somehow a non-string made it this far, log and skip it
            console.warn(`[handlePublishAction] AGGRESSIVE CLEAN: Found non-string in imageUris, skipping:`, url);
          }
        }
        canonicalDetailsPayload.media.imageUris = aggressivelyCleanedUris;
        console.log("[handlePublishAction] AGGRESSIVE last-minute cleaning complete. New value:", JSON.stringify(canonicalDetailsPayload.media.imageUris));
      }
      // --- END AGGRESSIVE CLEANING ---

      console.log("[handlePublishAction] Canonical Details Payload for /products/publish (FINAL just before stringify):", JSON.stringify(canonicalDetailsPayload, null, 2));
      
      // --- HYPER-FOCUSED STRINGIFY TEST ---
      let bodyAsString: string;
      try {
        if (canonicalDetailsPayload.media && canonicalDetailsPayload.media.imageUris && canonicalDetailsPayload.media.imageUris[0]) {
            console.log(`[handlePublishAction] Directly accessing payload.media.imageUris[0] before any stringify: '${canonicalDetailsPayload.media.imageUris[0]}' (Length: ${canonicalDetailsPayload.media.imageUris[0].length})`);
        }
        const stringifiedMediaUris = JSON.stringify(canonicalDetailsPayload.media.imageUris);
        console.log(`[handlePublishAction] Separately stringified media.imageUris: ${stringifiedMediaUris}`);
        
        // Construct body by embedding the pre-stringified media URIs
        const payloadCopy = { ...canonicalDetailsPayload };
        // @ts-ignore
        delete payloadCopy.media; // Remove original media to avoid conflict, we'll add it back as a string part

        bodyAsString = `{
          "productId": ${JSON.stringify(payloadCopy.productId)},
          "variantId": ${JSON.stringify(payloadCopy.variantId)},
          "publishIntent": ${JSON.stringify(payloadCopy.publishIntent)},
          "platformDetails": ${JSON.stringify(payloadCopy.platformDetails)},
          "media": {"imageUris": ${stringifiedMediaUris}, "coverImageIndex": ${JSON.stringify(canonicalDetailsPayload.media.coverImageIndex)}},
          "selectedPlatformsToPublish": ${JSON.stringify(payloadCopy.selectedPlatformsToPublish)}
        }`;
        console.log("[handlePublishAction] Manually constructed body string with pre-stringified imageUris:", bodyAsString);
      } catch (stringifyError: any) {
        console.error("[handlePublishAction] Error during HYPER-FOCUSED STRINGIFY TEST:", stringifyError);
        // Fallback to direct stringification if manual construction fails
        bodyAsString = JSON.stringify(canonicalDetailsPayload);
        console.log("[handlePublishAction] Falling back to direct JSON.stringify(canonicalDetailsPayload) for body.");
      }
      // --- END HYPER-FOCUSED STRINGIFY TEST ---

      console.log("[handlePublishAction] FINAL bodyAsString for /api/products/publish:", bodyAsString);

      const saveResponse = await fetch(`https://api.sssync.app/api/products/publish`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: bodyAsString, // Use the potentially manually constructed string
      });

      if (!saveResponse.ok) {
        let errorMsg = `Failed to save canonical product details. Status: ${saveResponse.status}`;
        try {
          const errorData = await saveResponse.json();
          errorMsg = errorData.message || errorMsg;
        } catch (e) { /* ignore if response is not json */ }
        console.error("[handlePublishAction] Error saving canonical details:", errorMsg);
        throw new Error(errorMsg);
      }
      console.log("[handlePublishAction] Step 1: Canonical product details saved successfully.");
      // --- End Step 1 ---

      // Handle Shopify publish if selected
      if (selectedPlatforms.includes('shopify') && productId && platformConnectionId) {
        console.log("[handlePublishAction] Step 2: Proceeding to publish to Shopify...");
        const originalShopifyConnection = userPlatformConnections.find(
          (conn: any) => conn.Id === platformConnectionId && conn.PlatformType === 'shopify'
        );

        const locationsToPublish = selectedLocations
          .filter(loc => loc.quantity > 0)
          .map(loc => ({
            locationId: loc.id,
            quantity: loc.quantity
          }));

        if (locationsToPublish.length === 0) {
          // This check might still be relevant if user deselects all quantities after canonical save but before this point.
          throw new Error("Please set inventory quantity for at least one location for Shopify.");
        }

        const shopifyData = formData?.shopify || {};
        
        const apiUrl = `https://api.sssync.app/api/products/${productId}/publish/shopify`;
        const requestBody = {
              platformConnectionId,
          locations: locationsToPublish, // Use the filtered and mapped locations
              options: {
                status: status.toUpperCase(),
                vendor: shopifyData.vendor || undefined,
                productType: shopifyData.productType || undefined,
                tags: Array.isArray(shopifyData.tags) ? shopifyData.tags : [],
                // Add cleaned image information for Shopify publish
                imageUris: cleanedImageUrisForPayload, 
                coverImageIndex: finalCoverImageIndex 
              }
        };
        console.log('[handlePublishAction] Attempting to POST to Shopify URL:', apiUrl);
        console.log('[handlePublishAction] Shopify Request Body:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorData = await response.json();
          // ... existing error handling for Shopify publish ...
          if (response.status === 403) {
            throw new Error("Shopify publishing is not enabled for your subscription");
          } else if (response.status === 400) {
            throw new Error(errorData.message || "Invalid request data for Shopify publish");
          } else {
            throw new Error(errorData.message || `Shopify publish HTTP error! status: ${response.status}`);
          }
        }

        const publishResponse: ShopifyPublishResponse = await response.json();
        if (!publishResponse.success) {
          // This case might be redundant if !response.ok already caught it, 
          // but good to have if backend can return 200 OK with success: false.
          throw new Error("Shopify publish operation reported failure."); 
        }

        let successMessage = `Product queued for publishing to Shopify as ${status}.`;
        if (publishResponse.operationId) {
          successMessage += `\nOperation ID: ${publishResponse.operationId}`;
        }
        Alert.alert("Publish Queued", successMessage);

        if (originalShopifyConnection && originalShopifyConnection.Status === 'needs_review') {
          Alert.alert(
            "Connection Review Needed",
            "Your Shopify connection status is still 'needs_review'. The product is queued for publishing, but you may need to complete the connection setup or mapping process in your profile for it to fully publish to Shopify."
          );
        }

        // Reset state and navigate back (or to a success screen)
        // Consider moving this reset logic to a separate function if it gets too repetitive
        setCurrentStage(ListingStage.PlatformSelection);
        setSelectedPlatforms([]);
        setFormData(null);
        setCapturedMedia([]);
        setCoverImageIndex(-1);
        // ProductId and VariantId might need to be cleared or handled based on whether this was a new creation or an edit.
        // For now, let's keep them if we intend to allow further edits or re-publishing without starting over.
        // setProductId(null); 
        // setVariantId(null);
        // setUploadedImageUrls([]); // Keep if you want to re-use images for another platform quickly
        // setPlatformConnectionId(null); // Might be needed if user changes store

      } else if (selectedPlatforms.includes('shopify') && (!productId || !platformConnectionId)) {
        // This case would be if Shopify is selected but prerequisites are missing (should be caught earlier)
        throw new Error("Cannot publish to Shopify: Missing Product ID or Shopify Connection ID.");
      } else if (selectedPlatforms.length > 0) {
        // Handle other platforms or a general success message if no specific platform publish was done here
        console.log(`Publishing as ${status} for other selected platforms... (Not implemented for direct API call yet)`);
        Alert.alert("Save Successful", `Product details saved. Publishing to other platforms is not yet implemented via this direct flow.`);
        // Potentially reset or navigate as above
      } else {
        // No platforms selected, but canonical save was done.
        Alert.alert("Save Successful", "Product details saved to your account.");
      }

    } catch (err: any) {
      console.error("[handlePublishAction] Error:", err);
      
      // Check if it's the specific Shopify Product ID error and if we should ignore it
      if (ignoreShopifyIdErrors && 
          err.message && 
          (err.message.includes("Failed to obtain Shopify Product ID") || 
           err.message.includes("Status: CREATED"))) {
        
        console.warn("[handlePublishAction] Ignoring Shopify ID error due to debug toggle:", err.message);
        
        // Show a success message anyway since the product was created
        Alert.alert(
          "Product Created (Debug Mode)", 
          "The product appears to have been created successfully, but the Shopify Product ID could not be obtained. " +
          "This error was ignored due to your debug settings."
        );
        
        // Reset to platform selection as if successful
        setCurrentStage(ListingStage.PlatformSelection);
        setSelectedPlatforms([]);
        setFormData(null);
        setCapturedMedia([]);
        setCoverImageIndex(-1);
        
      } else {
        // Normal error handling for other errors
        Alert.alert("Publish Error", err.message);
        // Revert to FormReview so user can see the form and try again or save draft
        setCurrentStage(ListingStage.FormReview);
      }
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
      // Modal is closed by the Confirm button's onPress in renderPublishModal
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

  // --- AI Testing Functions ---
  const testAiBackfill = async () => {
    setIsLoading(true);
    setLoadingMessage('🧠 Testing AI embedding backfill...');
    
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !sessionData?.session?.access_token) {
        setError("Authentication error. Please log out and back in.");
        return;
      }

      const token = sessionData.session.access_token;
      const backfillUrl = `https://sssync-bknd-production.up.railway.app/api/tasks/backfill-embeddings`;
      
      const response = await fetch(backfillUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ batchSize: 10 }) // Small batch for testing
      });

      const result: BackfillResponse = await response.json();
      
      if (response.ok) {
        Alert.alert("✅ Backfill Success", result.message);
        console.log("AI Backfill completed:", result);
      } else {
        throw new Error(result.message || 'Unknown error');
      }
    } catch (error: any) {
      console.error("AI Backfill test failed:", error);
      setError(`AI Backfill Failed: ${error.message}`);
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  // --- NEW: Render debug options UI ---
  const renderDebugOptions = () => {
    if (!__DEV__) return null; // Only show in development mode
    
    return (
      <View style={styles.debugOptionsContainer}>
        <TouchableOpacity
          style={styles.debugOptionRow}
          onPress={testAiBackfill}
        >
          <View style={styles.debugToggle}>
            <Icon name="brain" size={24} color="#FF6B35" />
          </View>
          <View style={styles.debugOptionTextContainer}>
            <Text style={styles.debugOptionTitle}>Test AI Backfill</Text>
            <Text style={styles.debugOptionDescription}>Generate embeddings for 10 existing products</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.debugOptionRow}
          onPress={() => setShowAiDebugInfo(!showAiDebugInfo)}
        >
          <View style={styles.debugToggle}>
            <Icon name={showAiDebugInfo ? "eye" : "eye-off"} size={24} color={showAiDebugInfo ? "#007AFF" : "#999"} />
          </View>
          <View style={styles.debugOptionTextContainer}>
            <Text style={styles.debugOptionTitle}>AI Debug Info</Text>
            <Text style={styles.debugOptionDescription}>
              {showAiDebugInfo ? "ON - Show AI processing steps and metadata" : "OFF - Hide AI debug information"}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.debugOptionRow}
          onPress={() => setIgnoreShopifyIdErrors(!ignoreShopifyIdErrors)}
        >
          <View style={styles.debugToggle}>
            <Icon 
              name={ignoreShopifyIdErrors ? "toggle-switch" : "toggle-switch-off"} 
              size={24} 
              color={ignoreShopifyIdErrors ? "#ff9500" : "#999"} 
            />
          </View>
          <View style={styles.debugOptionTextContainer}>
            <Text style={styles.debugOptionTitle}>Ignore Shopify ID Errors</Text>
            <Text style={styles.debugOptionDescription}>
              {ignoreShopifyIdErrors 
                ? "ON - Will ignore 'Failed to obtain Shopify Product ID' errors" 
                : "OFF - Will report all Shopify ID errors normally"}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    );
  };
  // --- End NEW --- 

  // --- NEW: Render function for Add Platform Modal ---
  const renderAddPlatformModal = () => {
    const availableToAdd = AVAILABLE_PLATFORMS.filter(p => !selectedPlatforms.includes(p.key));

    return (
      <Modal
        transparent={true}
        visible={isAddPlatformModalVisible}
        onRequestClose={() => setIsAddPlatformModalVisible(false)}
        animationType="fade"
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsAddPlatformModalVisible(false)}>
          {/* Use Pressable for the content area to stop propagation if user clicks inside modal content */}
          <Pressable style={styles.addPlatformModalContent} onPress={(e) => e.stopPropagation()}> 
            <Text style={styles.modalTitle}>Add Another Platform</Text>
            {availableToAdd.length > 0 ? (
              <FlatList
                data={availableToAdd}
                keyExtractor={item => item.key}
                renderItem={({ item }) => (
                  <TouchableOpacity 
                    style={styles.addPlatformModalItem}
                    onPress={() => handleAddPlatformFromModal(item.key)}
                  >
                    {/* Assuming platformImageMap is available and contains image sources */}
                    {React.createElement(platformImageMap[item.key], {
                      width: 40,
                      height: 40,
                      style: styles.addPlatformModalIcon
                    })}
                    <Text style={styles.addPlatformModalText}>{item.name}</Text>
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.addPlatformModalSeparator} />}
              />
            ) : (
              <Text style={styles.addPlatformModalEmptyText}>All available platforms are already selected.</Text>
            )}
            <Button 
              title="Close" 
              onPress={() => setIsAddPlatformModalVisible(false)} 
              style={styles.modalCancelButton} 
              outlined // Assuming 'outlined' is a valid prop for your Button component
            />
          </Pressable>
        </Pressable>
      </Modal>
    );
  };
  // --- End NEW --- 

  // --- NEW: Render function for Publish Modal ---
  const renderPublishModal = () => {
    // Determine status for publishing. For now, use Shopify form status or default to active.
    const shopifyFormData = formData?.shopify;
    const publishStatus = shopifyFormData?.status && ['active', 'draft', 'archived'].includes(shopifyFormData.status)
                          ? shopifyFormData.status
                          : 'active'; // Default to 'active'

    return (
      <Modal
        transparent={true}
        visible={isPublishModalVisible} // Controlled by state
        onRequestClose={() => setIsPublishModalVisible(false)}
        animationType="fade"
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsPublishModalVisible(false)}>
          {/* Use Pressable for the content area to stop propagation if user clicks inside modal content */}
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Confirm Publish Options</Text>

            {selectedPlatforms.includes('shopify') && (
              <View style={styles.formSection}> {/* Re-use formSection style for consistency */}
                <Text style={styles.sectionTitle}>Shopify Details</Text>
                <Text style={styles.modalSubtitle}>
                  Product will be published to Shopify with status: <Text style={{fontWeight: 'bold'}}>{publishStatus.toUpperCase()}</Text>
                </Text>
                <Text style={styles.sectionTitle}>Locations to Publish:</Text>
                {isLoadingLocations ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} style={{marginVertical: 10}} />
                ) : selectedLocations.filter(l => l.quantity > 0).length > 0 ? (
                  <FlatList
                    data={selectedLocations.filter(l => l.quantity > 0)}
                    keyExtractor={item => item.id}
                    renderItem={({ item }) => (
                      <View style={styles.locationItemModal}>
                        <Text style={styles.locationNameModal}>{item.name}</Text>
                        <Text style={styles.locationQuantityModal}>Quantity: {item.quantity}</Text>
                      </View>
                    )}
                    style={{maxHeight: 150, marginBottom: 10}} // Limit height and add margin
                  />
                ) : (
                  <Text style={styles.noLocationsText}>No locations selected with quantity for Shopify.</Text>
                )}
              </View>
            )}
            {/* TODO: Add sections for other platforms if needed when publishing to them */}

            <View style={styles.modalButtonContainerPublish}>
              <Button
                title="Cancel"
                onPress={() => setIsPublishModalVisible(false)}
                outlined
                style={StyleSheet.flatten([styles.modalButton, styles.modalCancelButton])} // Ensure these styles exist or adjust
              />
              <Button
                title={`Confirm & Publish`}
                onPress={() => {
                  handlePublishAction(publishStatus as 'active' | 'draft' | 'archived');
                  setIsPublishModalVisible(false); // Close modal after action
                }}
                // Disable if Shopify is selected but no locations have quantity > 0
                disabled={selectedPlatforms.includes('shopify') && selectedLocations.filter(l => l.quantity > 0).length === 0 && !isLoadingLocations}
                style={StyleSheet.flatten([styles.modalButton, styles.modalConfirmButton])} // Ensure these styles exist or adjust
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  };
  // --- End NEW --- 

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
          <Text style={styles.headerTitle}>Add A New Product</Text>
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
                    React.createElement(imageSource, {
                      width: 70,
                      height: 70,
                      style: [styles.platformImage, !isSelected && styles.platformImageDeselected]
                    })
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
    // --- Barcode Scanning Handlers ---
    const handleBarcodeSelect = (barcode: DetectedBarcode) => {
        const newSelectedValue = barcode.data === selectedBarcode ? null : barcode.data;
        setSelectedBarcode(newSelectedValue);
  
        setDetectedBarcodes(prev => prev.map(b => ({
            ...b,
            isSelected: b.data === newSelectedValue
        })));
  
        if (newSelectedValue) {
            console.log(`Selected Barcode: ${newSelectedValue}`);
      }
    };

      // --- Draggable Item Renderer ---
      const handleImageTap = (itemId: string) => {
        const now = Date.now();
        const DOUBLE_TAP_DELAY = 300; // milliseconds
        
        if (lastTapRef.current.itemId === itemId && 
            now - lastTapRef.current.time < DOUBLE_TAP_DELAY) {
          // Double tap detected - set as cover
          const index = capturedMedia.findIndex(m => m.id === itemId);
          handleSetCover(index);
          lastTapRef.current = { itemId: null, time: 0 }; // Reset
        } else {
          // Single tap - just record for potential double tap
          lastTapRef.current = { itemId, time: now };
        }
      };

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
              onPress={() => handleImageTap(item.id)}
              onLongPress={drag}
              disabled={isActive}
              activeOpacity={0.9}
            >
              <Image source={{ uri: item.uri }} style={styles.previewImage} />
              {item.type === 'video' && (
                <View style={styles.videoIndicatorPreview}><Icon name="play-circle" size={16} color={'white'} /></View>
              )}
              <TouchableOpacity style={styles.deleteMediaButton} onPress={() => handleRemoveMedia(item.id)}>
                <Icon name="close-circle" size={18} color="#FF5252" />
              </TouchableOpacity>
            </TouchableOpacity>
          </ScaleDecorator>
        );
      };

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

          return (
        <View style={styles.cameraStageContainer}>
        <CameraView 
          ref={cameraRef} 
          style={styles.cameraPreview} 
          facing={facing} 
          flash={flash}
          barcodeScannerSettings={{
            barcodeTypes: ["qr", "ean13", "upc_a", "upc_e", "code128"],
          }}
          onBarcodeScanned={isBarcodeScanningActive ? handleBarcodeScanned : undefined}
        >
            <View style={styles.cameraHeader}>
              <TouchableOpacity onPress={toggleFlash} style={styles.headerButton} disabled={facing === 'front'}>
                <Icon name={getFlashIcon()} size={24} color={facing === 'front' ? 'grey' : 'white'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={toggleCameraFacing} style={styles.headerButton}>
                <Icon name="camera-switch-outline" size={24} color="white" />
              </TouchableOpacity>
                  </View>
          
          {isBarcodeScanningActive && detectedBarcodes.map((barcode, index) => {
            const boundingBox = barcode.boundingBox || {
              origin: { x: 50, y: 100 + (index * 60) },
              size: { width: 200, height: 50 }
            };
            return (
              <TouchableOpacity
                  key={barcode.data}
                  style={[
                      styles.barcodeBrackets,
                      {
                          left: boundingBox.origin.x,
                          top: boundingBox.origin.y,
                          width: boundingBox.size.width,
                          height: boundingBox.size.height,
                      },
                      barcode.isSelected && styles.barcodeBracketsSelected
                  ]}
                  onPress={() => handleBarcodeSelect(barcode)}
                  activeOpacity={0.7}
              >
                {/* Corner brackets */}
                <View style={[
                  styles.bracketCorner, 
                  styles.bracketTopLeft,
                  barcode.isSelected && { borderColor: '#4CAF50' }
                ]} />
                <View style={[
                  styles.bracketCorner, 
                  styles.bracketTopRight,
                  barcode.isSelected && { borderColor: '#4CAF50' }
                ]} />
                <View style={[
                  styles.bracketCorner, 
                  styles.bracketBottomLeft,
                  barcode.isSelected && { borderColor: '#4CAF50' }
                ]} />
                <View style={[
                  styles.bracketCorner, 
                  styles.bracketBottomRight,
                  barcode.isSelected && { borderColor: '#4CAF50' }
                ]} />
                
                {/* Barcode text */}
                <View style={styles.barcodeTextContainer}>
                  <Text style={styles.barcodeText}>{barcode.data}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          </CameraView>

          {/* Top Left Image Preview */}
          {capturedMedia.length > 0 && (
            <View style={styles.topLeftPreviewContainer}>
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
                numColumns={1}
                contentContainerStyle={styles.verticalPreviewScroll}
                showsVerticalScrollIndicator={false}
                  />
                </View>
          )}

          <View style={styles.bottomControlsContainer}>
            <TouchableOpacity style={styles.sideControlButton} onPress={pickImagesFromLibrary} disabled={capturedMedia.length >= 10}>
              <Icon name="image-multiple-outline" size={30} color={capturedMedia.length >= 10 ? "grey" : "white"} />
            </TouchableOpacity>
          <TouchableOpacity style={styles.captureButton} onPress={takePicture} disabled={capturedMedia.length >= 10}>
            <View style={[ styles.captureInner, capturedMedia.length >= 10 && styles.captureDisabledInner]} />
            </TouchableOpacity>
          <TouchableOpacity style={styles.sideControlButton} onPress={() => {
            console.log('[Barcode Toggle] Toggling barcode scanning from:', isBarcodeScanningActive, 'to:', !isBarcodeScanningActive);
            setIsBarcodeScanningActive(prev => {
              const newValue = !prev;
              // Clear detected barcodes when toggling off
              if (!newValue) {
                setDetectedBarcodes([]);
                barcodeCache.current = {};
                setSelectedBarcode(null);
              }
              return newValue;
            });
          }}>
            <Icon name={isBarcodeScanningActive ? "barcode-off" : "barcode-scan"} size={30} color={isBarcodeScanningActive ? "#4CAF50" : "white"} />
                          </TouchableOpacity>
                </View>
                
          <View style={styles.cameraStageHeader}>
            <Text style={styles.stageTitleCamera}>Add Product Media</Text>
            <Text style={styles.stageSubtitleCamera}>
              {capturedMedia.length}/10 items. {capturedMedia.length > 0 ? 'Drag to reorder. Double-tap preview to set cover.' : 'Use camera or upload.'}
              {isBarcodeScanningActive && ' • Barcode scanning active'}
              {detectedBarcodes.length > 0 && ` • ${detectedBarcodes.length} barcode(s) detected`}
              {detectedBarcodes.length > 1 && ' • Tap to select'}
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

               {/* AI Debug Information */}
               {showAiDebugInfo && recognitionResult && (
                 <View style={{backgroundColor: '#f0f0f0', padding: 12, marginVertical: 8, borderRadius: 8}}>
                   <Text style={{fontWeight: 'bold', fontSize: 14, marginBottom: 4}}>🤖 AI Debug Info</Text>
                   <Text style={{fontSize: 12, color: '#666'}}>
                     Confidence: {recognitionResult.confidence} | Action: {recognitionResult.systemAction}
                   </Text>
                   <Text style={{fontSize: 12, color: '#666'}}>
                     Processing Time: {recognitionResult.metadata.processingTimeMs}ms
                   </Text>
                   <Text style={{fontSize: 12, color: '#666'}}>
                     Models: {recognitionResult.metadata.modelsUsed.join(', ')}
                   </Text>
                   {aiProcessingSteps.length > 0 && (
                     <View style={{marginTop: 4}}>
                       <Text style={{fontSize: 12, fontWeight: 'bold'}}>Processing Steps:</Text>
                       {aiProcessingSteps.slice(-3).map((step, index) => (
                         <Text key={index} style={{fontSize: 11, color: '#555', marginLeft: 8}}>
                           • {step}
                         </Text>
                       ))}
                     </View>
                   )}
                 </View>
               )}

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
    // console.log("[renderFormReview] Current form data:", JSON.stringify(formData, null, 2));
    // console.log("[renderFormReview] Selected platforms:", selectedPlatforms);
    // console.log("[renderFormReview] Route params:", JSON.stringify(route.params, null, 2));

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
      // console.log("[renderLocationsSection] Current platform key:", currentPlatformKey); // Can be verbose
      // console.log("[renderLocationsSection] Shopify locations from state:", shopifyLocations); // Very verbose
      // console.log("[renderLocationsSection] Selected locations from state:", selectedLocations); // Very verbose
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
                          value={selectedLocation.quantity === 0 ? '0' : String(selectedLocation.quantity)} // Display blank if 0
                          onChangeText={(value) => updateLocationQuantity(location.id, value)} // Use updated function
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
                {React.createElement(platformImageMap[platformKey], {
                  width: 40,
                  height: 40,
                  style: styles.platformTabIcon
                })}
                <Text style={[styles.platformTabText, activeFormTab === platformKey && styles.platformTabTextActive]}>
                  {AVAILABLE_PLATFORMS.find(p => p.key === platformKey)?.name || platformKey}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.addPlatformButton}
              onPress={() => setIsAddPlatformModalVisible(true)} // <-- UPDATED
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
            
            {/* Add debug options right before the bottom buttons */}
            {renderDebugOptions()}
            
          </ScrollView>
        </KeyboardAvoidingView>

        {/* --- NEW Bottom Action Buttons --- */}
        <View style={styles.formReviewBottomActionsContainer}>
          <TouchableOpacity
            style={[styles.formReviewActionButton, styles.formReviewBackButton]}
            onPress={() => {
              // Simplified back logic: always go to VisualMatch if available, else PlatformSelection
              if (analysisResponse) { // analysisResponse is set when VisualMatch stage was reached
                setCurrentStage(ListingStage.VisualMatch);
              } else {
                setCurrentStage(ListingStage.PlatformSelection);
              }
            }}
          >
            <Icon name="arrow-left" size={20} color={theme.colors.text} />
            <Text style={styles.formReviewActionButtonText}>Back</Text>
          </TouchableOpacity>

            <TouchableOpacity
            style={[styles.formReviewActionButton, styles.formReviewSaveButton]}
            onPress={handleSaveDraft} // Assuming handleSaveDraft is implemented
          >
            <Icon name="content-save-outline" size={20} color={theme.colors.primary} />
            <Text style={[styles.formReviewActionButtonText, { color: theme.colors.primary }]}>Save Draft</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.formReviewActionButton, styles.formReviewPublishButton]}
            onPress={handlePublish} // This opens the publish modal
            >
            <Icon name="cloud-upload-outline" size={20} color='#FFFFFF' />
            <Text style={[styles.formReviewActionButtonText, { color: '#FFFFFF' }]}>Publish</Text>
            </TouchableOpacity>
        </View>
        {/* --- END NEW Bottom Action Buttons --- */}

      </View>
    );
  };

  // --- Enhanced Search Stage --- //
  const renderEnhancedSearch = () => {
    const businessTemplates = [
      { key: 'electronics', name: '📱 Electronics', description: 'Phones, computers, gadgets' },
      { key: 'clothing', name: '👕 Clothing', description: 'Fashion, apparel, accessories' },
      { key: 'books', name: '📚 Books', description: 'Literature, textbooks, magazines' },
      { key: 'toys', name: '🧸 Toys', description: 'Children\'s toys, games' },
      { key: 'automotive', name: '🚗 Automotive', description: 'Car parts, accessories' },
      { key: 'home_garden', name: '🏠 Home & Garden', description: 'Furniture, tools, decor' }
    ];

    return (
      <View style={styles.stageContainer}>
        <Text style={styles.stageTitle}>Enhanced Product Search</Text>
        <Text style={styles.stageSubtitle}>
          Choose your product category and search method. Our AI will optimize recognition for better results.
        </Text>

        {/* Business Template Selector */}
        <View style={{marginBottom: 20}}>
          <Text style={{fontSize: 16, fontWeight: '600', marginBottom: 10, color: '#333'}}>Product Category:</Text>
          <View style={styles.templateGrid}>
            {businessTemplates.map((template) => (
              <TouchableOpacity
                key={template.key}
                style={[
                  styles.templateCard,
                  selectedBusinessTemplate === template.key && styles.templateCardSelected
                ]}
                onPress={() => setSelectedBusinessTemplate(template.key)}
              >
                <Text style={[
                  styles.templateName,
                  selectedBusinessTemplate === template.key && styles.templateNameSelected
                ]}>
                  {template.name}
                </Text>
                <Text style={styles.templateDescription}>{template.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        
        <View style={styles.searchOptionsContainer}>
          <TouchableOpacity 
            style={styles.searchOptionButton}
            onPress={() => setCurrentStage(ListingStage.ImageInput)}
          >
            <MaterialIcons name="photo-camera" size={24} color="#007AFF" />
            <Text style={styles.searchOptionText}>Take Photo & Search</Text>
            <Text style={styles.searchOptionSubtext}>AI visual product identification</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.searchOptionButton}
            onPress={() => {
              // TODO: Navigate to EnhancedSearchScreen
              console.log("Navigate to enhanced search - placeholder");
              setCurrentStage(ListingStage.PlatformSelection);
            }}
          >
            <MaterialIcons name="search" size={24} color="#007AFF" />
            <Text style={styles.searchOptionText}>Advanced Search</Text>
            <Text style={styles.searchOptionSubtext}>Custom templates & web search</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.searchOptionButton}
            onPress={() => setCurrentStage(ListingStage.PlatformSelection)}
          >
            <MaterialIcons name="edit" size={24} color="#007AFF" />
            <Text style={styles.searchOptionText}>Manual Entry</Text>
            <Text style={styles.searchOptionSubtext}>Create product from scratch</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={styles.skipButton}
          onPress={() => setCurrentStage(ListingStage.PlatformSelection)}
        >
          <Text style={styles.skipButtonText}>Skip Search</Text>
        </TouchableOpacity>

        {/* Debug Options */}
        {__DEV__ && renderDebugOptions()}
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
        if (currentStage === ListingStage.EnhancingData) return renderLoading('Gathering Detailed Product Information...');
        if (currentStage === ListingStage.Generating) return renderLoading('Generating Optimized Listings...');
        if (currentStage === ListingStage.Publishing) return renderLoading('Publishing...');
        return renderLoading(loadingMessage || 'Loading...');
    }

    // Restore original switch statement
    switch (currentStage) {
        case ListingStage.EnhancedSearch: return renderEnhancedSearch();
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



  // --- Main Render (Ensure this is the final return) --- //
  console.log("[AddListingScreen] Rendering main SafeAreaView with renderCurrentStage");
  return (
    <SafeAreaView style={styles.container}>
      {renderCurrentStage()}
      {renderAddPlatformModal()} 
      {/* NEW: Render the Publish Modal */}
      {isPublishModalVisible && renderPublishModal()} 
      {/* NEW: Render CameraSection inside a Modal */}
      <Modal
        visible={showCameraSection}
        onRequestClose={() => setShowCameraSection(false)}
        animationType="slide"
        style={{ margin: 0 }} // Remove default margin for full screen modal
      >
        <CameraSection
          onCapture={handleMediaCaptured}
          onClose={() => setShowCameraSection(false)}
          styles={styles} // Pass styles down
          initialMedia={capturedMedia} // Pass current media down
        />
      </Modal>
    </SafeAreaView>
  );
  // REMOVE any return null placeholders below this point

};

export default AddListingScreen;

// --- Styles --- //
const styles = StyleSheet.create(
  {
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
  topLeftPreviewContainer: {
      position: 'absolute',
      top: Platform.OS === 'android' ? 150 : 170, // Below stage header
      left: 15,
      width: 90,
      maxHeight: 400,
      backgroundColor: 'rgba(0,0,0,0.4)',
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 5,
      zIndex: 2,
  },
  previewScroll: {
      paddingHorizontal: 10,
      alignItems: 'center'
  },
  verticalPreviewScroll: {
      flexGrow: 1,
      alignItems: 'center',
  },
  previewImageContainer: {
      width: 70,
      height: 70,
      borderRadius: 6,
      marginVertical: 4,
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
      width: 100,
      height: 100,
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
    width: 80, // Increased width
    textAlign: 'center',
  },
  noLocationsText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 10,
  },
  // --- NEW Styles for FormReview Bottom Actions ---
  formReviewBottomActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0', // Slightly softer border
    backgroundColor: '#f8f9fa', // Light background
    marginTop: 10,
    marginBottom: 10,
  },
  formReviewActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15, // Balanced padding
    paddingVertical: 10,
    borderRadius: 20, // Rounded like platform tabs
    borderWidth: 1,
    borderColor: '#ccc', // Default border
    minWidth: 100, // Ensure decent tap target
    justifyContent: 'center',
    marginTop: 30,
    marginBottom: 30,
  },
  formReviewBackButton: {
    backgroundColor: '#fff',
    borderColor: '#ccc',
  },
  formReviewSaveButton: {
    backgroundColor: '#e8f5e9', // Light green, similar to active tab
    borderColor: '#4CAF50',
  },
  formReviewPublishButton: {
    backgroundColor: '#4CAF50', // Using a common primary color, adjust if needed
    borderColor: '#4CAF50', 
  },
  formReviewActionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
    color: '#333333', // Using a common default text color
  },
  // --- END NEW Styles ---

  // --- NEW Styles for AddPlatformModal ---
  addPlatformModalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 25,
    width: '85%',
    maxWidth: 350, // Slightly smaller than publish modal
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  addPlatformModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    width: '100%',
  },
  addPlatformModalIcon: {
    width: 24, 
    height: 24,
    marginRight: 15,
  },
  addPlatformModalText: {
    fontSize: 16,
    color: '#333',
  },
  addPlatformModalSeparator: {
    height: 1,
    backgroundColor: '#eee',
    width: '100%',
  },
  addPlatformModalEmptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    paddingVertical: 20,
  },
  // --- END Styles for AddPlatformModal ---

  // --- Styles for Publish Modal (NEW, can be refined) ---
  modalButtonContainerPublish: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
  },
  modalConfirmButton: {
    // Add specific styles for the confirm button if needed, e.g.:
    // backgroundColor: theme.colors.primary, // Or your theme's success color
  },
  locationItemModal: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  locationNameModal: {
    fontSize: 14,
    fontWeight: '500',
  },
  locationQuantityModal: {
    fontSize: 13,
    color: '#555',
  },
  // --- End Publish Modal Styles ---

  debugOptionsContainer: {
    marginTop: 20,
    padding: 10,
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    borderStyle: 'dashed',
  },
  debugOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  debugToggle: {
    marginRight: 12,
  },
  debugOptionTextContainer: {
    flex: 1,
  },
  debugOptionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  debugOptionDescription: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  // --- Styles for Barcode Overlay ---
  barcodeFrame: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.7)',
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  barcodeFrameSelected: {
    borderColor: '#4CAF50', // Green color for selected
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
  },
  barcodeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 4,
    borderRadius: 4,
  },
  barcodeBrackets: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
  barcodeBracketsSelected: {
    // Selected state styling handled by bracket corners
  },
  barcodeTextContainer: {
    position: 'absolute',
    bottom: -30,
    left: -10,
    right: -10,
    alignItems: 'center',
  },
  bracketCorner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: 'white',
    borderWidth: 3,
  },
  bracketTopLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  bracketTopRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },
  bracketBottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
  },
  bracketBottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  // --- End Barcode Overlay Styles ---

  // --- Template Selection Styles ---
  templateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  templateCard: {
    width: '48%',
    backgroundColor: '#fff',
    padding: 12,
    marginBottom: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
  },
  templateCardSelected: {
    borderColor: '#4CAF50',
    backgroundColor: '#E8F5E9',
    borderWidth: 2,
  },
  templateName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginBottom: 4,
  },
  templateNameSelected: {
    color: '#2E7D32',
  },
  templateDescription: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
  },

  // --- Enhanced Search Styles ---
  searchOptionsContainer: {
    flex: 1,
    paddingTop: 20,
    paddingBottom: 20,
  },
  searchOptionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchOptionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginLeft: 15,
    flex: 1,
  },
  searchOptionSubtext: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
    marginLeft: 15,
    flex: 1,
  },
  skipButton: {
    alignItems: 'center',
    padding: 15,
    marginHorizontal: 20,
    marginTop: 20,
  },
  skipButtonText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
  // --- End Enhanced Search Styles ---
});

// --- Platform Images Map --- //
const platformImageMap: { [key: string]: any } = {
    shopify: ShopifySvg,
    amazon: AmazonSvg,
    facebook: FacebookSvg,
    ebay: EbaySvg,
    clover: CloverSvg,
    square: SquareSvg,
};

