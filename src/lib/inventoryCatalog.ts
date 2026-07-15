import { supabase } from './supabase';

export type InventoryCatalogItem = {
  id: string;
  title: string;
  price: number;
  imageUrl?: string;
};

export async function loadInventoryCatalog(userId: string): Promise<InventoryCatalogItem[]> {
  const { data, error } = await supabase
    .from('ProductVariants')
    .select('Id, Title, Price, PrimaryImageUrl, VariantType, IsArchived, ProductImages!ProductImages_ProductVariantId_fkey ( ImageUrl, Position )')
    .eq('UserId', userId)
    .not('Sku', 'like', 'DRAFT-%')
    .range(0, 499);

  if (error) throw error;

  return (data ?? [])
    .filter((row: any) => row.VariantType !== 'option' && !row.IsArchived)
    .map((row: any) => {
      const productImages = Array.isArray(row.ProductImages) ? row.ProductImages : [];
      const imageUrl = productImages
        .slice()
        .sort((a: any, b: any) => (a.Position ?? 0) - (b.Position ?? 0))
        .map((image: any) => image.ImageUrl)
        .find((url: unknown): url is string => typeof url === 'string' && url.trim().length > 0)
        ?? (typeof row.PrimaryImageUrl === 'string' ? row.PrimaryImageUrl : undefined);

      return {
        id: String(row.Id),
        title: String(row.Title || 'Item'),
        price: Number(row.Price ?? 0),
        imageUrl,
      };
    });
}
