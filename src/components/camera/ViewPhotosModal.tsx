import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Modal,
  ScrollView,
  Alert,
  Dimensions,
  Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ANORHA_GREEN = '#93C822';

export interface CapturedPhoto {
  id: string;
  uri: string;
  width?: number;
  height?: number;
  timestamp?: number;
  isCover?: boolean;
}

interface ViewPhotosModalProps {
  visible: boolean;
  onClose: () => void;
  photos: CapturedPhoto[];
  activeItemId: string | null;
  totalItems: number;
  activeIndex: number;
  onSetCover: (photoId: string) => void;
  onRemovePhoto: (photoId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onSelectItem: (itemId: string) => void;
  onImageUpload: () => void;
  items: Array<{ id: string; photos: CapturedPhoto[] }>;
}

const ViewPhotosModal: React.FC<ViewPhotosModalProps> = ({
  visible,
  onClose,
  photos,
  activeItemId,
  totalItems,
  activeIndex,
  onSetCover,
  onRemovePhoto,
  onReorder,
  onSelectItem,
  onImageUpload,
  items,
}) => {
  const [localPhotos, setLocalPhotos] = useState<CapturedPhoto[]>(photos);
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(overlayOpacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    } else {
      Animated.timing(overlayOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    }
  }, [visible, overlayOpacity]);

  // Sync local state when photos prop changes (e.g. when switching items)
  React.useEffect(() => {
    setLocalPhotos(photos);
  }, [photos, visible]);

  const handleDragEnd = useCallback(
    ({ data, from, to }: { data: Array<CapturedPhoto | { id: string; type: 'add' }>; from: number; to: number }) => {
      const photosOnly = data.filter((x): x is CapturedPhoto => !('type' in x && x.type === 'add'));
      setLocalPhotos(photosOnly);
      if (from < photosOnly.length && to < photosOnly.length) {
        onReorder(from, to);
      }
    },
    [onReorder]
  );

  const handlePhotoLongPress = (photo: CapturedPhoto, photoIndex: number) => {
    Alert.alert(
      'Photo Options',
      `Photo ${photoIndex + 1}${photo.isCover ? ' (Cover)' : ''}`,
      [
        { text: 'Set as Cover', onPress: () => onSetCover(photo.id) },
        {
          text: 'Move Up',
          onPress: () => photoIndex > 0 && onReorder(photoIndex, photoIndex - 1),
        },
        {
          text: 'Move Down',
          onPress: () => photoIndex < photos.length - 1 && onReorder(photoIndex, photoIndex + 1),
        },
        { text: 'Remove', onPress: () => onRemovePhoto(photo.id), style: 'destructive' as const },
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  };

  const NUM_COLUMNS = 4;
  const PADDING = 16;
  const GAP = 8;
  const PHOTO_SIZE = (SCREEN_WIDTH - PADDING * 2 - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]} pointerEvents="box-none">
        <View style={styles.sheet}>
          {/* Header: X | Manage Images | Back | Counter | Go */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Icon name="close" size={24} color="#333" />
            </TouchableOpacity>

            <Text style={styles.headerTitle}>Manage Images</Text>

            <View style={styles.navRight}>
              <TouchableOpacity
                style={[styles.navButton, activeIndex <= 0 && styles.navButtonDisabled]}
                onPress={() => activeIndex > 0 && onSelectItem(items[activeIndex - 1].id)}
                disabled={activeIndex <= 0}
              >
                <Text style={[styles.navButtonText, activeIndex <= 0 && styles.navButtonTextDisabled]}>Back</Text>
              </TouchableOpacity>
              {totalItems > 1 && (
                <Text style={styles.navCounterSubtext}>{activeIndex + 1} / {totalItems}</Text>
              )}
              <TouchableOpacity style={styles.navButton} onPress={onClose}>
                <Text style={styles.navButtonText}>Go</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Photo grid - draggable for reordering (long-press to drag) */}
          <View style={styles.scrollView}>
            <DraggableFlatList<CapturedPhoto | { id: string; type: 'add' }>
              data={[
                ...localPhotos,
                ...(localPhotos.length < 12 ? [{ id: '__add__', type: 'add' as const }] : []),
              ]}
              keyExtractor={(item) => item.id}
              onDragEnd={handleDragEnd}
              numColumns={NUM_COLUMNS}
              contentContainerStyle={styles.scrollContent}
              columnWrapperStyle={styles.columnWrapper}
              renderItem={({ item, drag, isActive, getIndex }: RenderItemParams<CapturedPhoto | { id: string; type: 'add' }>) => {
                if ('type' in item && item.type === 'add') {
                  return (
                    <TouchableOpacity
                      style={[styles.addPhotoButton, { width: PHOTO_SIZE, height: PHOTO_SIZE }]}
                      onPress={onImageUpload}
                    >
                      <Icon name="camera-plus-outline" size={28} color="#999" />
                      <Text style={styles.addPhotoText}>Add to item</Text>
                    </TouchableOpacity>
                  );
                }
                const photo = item as CapturedPhoto;
                const index = getIndex() ?? localPhotos.indexOf(photo);
                return (
                  <ScaleDecorator>
                    <View style={[styles.photoSlotWrapper, { width: PHOTO_SIZE, height: PHOTO_SIZE }]}>
                      <TouchableOpacity
                        style={[
                          styles.photoSlot,
                          { width: PHOTO_SIZE, height: PHOTO_SIZE },
                          photo.isCover && styles.coverPhotoSlot,
                          isActive && styles.photoSlotDragging,
                        ]}
                        onPress={() => onSetCover(photo.id)}
                        onLongPress={drag}
                        disabled={isActive}
                      >
                        <Image key={photo.id} source={{ uri: photo.uri }} style={styles.photoImage} />
                        <View style={[styles.numberBadge, photo.isCover ? styles.numberBadgeCover : styles.numberBadgeDefault]}>
                          {photo.isCover ? (
                            <Text style={styles.numberBadgeText} numberOfLines={1}>
                              {index + 1} - <Text style={styles.numberBadgeText}>COVER</Text>
                            </Text>
                          ) : (
                            <Text style={styles.numberBadgeText}>{index + 1}</Text>
                          )}
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={() => onRemovePhoto(photo.id)}
                        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                      >
                        <Icon name="close-circle" size={28} color="#ff4444" />
                      </TouchableOpacity>
                    </View>
                  </ScaleDecorator>
                );
              }}
            />
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  closeButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  navRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  navButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: ANORHA_GREEN,
  },
  navButtonTextDisabled: {
    color: '#999',
  },
  navCounterSubtext: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  scrollView: {
    maxHeight: 320,
  },
  scrollContent: {
    padding: 16,
  },
  columnWrapper: {
    gap: 8,
    marginBottom: 8,
    flexDirection: 'row',
  },
  photoSlotWrapper: {
    position: 'relative',
    overflow: 'visible',
  },
  photoSlot: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  coverPhotoSlot: {
    borderWidth: 2,
    borderColor: '#93C822',
  },
  photoSlotDragging: {
    opacity: 0.9,
    transform: [{ scale: 1.02 }],
  },
  photoImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  numberBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    minHeight: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  numberBadgeCover: {
    borderRadius: 6,
    backgroundColor: ANORHA_GREEN,
    borderWidth: 2,
    borderColor: ANORHA_GREEN,
  },
  numberBadgeDefault: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.51)',
    paddingHorizontal: 0,
  },
  numberBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  deleteButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    zIndex: 10,
    padding: 2,
  },
  addPhotoButton: {
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#ccc',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
  },
  addPhotoText: {
    marginTop: 4,
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
  },
});

export default ViewPhotosModal;
