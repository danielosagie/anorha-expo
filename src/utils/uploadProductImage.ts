import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { ENV } from '../config/env';
import { getCurrentSupabaseJwt, getUserLike, supabase } from '../lib/supabase';
import { buildProductImageObjectPath } from '../lib/productImageUploadIdentity';
import { createConcurrencyLimiter } from './mapWithConcurrency';
import { createLogger } from './logger';

const log = createLogger('uploadProductImage');

const PRODUCT_IMAGES_BUCKET = 'product-images';
const PRODUCT_IMAGE_MAX_WIDTH = 1440;
const PRODUCT_IMAGE_COMPRESSION = 0.8;
export const PRODUCT_IMAGE_UPLOAD_CONCURRENCY = 3;

const runBoundedUpload = createConcurrencyLimiter(PRODUCT_IMAGE_UPLOAD_CONCURRENCY);

type UploadProductImageOptions = {
  /** Reuse the scan's already-resolved token so uploads never do identity I/O per photo. */
  accessToken?: string | null;
};

type CachedUploadIdentity = {
  accessToken: string;
  userId: string;
};

let cachedUploadIdentity: CachedUploadIdentity | null = null;
let sessionIdentityPromise: Promise<CachedUploadIdentity> | null = null;
let appIdentityPromise: { accessToken: string; promise: Promise<CachedUploadIdentity> } | null = null;

async function identityFromToken(accessToken: string): Promise<CachedUploadIdentity> {
  if (cachedUploadIdentity?.accessToken === accessToken) return cachedUploadIdentity;
  if (appIdentityPromise?.accessToken === accessToken) return appIdentityPromise.promise;

  const promise = getUserLike()
    .then(({ user }) => {
      const userId = user?.id?.trim();
      if (!userId) throw new Error('Authenticated session has no canonical app user');
      cachedUploadIdentity = { accessToken, userId };
      return cachedUploadIdentity;
    })
    .finally(() => {
      if (appIdentityPromise?.accessToken === accessToken) appIdentityPromise = null;
    });
  appIdentityPromise = { accessToken, promise };
  return promise;
}

async function getLocalUploadIdentity(providedAccessToken?: string | null): Promise<CachedUploadIdentity> {
  const cachedAccessToken = providedAccessToken || getCurrentSupabaseJwt();
  if (cachedAccessToken) return identityFromToken(cachedAccessToken);

  // getSession is the local/cached auth read. Unlike getUser, it does not make a
  // per-photo identity request. Coalesce the fallback so a cold three-photo batch
  // still performs only one session read.
  if (!sessionIdentityPromise) {
    sessionIdentityPromise = supabase.auth.getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error('Not authenticated');
        return identityFromToken(accessToken);
      })
      .finally(() => {
        sessionIdentityPromise = null;
      });
  }
  return sessionIdentityPromise;
}

function storageObjectUrl(fileName: string): { uploadUrl: string; anonKey: string } {
  const extra = (Constants.expoConfig?.extra || {}) as {
    supabaseUrl?: string;
    supabaseAnonKey?: string;
  };
  const supabaseUrl = ENV.supabaseUrl || extra.supabaseUrl || '';
  const anonKey = extra.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !anonKey) throw new Error('Supabase storage configuration is unavailable');
  const encodedPath = fileName.split('/').map(encodeURIComponent).join('/');
  return {
    uploadUrl: `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${PRODUCT_IMAGES_BUCKET}/${encodedPath}`,
    anonKey,
  };
}

/**
 * Compress a local product photo and stream it from the native filesystem to
 * Supabase Storage. All callers share the same three-upload ceiling.
 */
export async function uploadProductImage(
  localUri: string,
  photoId: string,
  options: UploadProductImageOptions = {},
): Promise<string> {
  const queuedAt = Date.now();

  return runBoundedUpload(async () => {
    const startedAt = Date.now();
    log.debug(`[UPLOAD_TIMING] photo=${photoId} queue_wait_ms=${startedAt - queuedAt}`);

    const identity = await getLocalUploadIdentity(options.accessToken);
    const manipulateStartedAt = Date.now();
    const compressed = await ImageManipulator.manipulateAsync(
      localUri,
      [{ resize: { width: PRODUCT_IMAGE_MAX_WIDTH } }],
      {
        compress: PRODUCT_IMAGE_COMPRESSION,
        format: ImageManipulator.SaveFormat.JPEG,
      },
    );
    const manipulateMs = Date.now() - manipulateStartedAt;
    log.debug(`[UPLOAD_TIMING] photo=${photoId} manipulate_ms=${manipulateMs}`);

    const fileName = buildProductImageObjectPath(identity.userId, photoId, Date.now());
    const { uploadUrl, anonKey } = storageObjectUrl(fileName);

    // There is no JS read/decode phase: uploadAsync hands the file URI directly to
    // NSURLSession/OkHttp. Keep a zero-valued receipt so before/after traces make the
    // removed base64/ArrayBuffer work explicit and greppable.
    const streamHandoffStartedAt = Date.now();
    const readOrStreamMs = Date.now() - streamHandoffStartedAt;
    log.debug(`[UPLOAD_TIMING] photo=${photoId} read_or_stream_ms=${readOrStreamMs} mode=native-file-stream`);

    const uploadStartedAt = Date.now();
    const result = await FileSystem.uploadAsync(uploadUrl, compressed.uri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${identity.accessToken}`,
        'Content-Type': 'image/jpeg',
        'cache-control': 'max-age=86400',
        'x-upsert': 'false',
      },
    });
    const uploadMs = Date.now() - uploadStartedAt;
    log.debug(`[UPLOAD_TIMING] photo=${photoId} upload_ms=${uploadMs} status=${result.status}`);

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Supabase image upload failed with HTTP ${result.status}: ${result.body.slice(0, 200)}`);
    }

    const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(fileName);
    log.debug(`[UPLOAD_TIMING] photo=${photoId} total_ms=${Date.now() - queuedAt} transport=native-file-stream`);
    return data.publicUrl;
  });
}
