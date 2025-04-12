import React, { useState, useRef, useEffect } from 'react';
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
  Dimensions
} from 'react-native';
import { CameraView, Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import Animated, { 
  FadeIn, 
  FadeOut, 
  SlideInUp, 
  SlideOutDown, 
  useAnimatedStyle, 
  withTiming, 
  useSharedValue 
} from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import theme from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Button from '../components/Button';
import Card from '../components/Card';
import PlatformSelector from '../components/PlatformSelector';
import PlaceholderImage from '../components/PlaceholderImage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const CameraSection = ({ onCapture, onClose }) => {
  const [cameraPermission, setCameraPermission] = useState();
  const [facing, setFacing] = useState("back");
  const [capturedMedia, setCapturedMedia] = useState([]);
  const [cameraMode, setCameraMode] = useState("picture"); // "picture" or "video"
  const [recording, setRecording] = useState(false);
  const [flash, setFlash] = useState("off");
  const cameraRef = useRef(null);
  const theme = useTheme() || { colors: { primary: '#0E8F7F' } };
  
  
  useEffect(() => {
    (async () => {
      const cameraPermissionResponse = await Camera.requestCameraPermissionsAsync();
      const microphonePermissionResponse = await Camera.requestMicrophonePermissionsAsync();
      setCameraPermission(cameraPermissionResponse.status === "granted");
    })();
  }, []);

  const takePicture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
        });
        
        setCapturedMedia([...capturedMedia, {
          type: 'image',
          uri: photo.uri,
          width: photo.width,
          height: photo.height,
          number: capturedMedia.length + 1
        }]);
      } catch (error) {
        console.log('Error taking picture', error);
      }
    }
  };

  const startRecording = async () => {
    if (cameraRef.current) {
      setRecording(true);
      try {
        const videoData = await cameraRef.current.recordAsync({
          maxDuration: 60, // 1 minute max
          quality: '720p',
        });
        
        setCapturedMedia([...capturedMedia, {
          type: 'video',
          uri: videoData.uri,
          number: capturedMedia.length + 1
        }]);
        setRecording(false);
      } catch (error) {
        console.log('Error recording video', error);
        setRecording(false);
      }
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && recording) {
      cameraRef.current.stopRecording();
      setRecording(false);
    }
  };

  const pickMedia = async () => {
    const options = {
      mediaTypes: cameraMode === 'picture' 
        ? ImagePicker.MediaTypeOptions.Images 
        : ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: cameraMode === 'picture',
      aspect: [4, 3],
      quality: 1,
      allowsMultipleSelection: cameraMode === 'picture',
    };
    
    const result = await ImagePicker.launchImageLibraryAsync(options);
    
    if (!result.canceled && result.assets) {
      const newMedia = result.assets.map((asset, index) => ({
        type: asset.type === 'video' ? 'video' : 'image',
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        number: capturedMedia.length + index + 1
      }));
      setCapturedMedia([...capturedMedia, ...newMedia]);
    }
  };

  const toggleCameraMode = () => {
    setCameraMode(current => current === "picture" ? "video" : "picture");
  };

  const toggleFlash = () => {
    setFlash(current => current === "off" ? "on" : "off");
  };

  const toggleCameraFacing = () => {
    setFacing(current => current === "back" ? "front" : "back");
  };

  const saveAndClose = () => {
    onCapture(capturedMedia);
    onClose();
  };

  const deleteMedia = (index) => {
    const newMedia = [...capturedMedia];
    newMedia.splice(index, 1);
    
    // Renumber the remaining items
    const renumberedMedia = newMedia.map((item, idx) => ({
      ...item,
      number: idx + 1
    }));
    
    setCapturedMedia(renumberedMedia);
  };

  if (cameraPermission === undefined) {
    return (
      <View style={styles.cameraLoading}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.cameraLoadingText}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!cameraPermission) {
    return (
      <View style={styles.cameraLoading}>
        <Icon name="camera-off" size={40} color="#FF5252" />
        <Text style={styles.cameraErrorText}>No access to camera</Text>
        <Button 
          title="Grant Permission" 
          onPress={async () => {
            const { status } = await Camera.requestCameraPermissionsAsync();
            setCameraPermission(status === "granted");
          }} 
          style={{ marginTop: 16 }}
        />
        <Button 
          title="Go Back" 
          onPress={onClose} 
          outlined
          style={{ marginTop: 8 }}
        />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.cameraContainer}>
      <View style={styles.cameraHeader}>
        <TouchableOpacity onPress={onClose} style={styles.headerButton}>
          <Icon name="close" size={24} color="white" />
        </TouchableOpacity>
        
        <View style={styles.headerControls}>
          <TouchableOpacity onPress={toggleFlash} style={styles.headerButton}>
            <Icon name={flash === "on" ? "flash" : "flash-off"} size={24} color="white" />
          </TouchableOpacity>
          
          <TouchableOpacity onPress={toggleCameraFacing} style={styles.headerButton}>
            <Icon name="camera-switch" size={24} color="white" />
          </TouchableOpacity>
        </View>
      </View>
      
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flash}
        mode={cameraMode}
      >
        <View style={styles.cameraGuide}>
          {/* Subtle frame guide */}
          <View style={styles.frameGuide} />
        </View>
      </CameraView>
      
      <View style={styles.controlsContainer}>
        <TouchableOpacity 
          style={styles.modeButton}
          onPress={toggleCameraMode}
        >
          <Icon 
            name={cameraMode === "picture" ? "camera" : "video"} 
            size={24} 
            color="white" 
          />
          <Text style={styles.modeText}>
            {cameraMode === "picture" ? "Photo" : "Video"}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.captureButton}
          onPress={cameraMode === "picture" ? takePicture : recording ? stopRecording : startRecording}
        >
          <View style={[
            styles.captureInner, 
            recording && styles.recordingButton
          ]} />
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.galleryButton}
          onPress={pickMedia}
        >
          <Icon name="image-multiple" size={24} color="white" />
          <Text style={styles.modeText}>Gallery</Text>
        </TouchableOpacity>
      </View>
      
      {capturedMedia.length > 0 && (
        <View style={styles.previewContainer}>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.previewScroll}
          >
            {capturedMedia.map((media, index) => (
              <View key={index} style={styles.previewImageContainer}>
                <Image source={{ uri: media.uri }} style={styles.previewImage} />
                <View style={styles.mediaNumberBadge}>
                  <Text style={styles.mediaNumber}>{media.number}</Text>
                </View>
                {media.type === 'video' && (
                  <View style={styles.videoIndicator}>
                    <Icon name="play-circle" size={24} color="white" />
                  </View>
                )}
                <TouchableOpacity 
                  style={styles.deleteMediaButton}
                  onPress={() => deleteMedia(index)}
                >
                  <Icon name="close-circle" size={22} color="white" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          
          <TouchableOpacity 
            style={styles.doneButton}
            onPress={saveAndClose}
          >
            <Text style={styles.doneButtonText}>Done ({capturedMedia.length})</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
};

const SimilarProductsSuggestion = ({ productType }) => {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  
  // Mock data for similar products
  const similarProducts = [
    {
      id: 1,
      title: 'Commercial Hot Dog Roller Grill',
      price: 144.99,
      platform: 'Amazon',
      seller: 'Kitchen Equipment Pro',
    },
    {
      id: 2,
      title: 'Hot Dog Steamer and Bun Warmer',
      price: 119.95,
      platform: 'eBay',
      seller: 'Restaurant Supplies',
    },
    {
      id: 3,
      title: 'Professional Hot Dog Warmer Machine',
      price: 159.99,
      platform: 'Shopify',
      seller: 'Food Equipment Store',
    }
  ];
  
  // Simulate loading
  useEffect(() => {
    if (productType) {
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
      }, 1500);
    }
  }, [productType]);
  
  if (!productType) return null;
  
  const getPlatformColor = (platform) => {
    switch (platform) {
      case 'Shopify':
        return '#0E8F7F';
      case 'Amazon':
        return '#F17F5F';
      case 'eBay':
        return '#E53238';
      case 'Depop':
        return '#FF2300';
      case 'Whatnot':
        return '#FFC107';
      default:
        return '#555555';
    }
  };
  
  return (
    <Card style={styles.similarProductsCard}>
      <TouchableOpacity 
        style={styles.similarProductsHeader}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={styles.similarProductsHeaderLeft}>
          <Icon name="lightbulb-outline" size={20} color={theme.colors.primary} />
          <Text style={styles.similarProductsTitle}>Similar Products Found</Text>
        </View>
        <Icon 
          name={expanded ? "chevron-up" : "chevron-down"} 
          size={20} 
          color="#777" 
        />
      </TouchableOpacity>
      
      {expanded && (
        <View style={styles.similarProductsList}>
          {loading ? (
            <ActivityIndicator color={theme.colors.primary} style={styles.loadingIndicator} />
          ) : (
            similarProducts.map((product) => (
              <View key={product.id} style={styles.similarProductItem}>
                <PlaceholderImage
                  size={40}
                  borderRadius={4}
                  type="gradient"
                  icon="shopping"
                  color={getPlatformColor(product.platform)}
                />
                <View style={styles.similarProductInfo}>
                  <Text style={styles.similarProductTitle} numberOfLines={1}>{product.title}</Text>
                  <Text style={styles.similarProductMeta}>
                    ${product.price} on {product.platform}
                  </Text>
                </View>
                <TouchableOpacity 
                  style={[styles.useThisButton, { backgroundColor: theme.colors.primary + '20' }]}
                >
                  <Text style={[styles.useThisButtonText, { color: theme.colors.primary }]}>
                    Use
                  </Text>
                </TouchableOpacity>
              </View>
            ))
          )}
          
          <TouchableOpacity 
            style={[styles.viewAllButton, { borderColor: theme.colors.primary }]}
          >
            <Text style={[styles.viewAllButtonText, { color: theme.colors.primary }]}>
              View All Similar Products
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </Card>
  );
};

const PlatformPreview = ({ platform, data, images }) => {
  const theme = useTheme();
  
  return (
    <View style={[styles.platformPreview, { borderColor: getPlatformColor(platform) }]}>
      <View style={styles.previewHeader}>
        <Icon name={getPlatformIcon(platform)} size={24} color={getPlatformColor(platform)} />
        <Text style={[styles.previewPlatformTitle, { color: getPlatformColor(platform) }]}>
          {getPlatformName(platform)}
        </Text>
      </View>
      
      <View style={styles.previewBody}>
        <View style={styles.previewImageContainer}>
          {images && images.length > 0 ? (
            <Image source={{ uri: images[0] }} style={styles.previewProductImage} />
          ) : (
            <PlaceholderImage 
              size={120} 
              borderRadius={8}
              color={getPlatformColor(platform)}
              type="gradient"
              icon={getPlatformIcon(platform)}
            />
          )}
          {images && images.length > 1 && (
            <View style={styles.previewImageCount}>
              <Text style={styles.previewImageCountText}>+{images.length - 1}</Text>
            </View>
          )}
        </View>
        
        <View style={styles.previewProductDetails}>
          <Text style={styles.previewProductTitle} numberOfLines={2}>
            {data.title || "Your Product Title"}
          </Text>
          <Text style={styles.previewProductPrice}>
            ${parseFloat(data.price || 0).toFixed(2)}
          </Text>
          <Text style={styles.previewProductDescription} numberOfLines={3}>
            {data.description || "Your product description will appear here."}
          </Text>
          
          <View style={styles.previewMeta}>
            <View style={styles.previewMetaBadge}>
              <Text style={styles.previewMetaBadgeText}>
                {data.quantity || 0} in stock
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
};

const AddListingScreen = () => {
  const theme = useTheme();
  const [mode, setMode] = useState('initial'); // initial, camera, scanning, form
  const [images, setImages] = useState([]);
  const [listingData, setListingData] = useState({
    title: '',
    price: '',
    description: '',
    category: '',
    condition: 'New',
    quantity: '1',
    brand: '',
    platforms: {
      shopify: true,
      amazon: true,
      clover: false,
      square: false,
    }
  });
  
  const [scanningProgress, setScanningProgress] = useState(0);
  const progressInterval = useRef(null);
  const cameraRef = useRef(null);
  const aiConfidence = useSharedValue(0);
  
  const aiConfidenceStyle = useAnimatedStyle(() => {
    return {
      width: `${aiConfidence.value * 100}%`,
    };
  });
  
  const [showRelatedProducts, setShowRelatedProducts] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedPreviewPlatform, setSelectedPreviewPlatform] = useState('shopify');
  const [savedDrafts, setSavedDrafts] = useState([]);
  const [previewTab, setPreviewTab] = useState('shopify');
  
  const startAIAnalysis = () => {
    setMode('scanning');
    
    // Simulate AI processing with progress bar
    setScanningProgress(0);
    progressInterval.current = setInterval(() => {
      setScanningProgress(prev => {
        if (prev >= 100) {
          clearInterval(progressInterval.current);
          
          // Simulate AI filling in the form
          setTimeout(() => {
            setListingData({
              title: 'Vintage Caribbean Seafood Cookbook',
              price: '24.99',
              description: 'Authentic seafood recipes from the Caribbean, featuring traditional cooking methods and local ingredients. Hardcover, full color images, 212 pages.',
              category: 'Books & Media',
              condition: 'New',
              quantity: '45',
              brand: 'Atlantic Culinary Press',
              platforms: {
                shopify: true,
                amazon: true,
                clover: false,
                square: false,
              }
            });
            
            aiConfidence.value = withTiming(0.85, { duration: 800 });
            setMode('form');
          }, 500);
          return 100;
        }
        return prev + 5;
      });
    }, 100);
  };
  
  const handleCapturedImages = (capturedMedia) => {
    // Update images state with the captured media
    const newImages = capturedMedia.map(media => media.uri);
    setImages(prevImages => [...prevImages, ...newImages]);
    
    // Change mode back to form
    setMode('form');
    
    // Start AI analysis if you have images
    if (newImages.length > 0) {
      startAIAnalysis();
    }
  };
  
  const publishListing = () => {
    // Simulate publishing with a success message
    Alert.alert(
      "Success!",
      "Your listing has been published to Shopify and Amazon. You can view and track it in your inventory.",
      [{ text: "OK", onPress: () => {
        setMode('initial');
        setImages([]);
        setListingData({
          title: '',
          price: '',
          description: '',
          category: '',
          condition: 'New',
          quantity: '1',
          brand: '',
          platforms: {
            shopify: true,
            amazon: true,
            clover: false,
            square: false,
          }
        });
      }}]
    );
  };
  
  const saveDraft = () => {
    const newDraft = {
      id: Date.now(),
      title: listingData.title || 'Untitled Draft',
      description: listingData.description,
      price: listingData.price,
      quantity: listingData.quantity,
      images: images,
      selectedPlatforms: Object.keys(listingData.platforms).filter(p => listingData.platforms[p]),
      createdAt: new Date().toISOString()
    };
    
    setSavedDrafts(prev => [...prev, newDraft]);
    
    Alert.alert(
      "Draft Saved",
      "Your listing has been saved as a draft",
      [{ text: "OK", onPress: () => {
        // Reset form and go back to dashboard
        setMode('initial');
        setImages([]);
        setListingData({
          title: '',
          price: '',
          description: '',
          category: '',
          condition: 'New',
          quantity: '1',
          brand: '',
          platforms: {
            shopify: true,
            amazon: true,
            clover: false,
            square: false,
          }
        });
        
        // If using navigation
        // navigation.goBack();
      }}]
    );
  };
  
  const togglePreview = () => {
    setShowPreview(!showPreview);
  };
  
  const renderContent = () => {
    switch (mode) {
      case 'initial':
        return (
          <Animated.View 
            entering={FadeIn.duration(400)} 
            style={styles.initialContainer}
            paddingTop={60}
          >
            <Icon name="camera-plus" size={80} color={theme.colors.primary} />
            <Text style={styles.initialText}>
              Add a new listing by taking a photo or uploading an image
            </Text>
            <View style={styles.buttonRow}>
              <Button 
                title="Take Photo" 
                icon="camera" 
                onPress={() => setMode('camera')} 
                style={styles.actionButton}
              />
              <Button 
                title="Upload Image" 
                icon="image" 
                onPress={() => setMode('camera')} 
                style={styles.actionButton}
                outlined
              />
            </View>
          </Animated.View>
        );
        
      case 'camera':
        return (
          <CameraSection
            onCapture={handleCapturedImages}
            onClose={() => setMode('form')}
          />
        );
        
      case 'scanning':
        return (
          <Animated.View 
            entering={SlideInUp.duration(400)}
            style={styles.scanningContainer}
          >
            <View style={styles.imagePreviewContainer}>
              {images.map((uri, index) => (
                <Image 
                  key={index}
                  source={{ uri }}
                  style={styles.previewImage}
                />
              ))}
            </View>
            <Text style={styles.scanningTitle}>
              AI is analyzing your item...
            </Text>
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <Animated.View 
                  style={[
                    styles.progressFill, 
                    { width: `${scanningProgress}%`, backgroundColor: theme.colors.primary }
                  ]}
                />
              </View>
              <Text style={styles.progressText}>{scanningProgress}%</Text>
            </View>
            <Text style={styles.scanningSubtitle}>
              We're identifying product details and gathering information to create your listing
            </Text>
          </Animated.View>
        );
        
      case 'form':
        return (
          <Animated.View 
            entering={SlideInUp.duration(400)} 
            style={styles.formContainer}
            paddingTop={60}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.imagesSection}>
                <Text style={styles.sectionTitle}>Images</Text>
                <Text style={styles.sectionSubtitle}>Add up to 10 images of your product</Text>
                
                <ScrollView horizontal showsHorizontalScrollIndicator={false} paddingTop={20}>
                  <View style={styles.imagesContainer}>
                    {images.map((image, index) => (
                      <View key={index} style={styles.imageContainer}>
                        <Image source={{ uri: image }} style={styles.image} />
                        <TouchableOpacity
                          style={styles.removeImageButton}
                          onPress={() => {
                            const newImages = [...images];
                            newImages.splice(index, 1);
                            setImages(newImages);
                          }}
                        >
                          <Icon name="close-circle" size={20} color="white" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    
                    {images.length < 10 && (
                      <TouchableOpacity 
                        style={[
                          styles.addImageButton, 
                          { borderColor: theme ? theme.colors.primary + '50' : '#ddd' }
                        ]} 
                        onPress={() => setMode('camera')}
                      >
                        <Icon 
                          name="camera-plus" 
                          size={24} 
                          color={theme ? theme.colors.primary : '#aaa'} 
                        />
                        <Text style={{ 
                          color: theme ? theme.colors.primary : '#aaa', 
                          marginTop: 4 
                        }}>
                          Add Image
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </ScrollView>
              </View>
              
              <Card>
                <View style={styles.aiConfidenceContainer}>
                  <Text style={styles.aiConfidenceText}>AI Confidence</Text>
                  <View style={styles.aiConfidenceBar}>
                    <Animated.View 
                      style={[
                        styles.aiConfidenceFill, 
                        aiConfidenceStyle, 
                        { backgroundColor: theme.colors.primary }
                      ]}
                    />
                  </View>
                  <Text style={styles.aiConfidenceValue}>85%</Text>
                </View>
              </Card>
              
              <Card>
                <Text style={styles.formSectionTitle}>Product Details</Text>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Title</Text>
                  <TextInput
                    style={styles.input}
                    value={listingData.title}
                    onChangeText={(text) => setListingData({...listingData, title: text})}
                    placeholder="Product title"
                  />
                </View>
                
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Price</Text>
                  <TextInput
                    style={styles.input}
                    value={listingData.price}
                    onChangeText={(text) => setListingData({...listingData, price: text})}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                  />
                </View>
                
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Description</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={listingData.description}
                    onChangeText={(text) => setListingData({...listingData, description: text})}
                    placeholder="Describe your product..."
                    multiline
                    numberOfLines={4}
                  />
                </View>
                
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Category</Text>
                  <TextInput
                    style={styles.input}
                    value={listingData.category}
                    onChangeText={(text) => setListingData({...listingData, category: text})}
                    placeholder="Category"
                  />
                </View>
                
                <View style={styles.inputRow}>
                  <View style={[styles.inputGroup, {flex: 1, marginRight: 8}]}>
                    <Text style={styles.inputLabel}>Condition</Text>
                    <TextInput
                      style={styles.input}
                      value={listingData.condition}
                      onChangeText={(text) => setListingData({...listingData, condition: text})}
                      placeholder="Condition"
                    />
                  </View>
                  
                  <View style={[styles.inputGroup, {flex: 1, marginLeft: 8}]}>
                    <Text style={styles.inputLabel}>Quantity</Text>
                    <TextInput
                      style={styles.input}
                      value={listingData.quantity}
                      onChangeText={(text) => setListingData({...listingData, quantity: text})}
                      placeholder="Quantity"
                      keyboardType="number-pad"
                    />
                  </View>
                </View>
                
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Brand</Text>
                  <TextInput
                    style={styles.input}
                    value={listingData.brand}
                    onChangeText={(text) => setListingData({...listingData, brand: text})}
                    placeholder="Brand (optional)"
                  />
                </View>
              </Card>
              
              <Card>
                <Text style={styles.formSectionTitle}>Publish To</Text>
                <Text style={styles.formSectionSubtitle}>Select platforms where you want to list this product</Text>
                
                <PlatformSelector 
                  platforms={listingData.platforms}
                  onChange={(platforms) => setListingData({...listingData, platforms})}
                />
              </Card>
              
              <View style={styles.buttonRow}>
                <TouchableOpacity 
                  style={[styles.button, styles.draftButton, styles.outlinedButton]} 
                  onPress={saveDraft}
                >
                  <Icon name="content-save-outline" size={20} color={theme.colors.primary} />
                  <Text style={[styles.buttonText, {color: theme.colors.primary}]}>Save Draft</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.button, styles.previewButton, styles.outlinedButton]} 
                  onPress={togglePreview}
                >
                  <Icon name="eye-outline" size={20} color={theme.colors.primary} />
                  <Text style={[styles.buttonText, {color: theme.colors.primary}]}>
                    {showPreview ? "Edit" : "Preview"}
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.button, styles.optimizeButton, styles.outlinedButton]} 
                  onPress={() => {
                    // Start AI optimization
                    setMode('scanning');
                    setScanningProgress(0);
                    
                    // Simulate optimization process
                    if (progressInterval.current) {
                      clearInterval(progressInterval.current);
                    }
                    
                    progressInterval.current = setInterval(() => {
                      setScanningProgress(prev => {
                        if (prev >= 100) {
                          clearInterval(progressInterval.current);
                          
                          // Show optimization results
                          setTimeout(() => {
                            Alert.alert(
                              "Listing Optimized",
                              "We've enhanced your listing with SEO keywords, improved description, and optimized pricing based on market data.",
                              [{ text: "OK", onPress: () => setMode('form') }]
                            );
                            return 100;
                          }, 500);
                        }
                        return prev + 5;
                      });
                    }, 100);
                  }}
                >
                  <Icon name="auto-fix" size={20} color={theme.colors.primary} />
                  <Text style={[styles.buttonText, {color: theme.colors.primary}]}>Optimize</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.button, styles.submitButton]} 
                  onPress={publishListing}
                >
                  <Icon name="rocket-launch-outline" size={20} color="white" />
                  <Text style={[styles.buttonText, {color: 'white'}]}>Publish</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Animated.View>
        );
        
      default:
        return null;
    }
  };
  
  return (
    <View style={styles.container}>
      {renderContent()}
      {showPreview && (
        <View style={styles.previewSection}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewTitle}>Preview Your Listing</Text>
            <TouchableOpacity 
              style={styles.closePreviewButton}
              onPress={() => setShowPreview(false)}
            >
              <Icon name="close" size={20} color="#777" />
            </TouchableOpacity>
          </View>
          
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            style={styles.platformPreviewTabs}
          >
            {Object.keys(listingData.platforms)
              .filter(p => listingData.platforms[p])
              .map(platform => (
                <TouchableOpacity
                  key={platform}
                  style={[
                    styles.platformPreviewTab,
                    previewTab === platform && {
                      backgroundColor: getPlatformColor(platform) + '20',
                      borderColor: getPlatformColor(platform),
                      borderWidth: 1,
                    }
                  ]}
                  onPress={() => setPreviewTab(platform)}
                >
                  <Icon 
                    name={getPlatformIcon(platform)} 
                    size={16} 
                    color={previewTab === platform ? getPlatformColor(platform) : '#777'} 
                    style={styles.platformPreviewIcon}
                  />
                  <Text 
                    style={[
                      styles.platformPreviewText,
                      previewTab === platform && {color: getPlatformColor(platform)}
                    ]}
                  >
                    {getPlatformName(platform)}
                  </Text>
                </TouchableOpacity>
              ))}
          </ScrollView>
          
          <PlatformPreview 
            platform={previewTab} 
            data={listingData}
            images={images}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FB',
  },
  initialContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  initialText: {
    fontSize: 18,
    textAlign: 'center',
    color: '#555',
    marginVertical: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 24,
  },
  actionButton: {
    marginHorizontal: 8,
    minWidth: 150,
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    zIndex: 10,
  },
  headerButton: {
    padding: 8,
  },
  headerControls: {
    flexDirection: 'row',
  },
  camera: {
    flex: 1,
  },
  cameraGuide: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  frameGuide: {
    width: SCREEN_WIDTH * 0.8,
    height: SCREEN_WIDTH * 0.8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 8,
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 30,
  },
  modeButton: {
    alignItems: 'center',
  },
  modeText: {
    color: 'white',
    marginTop: 4,
    fontSize: 12,
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 4,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'white',
  },
  recordingButton: {
    backgroundColor: 'red',
    width: 24,
    height: 24,
    borderRadius: 4,
  },
  galleryButton: {
    alignItems: 'center',
  },
  previewContainer: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingVertical: 16,
  },
  previewScroll: {
    paddingHorizontal: 16,
  },
  previewImageContainer: {
    marginRight: 12,
    position: 'relative',
  },
  previewImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  mediaNumberBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaNumber: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  videoIndicator: {
    position: 'absolute',
    bottom: 4,
    right: 4,
  },
  deleteMediaButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
  },
  doneButton: {
    backgroundColor: theme.colors.primary,
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  doneButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  cameraLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  cameraLoadingText: {
    color: 'white',
    marginTop: 16,
  },
  cameraErrorText: {
    color: 'white',
    marginTop: 16,
    marginBottom: 24,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  previewContent: {
    flex: 1,
  },
  previewSection: {
    marginTop: 24,
  },
  closePreviewButton: {
    position: 'absolute',
    right: 0,
    top: 0,
    padding: 8,
  },
  platformPreviewTabs: {
    marginBottom: 16,
  },
  platformPreviewTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
  },
  platformPreviewIcon: {
    marginRight: 4,
  },
  platformPreviewText: {
    fontSize: 14,
    color: '#777',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    position: 'relative',
  },
  previewPlatformTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  previewBody: {
    flexDirection: 'row',
  },
  previewImageCount: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  previewImageCountText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  previewProductDetails: {
    flex: 1,
  },
  previewProductTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  previewProductPrice: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0E8F7F',
    marginBottom: 8,
  },
  previewProductDescription: {
    fontSize: 14,
    color: '#555',
    marginBottom: 12,
  },
  previewMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  previewMetaBadge: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
    marginBottom: 8,
  },
  previewMetaBadgeText: {
    fontSize: 12,
    color: '#555',
  },
  previewMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  previewMetaText: {
    fontSize: 12,
    color: '#777',
    marginLeft: 4,
  },
  formContainer: {
    flex: 1,
    padding: 16,
  },
  imagesSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#777',
  },
  imagesContainer: {
    flexDirection: 'row',
  },
  imageContainer: {
    marginRight: 8,
  },
  image: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
  removeImageButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
  },
  addImageButton: {
    width: 100,
    height: 100,
    borderRadius: 8,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
    margin: 4,
  },
  aiConfidenceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  aiConfidenceText: {
    fontSize: 14,
    color: '#555',
    width: 100,
  },
  aiConfidenceBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#eee',
    borderRadius: 4,
    overflow: 'hidden',
    marginHorizontal: 8,
  },
  aiConfidenceFill: {
    height: '100%',
  },
  aiConfidenceValue: {
    width: 40,
    textAlign: 'right',
    fontSize: 14,
    color: '#555',
  },
  formSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  formSectionSubtitle: {
    fontSize: 14,
    color: '#777',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    color: '#555',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  inputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButtons: {
    flexDirection: 'row',
    marginVertical: 24,
  },
  platformPreview: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  previewProductImage: {
    width: 120,
    height: 120,
    borderRadius: 8,
  },
  previewPlaceholderImage: {
    width: 120,
    height: 120,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  buttonText: {
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 6,
  },
  outlinedButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 24,
  },
  draftButton: {
    flex: 0.9,
    marginRight: 8,
  },
  previewButton: {
    flex: 0.9,
    marginHorizontal: 4,
  },
  optimizeButton: {
    flex: 0.9,
    marginHorizontal: 4,
  },
  submitButton: {
    flex: 1,
    marginLeft: 8,
    backgroundColor: theme.colors.primary,
  },
  scanningContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePreviewContainer: {
    marginBottom: 24,
  },
  scanningTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#eee',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  progressText: {
    fontSize: 14,
    color: '#555',
    marginLeft: 8,
  },
  scanningSubtitle: {
    fontSize: 14,
    color: '#777',
  },
});

export default AddListingScreen;