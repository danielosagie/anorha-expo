import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
} from 'react-native';

const ANORHA_GREEN = '#93C822';

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
  onPress?: () => void; // Opens modal when tapped
}

const PhotoStack: React.FC<PhotoStackProps> = ({ photos, onPress }) => {
  const coverPhoto = photos.find((p) => p.isCover) || photos[0];
  const count = photos.length;

  if (!coverPhoto || count === 0) return null;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress?.()}
      activeOpacity={0.9}
    >
      <View style={styles.photoWrapper}>
        <Image source={{ uri: coverPhoto.uri }} style={styles.photo} />
        <View style={styles.counterBadge}>
          <Text style={styles.counterText}>{count}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
  },
  photoWrapper: {
    width: 72,
    height: 72,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: ANORHA_GREEN,
    overflow: 'visible',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  photo: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
    resizeMode: 'cover',
  },
  counterBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: ANORHA_GREEN,
    borderWidth: 2,
    borderColor: ANORHA_GREEN,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  counterText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: '700',
  },
});

export default PhotoStack;
export type { CapturedPhoto, PhotoStackProps };
