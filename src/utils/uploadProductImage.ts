import { Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { decode as base64Decode } from 'base64-arraybuffer';
import { supabase } from '../../lib/supabase';

/**
 * Compress a local image and upload it to the product-images bucket, returning a
 * public URL the backend can read. Extracted from AddProductScreen so the chat
 * photo-dump flow can reuse the exact same upload path.
 */
export async function uploadProductImage(localUri: string, photoId: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const compressed = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 1920 } }],
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
  );

  let byteArray: Uint8Array;
  if (Platform.OS === 'android') {
    const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    byteArray = new Uint8Array(base64Decode(base64));
  } else {
    const resp = await fetch(compressed.uri);
    byteArray = new Uint8Array(await resp.arrayBuffer());
  }

  const fileName = `${user.id}/${photoId}-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from('product-images')
    .upload(fileName, byteArray, { contentType: 'image/jpeg', cacheControl: '86400' });
  if (error) throw error;

  const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(fileName);
  return urlData.publicUrl;
}
