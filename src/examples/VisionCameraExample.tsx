import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Image } from 'react-native';
import VisionCamera from '../components/VisionCamera';
import useVisionCamera from '../hooks/useVisionCamera';
import { CapturedMediaItem } from '../screens/AddListingScreen';

// This is a simple example showing how to use the VisionCamera component
// in the AddListingScreen. You can use this as a reference for how to
// integrate it into your actual AddListingScreen.

const VisionCameraExample: React.FC = () => {
  const [media, setMedia] = useState<CapturedMediaItem[]>([]);
  
  // Use our custom hook to manage camera state
  const { 
    showCamera, 
    initialMedia, 
    openCamera, 
    closeCamera, 
    handleMediaCaptured 
  } = useVisionCamera((newMedia) => {
    setMedia(newMedia);
  });

  const handleOpenCamera = () => {
    // Open the camera with any existing media
    openCamera(media);
  };

  const handleRemoveMedia = (idToRemove: string) => {
    setMedia(prev => prev.filter(item => item.id !== idToRemove));
  };

  return (
    <View style={styles.container}>
      {/* Camera View (shows when showCamera is true) */}
      {showCamera ? (
        <VisionCamera
          onCapture={handleMediaCaptured}
          onClose={closeCamera}
          initialMedia={initialMedia}
          styles={{}} // You can pass custom styles here if needed
        />
      ) : (
        // Regular UI when camera is not shown
        <View style={styles.content}>
          <Text style={styles.title}>Add Product Listing</Text>
          
          {/* Media preview grid */}
          {media.length > 0 ? (
            <View style={styles.mediaContainer}>
              <Text style={styles.sectionTitle}>Product Images</Text>
              <FlatList
                data={media}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View style={styles.mediaItem}>
                    <Image source={{ uri: item.uri }} style={styles.mediaPreview} />
                    <TouchableOpacity 
                      style={styles.removeButton}
                      onPress={() => handleRemoveMedia(item.id)}
                    >
                      <Text style={styles.removeButtonText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            </View>
          ) : (
            <Text style={styles.emptyText}>No product images yet</Text>
          )}
          
          {/* Camera button */}
          <TouchableOpacity style={styles.cameraButton} onPress={handleOpenCamera}>
            <Text style={styles.cameraButtonText}>
              {media.length > 0 ? 'Add More Photos' : 'Take Product Photos'}
            </Text>
          </TouchableOpacity>
          
          <Text style={styles.helpText}>
            Use the camera to capture product images or scan barcodes.
            The camera will help detect products and provide real-time feedback.
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  mediaContainer: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
  },
  mediaItem: {
    position: 'relative',
    marginRight: 10,
  },
  mediaPreview: {
    width: 120,
    height: 120,
    borderRadius: 8,
  },
  removeButton: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  cameraButton: {
    backgroundColor: '#2196F3',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  cameraButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#888',
    marginBottom: 20,
    alignSelf: 'center',
    marginTop: 20,
  },
  helpText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginTop: 20,
  },
});

export default VisionCameraExample; 