import { ensureSupabaseJwt, supabase } from './supabase';
import type { CanonicalRef, SyncItem } from '../types/syncItem';

export interface IncomingItemDetails {
  title: string;
  imageUrl: string | null;
  description: string | null;
  sourceLabel: string;
  draftId: string | null;
}

const PLACEHOLDER_TITLES = new Set(['unknown product', 'unknown item', 'untitled', 'n/a']);

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function usefulTitle(value: unknown): string {
  const text = cleanText(value);
  const draftOnly = /^DRAFT(?:\s*[-_]\s*|\s+)[A-Z0-9-]+$/i.test(text);
  return text && !draftOnly && !PLACEHOLDER_TITLES.has(text.toLowerCase()) ? text : '';
}

function isDraftId(value: unknown): boolean {
  return /^DRAFT(?:\s*[-_]\s*|\s+)[A-Z0-9-]+$/i.test(cleanText(value));
}

function descriptionTitle(value: unknown): string {
  const words = cleanText(value).split(' ').filter(Boolean).slice(0, 9);
  if (words.length === 0) return '';
  const title = words.join(' ');
  return title.length > 72 ? `${title.slice(0, 69).trim()}...` : title;
}

function firstText(objects: any[], keys: string[], title = false): string {
  for (const object of objects) {
    if (!object || typeof object !== 'object') continue;
    for (const key of keys) {
      const value = title ? usefulTitle(object[key]) : cleanText(object[key]);
      if (value) return value;
    }
  }
  return '';
}

function listingObjects(value: any): any[] {
  if (!value || typeof value !== 'object') return [];
  const first = [
    value.sourceListing,
    value.listing,
    value.platformProduct,
    value.payload,
    value.PlatformSpecificData,
    value.source,
    value.origin,
    value,
  ].filter(Boolean);
  return [
    ...first,
    ...first.flatMap((object) => [object?.ebay, object?.draft, object?.item, object?.product].filter(Boolean)),
  ];
}

function firstImage(objects: any[]): string {
  for (const object of objects) {
    if (!object || typeof object !== 'object') continue;
    for (const key of ['imageUrl', 'primaryImageUrl', 'thumbnailUrl', 'coverImageUrl']) {
      const value = cleanText(object[key]);
      if (value) return value;
    }
    for (const key of ['imageUrls', 'images', 'photos', 'pictureUrls']) {
      const images = object[key];
      if (!Array.isArray(images)) continue;
      for (const image of images) {
        const value = cleanText(typeof image === 'string' ? image : image?.url ?? image?.imageUrl);
        if (value) return value;
      }
    }
  }
  return '';
}

function sourceName(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';
  if (/^ebay$/i.test(text)) return 'eBay';
  return text;
}

/**
 * Produces a useful identity synchronously, before optional Supabase hydration
 * lands. This prevents a placeholder title or a bare draft SKU from flashing
 * in the deck header.
 */
export function incomingItemDetailsFromPayload(
  item: SyncItem,
  fallbackPlatform?: string,
  extra?: Partial<IncomingItemDetails>,
): IncomingItemDetails {
  const objects = listingObjects(item as any);
  const description =
    cleanText(extra?.description) ||
    firstText(objects, ['description', 'body', 'listingDescription', 'shortDescription']);
  const draftId = [item.sku, item.platformId].find(isDraftId) ?? null;
  const nonDraftSku = !isDraftId(item.sku) ? cleanText(item.sku) : '';
  const platform = sourceName(
    firstText(objects, ['sourcePlatform', 'platformName', 'platform', 'marketplace']) || fallbackPlatform || 'import',
  );
  const partner = firstText(objects, [
    'partnerName',
    'partnerOrgName',
    'sourcePartnerName',
    'sourceOrgName',
    'partnerPoolName',
  ]);
  const sourceLabel = partner || sourceName(extra?.sourceLabel) || platform;
  const title =
    firstText(objects, ['listingTitle', 'sourceTitle', 'title', 'name'], true) ||
    usefulTitle(extra?.title) ||
    nonDraftSku ||
    descriptionTitle(description) ||
    (draftId && /ebay/i.test(platform) ? 'Untitled eBay draft' : draftId ? 'Untitled draft' : 'Untitled import item');

  return {
    title,
    imageUrl: cleanText(extra?.imageUrl) || firstImage(objects) || null,
    description: description || null,
    sourceLabel,
    draftId,
  };
}

