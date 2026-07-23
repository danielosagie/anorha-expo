import { ensureSupabaseJwt, supabase } from './supabase';
import type { CanonicalRef } from '../types/syncItem';

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
