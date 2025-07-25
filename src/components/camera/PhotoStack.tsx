import React, { useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Image, 
  Alert,
} from 'react-native';
import Animated, { SlideInDown } from 'react-native-reanimated';
import { TapGestureHandler, PanGestureHandler, State } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface CapturedPhoto {
  id: string;
  uri: string;
  width: number;
  height: number;
  timestamp: number;
  isCover: boolean;
}

interface PhotoStackProps {
  photos: CapturedPhoto[];
  onSetCover: (id: string) => void;
  onRemovePhoto: (id: string) => void;
  onDoubleTap?: (id: string) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  draggedPhotoId?: string | null;
}

const PhotoStack: React.FC<PhotoStackProps> = ({ 
  photos, 
  onSetCover, 
  onRemovePhoto,
  onDoubleTap,
  onDragStart,
  onDragEnd,
  onReorder,
  draggedPhotoId
}) => {
  const doubleTapRef = useRef(null);
  
  const handleDoubleTap = (event: any, photoId: string) => {
    if (event.nativeEvent.state === State.ACTIVE) {
      if (onDoubleTap) {
        onDoubleTap(photoId);
      } else {
        onSetCover(photoId);
      }
    }
  };

  const handlePanGestureStateChange = (event: any, photoId: string, index: number) => {
    if (event.nativeEvent.state === State.BEGAN) {
      onDragStart?.(photoId);
    } else if (event.nativeEvent.state === State.END) {
      onDragEnd?.();
      // Simple reordering logic based on vertical drag
      const dragY = event.nativeEvent.translationY;
      if (Math.abs(dragY) > 30) { // Threshold for reordering
        const direction = dragY > 0 ? 1 : -1;
        const newIndex = Math.max(0, Math.min(photos.length - 1, index + direction));
        if (newIndex !== index) {
          onReorder?.(index, newIndex);
        }
      }
    }
  };

  const renderPhoto = (photo: CapturedPhoto, index: number) => (
    <PanGestureHandler
      key={photo.id}
      onHandlerStateChange={(event) => handlePanGestureStateChange(event, photo.id, index)}
    >
      <Animated.View
        style={[
          styles.photoStackItem,
          { 
            top: index * 75,
            zIndex: photos.length - index,
            borderColor: photo.isCover ? '#4CAF50' : 'rgba(255,255,255,0.3)',
            borderWidth: photo.isCover ? 2 : 1,
            opacity: draggedPhotoId === photo.id ? 0.7 : 1,
          }
        ]}
      >
        <TapGestureHandler
          ref={doubleTapRef}
          numberOfTaps={2}
          onHandlerStateChange={(event) => handleDoubleTap(event, photo.id)}
        >
          <Animated.View>
            <TouchableOpacity
              onPress={() => onSetCover(photo.id)}
              onLongPress={() => {
                Alert.alert(
                  'Photo Options',
                  `Photo ${index + 1}${photo.isCover ? ' (Cover)' : ''}`,
                  [
                    { text: 'Set as Cover', onPress: () => onSetCover(photo.id) },
                    { text: 'Remove', onPress: () => onRemovePhoto(photo.id), style: 'destructive' },
                    { text: 'Cancel', style: 'cancel' },
                  ]
                );
              }}
            >
              <Image source={{ uri: photo.uri }} style={styles.photoStackImage} />
              <View style={styles.photoStackNumber}>
                <Text style={styles.photoStackNumberText}>{index + 1}</Text>
              </View>
              {photo.isCover && (
                <View style={styles.coverBadge}>
                  <Icon name="star" size={12} color="white" />
                </View>
              )}
              {/* Delete button */}
              <TouchableOpacity 
                style={styles.deleteButton}
                onPress={() => onRemovePhoto(photo.id)}
                hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
              >
                <Icon name="close-circle" size={16} color="#ff4444" />
              </TouchableOpacity>
            </TouchableOpacity>
          </Animated.View>
        </TapGestureHandler>
      </Animated.View>
    </PanGestureHandler>
  );

  return (
    <Animated.View entering={SlideInDown.delay(400)} style={styles.photoStackContainer}>
      {photos.map(renderPhoto)}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  photoStackContainer: {
    position: 'absolute',
    top: 40,
    left: 0,
    zIndex: 10,
    marginBottom: 100,
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
  deleteButton: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
});

export default PhotoStack;
export type { CapturedPhoto, PhotoStackProps }; 