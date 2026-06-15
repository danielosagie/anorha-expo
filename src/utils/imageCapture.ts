import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

// Shared "add image" entry point for the listing editor (Generate Details + Product Detail).
// Presents Take Photo / Choose from Library, handles permissions, and returns the picked
// ImagePicker assets (camera and library both return assets, so each screen's existing upload
// logic keeps working unchanged). Returns [] if the user cancels or denies permission.
export async function captureOrPickImageAssets(opts?: { multiple?: boolean }): Promise<ImagePicker.ImagePickerAsset[]> {
  const multiple = opts?.multiple ?? true;

  const takePhoto = async (): Promise<ImagePicker.ImagePickerAsset[]> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Enable camera access in Settings to take a photo.');
      return [];
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    return res.canceled || !res.assets?.length ? [] : res.assets;
  };

  const pickLibrary = async (): Promise<ImagePicker.ImagePickerAsset[]> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access needed', 'Enable photo library access in Settings to add images.');
      return [];
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: multiple,
      quality: 0.8,
    });
    return res.canceled || !res.assets?.length ? [] : res.assets;
  };

  return new Promise((resolve) => {
    Alert.alert('Add photos', undefined, [
      { text: 'Take Photo', onPress: () => takePhoto().then(resolve).catch(() => resolve([])) },
      { text: 'Choose from Library', onPress: () => pickLibrary().then(resolve).catch(() => resolve([])) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve([]) },
    ]);
  });
}
