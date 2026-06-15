import { supabase } from '../lib/supabase';
import { createLogger } from './logger';
const log = createLogger('InventoryChecker');


export interface InventoryMatch {
  productId: string;
  variantId: string;
  title: string;
  sku: string;
  barcode?: string;
  price: number;
  quantity?: number;
  image?: string;
  lastUpdated: string;
}

export interface InventoryCheckResult {
  exists: boolean;
  matches: InventoryMatch[];
  suggestions: {
    action: 'update_quantity' | 'create_variant' | 'search_web';
    message: string;
    data?: any;
  }[];
}

/**
 * Check if a product exists in user's inventory by barcode
 */
export async function checkInventoryByBarcode(barcode: string): Promise<InventoryCheckResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User not authenticated');
    }

    const { data: variants, error } = await supabase
      .from('ProductVariants')
      .select(`
        Id,
        ProductId,
        Title,
        Sku,
        Barcode,
        Price,
        InventoryQuantity,
        ImageId,
        UpdatedAt,
        Products!inner(
          Id,
          Title,
          UserId
        )
      `)
      .eq('Barcode', barcode)
      .eq('Products.UserId', user.id);

    if (error) {
      log.error('Error checking barcode inventory:', error);
      return { exists: false, matches: [], suggestions: [] };
    }

    const matches: InventoryMatch[] = variants?.map(variant => ({
      productId: variant.ProductId,
      variantId: variant.Id,
      title: variant.Title || (variant.Products as any)?.Title,
      sku: variant.Sku,
      barcode: variant.Barcode,
      price: variant.Price || 0,
      quantity: variant.InventoryQuantity,
      lastUpdated: variant.UpdatedAt
    })) || [];

    const suggestions = [];
    if (matches.length > 0) {
      suggestions.push({
        action: 'update_quantity' as const,
        message: 'This product exists in your inventory. Would you like to update the quantity?',
        data: { existingProduct: matches[0] }
      });
      
      suggestions.push({
        action: 'create_variant' as const,
        message: 'Create a new variant of this existing product?',
        data: { baseProduct: matches[0] }
      });
    } else {
      suggestions.push({
        action: 'search_web' as const,
        message: 'Product not found in inventory. Search the web for details?',
        data: { barcode }
      });
    }

    return {
      exists: matches.length > 0,
      matches,
      suggestions
    };
  } catch (error) {
    log.error('Error in checkInventoryByBarcode:', error);
    return { exists: false, matches: [], suggestions: [] };
  }
}

/**
 * Check if a product exists in user's inventory by SKU
 */
export async function checkInventoryBySku(sku: string): Promise<InventoryCheckResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User not authenticated');
    }

    const { data: variants, error } = await supabase
      .from('ProductVariants')
      .select(`
        Id,
        ProductId,
        Title,
        Sku,
        Barcode,
        Price,
        InventoryQuantity,
        ImageId,
        UpdatedAt,
        Products!inner(
          Id,
          Title,
          UserId
        )
      `)
      .eq('Sku', sku)
      .eq('Products.UserId', user.id);

    if (error) {
      log.error('Error checking SKU inventory:', error);
      return { exists: false, matches: [], suggestions: [] };
    }

    const matches: InventoryMatch[] = variants?.map(variant => ({
      productId: variant.ProductId,
      variantId: variant.Id,
      title: variant.Title || (variant.Products as any)?.Title,
      sku: variant.Sku,
      barcode: variant.Barcode,
      price: variant.Price || 0,
      quantity: variant.InventoryQuantity,
      lastUpdated: variant.UpdatedAt
    })) || [];

    return {
      exists: matches.length > 0,
      matches,
      suggestions: matches.length > 0 ? [{
        action: 'update_quantity' as const,
        message: 'This SKU already exists. Update quantity?',
        data: { existingProduct: matches[0] }
      }] : [{
        action: 'search_web' as const,
        message: 'SKU not found. Create new product?',
        data: { sku }
      }]
    };
  } catch (error) {
    log.error('Error in checkInventoryBySku:', error);
    return { exists: false, matches: [], suggestions: [] };
  }
}

/**
 * Search inventory by product title (fuzzy search)
 */
export async function searchInventoryByTitle(title: string): Promise<InventoryCheckResult> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User not authenticated');
    }

    // Use PostgreSQL's full-text search or simple ILIKE for fuzzy matching
    const { data: variants, error } = await supabase
      .from('ProductVariants')
      .select(`
        Id,
        ProductId,
        Title,
        Sku,
        Barcode,
        Price,
        InventoryQuantity,
        ImageId,
        UpdatedAt,
        Products!inner(
          Id,
          Title,
          UserId
        )
      `)
      .or(`Title.ilike.%${title}%,Products.Title.ilike.%${title}%`)
      .eq('Products.UserId', user.id)
      .limit(10);

    if (error) {
      log.error('Error searching inventory by title:', error);
      return { exists: false, matches: [], suggestions: [] };
    }

    const matches: InventoryMatch[] = variants?.map(variant => ({
      productId: variant.ProductId,
      variantId: variant.Id,
      title: variant.Title || (variant.Products as any)?.Title,
      sku: variant.Sku,
      barcode: variant.Barcode,
      price: variant.Price || 0,
      quantity: variant.InventoryQuantity,
      lastUpdated: variant.UpdatedAt
    })) || [];

    return {
      exists: matches.length > 0,
      matches,
      suggestions: matches.length > 0 ? [{
        action: 'update_quantity' as const,
        message: `Found ${matches.length} similar product(s). Select one to update?`,
        data: { similarProducts: matches }
      }] : [{
        action: 'search_web' as const,
        message: 'No similar products found. Search web for details?',
        data: { searchQuery: title }
      }]
    };
  } catch (error) {
    log.error('Error in searchInventoryByTitle:', error);
    return { exists: false, matches: [], suggestions: [] };
  }
}

/**
 * Get recently added products for quick access
 */
export async function getRecentProducts(limit: number = 10): Promise<InventoryMatch[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return [];
    }

    const { data: variants, error } = await supabase
      .from('ProductVariants')
      .select(`
        Id,
        ProductId,
        Title,
        Sku,
        Barcode,
        Price,
        InventoryQuantity,
        ImageId,
        UpdatedAt,
        Products!inner(
          Id,
          Title,
          UserId
        )
      `)
      .eq('Products.UserId', user.id)
      .order('UpdatedAt', { ascending: false })
      .limit(limit);

    if (error) {
      log.error('Error fetching recent products:', error);
      return [];
    }

    return variants?.map(variant => ({
      productId: variant.ProductId,
      variantId: variant.Id,
      title: variant.Title || (variant.Products as any)?.Title,
      sku: variant.Sku,
      barcode: variant.Barcode,
      price: variant.Price || 0,
      quantity: variant.InventoryQuantity,
      lastUpdated: variant.UpdatedAt
    })) || [];
  } catch (error) {
    log.error('Error in getRecentProducts:', error);
    return [];
  }
} 