/**
 * Hydrates the incoming side using the same canonical tables used for candidate
 * cards. This especially helps partner forks and locally persisted eBay drafts,
 * whose resolver payload can contain only a DRAFT SKU.
 */
export async function fetchImportIncomingItemDetails(
  item: SyncItem,
  fallbackPlatform?: string,
): Promise<IncomingItemDetails> {
  await ensureSupabaseJwt();

  const draftKey = [item.sku, item.platformId].find(isDraftId);
  const platformIdIsUuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(item.platformId);
  const [mappingResult, draftVariantResult, idVariantResult] = await Promise.all([
    supabase
      .from('PlatformProductMappings')
      .select('ProductVariantId, PlatformConnectionId, PlatformSpecificData, ConnectionTitle, ConnectionDescription, PlatformSku')
      .eq('PlatformProductId', item.platformId)
      .eq('IsEnabled', true)
      .limit(1)
      .maybeSingle(),
    draftKey
      ? supabase
          .from('ProductVariants')
          .select('Id, Title, Sku, Description, PrimaryImageUrl, SourceOrgId, Products(Title, Description), ProductImages:ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl, Position)')
          .eq('Sku', draftKey)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    platformIdIsUuid
      ? supabase
          .from('ProductVariants')
          .select('Id, Title, Sku, Description, PrimaryImageUrl, SourceOrgId, Products(Title, Description), ProductImages:ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl, Position)')
          .eq('Id', item.platformId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (mappingResult.error) throw mappingResult.error;
  if (draftVariantResult.error) throw draftVariantResult.error;
  if (idVariantResult.error) throw idVariantResult.error;

  const mapping = mappingResult.data as any;
  let variant = (draftVariantResult.data ?? idVariantResult.data) as any;
  if (!variant && mapping?.ProductVariantId) {
    const result = await supabase
      .from('ProductVariants')
      .select('Id, Title, Sku, Description, PrimaryImageUrl, SourceOrgId, Products(Title, Description), ProductImages:ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl, Position)')
      .eq('Id', mapping.ProductVariantId)
      .maybeSingle();
    if (result.error) throw result.error;
    variant = result.data as any;
  }

  const [connectionResult, sourceOrgResult] = await Promise.all([
    mapping?.PlatformConnectionId
      ? supabase
          .from('PlatformConnections')
          .select('PlatformType, DisplayName')
          .eq('Id', mapping.PlatformConnectionId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    variant?.SourceOrgId
      ? supabase.from('Organizations').select('Name').eq('Id', variant.SourceOrgId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const mappingObjects = listingObjects(mapping?.PlatformSpecificData);
  const product = Array.isArray(variant?.Products) ? variant.Products[0] : variant?.Products;
  const orderedImages = Array.isArray(variant?.ProductImages)
    ? [...variant.ProductImages]
        .sort((a, b) => Number(a?.Position ?? 0) - Number(b?.Position ?? 0))
        .map((image) => cleanText(image?.ImageUrl))
        .filter(Boolean)
    : [];
  const description =
    firstText(mappingObjects, ['description', 'body', 'listingDescription', 'shortDescription']) ||
    cleanText(mapping?.ConnectionDescription) ||
    cleanText(variant?.Description) ||
    cleanText(product?.Description);
  const partnerName = sourceOrgResult.error ? '' : cleanText((sourceOrgResult.data as any)?.Name);
  const connection = connectionResult.error ? null : connectionResult.data as any;
  const platformSource = sourceName(connection?.DisplayName || connection?.PlatformType || fallbackPlatform);
  const extra: Partial<IncomingItemDetails> = {
    title:
      firstText(mappingObjects, ['listingTitle', 'sourceTitle', 'title', 'name'], true) ||
      usefulTitle(mapping?.ConnectionTitle) ||
      usefulTitle(variant?.Title) ||
      usefulTitle(product?.Title) ||
      (!isDraftId(mapping?.PlatformSku) ? cleanText(mapping?.PlatformSku) : '') ||
      (!isDraftId(variant?.Sku) ? cleanText(variant?.Sku) : '') ||
      descriptionTitle(description),
    imageUrl:
      firstImage(mappingObjects) ||
      cleanText(variant?.PrimaryImageUrl) ||
      orderedImages[0] ||
      null,
    description: description || null,
    sourceLabel: partnerName || platformSource,
  };
  return incomingItemDetailsFromPayload(item, fallbackPlatform, extra);
}

/**
 * Hydrate thin resolver candidates with the canonical variant's display fields
 * and the platform mapping that explains where the existing item came from.
 * Supabase RLS keeps all three reads inside the active user/org scope.
 */
export async function fetchImportCandidateDetails(
  ids: string[],
  incomingPlatform?: string,
): Promise<Record<string, CanonicalRef>> {
  if (ids.length === 0) return {};
  await ensureSupabaseJwt();

  const [variantsResult, mappingsResult] = await Promise.all([
    supabase
      .from('ProductVariants')
      .select('Id, Title, Sku, Price, PrimaryImageUrl, ProductImages:ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl, Position)')
      .in('Id', ids),
    supabase
      .from('PlatformProductMappings')
      .select('ProductVariantId, PlatformConnectionId')
      .in('ProductVariantId', ids)
      .eq('IsEnabled', true),
  ]);
  if (variantsResult.error) throw variantsResult.error;
  if (mappingsResult.error) throw mappingsResult.error;

  const mappings = (mappingsResult.data ?? []) as any[];
  const connectionIds = Array.from(
    new Set(mappings.map((mapping) => String(mapping.PlatformConnectionId || '')).filter(Boolean)),
  );
  const connectionsResult = connectionIds.length > 0
    ? await supabase.from('PlatformConnections').select('Id, PlatformType').in('Id', connectionIds)
    : { data: [], error: null };
  if (connectionsResult.error) throw connectionsResult.error;

  const platformByConnection = new Map(
    ((connectionsResult.data ?? []) as any[]).map((connection) => [
      String(connection.Id),
      String(connection.PlatformType || ''),
    ]),
  );
  const sourcesByVariant = new Map<string, string[]>();
  for (const mapping of mappings) {
    const variantId = String(mapping.ProductVariantId || '');
    const platform = platformByConnection.get(String(mapping.PlatformConnectionId || ''));
    if (!variantId || !platform) continue;
    const sources = sourcesByVariant.get(variantId) ?? [];
    if (!sources.includes(platform)) sources.push(platform);
    sourcesByVariant.set(variantId, sources);
  }

  const incoming = String(incomingPlatform || '').toLowerCase();
  const details: Record<string, CanonicalRef> = {};
  for (const row of (variantsResult.data ?? []) as any[]) {
    const images = Array.isArray(row.ProductImages)
      ? [...row.ProductImages]
          .sort((a, b) => Number(a?.Position ?? 0) - Number(b?.Position ?? 0))
          .map((image) => image?.ImageUrl)
          .filter(Boolean)
      : [];
    const sources = sourcesByVariant.get(String(row.Id)) ?? [];
    const sourcePlatform =
      sources.find((source) => !incoming.includes(source.toLowerCase())) ?? sources[0] ?? null;
    details[String(row.Id)] = {
      id: String(row.Id),
      title: row.Title ?? null,
      sku: row.Sku ?? null,
      price: row.Price ?? null,
      imageUrl: row.PrimaryImageUrl ?? images[0] ?? null,
      sourcePlatform,
    };
  }
  return details;
}
