import { Image } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import type { CapturedPhoto } from '../../components/camera/PhotoStack';
import type { ShelfItemBox } from './types';
import { addPhotoToItem, selectItem, setItemPhotoUri } from './cartStore';
import { createLogger } from '../../utils/logger';

const log = createLogger('shelfItemCropPipeline');
const CROP_PADDING_RATIO = 0.06;

type ImageSize = { width: number; height: number };
type CropRect = { originX: number; originY: number; width: number; height: number };
type UploadCrop = (localUri: string, photoId: string) => Promise<string>;

type CropTask = {
  itemId: string;
  sourceUri: string;
  box: ShelfItemBox;
  upload?: UploadCrop;
};

const pendingItemIds = new Set<string>();
let cropQueue: Promise<void> = Promise.resolve();
let uploadQueue: Promise<void> = Promise.resolve();

const getImageSize = (uri: string): Promise<ImageSize> =>
  new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });

/** Convert normalized or pixel coordinates into a padded, in-bounds pixel crop. */
export function shelfBoxToCropRect(box: ShelfItemBox, source: ImageSize): CropRect | null {
  if (!(source.width > 0) || !(source.height > 0)) return null;

  const values = [box.x, box.y, box.width, box.height];
  if (!values.every(Number.isFinite) || box.width <= 0 || box.height <= 0) return null;

  const looksNormalized = Math.max(box.x, box.y, box.width, box.height, box.x + box.width, box.y + box.height) <= 1.001;
  const coordinateWidth = looksNormalized ? 1 : (box.sourceWidth || source.width);
  const coordinateHeight = looksNormalized ? 1 : (box.sourceHeight || source.height);
  const scaleX = source.width / coordinateWidth;
  const scaleY = source.height / coordinateHeight;

  const rawX = box.x * scaleX;
  const rawY = box.y * scaleY;
  const rawWidth = box.width * scaleX;
  const rawHeight = box.height * scaleY;
  const paddingX = rawWidth * CROP_PADDING_RATIO;
  const paddingY = rawHeight * CROP_PADDING_RATIO;

  const left = Math.max(0, Math.floor(rawX - paddingX));
  const top = Math.max(0, Math.floor(rawY - paddingY));
  const right = Math.min(source.width, Math.ceil(rawX + rawWidth + paddingX));
  const bottom = Math.min(source.height, Math.ceil(rawY + rawHeight + paddingY));
  const width = right - left;
  const height = bottom - top;
  return width >= 1 && height >= 1 ? { originX: left, originY: top, width, height } : null;
}

const enqueueUpload = (task: CropTask, photo: CapturedPhoto) => {
  if (!task.upload) return;
  uploadQueue = uploadQueue
    .then(async () => {
      const item = selectItem(task.itemId);
      if (!item?.photos.some((candidate) => candidate.id === photo.id)) return;
      const publicUrl = await task.upload!(photo.uri, photo.id);
      if (publicUrl) setItemPhotoUri(task.itemId, photo.id, publicUrl);
    })
    .catch((error) => {
      // The local cover remains useful for this session. Draft serialization will
      // intentionally omit it until a later flow supplies a durable URL.
      log.warn('[crop] Background upload failed; keeping local crop', error);
    });
};

async function createAndAttachCrop(task: CropTask): Promise<void> {
  const itemBefore = selectItem(task.itemId);
  if (!itemBefore || itemBefore.photos.length > 0 || !task.sourceUri || !task.box) return;

  const sourceSize = await getImageSize(task.sourceUri);
  const crop = shelfBoxToCropRect(task.box, sourceSize);
  if (!crop) return;

  const result = await ImageManipulator.manipulateAsync(
    task.sourceUri,
    [{ crop }],
    { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
  );

  // A user-added photo wins if one landed while manipulation was running.
  const itemAfter = selectItem(task.itemId);
  if (!itemAfter || itemAfter.photos.length > 0) return;

  const photo: CapturedPhoto = {
    id: `shelf-crop-${task.itemId}-${Date.now()}`,
    uri: result.uri,
    width: result.width,
    height: result.height,
    timestamp: Date.now(),
    isCover: true,
  };
  addPhotoToItem(task.itemId, photo);
  enqueueUpload(task, photo);
}

/**
 * Queue one shelf crop. Work is serialized and deduplicated per item so a large
 * streamed shelf does not start dozens of native image jobs at once.
 */
export function enqueueShelfItemCrop(task: CropTask): void {
  if (!task.itemId || !task.sourceUri || !task.box || pendingItemIds.has(task.itemId)) return;
  if (selectItem(task.itemId)?.photos.length) return;

  pendingItemIds.add(task.itemId);
  cropQueue = cropQueue
    .then(() => createAndAttachCrop(task))
    .catch((error) => log.warn('[crop] Failed to create shelf item cover', error))
    .finally(() => pendingItemIds.delete(task.itemId));
}
